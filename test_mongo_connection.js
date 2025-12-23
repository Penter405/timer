/**
 * MongoDB Connection Test Script
 * Run this locally to verify MongoDB Atlas connection
 * 
 * Usage: node test_mongo_connection.js
 */

require('dotenv').config({ path: '.env.local' });
const { connectToMongo, initializeIndexes } = require('./docs/lib/mongoClient');

async function testMongoConnection() {
    console.log('🔍 Testing MongoDB Connection...\n');

    try {
        // Test 1: Connect to MongoDB
        console.log('📡 Connecting to MongoDB Atlas...');
        const { db } = await connectToMongo();
        console.log('✅ Connected successfully!\n');

        // Test 2: Check database
        console.log('📊 Database Name:', db.databaseName);
        const collections = await db.listCollections().toArray();
        console.log('📦 Existing Collections:', collections.map(c => c.name).join(', ') || 'None');
        console.log('');

        // Test 3: Create indexes
        console.log('🔧 Creating indexes...');
        await initializeIndexes();
        console.log('✅ Indexes created!\n');

        // Test 4: Insert test document
        console.log('💾 Inserting test document...');
        const users = db.collection('users');

        const testUser = {
            email: `test_${Date.now()}@example.com`,
            userID: Date.now(),
            nickname: 'TestPlayer',
            encryptedNickname: Buffer.from(`${Date.now()}:TestPlayer`).toString('base64'),
            createdAt: new Date()
        };

        const insertResult = await users.insertOne(testUser);
        console.log('✅ Test document inserted!');
        console.log('   ID:', insertResult.insertedId);
        console.log('');

        // Test 5: Query test document
        console.log('🔎 Querying test document...');
        const foundUser = await users.findOne({ _id: insertResult.insertedId });
        console.log('✅ Found:', foundUser.email);
        console.log('');

        // Test 6: Delete test document
        console.log('🗑️  Cleaning up test document...');
        await users.deleteOne({ _id: insertResult.insertedId });
        console.log('✅ Test document deleted!\n');

        // Test 7: Get collection stats (using countDocuments)
        console.log('📈 Collection Stats:');
        const count = await users.countDocuments();
        console.log('   Documents:', count);
        console.log('   Indexes: (use listIndexes if needed)');
        console.log('');

        console.log('🎉 All tests passed! MongoDB is ready to use.\n');

        // Connection info
        console.log('ℹ️  Connection Info:');
        console.log('   URI:', process.env.MONGODB_URI.replace(/:[^:@]+@/, ':****@'));
        console.log('   Database:', db.databaseName);
        console.log('   Collections: users, scores');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('\n💡 Troubleshooting:');
        console.error('   1. Check MONGODB_URI in .env.local');
        console.error('   2. Verify Network Access in MongoDB Atlas (0.0.0.0/0)');
        console.error('   3. Confirm Database User credentials');
        console.error('   4. Check if cluster is running');
        process.exit(1);
    }

    process.exit(0);
}

// Run test
testMongoConnection();
