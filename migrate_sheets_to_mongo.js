/**
 * Migrate Google Sheets Data to MongoDB
 * 
 * This script migrates data from Google Sheets (UserMap, Counts, Total)
 * to MongoDB collections (users)
 * 
 * Usage:
 * 1. Ensure .env.local has MONGODB_URI and GOOGLE_SHEET_ID
 * 2. Run: node migrate_sheets_to_mongo.js
 */

require('dotenv').config({ path: '.env.local' });
const { connectToMongo } = require('./docs/lib/mongoClient');
const { encryptNickname } = require('./docs/lib/encryption');
const getSheetsClient = require('./docs/api/sheetsClient');

const USERMAP_TEAM_COUNT = 8;

/**
 * Main migration function
 */
async function migrateData() {
    console.log('🔄 Starting migration from Google Sheets to MongoDB...\n');

    try {
        // Connect to MongoDB
        const { db } = await connectToMongo();
        const users = db.collection('users');
        const scores = db.collection('scores');

        console.log('✅ Connected to MongoDB\n');

        // Get Google Sheets client
        const sheets = getSheetsClient();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        if (!spreadsheetId) {
            throw new Error('GOOGLE_SHEET_ID not found in environment variables');
        }

        console.log('✅ Connected to Google Sheets\n');

        // Step 1: Migrate Total sheet (userID → nickname mapping)
        console.log('📊 Step 1: Migrating Total sheet...');
        const totalData = await migrateTotal(sheets, spreadsheetId);
        console.log(`   Found ${totalData.length} users in Total sheet\n`);

        // Step 2: Migrate UserMap (email → userID mapping)
        console.log('📊 Step 2: Migrating UserMap...');
        const userMapData = await migrateUserMap(sheets, spreadsheetId);
        console.log(`   Found ${userMapData.length} users in UserMap\n`);

        // Step 3: Merge and create users documents
        console.log('📊 Step 3: Creating users in MongoDB...');

        const userDocuments = [];
        const processedEmails = new Set();

        // Process UserMap data (has email)
        for (const userMapEntry of userMapData) {
            const { email, userID, uniqueName } = userMapEntry;

            if (processedEmails.has(email)) {
                console.log(`   ⚠️  Duplicate email: ${email}`);
                continue;
            }

            // Get nickname from Total if available
            const totalEntry = totalData.find(t => t.userID === userID);
            const nickname = totalEntry?.nickname || uniqueName || `Player${userID}`;

            const userDoc = {
                email,
                userID: parseInt(userID),
                nickname,
                encryptedNickname: encryptNickname(nickname, userID),
                createdAt: new Date(),
                updatedAt: new Date(),
                migratedFrom: 'sheets'
            };

            userDocuments.push(userDoc);
            processedEmails.add(email);
        }

        // Insert users to MongoDB
        if (userDocuments.length > 0) {
            // Check for existing users
            const existingUsers = await users.find({}).toArray();
            const existingEmails = new Set(existingUsers.map(u => u.email));

            const newUsers = userDocuments.filter(u => !existingEmails.has(u.email));

            if (newUsers.length > 0) {
                await users.insertMany(newUsers);
                console.log(`   ✅ Migrated ${newUsers.length} users to MongoDB`);
            } else {
                console.log(`   ℹ️  All users already exist in MongoDB`);
            }

            if (userDocuments.length > newUsers.length) {
                console.log(`   ⚠️  Skipped ${userDocuments.length - newUsers.length} duplicate users`);
            }
        }

        console.log('\n🎉 Migration completed successfully!\n');

        // Show statistics
        const finalUserCount = await users.countDocuments({});
        const finalScoreCount = await scores.countDocuments({});

        console.log('📊 Final Statistics:');
        console.log(`   Users in MongoDB: ${finalUserCount}`);
        console.log(`   Scores in MongoDB: ${finalScoreCount}`);
        console.log('');

        // Show sample data
        console.log('📝 Sample migrated users:');
        const sampleUsers = await users.find({}).limit(5).toArray();
        sampleUsers.forEach(user => {
            console.log(`   - UserID ${user.userID}: ${user.nickname} (${user.email})`);
        });

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }

    process.exit(0);
}

/**
 * Migrate Total sheet data
 */
async function migrateTotal(sheets, spreadsheetId) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Total!A:B'
    });

    const rows = response.data.values || [];
    const data = [];

    rows.forEach((row, index) => {
        const userID = index + 1;
        const email = row[0];
        const nickname = row[1];

        if (email || nickname) {
            data.push({
                userID,
                email: email || '',
                nickname: nickname || `Player${userID}`
            });
        }
    });

    return data;
}

/**
 * Migrate UserMap data
 */
async function migrateUserMap(sheets, spreadsheetId) {
    const allData = [];

    // Read all teams (0 to 7)
    for (let teamIndex = 0; teamIndex < USERMAP_TEAM_COUNT; teamIndex++) {
        const startCol = teamIndex * 3;
        const firstColLetter = getColumnLetter(startCol);
        const lastColLetter = getColumnLetter(startCol + 2);

        const range = `UserMap!${firstColLetter}:${lastColLetter}`;

        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range
            });

            const rows = response.data.values || [];

            rows.forEach(row => {
                const email = row[0];
                const userID = row[1];
                const uniqueName = row[2];

                if (email && userID) {
                    allData.push({
                        email: email.trim(),
                        userID: parseInt(userID),
                        uniqueName: uniqueName || ''
                    });
                }
            });
        } catch (error) {
            console.log(`   ⚠️  Team ${teamIndex} read error:`, error.message);
        }
    }

    return allData;
}

/**
 * Get Excel column letter from index
 */
function getColumnLetter(index) {
    let letter = '';
    while (index >= 0) {
        letter = String.fromCharCode((index % 26) + 65) + letter;
        index = Math.floor(index / 26) - 1;
    }
    return letter;
}

// Run migration
migrateData();
