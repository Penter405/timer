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
const MAX_ROWS_PER_PERIOD = 1000;

/**
 * Period column configuration
 * Each period uses 6 columns: UserID, Time, Scramble, Date, Time, Status
 */
const PERIOD_CONFIG = {
    all: { startCol: 0, name: '歷史' },   // A-F (0-5)
    year: { startCol: 6, name: '本年' },   // G-L (6-11)
    month: { startCol: 12, name: '本月' },   // M-R (12-17)
    week: { startCol: 18, name: '本周' },   // S-X (18-23)
    today: { startCol: 24, name: '本日' }    // Y-AD (24-29)
};

/**
 * Save Time API (SECURE + Multi-Period)
 * Saves user's solve time to ScoreBoard and ScoreBoardUnique sheets
 * 
 * SECURITY: UserID is looked up from UserMap using email hash
 * MULTI-PERIOD: Writes to 5 time periods (歷史/本年/本月/本周/本日)
 * 1000 ROW LIMIT: Checks if score can make the ranking before inserting
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

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

        // === 3. Lookup UserID from UserMap ===
        const teamIndex = getBucketIndex(email, USERMAP_TEAM_COUNT);
        const firstColLetter = getColumnLetter(teamIndex * 3);
        const lastColLetter = getColumnLetter(teamIndex * 3 + 2);

        const userMapRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `UserMap!${firstColLetter}:${lastColLetter}`
        });

        const teamData = userMapRes.data.values || [];
        let userID = null;

        for (let i = 0; i < teamData.length; i++) {
            if (teamData[i]?.[0] === email) {
                userID = teamData[i][1];
                break;
            }
        }

        // === 4. Auto-Register if Not Found ===
        if (!userID) {
            console.log(`[SAVE_TIME] Auto-registering user...`);

            const totalAppend = await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Total!A:A',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[email]] }
            });

            const match = totalAppend.data.updates.updatedRange.match(/!A(\d+)/);
            userID = match?.[1];

            if (!userID) {
                return sendError(res, 500, 'Failed to register user', '用戶註冊失敗');
            }

            const targetRow = teamData.length + 1;
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `UserMap!${firstColLetter}${targetRow}:${lastColLetter}${targetRow}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[email, userID, '']] }
            });

            console.log(`[SAVE_TIME] Registered: userID=${userID}`);
        }

        // === 5. Prepare Row Data ===
        const timestamp = date ? new Date(date) : new Date();
        const formattedDate = formatDate(timestamp);
        const formattedTime = formatTime(timestamp);

        const rowData = [
            formatSheetValue(userID),
            formatSheetValue(timeInSeconds.toFixed(3)),
            formatSheetValue(scramble || ''),
            formatSheetValue(formattedDate),
            formatSheetValue(formattedTime),
            formatSheetValue('Verified')
        ];

        // === 6. Write to All 5 Periods in Both Sheets ===
        const periods = Object.keys(PERIOD_CONFIG);
        const results = { ScoreBoard: {}, ScoreBoardUnique: {} };

        for (const sheetName of ['ScoreBoard', 'ScoreBoardUnique']) {
            for (const period of periods) {
                const config = PERIOD_CONFIG[period];
                const startColLetter = getColumnLetter(config.startCol);
                const endColLetter = getColumnLetter(config.startCol + 5);
                const range = `${sheetName}!${startColLetter}:${endColLetter}`;

                try {
                    // Read existing data
                    const existingRes = await sheets.spreadsheets.values.get({
                        spreadsheetId,
                        range: range
                    });

                    const existingData = existingRes.data.values || [];

                    // Parse times (column B = index 1)
                    const times = existingData.map((row, idx) => ({
                        rowIdx: idx,
                        userId: row[0]?.toString().replace(/^'/, ''),
                        time: parseFloat(row[1]?.toString().replace(/^'/, '') || 'NaN')
                    })).filter(t => !isNaN(t.time));

                    // ScoreBoardUnique: Check if user already has a score
                    if (sheetName === 'ScoreBoardUnique') {
                        const existingEntry = times.find(t => t.userId === userID);
                        if (existingEntry) {
                            // Only update if new time is better
                            if (timeInSeconds < existingEntry.time) {
                                const updateRow = existingEntry.rowIdx + 1;
                                await sheets.spreadsheets.values.update({
                                    spreadsheetId,
                                    range: `${sheetName}!${startColLetter}${updateRow}:${endColLetter}${updateRow}`,
                                    valueInputOption: 'USER_ENTERED',
                                    requestBody: { values: [rowData] }
                                });
                                results[sheetName][period] = 'updated';
                                console.log(`[SAVE_TIME] ${sheetName}/${period}: Updated row ${updateRow}`);
                            } else {
                                results[sheetName][period] = 'skipped (not faster)';
                                console.log(`[SAVE_TIME] ${sheetName}/${period}: Skipped (existing ${existingEntry.time} <= new ${timeInSeconds})`);
                            }
                            continue;
                        }
                    }

                    // Check 1000 row limit
                    if (times.length >= MAX_ROWS_PER_PERIOD) {
                        // Sort by time to find worst score
                        times.sort((a, b) => a.time - b.time);
                        const worstTime = times[times.length - 1].time;

                        if (timeInSeconds >= worstTime) {
                            results[sheetName][period] = 'skipped (not in top 1000)';
                            console.log(`[SAVE_TIME] ${sheetName}/${period}: Skipped (${timeInSeconds} >= worst ${worstTime})`);
                            continue;
                        }

                        // Replace worst score
                        const worstRowIdx = times[times.length - 1].rowIdx + 1;
                        await sheets.spreadsheets.values.update({
                            spreadsheetId,
                            range: `${sheetName}!${startColLetter}${worstRowIdx}:${endColLetter}${worstRowIdx}`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [rowData] }
                        });
                        results[sheetName][period] = `replaced row ${worstRowIdx}`;
                        console.log(`[SAVE_TIME] ${sheetName}/${period}: Replaced worst at row ${worstRowIdx}`);
                    } else {
                        // Append new row
                        const newRow = existingData.length + 1;
                        await sheets.spreadsheets.values.update({
                            spreadsheetId,
                            range: `${sheetName}!${startColLetter}${newRow}:${endColLetter}${newRow}`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [rowData] }
                        });
                        results[sheetName][period] = `added row ${newRow}`;
                        console.log(`[SAVE_TIME] ${sheetName}/${period}: Added at row ${newRow}`);
                    }
                } catch (periodErr) {
                    console.error(`[SAVE_TIME] Error writing to ${sheetName}/${period}:`, periodErr.message);
                    results[sheetName][period] = `error: ${periodErr.message}`;
                }
            }
        }

        // === 7. Return Success ===
        console.log(`[SAVE_TIME] Completed:`, results);

        sendSuccess(res, {
            userID,
            time: timeInSeconds.toFixed(3),
            scramble: scramble || '',
            date: formattedDate,
            timestamp: formattedTime,
            results
        }, '成績已成功保存');

    } catch (err) {
        console.error('[SAVE_TIME] Error:', err);
        sendError(res, 500, err.message, '伺服器錯誤，請稍後再試');
    }
};
