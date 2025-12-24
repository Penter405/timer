const { connectToMongo } = require('../lib/mongoClient');
const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    sendError,
    sendSuccess,
    formatSheetValue,
    getColumnLetter
} = require('../lib/apiUtils');

const MAX_ROWS = 1000; // Maximum rows per period

/**
 * Period column configuration
 * Each period uses 6 columns: UserID, Time, Scramble, Date, Timestamp, Status
 */
const PERIOD_CONFIG = {
    all: { startCol: 0, endCol: 5, name: '歷史' },   // A-F
    year: { startCol: 6, endCol: 11, name: '本年' },   // G-L
    month: { startCol: 12, endCol: 17, name: '本月' },   // M-R
    week: { startCol: 18, endCol: 23, name: '本周' },   // S-X
    today: { startCol: 24, endCol: 29, name: '本日' }    // Y-AD
};

/**
 * FrontEnd column configuration (5 columns: Nickname, Time, Scramble, Date, Timestamp)
 */
const FRONTEND_PERIOD_CONFIG = {
    all: { startCol: 0 },   // A-E
    year: { startCol: 5 },   // F-J
    month: { startCol: 10 },  // K-O
    week: { startCol: 15 },  // P-T
    today: { startCol: 20 }   // U-Y
};

/**
 * Sync Scores API (Single Collection Mode)
 * 
 * 1. Reads pending scores from `scores` collection.
 * 2. Appends to ScoreBoard (History).
 * 3. Reads existing ScoreBoardUnique from Sheet.
 * 4. Merges pending scores into Unique List (In-Memory).
 * 5. Writes back to ScoreBoardUnique.
 * 6. Deletes pending scores from MongoDB.
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    try {
        console.log('[SYNC_SCORES] Starting sync from MongoDB...');

        const { db } = await connectToMongo();
        const scores = db.collection('scores');
        const users = db.collection('users');

        const sheets = getSheetsClient();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        if (!spreadsheetId) {
            throw new Error('GOOGLE_SHEET_ID not configured');
        }

        // === 1. Get all pending scores from MongoDB ===
        const pendingScores = await scores.find({ syncStatus: 'pending' }).toArray();
        console.log(`[SYNC_SCORES] Found ${pendingScores.length} pending scores`);

        // === 2. Get all user nicknames ===
        const allUsers = await users.find({}).toArray();
        const userMap = {};
        for (const user of allUsers) {
            userMap[user.userID] = user.nickname || `ID:${user.userID}`;
        }

        if (pendingScores.length > 0) {
            // === 3. Sync ScoreBoard (Backend History) ===
            const newRows = pendingScores.map(score => [
                formatSheetValue(score.userID),
                formatSheetValue(score.time.toFixed(3)),
                formatSheetValue(score.scramble),
                formatSheetValue(score.date),
                formatSheetValue(score.timestamp),
                formatSheetValue('Verified')
            ]);

            for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
                const startColLetter = getColumnLetter(config.startCol);
                const endColLetter = getColumnLetter(config.endCol);
                const nextRow = await findNextEmptyRow(sheets, spreadsheetId, 'ScoreBoard', config.startCol);
                const endRow = nextRow + newRows.length - 1;

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `ScoreBoard!${startColLetter}${nextRow}:${endColLetter}${endRow}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: newRows }
                });
                console.log(`[SYNC_SCORES] Wrote ${newRows.length} rows to ScoreBoard/${periodKey}`);
            }

            // === 4. Sync FrontEndScoreBoard (Frontend History with Names) ===
            const frontEndRows = pendingScores.map(score => {
                const userId = (score.userID || '').toString();
                const nickname = userMap[userId] || `ID:${userId}`;
                return [
                    formatSheetValue(nickname),
                    formatSheetValue(score.time.toFixed(3)),
                    formatSheetValue(score.scramble || ''),
                    formatSheetValue(score.date || ''),
                    formatSheetValue(score.timestamp || '')
                ];
            });

            for (const [periodKey, frontConfig] of Object.entries(FRONTEND_PERIOD_CONFIG)) {
                const startColLetter = getColumnLetter(frontConfig.startCol);
                const endColLetter = getColumnLetter(frontConfig.startCol + 4);
                const nextRow = await findNextEmptyRow(sheets, spreadsheetId, 'FrontEndScoreBoard', frontConfig.startCol);
                const endRow = nextRow + frontEndRows.length - 1;

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `FrontEndScoreBoard!${startColLetter}${nextRow}:${endColLetter}${endRow}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: frontEndRows }
                });
            }

            // === CRITICAL: Delete from MongoDB immediately after History Sync ===
            // This prevents duplicate history entries if the script crashes later (e.g. during Unique sync)
            const scoreIds = pendingScores.map(s => s._id);
            await scores.deleteMany({ _id: { $in: scoreIds } });
            console.log(`[SYNC_SCORES] Deleted ${scoreIds.length} scores from MongoDB (Anti-Duplication)`);
        }

        // === 5. Sync ScoreBoardUnique (Sheet-Based Logic) ===
        // We read the existing sheet, merge pending scores, and write back.
        // We start from Row 1 as requested by user.

        for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
            // A. Read Existing Data (Row 1+)
            const startColLetter = getColumnLetter(config.startCol);
            const endColLetter = getColumnLetter(config.endCol);

            const sheetResp = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `ScoreBoardUnique!${startColLetter}:${endColLetter}`
            });

            const uniqueMap = new Map();
            const existingRows = sheetResp.data.values || [];

            // Load Sheet Data into Map
            existingRows.forEach(row => {
                if (!row[0]) return;
                const userID = row[0].toString();
                const time = parseFloat(row[1]);
                if (!isNaN(time)) {
                    uniqueMap.set(userID, {
                        userID,
                        time,
                        scramble: row[2],
                        date: row[3],
                        timestamp: row[4],
                        status: row[5]
                    });
                }
            });

            // Merge Pending Scores (Keep Best)
            for (const score of pendingScores) {
                const userID = score.userID.toString();
                const time = score.time;
                const current = uniqueMap.get(userID);

                if (!current || time < current.time) {
                    uniqueMap.set(userID, {
                        userID,
                        time,
                        scramble: score.scramble,
                        date: score.date,
                        timestamp: score.timestamp,
                        status: 'Verified'
                    });
                }
            }

            // Sort and Limit
            const sortedUnique = Array.from(uniqueMap.values())
                .sort((a, b) => a.time - b.time)
                .slice(0, 1000);

            // B. Write Back to ScoreBoardUnique
            await sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `ScoreBoardUnique!${startColLetter}:${endColLetter}`
            });

            if (sortedUnique.length > 0) {
                const rows = sortedUnique.map(s => [
                    formatSheetValue(s.userID),
                    formatSheetValue(s.time.toFixed(3)),
                    formatSheetValue(s.scramble || ''),
                    formatSheetValue(s.date || ''),
                    formatSheetValue(s.timestamp || ''),
                    formatSheetValue(s.status || 'Verified')
                ]);

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `ScoreBoardUnique!${startColLetter}1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: rows }
                });
                console.log(`[SYNC_SCORES] ScoreBoardUnique/${periodKey}: Updated ${rows.length} rows`);
            }

            // C. Write to FrontEndScoreBoardUnique
            const frontConfig = FRONTEND_PERIOD_CONFIG[periodKey];
            const frontStartCol = getColumnLetter(frontConfig.startCol);
            const frontEndCol = getColumnLetter(frontConfig.startCol + 4);

            await sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `FrontEndScoreBoardUnique!${frontStartCol}:${frontEndCol}`
            });

            if (sortedUnique.length > 0) {
                const frontRows = sortedUnique.map(s => {
                    const nickname = userMap[s.userID] || `ID:${s.userID}`;
                    return [
                        formatSheetValue(nickname),
                        formatSheetValue(s.time.toFixed(3)),
                        formatSheetValue(s.scramble || ''),
                        formatSheetValue(s.date || ''),
                        formatSheetValue(s.timestamp || '')
                    ];
                });

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `FrontEndScoreBoardUnique!${frontStartCol}1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: frontRows }
                });
            }
        }

        // === 6. Return Success ===
        sendSuccess(res, {
            scoresSynced: pendingScores.length,
            message: 'Sync completed from MongoDB to Sheets'
        });

    } catch (err) {
        console.error('[SYNC_SCORES] Error:', err);
        sendError(res, 500, err.message, '同步失敗');
    }
};

/**
 * Find the next empty row for a specific period column
 */
async function findNextEmptyRow(sheets, spreadsheetId, sheetName, startCol) {
    const colLetter = getColumnLetter(startCol);

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!${colLetter}:${colLetter}`
    });

    const data = response.data.values || [];

    // Find first empty row
    for (let i = 0; i < data.length; i++) {
        if (!data[i][0] || data[i][0] === '') {
            return i + 1; // 1-indexed
        }
    }

    // If no empty row found, return next row after last
    return data.length + 1;
}