const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    verifyGoogleToken,
    sendError,
    sendSuccess,
    getColumnLetter,
    getBucketIndex,
    getBucketRange
} = require('../lib/apiUtils');

/**
 * Update Nickname API
 * Register new users and update nicknames using Hash Table
 * Architecture: Web → Vercel → Sheet (option_3_vercel)
 * 
 * New User Flow:
 * 1. Hash email to find UserMap bucket
 * 2. Check if email exists in bucket
 * 3. If not found → Register in Total sheet (get UserID)
 * 4. Save [Email, UserID, Nickname] to UserMap
 * 
 * Request Body:
 * - token: Google ID Token (required)
 * - nickname: Nickname to set (optional, empty = registration only)
 */
module.exports = async (req, res) => {
    // Handle CORS
    if (handleCORS(req, res)) return;

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    try {
        // === 1. Extract and Validate Input ===
        const { token, nickname } = req.body;

        // Verify JWT and extract email
        const email = verifyGoogleToken(token);
        if (!email) {
            return sendError(res, 401, 'Invalid or expired token', '請重新登入');
        }

        console.log(`[UPDATE_NICKNAME] Processing request for email: ${email}`);

        // === 2. Get UserMap Metadata and Calculate Bucket ===
        const meta = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties(title,gridProperties.columnCount)'
        });

        const userMapProps = meta.data.sheets.find(s => s.properties.title === 'UserMap');
        if (!userMapProps) {
            throw new Error('UserMap sheet not found');
        }

        const userCols = userMapProps.properties.gridProperties.columnCount || 26;
        const userBucketSize = Math.floor(userCols / 3); // Each bucket = 3 columns
        const userBucket = getBucketIndex(email, userBucketSize);
        const userRange = getBucketRange('UserMap', userBucket, 3);

        console.log(`[UPDATE_NICKNAME] Bucket: ${userBucket}, Range: ${userRange}`);

        // === 3. Check if User Exists in UserMap ===
        const userRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: userRange
        });
        const rows = userRes.data.values || [];

        let userRowIdx = rows.findIndex(r => r && r[0] === email);
        let userID = null;
        let isNewUser = false;

        // === 4. Handle New User Registration ===
        if (userRowIdx === -1) {
            isNewUser = true;
            console.log(`[UPDATE_NICKNAME] New user detected: ${email}`);

            // Register in Total sheet to get unique ID
            const totalAppend = await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Total!A:A',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[email]] }
            });

            // Log the actual response for debugging
            console.log(`[UPDATE_NICKNAME] Total append response:`, JSON.stringify(totalAppend.data.updates, null, 2));

            // Extract row number as UserID
            // Format can be "Total!A5" or "Total!A5:A5"
            const updatedRange = totalAppend.data.updates.updatedRange;
            const match = updatedRange.match(/!A(\d+)/);
            userID = match ? match[1] : null;

            if (!userID) {
                console.error(`[UPDATE_NICKNAME] Failed to extract UserID. UpdatedRange: ${updatedRange}`);
                throw new Error('Failed to register new user in Total sheet');
            }

            console.log(`[UPDATE_NICKNAME] Registered new user with ID: ${userID}`);

            // Update userRowIdx for new row insertion
            userRowIdx = rows.length; // Append to end
        } else {
            // Existing user - retrieve ID
            userID = rows[userRowIdx][1];
            console.log(`[UPDATE_NICKNAME] Existing user found with ID: ${userID}`);
        }

        // === 5. Generate Unique Nickname ===
        // If nickname is provided, append #ID
        // If nickname is empty, leave uniqueName as empty (for future updates)
        const uniqueName = nickname ? `${nickname.trim()}#${userID}` : '';

        console.log(`[UPDATE_NICKNAME] Unique name: ${uniqueName || '(empty)'}`);

        // === 6. Update UserMap ===
        // Calculate exact cell range for update
        const bucketStartCol = userBucket * 3;
        const updateRange = `UserMap!${getColumnLetter(bucketStartCol)}${userRowIdx + 1}:${getColumnLetter(bucketStartCol + 2)}${userRowIdx + 1}`;

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[email, userID, uniqueName]]
            }
        });

        console.log(`[UPDATE_NICKNAME] UserMap updated at ${updateRange}`);

        // === 7. Return Response ===
        sendSuccess(res, {
            uniqueName: uniqueName || null,
            userID: userID,
            isNewUser: isNewUser
        }, isNewUser ? '新用戶註冊成功' : '資料更新成功');

    } catch (err) {
        console.error('[UPDATE_NICKNAME] Error:', err);
        sendError(res, 500, err.message, '伺服器錯誤，請稍後再試');
    }
};
