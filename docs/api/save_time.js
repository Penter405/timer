const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    verifyGoogleToken,
    sendError,
    sendSuccess,
    formatDate,
    formatTime,
    formatSheetValue,
    getColumnLetter,
    getBucketIndex
} = require('../lib/apiUtils');

// Must match update_nickname.js settings
const USERMAP_TEAM_COUNT = 8;

/**
 * Save Time API (SECURE)
 * Saves user's solve time to ScoreBoard sheet
 * Architecture: Web → Vercel → Sheet (option_3_vercel)
 * 
 * SECURITY: UserID is looked up from UserMap using email hash, NOT from frontend
 * 
 * Request Body:
 * - time: Solve time in milliseconds (required)
 * - scramble: Scramble sequence (optional)
 * - date: Timestamp (optional, defaults to now)
 * 
 * Authorization Header:
 * - Bearer {Google ID Token}
 */
module.exports = async (req, res) => {
    // Handle CORS
    if (handleCORS(req, res)) return;

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    try {
        // === 1. Extract and Validate Token ===
        const authHeader = req.headers.authorization;
        let token = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }

        // Verify JWT token and extract email (SECURE: email comes from Google)
        const email = verifyGoogleToken(token);
        if (!email) {
            return sendError(res, 401, 'Invalid or expired token', '請重新登入');
        }

        console.log(`[SAVE_TIME] Authenticated user: ${email}`);

        // === 2. Validate Time Input ===
        const { time, scramble, date } = req.body;

        if (!time || isNaN(parseFloat(time))) {
            return sendError(res, 400, 'Missing or invalid time', '缺少或無效的時間數據');
        }

        // === 3. Lookup UserID from UserMap (SECURE) ===
        // Hash email to find bucket
        const teamIndex = getBucketIndex(email, USERMAP_TEAM_COUNT);
        const firstCol = teamIndex * 3 + 1; // 1-indexed
        const lastCol = firstCol + 2;
        const firstColLetter = getColumnLetter(firstCol - 1); // getColumnLetter is 0-indexed
        const lastColLetter = getColumnLetter(lastCol - 1);

        console.log(`[SAVE_TIME] Looking up email ${email} in UserMap bucket ${teamIndex} (cols ${firstColLetter}-${lastColLetter})`);

        const userMapRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `UserMap!${firstColLetter}:${lastColLetter}`
        });

        const teamData = userMapRes.data.values || [];
        let userID = null;
        let foundRowIndex = -1;

        // Search for email in bucket
        for (let i = 0; i < teamData.length; i++) {
            if (teamData[i] && teamData[i][0] === email) {
                userID = teamData[i][1]; // Column 2 is UserID
                foundRowIndex = i;
                console.log(`[SAVE_TIME] Found user in UserMap: email=${email}, userID=${userID}`);
                break;
            }
        }

        // === 4. Auto-Register if Not Found ===
        if (!userID) {
            console.log(`[SAVE_TIME] User not found in UserMap, auto-registering...`);

            // 4a. Register in Total sheet (get new UserID)
            const totalAppend = await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Total!A:A',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[email]] }
            });

            // Extract UserID from row number
            const updatedRange = totalAppend.data.updates.updatedRange;
            const match = updatedRange.match(/!A(\d+)/);
            userID = match ? match[1] : null;

            if (!userID) {
                console.error(`[SAVE_TIME] Failed to extract UserID from Total. Range: ${updatedRange}`);
                return sendError(res, 500, 'Failed to register user', '用戶註冊失敗');
            }

            console.log(`[SAVE_TIME] Registered in Total with UserID: ${userID}`);

            // 4b. Also write to UserMap (email, userID, empty nickname)
            // Find first empty row or append
            let targetRow;
            let emptyRowIndex = -1;
            for (let i = 0; i < teamData.length; i++) {
                if (!teamData[i] || !teamData[i][0]) {
                    emptyRowIndex = i;
                    break;
                }
            }

            if (emptyRowIndex !== -1) {
                targetRow = emptyRowIndex + 1;
            } else {
                targetRow = teamData.length + 1;
            }

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `UserMap!${firstColLetter}${targetRow}:${lastColLetter}${targetRow}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[email, userID, '']] } // Empty nickname
            });

            console.log(`[SAVE_TIME] Wrote to UserMap bucket ${teamIndex} row ${targetRow}: [${email}, ${userID}, '']`);
        }

        // === 5. Format Data for Google Sheets ===
        const timestamp = date ? new Date(date) : new Date();
        const formattedDate = formatDate(timestamp);
        const formattedTime = formatTime(timestamp);

        // Convert milliseconds to seconds with 3 decimal places
        const timeInSeconds = (parseFloat(time) / 1000).toFixed(3);

        // Prepare row data
        // Schema: [UserID, Time(seconds), Scramble, Date, Time, Status]
        const rowData = [
            formatSheetValue(userID),           // SECURE: UserID from backend lookup
            formatSheetValue(timeInSeconds),
            formatSheetValue(scramble || ''),
            formatSheetValue(formattedDate),
            formatSheetValue(formattedTime),
            formatSheetValue('Verified')
        ];

        console.log(`[SAVE_TIME] Row data: `, rowData);

        // === 6. Append to ScoreBoard Sheet ===
        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'ScoreBoard!A:F',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [rowData]
            }
        });

        const scoreboardRange = appendResponse.data.updates.updatedRange;
        console.log(`[SAVE_TIME] Successfully saved to ${scoreboardRange}`);

        // === 7. Return Success Response ===
        sendSuccess(res, {
            userID,
            time: timeInSeconds,
            scramble: scramble || '',
            date: formattedDate,
            timestamp: formattedTime,
            range: scoreboardRange
        }, '成績已成功保存');

    } catch (err) {
        console.error('[SAVE_TIME] Error:', err);
        sendError(res, 500, err.message, '伺服器錯誤，請稍後再試');
    }
};
