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
        const total = db.collection('total');

        // === 1. Initialize userID counter in total collection ===
        const maxUserResult = await users.find()
            .sort({ userID: -1 })
            .limit(1)
            .toArray();

        const maxUserID = maxUserResult[0]?.userID || 0;
        const nextUserID = maxUserID + 1;

        await total.updateOne(
            { _id: 'userID' },
            { $set: { count: nextUserID } },
            { upsert: true }
        );

        console.log(`[INIT_COUNTS] UserID counter set to: ${nextUserID}`);

        // === 2. Initialize nickname counters (Name#number format) ===
        const allUsers = await users.find({}).toArray();
        const nicknameCounts = {};

        for (const user of allUsers) {
            if (!user.nickname) continue;

            // Parse Name#number format
            const match = user.nickname.match(/^(.+?)#(\d+)$/);
            if (match) {
                const baseNickname = match[1];
                const number = parseInt(match[2]);

                // Track max number for each base nickname
                if (!nicknameCounts[baseNickname] || nicknameCounts[baseNickname] < number) {
                    nicknameCounts[baseNickname] = number;
                }
            } else {
                // Old format without #number (shouldn't happen in new system)
                console.warn(`[INIT_COUNTS] User ${user.userID} has old format nickname: ${user.nickname}`);
            }
        }

        // Set counters in counts collection (no prefix)
        let nicknameCountersSet = 0;
        for (const [baseNickname, maxCount] of Object.entries(nicknameCounts)) {
            await counts.updateOne(
                { _id: baseNickname },  // No prefix - just the nickname
                { $set: { count: maxCount } },
                { upsert: true }
            );
            nicknameCountersSet++;
        }

        console.log(`[INIT_COUNTS] ${nicknameCountersSet} nickname counters initialized`);

        // === 3. Return summary ===
        const finalTotalCounters = await total.find({}).toArray();
        const finalNicknameCounters = await counts.find({}).toArray();

        sendSuccess(res, {
            success: true,
            counters: {
                userID: nextUserID,
                nicknameCountersSet,
                totalCounters: finalTotalCounters.length + finalNicknameCounters.length
            },
            collections: {
                total: finalTotalCounters,
                counts: finalNicknameCounters
            }
        }, '計數器初始化完成');

    } catch (error) {
        console.error('[INIT_COUNTS] Error:', error);
        sendError(res, 500, error.message, '初始化失敗');
    }
};
