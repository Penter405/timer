const { connectToMongo } = require('../lib/mongoClient');
const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    sendError,
    sendSuccess,
    formatSheetValue,
    cleanSheetValue,
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
 * 2. Syncs History (ScoreBoard) -> Derives FrontEndScoreBoard.
 * 3. Deletes pending scores from MongoDB.
 * 4. Syncs Unique (ScoreBoardUnique) -> Derives FrontEndScoreBoardUnique.
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
            // === 3. Sync ScoreBoard (Backend History) - Top 1000 Solves ===
            // AND Sync FrontEndScoreBoard (Derived)

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

                // 1. Read Existing History
                const sheetResp = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `ScoreBoard!${startColLetter}:${endColLetter}`
                });
                const rawExistingRows = sheetResp.data.values || [];

                // Validate/Clean existing rows (ensure we can parse numbers)
                // We strip quotes if they somehow exist in the read data
                const existingRows = rawExistingRows.map(row => row.map(cell => cleanSheetValue(cell)));

                // 2. Append New (We clean newRows too just for sorting consistency, though they have clean numbers inside)
                // Actually newRows has formatted values ('1.23). cleanSheetValue removes ' for logic.
                const cleanNewRows = newRows.map(row => row.map(cell => cleanSheetValue(cell)));

                const combinedRows = existingRows.concat(cleanNewRows);

                // 3. Sort by Time (Ascending) & Cap at 1000
                // Column 1 is Time
                const sortedRows = combinedRows
                    .sort((a, b) => {
                        const timeA = parseFloat(a[1]);
                        const timeB = parseFloat(b[1]);
                        if (isNaN(timeA)) return 1;
                        if (isNaN(timeB)) return -1;
                        return timeA - timeB;
                    })
                    .slice(0, MAX_ROWS);

                // 4. Re-Format for Writing (Force String)
                const finalRows = sortedRows.map(row => row.map(cell => formatSheetValue(cell)));

                // 5. Write Backend (ScoreBoard) - Overwrite Row 1
                await sheets.spreadsheets.values.clear({
                    spreadsheetId,
                    range: `ScoreBoard!${startColLetter}:${endColLetter}`
                });

                if (finalRows.length > 0) {
                    await sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `ScoreBoard!${startColLetter}1`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: finalRows }
                    });
                }
                console.log(`[SYNC_SCORES] ScoreBoard/${periodKey}: Updated Top ${finalRows.length} rows`);

                // 6. Derive & Write FrontEndScoreBoard
                // Map UserID (Col 0) to Nickname
                const frontEndRows = finalRows.map(row => {
                    // row[0] is formatted like '123 or 123
                    const rawID = cleanSheetValue(row[0]).toString();
                    const nickname = userMap[rawID] || `ID:${rawID}`;

                    // Construct Frontend Row: Nickname, Time, Scramble, Date, Timestamp
                    // row indices: 0:ID, 1:Time, 2:Scramble, 3:Date, 4:Timestamp, 5:Status
                    return [
                        formatSheetValue(nickname),
                        row[1], // Already formatted time
                        row[2], // Already formatted scramble
                        row[3], // Already formatted date
                        row[4]  // Already formatted timestamp
                    ];
                });

                const frontConfig = FRONTEND_PERIOD_CONFIG[periodKey];
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
            }

            // === CRITICAL: Delete from MongoDB immediately after History Sync ===
            const scoreIds = pendingScores.map(s => s._id);
            await scores.deleteMany({ _id: { $in: scoreIds } });
            console.log(`[SYNC_SCORES] Deleted ${scoreIds.length} scores from MongoDB (Anti-Duplication)`);
        }

        // === 5. Sync ScoreBoardUnique (Sheet-Based Logic) ===
        // Row 1 Logic. Top 1000 Users.

        for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
            // A. Read Existing Data (Row 1+)
            const startColLetter = getColumnLetter(config.startCol);
            const endColLetter = getColumnLetter(config.endCol);

            const sheetResp = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `ScoreBoardUnique!${startColLetter}:${endColLetter}`
            });

            const uniqueMap = new Map();
            const rawExistingRows = sheetResp.data.values || [];

            // Load Sheet Data into Map (Clean values first)
            rawExistingRows.forEach(row => {
                if (!row[0]) return;
                const cleanRow = row.map(c => cleanSheetValue(c));

                const userID = cleanRow[0].toString();
                const time = parseFloat(cleanRow[1]);
                if (!isNaN(time)) {
                    uniqueMap.set(userID, {
                        userID,
                        time,
                        scramble: cleanRow[2],
                        date: cleanRow[3],
                        timestamp: cleanRow[4],
                        status: cleanRow[5]
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

            // B. Prepare Rows (Force String)
            const backendRows = sortedUnique.map(s => [
                formatSheetValue(s.userID),
                formatSheetValue(s.time.toFixed(3)),
                formatSheetValue(s.scramble || ''),
                formatSheetValue(s.date || ''),
                formatSheetValue(s.timestamp || ''),
                formatSheetValue(s.status || 'Verified')
            ]);

            // C. Write Back to ScoreBoardUnique
            await sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `ScoreBoardUnique!${startColLetter}:${endColLetter}`
            });

            if (backendRows.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `ScoreBoardUnique!${startColLetter}1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: backendRows }
                });
                console.log(`[SYNC_SCORES] ScoreBoardUnique/${periodKey}: Updated ${backendRows.length} rows`);
            }

            // D. Derive & Write FrontEndScoreBoardUnique
            const frontEndUniqueRows = backendRows.map(row => {
                const rawID = cleanSheetValue(row[0]).toString();
                const nickname = userMap[rawID] || `ID:${rawID}`;
                return [
                    formatSheetValue(nickname),
                    row[1],
                    row[2],
                    row[3],
                    row[4]
                ];
            });

            const frontConfig = FRONTEND_PERIOD_CONFIG[periodKey];
            const frontStartCol = getColumnLetter(frontConfig.startCol);
            const frontEndCol = getColumnLetter(frontConfig.startCol + 4);

            await sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `FrontEndScoreBoardUnique!${frontStartCol}:${frontEndCol}`
            });

            if (frontEndUniqueRows.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `FrontEndScoreBoardUnique!${frontStartCol}1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: frontEndUniqueRows }
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
 * (Kept for reference, though unused in Overwrite logic)
 */
async function findNextEmptyRow(sheets, spreadsheetId, sheetName, startCol) {
    const colLetter = getColumnLetter(startCol);

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!${colLetter}:${colLetter}`
    });

    const data = response.data.values || [];

    for (let i = 0; i < data.length; i++) {
        if (!data[i][0] || data[i][0] === '') {
            return i + 1;
        }
    }
    return data.length + 1;
}