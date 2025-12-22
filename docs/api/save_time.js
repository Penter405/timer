const { connectToMongo } = require('../lib/mongoClient');
const {
    handleCORS,
    verifyGoogleToken,
    sendError,
    sendSuccess,
    formatDate,
    formatTime
} = require('../lib/apiUtils');

/**
 * Save Time API (MongoDB with Dual Collections)
 * 
 * Data Strategy:
 * - Save to MongoDB `scores` collection (all scores)
 * - Update `scores_unique` collection (best per user per period)
 * - External cron job syncs to Google Sheets
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    try {
        // === 1. Authenticate User ===
        const authHeader = req.headers.authorization;
        let token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

        const email = verifyGoogleToken(token);
        if (!email) {
            return sendError(res, 401, 'Invalid or expired token', '請重新登入');
        }

        console.log(`[SAVE_TIME] Authenticated: ${email}`);

        // === 2. Validate Input ===
        const { time, scramble, date } = req.body;
        if (!time || isNaN(parseFloat(time))) {
            return sendError(res, 400, 'Missing or invalid time', '缺少或無效的時間數據');
        }

        const timeInSeconds = parseFloat((parseFloat(time) / 1000).toFixed(3));

        // === 3. Get or Create User in MongoDB ===
        const { db } = await connectToMongo();
        const users = db.collection('users');
        const scores = db.collection('scores');
        const scoresUnique = db.collection('scores_unique');
        const total = db.collection('total');

        let user = await users.findOne({ email });

        if (!user) {
            // Auto-register user with userID from total collection
            console.log(`[SAVE_TIME] Auto-registering user: ${email}`);

            const counterResult = await total.findOneAndUpdate(
                { _id: 'userID' },
                { $inc: { count: 1 } },
                { upsert: true, returnDocument: 'after' }
            );

            // MongoDB driver v4+ returns the document directly, not in .value
            const userID = counterResult?.count || counterResult?.value?.count;

            user = {
                email,
                userID,
                nickname: '',  // Empty until user sets nickname
                createdAt: new Date()
            };

            await users.insertOne(user);
            console.log(`[SAVE_TIME] Created user with ID: ${userID}`);
        }

        // === 4. Prepare score document ===
        const timestamp = date ? new Date(date) : new Date();
        const scoreDocument = {
            userID: user.userID,
            time: timeInSeconds,
            scramble: scramble || '',
            date: formatDate(timestamp),
            timestamp: formatTime(timestamp),
            syncStatus: 'pending',  // Will be synced by cron job
            createdAt: timestamp
        };

        // === 5. Save to scores collection (all scores) ===
        await scores.insertOne(scoreDocument);
        console.log(`[SAVE_TIME] Saved to scores: UserID ${user.userID}, Time ${timeInSeconds}`);

        // === 6. Update scores_unique for each period ===
        // Only update if this is a better (faster) time
        const periods = ['all', 'year', 'month', 'week', 'today'];

        for (const period of periods) {
            const uniqueKey = { userID: user.userID, period };

            // Use findOneAndUpdate with $min to atomically keep the best time
            await scoresUnique.findOneAndUpdate(
                uniqueKey,
                {
                    $min: { time: timeInSeconds },  // Only update if new time is lower
                    $setOnInsert: {
                        userID: user.userID,
                        period,
                        scramble: scramble || '',
                        date: formatDate(timestamp),
                        timestamp: formatTime(timestamp),
                        createdAt: timestamp
                    },
                    $set: {
                        syncStatus: 'pending',
                        updatedAt: timestamp
                    }
                },
                { upsert: true }
            );

            // If this time is better, also update scramble/date/timestamp
            const existing = await scoresUnique.findOne(uniqueKey);
            if (existing && existing.time === timeInSeconds) {
                await scoresUnique.updateOne(uniqueKey, {
                    $set: {
                        scramble: scramble || '',
                        date: formatDate(timestamp),
                        timestamp: formatTime(timestamp)
                    }
                });
            }
        }
        console.log(`[SAVE_TIME] Updated scores_unique for all 5 periods`);

        // === 7. Return Success ===
        sendSuccess(res, {
            userID: user.userID,
            time: timeInSeconds.toFixed(3),
            scramble: scramble || '',
            date: formatDate(timestamp),
            timestamp: formatTime(timestamp),
            storage: 'mongodb'
        }, '成績已成功保存');

    } catch (err) {
        console.error('[SAVE_TIME] Error:', err);
        sendError(res, 500, err.message, '伺服器錯誤，請稍後再試');
    }
};
