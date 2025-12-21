const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

/**
 * Connect to MongoDB with connection pooling
 * Uses cached connection for serverless efficiency
 */
async function connectToMongo() {
    // Return cached connection if available
    if (cachedClient && cachedDb) {
        console.log('[MongoDB] Using cached connection');
        return { client: cachedClient, db: cachedDb };
    }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
        throw new Error('MONGODB_URI environment variable is not set');
    }

    console.log('[MongoDB] Creating new connection...');

    const client = await MongoClient.connect(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10, // Connection pool size
        serverSelectionTimeoutMS: 5000, // Timeout after 5s
        socketTimeoutMS: 45000, // Close sockets after 45s
    });

    const db = client.db('timer'); // Database name

    // Cache for reuse
    cachedClient = client;
    cachedDb = db;

    console.log('[MongoDB] Connected successfully');

    return { client, db };
}

/**
 * Get MongoDB collections
 */
async function getCollections() {
    const { db } = await connectToMongo();

    return {
        users: db.collection('users'),
        scores: db.collection('scores')
    };
}

/**
 * Initialize database indexes (run once)
 */
async function initializeIndexes() {
    const { users, scores } = await getCollections();

    console.log('[MongoDB] Creating indexes...');

    // Users collection indexes
    await users.createIndex({ email: 1 }, { unique: true });
    await users.createIndex({ userID: 1 }, { unique: true });
    await users.createIndex({ googleIdHash: 1 });

    // Scores collection indexes
    await scores.createIndex({ userID: 1, period: 1 });
    await scores.createIndex({ period: 1, time: 1 }); // For leaderboard queries
    await scores.createIndex({ createdAt: -1 });

    console.log('[MongoDB] Indexes created successfully');
}

module.exports = {
    connectToMongo,
    getCollections,
    initializeIndexes
};
