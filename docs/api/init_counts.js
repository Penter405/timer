const { connectToMongo } = require('../lib/mongoClient');
const {
    handleCORS,
    sendError,
    sendSuccess
} = require('../lib/apiUtils');

/**
 * Initialize Counts Collection
 * 
 * Sets up atomic counters based on existing data
 * - userID counter: max userID + 1
 * - nickname counters: count for each base nickname
 * 
 * Usage: GET https://your-domain.vercel.app/api/init_counts
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    try {
        console.log('[INIT_COUNTS] Starting initialization...');

        const { db } = await connectToMongo();
        const users = db.collection('users');
        const counts = db.collection('counts');

        // === 1. Initialize userID counter ===
        const maxUserResult = await users.find()
            .sort({ userID: -1 })
            .limit(1)
            .toArray();

        const maxUserID = maxUserResult[0]?.userID || 0;
        const nextUserID = maxUserID + 1;

        await counts.updateOne(
            { _id: 'userID' },
            { $set: { count: nextUserID } },
            { upsert: true }
        );

        console.log(`[INIT_COUNTS] UserID counter set to: ${nextUserID}`);

        // === 2. Initialize nickname counters ===
        const allUsers = await users.find({}).toArray();
        const nicknameCounts = {};

        for (const user of allUsers) {
            if (!user.nickname) continue;

            // Extract base nickname (before #)
            const match = user.nickname.match(/^(.+?)(#\d+)?$/);
            const baseNickname = match ? match[1] : user.nickname;

            // Extract number
            const numberMatch = user.nickname.match(/#(\d+)$/);
            const number = numberMatch ? parseInt(numberMatch[1]) : 1;

            // Track max number for each base nickname
            if (!nicknameCounts[baseNickname] || nicknameCounts[baseNickname] < number) {
                nicknameCounts[baseNickname] = number;
            }
        }

        // Set counters
        let nicknameCountersSet = 0;
        for (const [baseNickname, maxCount] of Object.entries(nicknameCounts)) {
            await counts.updateOne(
                { _id: `nickname_${baseNickname}` },
                { $set: { count: maxCount } },
                { upsert: true }
            );
            nicknameCountersSet++;
        }

        console.log(`[INIT_COUNTS] ${nicknameCountersSet} nickname counters initialized`);

        // === 3. Return summary ===
        const finalCounters = await counts.find({}).toArray();

        sendSuccess(res, {
            success: true,
            counters: {
                userID: nextUserID,
                nicknameCountersSet,
                totalCounters: finalCounters.length
            },
            details: finalCounters
        }, '計數器初始化完成');

    } catch (error) {
        console.error('[INIT_COUNTS] Error:', error);
        sendError(res, 500, error.message, '初始化失敗');
    }
};
