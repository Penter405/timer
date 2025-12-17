const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    sendError,
    sendSuccess,
    getColumnLetter,
    getBucketIndex
} = require('../lib/apiUtils');

// Must match update_nickname.js settings
const USERMAP_TEAM_COUNT = 8;

/**
 * Get Nicknames API
 * Batch resolve User IDs to Nicknames using Hash Table lookup
 * Architecture: Web → Vercel → Sheet (option_3_vercel)
 * 
 * Flow:
 * 1. ScoreBoard has UserID in column A
 * 2. Use UserID as row number in Total sheet to get Email
 * 3. Hash Email to find bucket in UserMap
 * 4. Lookup UniqueName (column 3 of bucket) in UserMap
 * 
 * Request Body:
 * - ids: Array of UserIDs to resolve (required)
 * 
 * Response:
 * - Map of { userID: nickname }
 */
module.exports = async (req, res) => {
    // Handle CORS
    if (handleCORS(req, res)) return;

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    try {
        // === 1. Validate Input ===
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return sendError(res, 400, 'Invalid IDs array', '需要提供有效的 ID 陣列');
        }

        console.log(`[GET_NICKNAMES] Resolving ${ids.length} user IDs:`, ids);

        // === 2. Batch Read from Total Sheet (UserID → Email) ===
        // Total sheet stores emails at row number = UserID
        const totalRanges = ids.map(id => `Total!A${id}`);

        const totalRes = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges: totalRanges
        });

        const idToEmail = {};
        totalRes.data.valueRanges.forEach((vr, idx) => {
            if (vr.values && vr.values[0] && vr.values[0][0]) {
                idToEmail[ids[idx]] = vr.values[0][0];
            }
        });

        console.log(`[GET_NICKNAMES] Resolved ${Object.keys(idToEmail).length} emails from Total:`, idToEmail);

        // === 3. Group Emails by Bucket (using fixed 8 teams) ===
        const bucketToEmails = {};
        Object.entries(idToEmail).forEach(([id, email]) => {
            if (email) {
                const bucketIdx = getBucketIndex(email, USERMAP_TEAM_COUNT);
                if (!bucketToEmails[bucketIdx]) {
                    bucketToEmails[bucketIdx] = [];
                }
                bucketToEmails[bucketIdx].push({ id, email });
            }
        });

        console.log(`[GET_NICKNAMES] Emails distributed across ${Object.keys(bucketToEmails).length} buckets`);

        // === 4. Batch Read from UserMap (Email → Nickname) ===
        const getBucketRange = (bucketIdx) => {
            const startCol = bucketIdx * 3; // 3 columns per bucket: Email, UserID, UniqueName
            const endCol = startCol + 2;
            return `UserMap!${getColumnLetter(startCol)}:${getColumnLetter(endCol)}`;
        };

        const bucketIndices = Object.keys(bucketToEmails).map(b => parseInt(b));
        const bucketRanges = bucketIndices.map(b => getBucketRange(b));

        console.log(`[GET_NICKNAMES] Reading bucket ranges:`, bucketRanges);

        const bucketRes = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges: bucketRanges
        });

        // Build Email → Nickname map
        const emailToNickname = {};
        bucketRes.data.valueRanges.forEach((vr, vrIdx) => {
            const rows = vr.values || [];
            console.log(`[GET_NICKNAMES] Bucket ${bucketIndices[vrIdx]} has ${rows.length} rows`);
            rows.forEach(row => {
                if (row && row.length >= 3) {
                    const email = row[0];
                    const nickname = row[2]; // UniqueName is in column 3 (index 2)
                    if (email && nickname) {
                        emailToNickname[email] = nickname;
                        console.log(`[GET_NICKNAMES] Found mapping: ${email} -> ${nickname}`);
                    }
                }
            });
        });

        console.log(`[GET_NICKNAMES] Found ${Object.keys(emailToNickname).length} nicknames in UserMap`);

        // === 5. Build Final UserID → Nickname Map ===
        const finalMap = {};
        ids.forEach(id => {
            const email = idToEmail[id];
            if (email) {
                const nickname = emailToNickname[email];
                // If no nickname, return null (frontend will use fallback)
                finalMap[id] = nickname || null;
            } else {
                // ID not found in Total sheet
                finalMap[id] = null;
            }
        });

        console.log(`[GET_NICKNAMES] Final map:`, finalMap);

        // === 6. Return Response ===
        // Return plain object for backward compatibility
        res.status(200).json(finalMap);

    } catch (err) {
        console.error('[GET_NICKNAMES] Error:', err);
        sendError(res, 500, err.message, '無法讀取暱稱資料');
    }
};
