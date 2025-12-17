const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    verifyGoogleToken,
    sendError,
    sendSuccess,
    formatDate,
    formatTime,
    formatSheetValue
} = require('./apiUtils');

/**
 * Save Time API
 * Saves user's solve time to ScoreBoard sheet
 * Architecture: Web → Vercel → Sheet (option_3_vercel)
 * 
 * Request Body:
 * - token: Google ID Token (required)
 * - userID: User ID from Total sheet (required)
 * - time: Solve time in milliseconds (required)
 * - scramble: Scramble sequence (optional)
 * - date: Timestamp (optional, defaults to now)
 */
module.exports = async (req, res) => {
    // Handle CORS
    if (handleCORS(req, res)) return;

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    try {
        // === 1. Extract and Validate Input ===
        const { userID, time, scramble, date } = req.body;

        // Extract token from Authorization header
        const authHeader = req.headers.authorization;
        let token = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7); // Remove 'Bearer ' prefix
        }

        // Verify JWT token
        const email = verifyGoogleToken(token);
        if (!email) {
            return sendError(res, 401, 'Invalid or expired token', '請重新登入');
        }

        // Validate required fields
        if (!userID) {
            return sendError(res, 400, 'Missing userID', '缺少用戶 ID');
        }

        if (!time || isNaN(parseFloat(time))) {
            return sendError(res, 400, 'Missing or invalid time', '缺少或無效的時間數據');
        }

        console.log(`[SAVE_TIME] User ${email} (ID: ${userID}) saving time: ${time}ms`);

        // === 2. Format Data for Google Sheets ===
        const timestamp = date ? new Date(date) : new Date();
        const formattedDate = formatDate(timestamp);
        const formattedTime = formatTime(timestamp);

        // Convert milliseconds to seconds with 3 decimal places
        const timeInSeconds = (parseFloat(time) / 1000).toFixed(3);

        // Prepare row data
        // Schema: [UserID, Time(seconds), Scramble, Date, Time, Status]
        const rowData = [
            formatSheetValue(userID),           // Force text
            formatSheetValue(timeInSeconds),    // Force text to prevent date conversion
            formatSheetValue(scramble || ''),   // Scramble
            formatSheetValue(formattedDate),    // Date
            formatSheetValue(formattedTime),    // Time
            formatSheetValue('Verified')        // Status
        ];

        console.log(`[SAVE_TIME] Row data:`, rowData);

        // === 3. Append to ScoreBoard Sheet ===
        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'ScoreBoard!A:F',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [rowData]
            }
        });

        const updatedRange = appendResponse.data.updates.updatedRange;
        console.log(`[SAVE_TIME] Successfully saved to ${updatedRange}`);

        // === 4. Return Success Response ===
        sendSuccess(res, {
            userID,
            time: timeInSeconds,
            scramble: scramble || '',
            date: formattedDate,
            timestamp: formattedTime,
            range: updatedRange
        }, '成績已成功保存');

    } catch (err) {
        console.error('[SAVE_TIME] Error:', err);
        sendError(res, 500, err.message, '伺服器錯誤，請稍後再試');
    }
};
