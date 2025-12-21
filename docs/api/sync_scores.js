const { connectToMongo } = require('../lib/mongoClient');
const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    sendError,
    sendSuccess,
    formatSheetValue,
    getColumnLetter
} = require('../lib/apiUtils');

/**
 * Period column configuration (matching GAS)
 * Each period uses 6 columns: UserID, Time, Scramble, Date, Time, Status
 */
const PERIOD_CONFIG = {
    all: { startCol: 0, name: '歷史' },   // A-F (never cleared)
    year: { startCol: 6, name: '本年' },   // G-L
    month: { startCol: 12, name: '本月' },   // M-R
    week: { startCol: 18, name: '本周' },   // S-X
    today: { startCol: 24, name: '本日' }    // Y-AD
};

/**
 * Sync Scores API
 * 
 * Called by external cron job (cron-job.org) every minute
 * 
 * Flow:
 * 1. Read pending_scores from MongoDB
 * 2. Write to ALL 5 periods in ScoreBoard (30 columns)
 * 3. Read processed ScoreBoard (all period) and copy to FrontEnd sheets
 * 4. Delete synced pending_scores
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    try {
        console.log('[SYNC_SCORES] Starting sync...');

        // === 1. Get pending scores from MongoDB ===
        const { db } = await connectToMongo();
        const pendingScores = db.collection('pending_scores');
        const users = db.collection('users');

        const pending = await pendingScores.find({ syncStatus: 'pending' }).toArray();

        if (pending.length === 0) {
            console.log('[SYNC_SCORES] No pending scores to sync');
            return sendSuccess(res, { synced: 0, message: 'No pending scores' });
        }

        console.log(`[SYNC_SCORES] Found ${pending.length} pending scores`);

        // === 2. Sync to Google Sheets ===
        const sheets = getSheetsClient();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        if (!spreadsheetId) {
            throw new Error('GOOGLE_SHEET_ID not configured');
        }

        // === 3. Write to ALL 5 periods in ScoreBoard ===
        for (const score of pending) {
            const rowData = [
                formatSheetValue(score.userID),
                formatSheetValue(score.time.toFixed(3)),
                formatSheetValue(score.scramble),
                formatSheetValue(score.date),
                formatSheetValue(score.timestamp),
                formatSheetValue('Verified')
            ];

            // Build row for all 5 periods (30 columns)
            const fullRowData = [];
            for (const periodKey of ['all', 'year', 'month', 'week', 'today']) {
                fullRowData.push(...rowData);
            }

            // Append to ScoreBoard (A to AD, 30 columns)
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'ScoreBoard!A:AD',
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: [fullRowData] }
            });
        }
        console.log(`[SYNC_SCORES] Appended ${pending.length} rows to ScoreBoard (all 5 periods)`);

        // === 4. Read ALL processed ScoreBoard data (all period: A-F) ===
        const scoreBoardRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'ScoreBoard!A:F'
        });
        const allScoreData = scoreBoardRes.data.values || [];
        console.log(`[SYNC_SCORES] Read ${allScoreData.length} rows from ScoreBoard`);

        // === 5. Get ALL user nicknames from MongoDB ===
        const allUserIDs = [...new Set(allScoreData.map(row => parseInt(row[0])).filter(id => !isNaN(id)))];
        const allUsersData = await users.find({ userID: { $in: allUserIDs } }).toArray();
        const userMap = {};
        for (const user of allUsersData) {
            userMap[user.userID] = user.nickname || `ID:${user.userID}`;
        }

        // === 6. Build FrontEndScoreBoard (all scores with nickname) ===
        const frontEndData = allScoreData.map(row => {
            const userID = parseInt(row[0]);
            const nickname = userMap[userID] || `ID:${userID}`;
            return [
                formatSheetValue(nickname),      // nickname instead of userID
                formatSheetValue(row[1]),        // time
                formatSheetValue(row[2]),        // scramble
                formatSheetValue(row[3]),        // date
                formatSheetValue(row[4])         // timestamp
            ];
        });

        // Clear and write FrontEndScoreBoard
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: 'FrontEndScoreBoard!A:E'
        });
        if (frontEndData.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: 'FrontEndScoreBoard!A1',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: frontEndData }
            });
        }
        console.log(`[SYNC_SCORES] Updated FrontEndScoreBoard with ${frontEndData.length} rows`);

        // === 7. Build FrontEndScoreBoardUnique (best per user) ===
        const bestByUser = {};
        for (const row of allScoreData) {
            const userID = parseInt(row[0]);
            if (isNaN(userID)) continue;

            const time = parseFloat(row[1]?.toString().replace(/^'/, '') || 'Infinity');
            const nickname = userMap[userID] || `ID:${userID}`;

            if (!bestByUser[userID] || time < bestByUser[userID].time) {
                bestByUser[userID] = {
                    nickname,
                    time,
                    date: row[3],
                    timestamp: row[4]
                };
            }
        }

        const uniqueData = Object.values(bestByUser).map(entry => [
            formatSheetValue(entry.nickname),
            formatSheetValue(entry.time.toFixed(3)),
            formatSheetValue(entry.date),
            formatSheetValue(entry.timestamp)
        ]);

        // Clear and write FrontEndScoreBoardUnique
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: 'FrontEndScoreBoardUnique!A:D'
        });
        if (uniqueData.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: 'FrontEndScoreBoardUnique!A1',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: uniqueData }
            });
        }
        console.log(`[SYNC_SCORES] Updated FrontEndScoreBoardUnique with ${uniqueData.length} rows`);

        // === 8. Delete synced pending scores ===
        const pendingIds = pending.map(s => s._id);
        await pendingScores.deleteMany({ _id: { $in: pendingIds } });
        console.log(`[SYNC_SCORES] Deleted ${pendingIds.length} synced pending scores`);

        // === 9. Return Success ===
        sendSuccess(res, {
            synced: pending.length,
            totalScores: allScoreData.length,
            uniqueUsers: uniqueData.length,
            message: `Synced ${pending.length} new scores to all 5 periods`
        });

    } catch (err) {
        console.error('[SYNC_SCORES] Error:', err);
        sendError(res, 500, err.message, '同步失敗');
    }
};
