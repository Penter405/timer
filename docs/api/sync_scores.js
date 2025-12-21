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
 * Period column configuration (matching GAS)
 * Each period uses 6 columns: UserID, Time, Scramble, Date, Time, Status
 */
const PERIOD_CONFIG = {
    all: { startCol: 0, endCol: 5, name: '歷史' },   // A-F
    year: { startCol: 6, endCol: 11, name: '本年' },   // G-L
    month: { startCol: 12, endCol: 17, name: '本月' },   // M-R
    week: { startCol: 18, endCol: 23, name: '本周' },   // S-X
    today: { startCol: 24, endCol: 29, name: '本日' }    // Y-AD
};

/**
 * Sync Scores API
 * 
 * Flow:
 * 1. Read pending_scores from MongoDB
 * 2. For each period, find minimum empty row and write there
 * 3. Enforce 1000 row limit per period
 * 4. Read ALL periods and aggregate to FrontEnd sheets
 * 5. Delete synced pending_scores
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    try {
        console.log('[SYNC_SCORES] Starting sync...');

        const { db } = await connectToMongo();
        const pendingScores = db.collection('pending_scores');
        const users = db.collection('users');

        const pending = await pendingScores.find({ syncStatus: 'pending' }).toArray();

        if (pending.length === 0) {
            console.log('[SYNC_SCORES] No pending scores to sync');
            return sendSuccess(res, { synced: 0, message: 'No pending scores' });
        }

        console.log(`[SYNC_SCORES] Found ${pending.length} pending scores`);

        const sheets = getSheetsClient();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        if (!spreadsheetId) {
            throw new Error('GOOGLE_SHEET_ID not configured');
        }

        // === 1. Write to each period at its minimum empty row ===
        for (const score of pending) {
            const rowData = [
                formatSheetValue(score.userID),
                formatSheetValue(score.time.toFixed(3)),
                formatSheetValue(score.scramble),
                formatSheetValue(score.date),
                formatSheetValue(score.timestamp),
                formatSheetValue('Verified')
            ];

            // Write to each period individually
            for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
                const startColLetter = getColumnLetter(config.startCol);
                const endColLetter = getColumnLetter(config.endCol);

                // Find next empty row for this period
                const nextRow = await findNextEmptyRow(sheets, spreadsheetId, config.startCol);

                // Write to that row
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `ScoreBoard!${startColLetter}${nextRow}:${endColLetter}${nextRow}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [rowData] }
                });
            }
        }
        console.log(`[SYNC_SCORES] Wrote ${pending.length} scores to all 5 periods`);

        // === 2. Enforce 1000 row limit per period ===
        let totalDeleted = 0;
        for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
            const deleted = await enforceRowLimitForPeriod(sheets, spreadsheetId, config);
            totalDeleted += deleted;
            if (deleted > 0) {
                console.log(`[SYNC_SCORES] Deleted ${deleted} slow rows from ${config.name}`);
            }
        }

        // === 3. Read ALL periods and aggregate data for FrontEnd ===
        const allScores = [];
        const userIDsSet = new Set();

        for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
            const startColLetter = getColumnLetter(config.startCol);
            const endColLetter = getColumnLetter(config.endCol);

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `ScoreBoard!${startColLetter}:${endColLetter}`
            });

            const data = response.data.values || [];
            for (const row of data) {
                const userID = parseInt(row[0]);
                if (!isNaN(userID) && row[1]) {
                    allScores.push({
                        userID,
                        time: parseFloat(row[1]?.toString().replace(/^'/, '') || 'Infinity'),
                        scramble: row[2] || '',
                        date: row[3] || '',
                        timestamp: row[4] || '',
                        period: periodKey
                    });
                    userIDsSet.add(userID);
                }
            }
        }

        console.log(`[SYNC_SCORES] Aggregated ${allScores.length} total scores from all periods`);

        // === 4. Get user nicknames ===
        const allUserIDs = [...userIDsSet];
        const allUsersData = await users.find({ userID: { $in: allUserIDs } }).toArray();
        const userMap = {};
        for (const user of allUsersData) {
            userMap[user.userID] = user.nickname || `ID:${user.userID}`;
        }

        // === 5. Deduplicate and sort for FrontEndScoreBoard ===
        // Remove duplicates (same userID + time + date = same record across periods)
        const uniqueScores = [];
        const seenKeys = new Set();
        for (const score of allScores) {
            const key = `${score.userID}-${score.time}-${score.date}-${score.timestamp}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueScores.push(score);
            }
        }

        // Sort by time (fastest first)
        uniqueScores.sort((a, b) => a.time - b.time);

        const frontEndData = uniqueScores.map(score => [
            formatSheetValue(userMap[score.userID] || `ID:${score.userID}`),
            formatSheetValue(score.time.toFixed(3)),
            formatSheetValue(score.scramble),
            formatSheetValue(score.date),
            formatSheetValue(score.timestamp)
        ]);

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

        // === 6. Build FrontEndScoreBoardUnique (best per user) ===
        const bestByUser = {};
        for (const score of uniqueScores) {
            if (!bestByUser[score.userID] || score.time < bestByUser[score.userID].time) {
                bestByUser[score.userID] = {
                    nickname: userMap[score.userID] || `ID:${score.userID}`,
                    time: score.time,
                    date: score.date,
                    timestamp: score.timestamp
                };
            }
        }

        const uniqueData = Object.values(bestByUser)
            .sort((a, b) => a.time - b.time)
            .map(entry => [
                formatSheetValue(entry.nickname),
                formatSheetValue(entry.time.toFixed(3)),
                formatSheetValue(entry.date),
                formatSheetValue(entry.timestamp)
            ]);

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

        // === 7. Delete synced pending scores ===
        const pendingIds = pending.map(s => s._id);
        await pendingScores.deleteMany({ _id: { $in: pendingIds } });

        sendSuccess(res, {
            synced: pending.length,
            totalScores: uniqueScores.length,
            uniqueUsers: uniqueData.length,
            deletedSlowRows: totalDeleted,
            message: `Synced ${pending.length} scores. Total: ${uniqueScores.length}`
        });

    } catch (err) {
        console.error('[SYNC_SCORES] Error:', err);
        sendError(res, 500, err.message, '同步失敗');
    }
};

/**
 * Find the next empty row for a specific period column
 */
async function findNextEmptyRow(sheets, spreadsheetId, startCol) {
    const colLetter = getColumnLetter(startCol);

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `ScoreBoard!${colLetter}:${colLetter}`
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

/**
 * Enforce 1000 row limit for a specific period
 */
async function enforceRowLimitForPeriod(sheets, spreadsheetId, config) {
    const startColLetter = getColumnLetter(config.startCol);
    const endColLetter = getColumnLetter(config.endCol);

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `ScoreBoard!${startColLetter}:${endColLetter}`
    });

    const data = response.data.values || [];

    // Filter out empty rows
    const validRows = data.map((row, idx) => ({
        rowNumber: idx + 1,
        time: parseFloat(row[1]?.toString().replace(/^'/, '') || 'Infinity'),
        data: row
    })).filter(r => r.data[0] && !isNaN(r.time));

    if (validRows.length <= MAX_ROWS) {
        return 0;
    }

    const rowsToDelete = validRows.length - MAX_ROWS;

    // Sort by time descending (slowest first)
    validRows.sort((a, b) => b.time - a.time);

    // Keep fastest 1000
    const rowsToKeep = validRows.slice(rowsToDelete);
    rowsToKeep.sort((a, b) => a.rowNumber - b.rowNumber);

    // Clear this period's columns
    const sheetId = await getSheetId(sheets, spreadsheetId, 'ScoreBoard');

    // Clear all data in this period's columns
    await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `ScoreBoard!${startColLetter}:${endColLetter}`
    });

    // Rewrite the kept rows
    if (rowsToKeep.length > 0) {
        const newData = rowsToKeep.map(r => r.data);
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `ScoreBoard!${startColLetter}1:${endColLetter}${newData.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: newData }
        });
    }

    return rowsToDelete;
}

/**
 * Get sheet ID by name
 */
async function getSheetId(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties'
    });

    const sheet = response.data.sheets.find(s => s.properties.title === sheetName);
    return sheet ? sheet.properties.sheetId : 0;
}
