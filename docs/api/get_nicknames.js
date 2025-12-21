const { getCollections } = require('../lib/mongoClient');
const { decryptNickname } = require('../lib/encryption');
const {
    handleCORS,
    sendError,
    sendSuccess
} = require('../lib/apiUtils');

/**
 * Get Nicknames API (MongoDB Primary)
 * 
 * Returns public leaderboard data from MongoDB
 * Decrypts nicknames for display
 * 
 * Query Parameters:
 * - period: 'all', 'year', 'month', 'week', 'today' (default: 'all')
 * - limit: Number of results (default: 1000, max: 1000)
 */
module.exports = async (req, res) => {
    if (handleCORS(req, res)) return;

    try {
        const period = req.query.period || 'all';
        const limit = Math.min(parseInt(req.query.limit) || 1000, 1000);

        console.log(`[GET_NICKNAMES] Fetching ${limit} scores for period: ${period}`);

        // === 1. Get MongoDB Collections ===
        const { users, scores } = await getCollections();

        // === 2. Fetch Top Scores ===
        const query = period === 'all' ? {} : { period };
        const topScores = await scores
            .find(query)
            .sort({ time: 1 }) // Fastest first
            .limit(limit)
            .toArray();

        console.log(`[GET_NICKNAMES] Found ${topScores.length} scores`);

        // === 3. Get User Info and Decrypt Nicknames ===
        const userIDs = [...new Set(topScores.map(s => s.userID))];
        const userMap = {};

        // Batch fetch users
        const usersData = await users.find({ userID: { $in: userIDs } }).toArray();

        for (const user of usersData) {
            userMap[user.userID] = {
                nickname: user.nickname || `Player${user.userID}`,
                encryptedNickname: user.encryptedNickname
            };
        }

        // === 4. Build Response ===
        const leaderboard = topScores.map((score, index) => {
            const userData = userMap[score.userID] || { nickname: `Player${score.userID}` };

            return {
                rank: index + 1,
                userID: score.userID,
                nickname: userData.nickname,
                time: score.time,
                scramble: score.scramble || '',
                date: score.date,
                timestamp: score.timestamp
            };
        });

        // === 5. Return Success ===
        sendSuccess(res, {
            period,
            count: leaderboard.length,
            leaderboard
        });

    } catch (err) {
        console.error('[GET_NICKNAMES] Error:', err);

        // Fallback to Google Sheets if MongoDB fails
        try {
            console.log('[GET_NICKNAMES] Falling back to Google Sheets');
            return await getFallbackFromSheets(req, res);
        } catch (fallbackErr) {
            console.error('[GET_NICKNAMES] Fallback failed:', fallbackErr);
            sendError(res, 500, err.message, '伺服器錯誤，請稍後再試');
        }
    }
};

/**
 * Fallback: Get nicknames from Google Sheets
 */
async function getFallbackFromSheets(req, res) {
    const getSheetsClient = require('./sheetsClient');
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) {
        throw new Error('No Google Sheet ID configured');
    }

    // Read Total sheet for nicknames
    const totalResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Total!A:B'
    });

    const totalData = totalResponse.data.values || [];
    const nicknameMap = {};

    totalData.forEach((row, index) => {
        const userID = index + 1;
        const nickname = row[1] || `Player${userID}`;
        nicknameMap[userID] = nickname;
    });

    console.log(`[GET_NICKNAMES] Fallback: Loaded ${Object.keys(nicknameMap).length} nicknames from Sheet`);

    sendSuccess(res, {
        period: 'all',
        count: Object.keys(nicknameMap).length,
        nicknames: nicknameMap,
        source: 'google_sheets'
    });
}
