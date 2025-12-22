const { connectToMongo } = require('../lib/mongoClient');
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
 * - nickname: Nickname to set (optional - empty = sync/get mode)
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

        console.log(`[UPDATE_NICKNAME] Processing for email: ${email}, nickname: "${nickname || '(sync mode)'}"`);

        // === 2. Get MongoDB Collections ===
        const { db } = await connectToMongo();
        const users = db.collection('users');
        const counts = db.collection('counts');
        const total = db.collection('total');

        // === 3. Check if user exists ===
        let user = await users.findOne({ email });
        let isNewUser = false;

        if (!user) {
            // New user - get next userID from total collection
            const counterResult = await total.findOneAndUpdate(
                { _id: 'userID' },
                { $inc: { count: 1 } },
                { upsert: true, returnDocument: 'after' }
            );

            const userID = counterResult.value.count;

            user = {
                email,
                userID,
                nickname: '',  // Empty until user sets it
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await users.insertOne(user);
            isNewUser = true;
            console.log(`[UPDATE_NICKNAME] New user registered: UserID ${userID}`);
        }

        // === 4. Handle Sync Mode (empty nickname) ===
        if (!nickname || nickname.trim() === '') {
            // Sync mode: just return existing user info
            console.log(`[UPDATE_NICKNAME] Sync mode - returning existing info for UserID ${user.userID}`);
            return sendSuccess(res, {
                userID: user.userID,
                uniqueName: user.nickname || null,
                isNewUser
            }, '用戶資訊同步成功');
        }

        // === 5. Generate unique nickname with #number (always) ===
        const trimmedNickname = nickname.trim();
        const nicknameCounter = await counts.findOneAndUpdate(
            { _id: trimmedNickname },  // No prefix
            { $inc: { count: 1 } },
            { upsert: true, returnDocument: 'after' }
        );

        const number = nicknameCounter.value.count;
        const uniqueName = `${trimmedNickname}#${number}`;  // Always has #number

        // === 6. Update MongoDB ===
        await users.updateOne(
            { email },
            {
                $set: {
                    nickname: uniqueName,
                    updatedAt: new Date()
                }
            }
        );

        console.log(`[UPDATE_NICKNAME] Updated: ${email} -> ${uniqueName}`);

        // === 7. Optional: Sync to Google Sheets ===
        try {
            await syncNicknameToSheets(user.userID, uniqueName);
        } catch (sheetError) {
            console.error(`[UPDATE_NICKNAME] Sheet sync failed (non-critical):`, sheetError.message);
        }

        // === 8. Return Success ===
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
async function syncNicknameToSheets(userID, uniqueName) {
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
