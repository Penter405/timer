const { connectToMongo } = require('../lib/mongoClient');
const { encryptNickname } = require('../lib/encryption');
const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    verifyGoogleToken,
    sendError,
    sendSuccess
} = require('../lib/apiUtils');

/**
 * Update Nickname API (MongoDB with Counts Collection)
 * 
 * Uses atomic counters to prevent nickname and userID collisions
 * 
 * Request Body:
 * - token: Google ID Token (required)
 * - nickname: Nickname to set (required)
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    try {
        // === 1. Extract and Validate Input ===
        const { token, nickname } = req.body;

        const email = verifyGoogleToken(token);
        if (!email) {
            return sendError(res, 401, 'Invalid or expired token', '請重新登入');
        }

        if (!nickname || typeof nickname !== 'string') {
            return sendError(res, 400, 'Invalid nickname', '暱稱不能為空');
        }

        console.log(`[UPDATE_NICKNAME] Processing for email: ${email}`);

        // === 2. Get MongoDB Collections ===
        const { db } = await connectToMongo();
        const users = db.collection('users');
        const counts = db.collection('counts');

        // === 3. Check if user exists ===
        let user = await users.findOne({ email });
        let isNewUser = false;

        if (!user) {
            // New user - get next userID using atomic counter
            const counterResult = await counts.findOneAndUpdate(
                { _id: 'userID' },
                { $inc: { count: 1 } },
                { upsert: true, returnDocument: 'after' }
            );

            const userID = counterResult.value.count;

            user = {
                email,
                userID,
                nickname: '',
                encryptedNickname: '',
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await users.insertOne(user);
            isNewUser = true;
            console.log(`[UPDATE_NICKNAME] New user registered: UserID ${userID}`);
        }

        // === 4. Generate unique nickname using atomic counter ===
        const nicknameKey = `nickname_${nickname}`;

        const nicknameCounter = await counts.findOneAndUpdate(
            { _id: nicknameKey },
            { $inc: { count: 1 } },
            { upsert: true, returnDocument: 'after' }
        );

        const count = nicknameCounter.value.count;
        const uniqueName = count === 1 ? nickname : `${nickname}#${count}`;
        const encryptedNick = encryptNickname(uniqueName, user.userID);

        // === 5. Update MongoDB ===
        await users.updateOne(
            { email },
            {
                $set: {
                    nickname: uniqueName,
                    encryptedNickname: encryptedNick,
                    updatedAt: new Date()
                }
            }
        );

        console.log(`[UPDATE_NICKNAME] Updated: ${email} -> ${uniqueName}`);

        // === 6. Optional: Sync to Google Sheets ===
        try {
            await syncNicknameToSheets(user.userID, uniqueName, encryptedNick);
        } catch (sheetError) {
            console.error(`[UPDATE_NICKNAME] Sheet sync failed (non-critical):`, sheetError.message);
        }

        // === 7. Return Success ===
        sendSuccess(res, {
            userID: user.userID,
            uniqueName,
            isNewUser
        }, '暱稱已成功更新');

    } catch (err) {
        console.error('[UPDATE_NICKNAME] Error:', err);
        sendError(res, 500, err.message, '伺服器錯誤，請稍後再試');
    }
};

/**
 * Sync nickname to Google Sheets Total sheet (optional)
 */
async function syncNicknameToSheets(userID, uniqueName, encryptedNickname) {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) {
        console.warn('[UPDATE_NICKNAME] No GOOGLE_SHEET_ID, skipping sheet sync');
        return;
    }

    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Total!B${userID}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[uniqueName]]
            }
        });
        console.log(`[UPDATE_NICKNAME] Synced to Sheet: UserID ${userID} -> ${uniqueName}`);
    } catch (error) {
        console.warn('[UPDATE_NICKNAME] Sheet sync skipped:', error.message);
    }
}
