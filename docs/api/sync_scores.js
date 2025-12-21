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
            console.log('[SYNC_SCORES] No pending scores, will still refresh FrontEnd sheets');
        } else {
            console.log(`[SYNC_SCORES] Found ${pending.length} pending scores`);
        }

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

        // === 3. Read ALL 10 groups (5 periods × 2 sheets) for FrontEnd ===
        const allScores = [];
        const userIDsSet = new Set();

        // Read from both ScoreBoard and ScoreBoardUnique
        const sheetNames = ['ScoreBoard', 'ScoreBoardUnique'];

        for (const sheetName of sheetNames) {
            for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
                const startColLetter = getColumnLetter(config.startCol);
                const endColLetter = getColumnLetter(config.endCol);

                try {
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId,
                        range: `${sheetName}!${startColLetter}:${endColLetter}`
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
                                period: periodKey,
                                source: sheetName
                            });
                            userIDsSet.add(userID);
                        }
                    }
                } catch (err) {
                    console.log(`[SYNC_SCORES] Could not read ${sheetName}/${periodKey}: ${err.message}`);
                }
            }
        }

        console.log(`[SYNC_SCORES] Aggregated ${allScores.length} total scores from all 10 groups`);

        // === 4. Get user nicknames ===
        const allUserIDs = [...userIDsSet];
        const allUsersData = await users.find({ userID: { $in: allUserIDs } }).toArray();
        const userMap = {};
        for (const user of allUsersData) {
            userMap[user.userID] = user.nickname || `ID:${user.userID}`;
        }

        // === 5. Update FrontEndScoreBoard for each period (5 periods × 5 columns = 25 columns) ===
        // FrontEnd uses 5 columns per period: Nickname, Time, Scramble, Date, Timestamp
        const FRONTEND_PERIOD_CONFIG = {
            all: { startCol: 0 },   // A-E
            year: { startCol: 5 },   // F-J
            month: { startCol: 10 },  // K-O
            week: { startCol: 15 },  // P-T
            today: { startCol: 20 }   // U-Y
        };

        for (const [periodKey, frontConfig] of Object.entries(FRONTEND_PERIOD_CONFIG)) {
            const sourceConfig = PERIOD_CONFIG[periodKey];
            const startColLetter = getColumnLetter(sourceConfig.startCol);
            const endColLetter = getColumnLetter(sourceConfig.endCol);

            // Read from ScoreBoard for this period
            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `ScoreBoard!${startColLetter}:${endColLetter}`
                });

                const data = response.data.values || [];
                const frontEndRows = data
                    .filter(row => row[0] && row[1])
                    .map(row => {
                        const userID = parseInt(row[0]);
                        const nickname = userMap[userID] || `ID:${userID}`;
                        return [
                            formatSheetValue(nickname),
                            formatSheetValue(row[1]),  // time
                            formatSheetValue(row[2]),  // scramble
                            formatSheetValue(row[3]),  // date
                            formatSheetValue(row[4])   // timestamp
                        ];
                    });

                // Write to FrontEndScoreBoard for this period
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
                console.log(`[SYNC_SCORES] Updated FrontEndScoreBoard/${periodKey} with ${frontEndRows.length} rows`);
            } catch (err) {
                console.log(`[SYNC_SCORES] Could not update FrontEndScoreBoard/${periodKey}: ${err.message}`);
            }
        }

        // === 6. Update FrontEndScoreBoardUnique for each period (5 periods × 4 columns = 20 columns) ===
        const FRONTEND_UNIQUE_PERIOD_CONFIG = {
            all: { startCol: 0 },   // A-D
            year: { startCol: 4 },   // E-H
            month: { startCol: 8 },   // I-L
            week: { startCol: 12 },  // M-P
            today: { startCol: 16 }   // Q-T
        };

        for (const [periodKey, frontConfig] of Object.entries(FRONTEND_UNIQUE_PERIOD_CONFIG)) {
            const sourceConfig = PERIOD_CONFIG[periodKey];
            const startColLetter = getColumnLetter(sourceConfig.startCol);
            const endColLetter = getColumnLetter(sourceConfig.endCol);

            try {
                // Read from ScoreBoardUnique for this period
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `ScoreBoardUnique!${startColLetter}:${endColLetter}`
                });

                const data = response.data.values || [];
                const uniqueRows = data
                    .filter(row => row[0] && row[1])
                    .map(row => {
                        const userID = parseInt(row[0]);
                        const nickname = userMap[userID] || `ID:${userID}`;
                        return [
                            formatSheetValue(nickname),
                            formatSheetValue(row[1]),  // time
                            formatSheetValue(row[3]),  // date
                            formatSheetValue(row[4])   // timestamp
                        ];
                    });

                // Write to FrontEndScoreBoardUnique for this period
                const frontStartCol = getColumnLetter(frontConfig.startCol);
                const frontEndCol = getColumnLetter(frontConfig.startCol + 3);

                await sheets.spreadsheets.values.clear({
                    spreadsheetId,
                    range: `FrontEndScoreBoardUnique!${frontStartCol}:${frontEndCol}`
                });

                if (uniqueRows.length > 0) {
                    await sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `FrontEndScoreBoardUnique!${frontStartCol}1`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: uniqueRows }
                    });
                }
                console.log(`[SYNC_SCORES] Updated FrontEndScoreBoardUnique/${periodKey} with ${uniqueRows.length} rows`);
            } catch (err) {
                console.log(`[SYNC_SCORES] Could not update FrontEndScoreBoardUnique/${periodKey}: ${err.message}`);
            }
        }

        // === 7. Delete synced pending scores ===
        const pendingIds = pending.map(s => s._id);
        if (pendingIds.length > 0) {
            await pendingScores.deleteMany({ _id: { $in: pendingIds } });
        }

        sendSuccess(res, {
            synced: pending.length,
            message: `Synced ${pending.length} scores, updated all 10 FrontEnd groups`
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
