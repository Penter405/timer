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
 * Sync Scores API
 * 
 * Called by external cron job (cron-job.org) every minute
 * 
 * Steps:
 * 1. Read pending_scores from MongoDB
 * 2. Sync to Google Sheets ScoreBoard
 * 3. Update FrontEndScoreBoard and FrontEndScoreBoardUnique
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

        // === 2. Get user nicknames ===
        const userIDs = [...new Set(pending.map(s => s.userID))];
        const usersData = await users.find({ userID: { $in: userIDs } }).toArray();
        const userMap = {};
        for (const user of usersData) {
            userMap[user.userID] = user.nickname || `ID:${user.userID}`;
        }

        // === 3. Sync to Google Sheets ===
        const sheets = getSheetsClient();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        if (!spreadsheetId) {
            throw new Error('GOOGLE_SHEET_ID not configured');
        }

        // Prepare ScoreBoard data (userID, time, scramble, date, timestamp, Verified)
        const scoreBoardData = pending.map(score => [
            formatSheetValue(score.userID),
            formatSheetValue(score.time.toFixed(3)),
            formatSheetValue(score.scramble),
            formatSheetValue(score.date),
            formatSheetValue(score.timestamp),
            formatSheetValue('Verified')
        ]);

        // Prepare FrontEnd data (nickname, time, scramble, date, timestamp)
        const frontEndData = pending.map(score => [
            formatSheetValue(userMap[score.userID]),
            formatSheetValue(score.time.toFixed(3)),
            formatSheetValue(score.scramble),
            formatSheetValue(score.date),
            formatSheetValue(score.timestamp)
        ]);

        // === 4. Append to ScoreBoard ===
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'ScoreBoard!A:F',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: scoreBoardData }
        });
        console.log(`[SYNC_SCORES] Appended ${scoreBoardData.length} rows to ScoreBoard`);

        // === 5. Append to FrontEndScoreBoard ===
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'FrontEndScoreBoard!A:E',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: frontEndData }
        });
        console.log(`[SYNC_SCORES] Appended ${frontEndData.length} rows to FrontEndScoreBoard`);

        // === 6. Update FrontEndScoreBoardUnique (best per user) ===
        await updateUniqueScoreBoard(sheets, spreadsheetId, pending, userMap);

        // === 7. Delete synced pending scores ===
        const pendingIds = pending.map(s => s._id);
        await pendingScores.deleteMany({ _id: { $in: pendingIds } });
        console.log(`[SYNC_SCORES] Deleted ${pendingIds.length} synced pending scores`);

        // === 8. Return Success ===
        sendSuccess(res, {
            synced: pending.length,
            message: `Successfully synced ${pending.length} scores`
        });

    } catch (err) {
        console.error('[SYNC_SCORES] Error:', err);
        sendError(res, 500, err.message, '同步失敗');
    }
};

/**
 * Update FrontEndScoreBoardUnique with best time per user
 */
async function updateUniqueScoreBoard(sheets, spreadsheetId, newScores, userMap) {
    try {
        // Get existing unique scores
        const existingRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'FrontEndScoreBoardUnique!A:D'
        });

        const existingData = existingRes.data.values || [];

        // Build map of existing best times { nickname: { time, row, data } }
        const bestTimes = {};
        existingData.forEach((row, idx) => {
            const nickname = row[0];
            const time = parseFloat(row[1]?.toString().replace(/^'/, '') || 'Infinity');
            if (nickname && !isNaN(time)) {
                bestTimes[nickname] = { time, row: idx + 1, data: row };
            }
        });

        // Process new scores
        const updates = [];
        const appends = [];

        for (const score of newScores) {
            const nickname = userMap[score.userID];
            const newTime = score.time;

            if (bestTimes[nickname]) {
                // User exists, check if new time is better
                if (newTime < bestTimes[nickname].time) {
                    updates.push({
                        row: bestTimes[nickname].row,
                        data: [nickname, score.time.toFixed(3), score.date, score.timestamp]
                    });
                    bestTimes[nickname].time = newTime;
                }
            } else {
                // New user
                appends.push([nickname, score.time.toFixed(3), score.date, score.timestamp]);
                bestTimes[nickname] = { time: newTime };
            }
        }

        // Apply updates
        for (const update of updates) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `FrontEndScoreBoardUnique!A${update.row}:D${update.row}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [update.data] }
            });
        }

        // Apply appends
        if (appends.length > 0) {
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'FrontEndScoreBoardUnique!A:D',
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: appends }
            });
        }

        console.log(`[SYNC_SCORES] Unique: ${updates.length} updates, ${appends.length} new users`);

    } catch (error) {
        console.error('[SYNC_SCORES] Unique update error:', error.message);
        // Non-critical, continue
    }
}
