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
 * Sync Scores API
 * 
 * Reads from MongoDB collections and writes to Google Sheets:
 * - scores → ScoreBoard
 * - scores_unique → ScoreBoardUnique
 * - Both → FrontEnd sheets (with nicknames)
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    try {
        console.log('[SYNC_SCORES] Starting sync from MongoDB...');

        const { db } = await connectToMongo();
        const scores = db.collection('scores');
        const scoresUnique = db.collection('scores_unique');
        const users = db.collection('users');

        const sheets = getSheetsClient();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        if (!spreadsheetId) {
            throw new Error('GOOGLE_SHEET_ID not configured');
        }

        // === 1. Get all pending scores from MongoDB ===
        const pendingScores = await scores.find({ syncStatus: 'pending' }).toArray();
        const pendingUnique = await scoresUnique.find({ syncStatus: 'pending' }).toArray();

        console.log(`[SYNC_SCORES] Found ${pendingScores.length} pending scores, ${pendingUnique.length} pending unique`);

        // === 2. Get all user nicknames ===
        const allUsers = await users.find({}).toArray();
        const userMap = {};
        for (const user of allUsers) {
            userMap[user.userID] = user.nickname || `ID:${user.userID}`;
        }

        // === 3. Sync ScoreBoard (all scores) ===
        if (pendingScores.length > 0) {
            // Prepare rows for all pending scores
            const newRows = pendingScores.map(score => [
                formatSheetValue(score.userID),
                formatSheetValue(score.time.toFixed(3)),
                formatSheetValue(score.scramble),
                formatSheetValue(score.date),
                formatSheetValue(score.timestamp),
                formatSheetValue('Verified')
            ]);

            // Append to all 5 periods efficiently
            for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
                const startColLetter = getColumnLetter(config.startCol);
                const endColLetter = getColumnLetter(config.endCol);

                // Use 'append' to add all rows at once to the specific column range
                await sheets.spreadsheets.values.append({
                    spreadsheetId,
                    range: `ScoreBoard!${startColLetter}:${endColLetter}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: newRows }
                });

                console.log(`[SYNC_SCORES] Appended ${newRows.length} rows to ScoreBoard/${periodKey}`);
            }

            // Delete synced scores from MongoDB (as they are now in Sheets)
            const scoreIds = pendingScores.map(s => s._id);
            await scores.deleteMany(
                { _id: { $in: scoreIds } }
            );
            console.log(`[SYNC_SCORES] Deleted ${pendingScores.length} synced scores from MongoDB`);
            console.log(`[SYNC_SCORES] marked ${pendingScores.length} scores as synced`);
        }

        // === 4. Sync ScoreBoardUnique & FrontEndScoreBoardUnique ===
        // We sync ALL periods every time to ensure the leaderboard is self-healing and always accurate.
        // This is efficient because it uses batch operations (read mongo -> write sheet -> read sheet -> write frontend).

        for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
            // A. Update ScoreBoardUnique (Backend Sheet)
            // Read all unique scores for this period from MongoDB, keep Top 1000 best times
            const allUnique = await scoresUnique.find({ period: periodKey })
                .sort({ time: 1 })
                .limit(1000)
                .toArray();

            const startColLetter = getColumnLetter(config.startCol);
            const endColLetter = getColumnLetter(config.endCol);

            // Always clear the sheet range first
            await sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `ScoreBoardUnique!${startColLetter}:${endColLetter}`
            });

            if (allUnique.length > 0) {
                // Prepare rows
                const rows = allUnique.map(score => [
                    formatSheetValue(score.userID),
                    formatSheetValue(score.time.toFixed(3)),
                    formatSheetValue(score.scramble || ''),
                    formatSheetValue(score.date || ''),
                    formatSheetValue(score.timestamp || ''),
                    formatSheetValue('Verified')
                ]);

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `ScoreBoardUnique!${startColLetter}1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: rows }
                });
                console.log(`[SYNC_SCORES] ScoreBoardUnique/${periodKey}: Synced ${rows.length} rows (Top 1000)`);
            } else {
                console.log(`[SYNC_SCORES] ScoreBoardUnique/${periodKey}: No data in MongoDB`);
            }

            // B. Update FrontEndScoreBoardUnique (Frontend Sheet)
            const frontConfig = FRONTEND_PERIOD_CONFIG[periodKey];
            const frontStartCol = getColumnLetter(frontConfig.startCol);
            const frontEndCol = getColumnLetter(frontConfig.startCol + 4);

            await sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `FrontEndScoreBoardUnique!${frontStartCol}:${frontEndCol}`
            });

            if (allUnique.length > 0) {
                // Transform to FrontEnd rows using userMap
                const frontEndRows = allUnique.map(score => {
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

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `FrontEndScoreBoardUnique!${frontStartCol}1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: frontEndRows }
                });
                console.log(`[SYNC_SCORES] FrontEndScoreBoardUnique/${periodKey}: Synced ${frontEndRows.length} rows`);
            }
        }

        // Mark any pending unique scores as synced (cleanup)
        if (pendingUnique.length > 0) {
            const uniqueIds = pendingUnique.map(s => s._id);
            await scoresUnique.updateMany(
                { _id: { $in: uniqueIds } },
                { $set: { syncStatus: 'synced' } }
            );
        }

        // === 7. Return Success ===
        sendSuccess(res, {
            scoresSynced: pendingScores.length,
            uniqueSynced: pendingUnique.length,
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
