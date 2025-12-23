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

        // === 1. Get all pending scores from MongoDB ===
        const pendingScores = await scores.find({ syncStatus: 'pending' }).toArray();
        const pendingUnique = await scoresUnique.find({ syncStatus: 'pending' }).toArray();

        // [SAFETY CHECK] If DB connection is empty/bad, don't wipe the sheets!
        // We assume a real production database should have at least some users.
        const userCount = await users.countDocuments();
        if (userCount === 0) {
            console.warn('[SYNC_SCORES] SAFETY ABORT: MongoDB appears empty (0 users). Skipping sync to prevent wiping Sheets.');
            return sendSuccess(res, { message: 'Safety Abort: Database appears empty.' });
        }

        console.log(`[SYNC_SCORES] Found ${pendingScores.length} pending scores, ${pendingUnique.length} pending unique`);

        // === 2. Get all user nicknames ===
        const allUsers = await users.find({}).toArray();
        const userMap = {};
        for (const user of allUsers) {
            userMap[user.userID] = user.nickname || `ID:${user.userID}`;
        }

        // === 3. Sync ScoreBoard (all scores) ===
        if (pendingScores.length > 0) {
            for (const score of pendingScores) {
                const rowData = [
                    formatSheetValue(score.userID),
                    formatSheetValue(score.time.toFixed(3)),
                    formatSheetValue(score.scramble),
                    formatSheetValue(score.date),
                    formatSheetValue(score.timestamp),
                    formatSheetValue('Verified')
                ];

                // Write to all 5 periods
                for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
                    const startColLetter = getColumnLetter(config.startCol);
                    const endColLetter = getColumnLetter(config.endCol);
                    const nextRow = await findNextEmptyRow(sheets, spreadsheetId, 'ScoreBoard', config.startCol);

                    if (nextRow <= MAX_ROWS) {
                        await sheets.spreadsheets.values.update({
                            spreadsheetId,
                            range: `ScoreBoard!${startColLetter}${nextRow}:${endColLetter}${nextRow}`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [rowData] }
                        });
                    }
                }
            }

            // Mark as synced
            const scoreIds = pendingScores.map(s => s._id);
            await scores.updateMany(
                { _id: { $in: scoreIds } },
                { $set: { syncStatus: 'synced' } }
            );
            console.log(`[SYNC_SCORES] Synced ${pendingScores.length} scores to ScoreBoard`);
        }

        // === 4. Sync ScoreBoardUnique (best per user per period) ===
        // Group pending unique by period
        const uniqueByPeriod = {};
        for (const score of pendingUnique) {
            if (!uniqueByPeriod[score.period]) {
                uniqueByPeriod[score.period] = [];
            }
            uniqueByPeriod[score.period].push(score);
        }

        for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
            // Read all unique scores for this period from MongoDB
            const allUnique = await scoresUnique.find({ period: periodKey }).sort({ time: 1 }).toArray();

            if (allUnique.length === 0) continue;

            const startColLetter = getColumnLetter(config.startCol);
            const endColLetter = getColumnLetter(config.endCol);

            // Prepare rows
            const rows = allUnique.slice(0, MAX_ROWS).map(score => [
                formatSheetValue(score.userID),
                formatSheetValue(score.time.toFixed(3)),
                formatSheetValue(score.scramble || ''),
                formatSheetValue(score.date || ''),
                formatSheetValue(score.timestamp || ''),
                formatSheetValue('Verified')
            ]);

            // Clear and write
            await sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `ScoreBoardUnique!${startColLetter}:${endColLetter}`
            });

            if (rows.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `ScoreBoardUnique!${startColLetter}1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: rows }
                });
            }

            console.log(`[SYNC_SCORES] ScoreBoardUnique/${periodKey}: ${rows.length} rows`);
        }

        // Mark unique as synced
        if (pendingUnique.length > 0) {
            const uniqueIds = pendingUnique.map(s => s._id);
            await scoresUnique.updateMany(
                { _id: { $in: uniqueIds } },
                { $set: { syncStatus: 'synced' } }
            );
        }

        // === 5. Update FrontEndScoreBoard ===
        for (const [periodKey, frontConfig] of Object.entries(FRONTEND_PERIOD_CONFIG)) {
            const config = PERIOD_CONFIG[periodKey];

            // Read all scores for this period
            const allScores = await scores.find({}).sort({ time: 1 }).limit(MAX_ROWS).toArray();

            const frontEndRows = allScores.map(score => [
                formatSheetValue(userMap[score.userID] || `ID:${score.userID}`),
                formatSheetValue(score.time.toFixed(3)),
                formatSheetValue(score.scramble || ''),
                formatSheetValue(score.date || ''),
                formatSheetValue(score.timestamp || '')
            ]);

            const frontStartCol = getColumnLetter(frontConfig.startCol);
            const frontEndCol = getColumnLetter(frontConfig.startCol + 4);

            await sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `FrontEndScoreBoard!${frontStartCol}:${frontEndCol}`
            });

            if (frontEndRows.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `FrontEndScoreBoard!${frontStartCol}1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: frontEndRows }
                });
            }
            console.log(`[SYNC_SCORES] FrontEndScoreBoard/${periodKey}: ${frontEndRows.length} rows`);
        }

        // === 6. Update FrontEndScoreBoardUnique ===
        for (const [periodKey, frontConfig] of Object.entries(FRONTEND_PERIOD_CONFIG)) {
            // Read unique scores for this period from MongoDB
            const uniqueScores = await scoresUnique.find({ period: periodKey }).sort({ time: 1 }).limit(MAX_ROWS).toArray();

            const frontEndRows = uniqueScores.map(score => [
                formatSheetValue(userMap[score.userID] || `ID:${score.userID}`),
                formatSheetValue(score.time.toFixed(3)),
                formatSheetValue(score.scramble || ''),
                formatSheetValue(score.date || ''),
                formatSheetValue(score.timestamp || '')
            ]);

            const frontStartCol = getColumnLetter(frontConfig.startCol);
            const frontEndCol = getColumnLetter(frontConfig.startCol + 4);

            await sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `FrontEndScoreBoardUnique!${frontStartCol}:${frontEndCol}`
            });

            if (frontEndRows.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `FrontEndScoreBoardUnique!${frontStartCol}1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: frontEndRows }
                });
            }
            console.log(`[SYNC_SCORES] FrontEndScoreBoardUnique/${periodKey}: ${frontEndRows.length} rows`);
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
