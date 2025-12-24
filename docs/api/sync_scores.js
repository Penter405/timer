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

const PERIOD_CONFIG = {
    all: { startCol: 0, endCol: 5, name: '歷史' },   // A-F
    year: { startCol: 6, endCol: 11, name: '本年' },   // G-L
    month: { startCol: 12, endCol: 17, name: '本月' },   // M-R
    week: { startCol: 18, endCol: 23, name: '本周' },   // S-X
    today: { startCol: 24, endCol: 29, name: '本日' }    // Y-AD
};

const FRONTEND_PERIOD_CONFIG = {
    all: { startCol: 0 },   // A-E
    year: { startCol: 5 },   // F-J
    month: { startCol: 10 },  // K-O
    week: { startCol: 15 },  // P-T
    today: { startCol: 20 }   // U-Y
};

/**
 * Sync Scores API (Smart Sync Mode)
 * 
 * Triggers:
 * 1. New Solving (pendingScores > 0)
 * 2. New Naming (syncFlags.nicknameUpdate === 1)
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    try {
        console.log('[SYNC_SCORES] Starting sync check...');

        const { db } = await connectToMongo();
        const scores = db.collection('scores');
        const users = db.collection('users');
        const total = db.collection('total');

        const sheets = getSheetsClient();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        if (!spreadsheetId) {
            throw new Error('GOOGLE_SHEET_ID not configured');
        }

        // === 1. Check Triggers ===
        const pendingScores = await scores.find({ syncStatus: 'pending' }).toArray();
        const flagDoc = await total.findOne({ _id: 'syncFlags' });
        const nicknameUpdate = flagDoc?.nicknameUpdate === 1;

        const isNewSolve = pendingScores.length > 0;
        const isNewName = nicknameUpdate;

        if (!isNewSolve && !isNewName) {
            console.log('[SYNC_SCORES] No updates needed (No pending scores or name changes). SKIPPING.');
            return sendSuccess(res, { message: 'No updates needed' });
        }

        console.log(`[SYNC_SCORES] Triggered! NewSolve: ${isNewSolve}, NewName: ${isNewName}`);

        // === 2. Get User Map (Needed for both) ===
        const allUsers = await users.find({}).toArray();
        const userMap = {};
        for (const user of allUsers) {
            userMap[user.userID] = user.nickname || `ID:${user.userID}`;
        }

        // === 3. Sync ScoreBoard (History) ===
        // If New Solve: Full Sync
        // If Only Name: Refresh Frontend Only
        if (isNewSolve || isNewName) {
            const newRows = pendingScores.map(score => [
                formatSheetValue(score.userID),
                formatSheetValue(score.time.toFixed(3)),
                formatSheetValue(score.scramble),
                formatSheetValue(score.date),
                formatSheetValue(score.timestamp),
                formatSheetValue('Verified')
            ]);
            // cleanNewRows logic just strips quotes for sorting, but newRows has quotes. 
            // We use simple map.
            const cleanNewRows = newRows.map(r => r.map(c => cleanSheetValue(c)));

            for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
                const startColLetter = getColumnLetter(config.startCol);
                const endColLetter = getColumnLetter(config.endCol);

                // Read Existing History
                const sheetResp = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `ScoreBoard!${startColLetter}:${endColLetter}`
                });
                const rawExistingRows = sheetResp.data.values || [];
                const existingRows = rawExistingRows.map(row => row.map(cell => cleanSheetValue(cell)));

                let finalRowsCapped = [];
                let backendUpdated = false;

                if (isNewSolve) {
                    // FULL SYNC: Append -> Sort -> Cap -> Write
                    const combinedRows = existingRows.concat(cleanNewRows);

                    const sortedRows = combinedRows
                        .sort((a, b) => {
                            const timeA = parseFloat(a[1]);
                            const timeB = parseFloat(b[1]);
                            if (isNaN(timeA)) return 1;
                            if (isNaN(timeB)) return -1;
                            return timeA - timeB;
                        })
                        .slice(0, MAX_ROWS);

                    finalRowsCapped = sortedRows; // These are CLEAN values

                    // Write Backend
                    const rowsToWrite = finalRowsCapped.map(row => row.map(cell => formatSheetValue(cell)));
                    await sheets.spreadsheets.values.clear({
                        spreadsheetId,
                        range: `ScoreBoard!${startColLetter}:${endColLetter}`
                    });
                    if (rowsToWrite.length > 0) {
                        await sheets.spreadsheets.values.update({
                            spreadsheetId,
                            range: `ScoreBoard!${startColLetter}1`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: { values: rowsToWrite }
                        });
                    }
                    console.log(`[SYNC_SCORES] ScoreBoard/${periodKey}: Updated Top ${rowsToWrite.length} rows`);
                } else {
                    // NAME ONLY: Use Existing as Source
                    finalRowsCapped = existingRows;
                    console.log(`[SYNC_SCORES] ScoreBoard/${periodKey}: Using existing rows for Name Update`);
                }

                // Write Frontend (Derived from finalRowsCapped)
                const frontEndRows = finalRowsCapped.map(row => {
                    const rawID = row[0].toString(); // clean value
                    const nickname = userMap[rawID] || `ID:${rawID}`;
                    return [
                        formatSheetValue(nickname), // Name
                        formatSheetValue(row[1]),   // Time
                        formatSheetValue(row[2]),   // Scramble
                        formatSheetValue(row[3]),   // Date
                        formatSheetValue(row[4])    // Timestamp
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
        }

        // === 4. Sync Unique Leaderboards ===
        // Runs if ANY trigger occurs (New Name needs new leaderboard names)
        if (isNewSolve || isNewName) {
            for (const [periodKey, config] of Object.entries(PERIOD_CONFIG)) {
                // A. Read Existing
                const startColLetter = getColumnLetter(config.startCol);
                const endColLetter = getColumnLetter(config.endCol);

                const sheetResp = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `ScoreBoardUnique!${startColLetter}:${endColLetter}`
                });

                const uniqueMap = new Map();
                const rawExistingRows = sheetResp.data.values || [];

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

                // B. Merge Pending (If isNewSolve)
                if (isNewSolve) {
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
                }

                // C. Sort & Limit
                const sortedUnique = Array.from(uniqueMap.values())
                    .sort((a, b) => a.time - b.time)
                    .slice(0, 1000);

                const backendRows = sortedUnique.map(s => [
                    formatSheetValue(s.userID),
                    formatSheetValue(s.time.toFixed(3)),
                    formatSheetValue(s.scramble || ''),
                    formatSheetValue(s.date || ''),
                    formatSheetValue(s.timestamp || ''),
                    formatSheetValue(s.status || 'Verified')
                ]);

                // D. Write Backend (Always write ensures consistency, small cost)
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

                // E. Derive & Write FrontEnd
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
        }

        // === 5. Cleanup ===
        if (isNewSolve) {
            const scoreIds = pendingScores.map(s => s._id);
            await scores.deleteMany({ _id: { $in: scoreIds } });
            console.log(`[SYNC_SCORES] Deleted ${scoreIds.length} scores from MongoDB`);
        }

        if (isNewName) {
            await total.updateOne(
                { _id: 'syncFlags' },
                { $set: { nicknameUpdate: 0 } }
            );
            console.log(`[SYNC_SCORES] Reset nicknameUpdate flag`);
        }

        sendSuccess(res, {
            scoresSynced: pendingScores.length,
            nicknameUpdated: isNewName,
            message: 'Smart sync completed'
        });

    } catch (err) {
        console.error('[SYNC_SCORES] Error:', err);
        sendError(res, 500, err.message, '同步失敗');
    }
};