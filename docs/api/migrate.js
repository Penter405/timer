const { getCollections } = require('../lib/mongoClient');
const { encryptNickname } = require('../lib/encryption');
const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    sendError,
    sendSuccess,
    getColumnLetter,
    getBucketIndex
} = require('../lib/apiUtils');

const USERMAP_TEAM_COUNT = 8;

/**
 * Migration API Endpoint
 * 
 * Migrates data from Google Sheets to MongoDB
 * - UserMap → users collection
 * - Counts → integrated into users
 * - Total → users collection
 * 
 * Security: No authentication required (admin operation, run once)
 * Usage: GET https://your-domain.vercel.app/api/migrate
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    try {
        console.log('[MIGRATE] Starting migration...');

        // Connect to MongoDB
        const { users } = await getCollections();

        // Connect to Google Sheets
        const sheets = getSheetsClient();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        if (!spreadsheetId) {
            return sendError(res, 500, 'GOOGLE_SHEET_ID not configured');
        }

        const report = {
            totalSheetUsers: 0,
            newUsers: 0,
            existingUsers: 0,
            errors: []
        };

        // Step 1: Read Total sheet
        console.log('[MIGRATE] Reading Total sheet...');
        const totalResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Total!A:B'
        });

        const totalRows = totalResponse.data.values || [];
        const totalData = {};

        totalRows.forEach((row, index) => {
            const userID = index + 1;
            const email = row[0];
            const nickname = row[1];

            if (email) {
                totalData[userID] = {
                    email: email.trim(),
                    nickname: nickname || `Player${userID}`
                };
            }
        });

        console.log(`[MIGRATE] Found ${Object.keys(totalData).length} users in Total`);

        // Step 2: Read UserMap (all teams)
        console.log('[MIGRATE] Reading UserMap...');
        const userMapData = [];

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
                        userMapData.push({
                            email: email.trim(),
                            userID: parseInt(userID),
                            uniqueName: uniqueName || ''
                        });
                    }
                });
            } catch (error) {
                console.warn(`[MIGRATE] Team ${teamIndex} error:`, error.message);
                report.errors.push(`Team ${teamIndex}: ${error.message}`);
            }
        }

        console.log(`[MIGRATE] Found ${userMapData.length} users in UserMap`);
        report.totalSheetUsers = userMapData.length;

        // Step 3: Merge and create user documents
        console.log('[MIGRATE] Preparing user documents...');

        const existingUsers = await users.find({}).toArray();
        const existingEmails = new Set(existingUsers.map(u => u.email));

        const newUserDocs = [];
        const processedEmails = new Set();

        for (const userMapEntry of userMapData) {
            const { email, userID, uniqueName } = userMapEntry;

            // Skip if already processed or exists
            if (processedEmails.has(email) || existingEmails.has(email)) {
                if (existingEmails.has(email)) {
                    report.existingUsers++;
                }
                continue;
            }

            // Priority: UserMap UniqueName > Total Nickname > Empty
            let nickname = '';
            let nicknameSource = 'Empty';

            if (uniqueName && uniqueName.trim()) {
                // UserMap has nickname (Priority!)
                nickname = uniqueName.trim();
                nicknameSource = 'UserMap';
            } else {
                // Fallback to Total
                const totalEntry = totalData[userID];
                if (totalEntry?.nickname && totalEntry.nickname.trim()) {
                    nickname = totalEntry.nickname.trim();
                    nicknameSource = 'Total';
                }
                // else: nickname remains empty string
            }

            console.log(`[MIGRATE] User ${userID}: ${email} -> ${nickname || '(empty)'} (from ${nicknameSource})`);

            const userDoc = {
                email,
                userID: parseInt(userID),
                nickname,
                encryptedNickname: nickname ? encryptNickname(nickname, userID) : '',  // Only encrypt if nickname exists
                createdAt: new Date(),
                updatedAt: new Date(),
                migratedFrom: 'sheets',
                migratedAt: new Date()
            };

            newUserDocs.push(userDoc);
            processedEmails.add(email);
        }

        // Step 4: Insert new users
        if (newUserDocs.length > 0) {
            console.log(`[MIGRATE] Inserting ${newUserDocs.length} new users...`);
            await users.insertMany(newUserDocs);
            report.newUsers = newUserDocs.length;
            console.log(`[MIGRATE] Successfully inserted ${newUserDocs.length} users`);
        } else {
            console.log('[MIGRATE] No new users to insert');
        }

        // Step 5: Get final statistics
        const finalCount = await users.countDocuments({});

        console.log('[MIGRATE] Migration completed successfully');

        return sendSuccess(res, {
            success: true,
            report: {
                ...report,
                finalMongoDBUsers: finalCount
            },
            message: `Migration completed: ${report.newUsers} new users added, ${report.existingUsers} already existed`
        });

    } catch (error) {
        console.error('[MIGRATE] Error:', error);
        return sendError(res, 500, error.message, '遷移失敗');
    }
};
