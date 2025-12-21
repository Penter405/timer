const { getCollections } = require('../lib/mongoClient');
const { encryptNickname } = require('../lib/encryption');
const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    verifyGoogleToken,
    sendError,
    sendSuccess
} = require('../lib/apiUtils');

/**
 * Update Nickname API (MongoDB Primary + Google Sheets Sync)
 * 
 * Data Strategy:
 * - MongoDB: Store user email, nickname, and encrypted nickname
 * - Google Sheets: Optional sync for backup/compatibility
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
        const { users } = await getCollections();

        // === 3. Check if user exists ===
        let user = await users.findOne({ email });
        let isNewUser = false;

        if (!user) {
            // New user - auto-register
            const userCount = await users.countDocuments();
            const userID = userCount + 1;

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

        // === 4. Check nickname uniqueness and generate unique name ===
        const nicknamePattern = new RegExp(`^${escapeRegex(nickname)}(#\\d+)?$`);
        const existingUsers = await users.find({ nickname: nicknamePattern }).toArray();

        // Count existing users with same nickname
        let maxNumber = 0;
        for (const existingUser of existingUsers) {
            const match = existingUser.nickname?.match(/#(\d+)$/);
            if (match) {
                maxNumber = Math.max(maxNumber, parseInt(match[1]));
            } else if (existingUser.nickname === nickname) {
                maxNumber = Math.max(maxNumber, 1);
            }
        }

        const uniqueName = maxNumber > 0 ? `${nickname}#${maxNumber + 1}` : nickname;
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
 * Escape regex special characters
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

    // Update Total sheet Row = userID
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
