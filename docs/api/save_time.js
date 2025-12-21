const { getCollections } = require('../lib/mongoClient');
const { encryptNickname } = require('../lib/encryption');
const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    verifyGoogleToken,
    sendError,
    sendSuccess,
    formatDate,
    formatTime,
    formatSheetValue,
    getColumnLetter
} = require('../lib/apiUtils');

const MAX_ROWS_PER_PERIOD = 1000;

/**
 * Period column configuration for Google Sheets
 */
const PERIOD_CONFIG = {
    all: { startCol: 0, name: '歷史' },
    year: { startCol: 6, name: '本年' },
    month: { startCol: 12, name: '本月' },
    week: { startCol: 18, name: '本周' },
    today: { startCol: 24, name: '本日' }
};

/**
 * Save Time API (MongoDB + Google Sheets Dual Architecture)
 * 
 * Data Strategy:
 * - MongoDB: Store sensitive user data (email) and all scores
 * - Google Sheets: Store public scoreboard with encrypted nicknames
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
        const { users, scores } = await getCollections();

        let user = await users.findOne({ email });

        if (!user) {
            // Auto-register user
            console.log(`[SAVE_TIME] Auto-registering user: ${email}`);

            const userCount = await users.countDocuments();
            const userID = userCount + 1;

            user = {
                email,
                userID,
                nickname: `Player${userID}`,
                encryptedNickname: encryptNickname(`Player${userID}`, userID),
                createdAt: new Date()
            };

            await users.insertOne(user);
            console.log(`[SAVE_TIME] Created user with ID: ${userID}`);
        }

        // === 4. Save to MongoDB ===
        const timestamp = date ? new Date(date) : new Date();
        const scoreDocument = {
            userID: user.userID,
            email: user.email, // Store for reference
            time: timeInSeconds,
            scramble: scramble || '',
            date: formatDate(timestamp),
            timestamp: formatTime(timestamp),
            period: 'all', // Can be enhanced with period logic
            createdAt: timestamp
        };

        await scores.insertOne(scoreDocument);
        console.log(`[SAVE_TIME] Saved to MongoDB: UserID ${user.userID}, Time ${timeInSeconds}`);

        // === 5. Sync to Google Sheets (Background) ===
        try {
            await syncToGoogleSheets(user, timeInSeconds, scramble || '', timestamp);
            console.log(`[SAVE_TIME] Synced to Google Sheets`);
        } catch (sheetError) {
            console.error(`[SAVE_TIME] Sheet sync failed (non-critical):`, sheetError.message);
            // Don't fail the request, MongoDB save succeeded
        }

        // === 6. Return Success ===
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

/**
 * Sync score to Google Sheets (public scoreboard with encrypted nickname)
 */
async function syncToGoogleSheets(user, timeInSeconds, scramble, timestamp) {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) {
        console.warn('[SAVE_TIME] No GOOGLE_SHEET_ID, skipping sheet sync');
        return;
    }

    const rowData = [
        formatSheetValue(user.userID),
        formatSheetValue(user.encryptedNickname), // Encrypted nickname
        formatSheetValue(timeInSeconds.toFixed(3)),
        formatSheetValue(scramble),
        formatSheetValue(formatDate(timestamp)),
        formatSheetValue(formatTime(timestamp)),
        formatSheetValue('Verified')
    ];

    // Write to "all" period (歷史)
    const config = PERIOD_CONFIG.all;
    const startColLetter = getColumnLetter(config.startCol);
    const endColLetter = getColumnLetter(config.startCol + 6);
    const range = `ScoreBoard!${startColLetter}:${endColLetter}`;

    // Get existing data
    const existingRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range
    });

    const existingData = existingRes.data.values || [];
    const times = existingData.map((row, idx) => ({
        rowIdx: idx,
        time: parseFloat(row[2]?.toString().replace(/^'/, '') || 'NaN')
    })).filter(t => !isNaN(t.time));

    // Check 1000 row limit
    if (times.length >= MAX_ROWS_PER_PERIOD) {
        times.sort((a, b) => a.time - b.time);
        const worstTime = times[times.length - 1].time;

        if (timeInSeconds >= worstTime) {
            console.log(`[SAVE_TIME] Sheet: Score not in top 1000, skipping`);
            return;
        }

        // Replace worst score
        const worstRowIdx = times[times.length - 1].rowIdx + 1;
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `ScoreBoard!${startColLetter}${worstRowIdx}:${endColLetter}${worstRowIdx}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [rowData] }
        });
        console.log(`[SAVE_TIME] Sheet: Replaced worst at row ${worstRowIdx}`);
    } else {
        // Append new row
        const newRow = existingData.length + 1;
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `ScoreBoard!${startColLetter}${newRow}:${endColLetter}${newRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [rowData] }
        });
        console.log(`[SAVE_TIME] Sheet: Added at row ${newRow}`);
    }
}
