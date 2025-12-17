const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    sendError,
    sendSuccess,
    getColumnLetter,
    getBucketIndex
} = require('../lib/apiUtils');

/**
 * Get Nicknames API
 * Batch resolve User IDs to Nicknames using Hash Table lookup
 * Architecture: Web → Vercel → Sheet (option_3_vercel)
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

        console.log(`[GET_NICKNAMES] Resolving ${ids.length} user IDs`);

        // === 2. Batch Read from Total Sheet (UserID → Email) ===
        // Total sheet stores emails at row number = UserID
        const totalRanges = ids.map(id => `Total!A${id} `);

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

        console.log(`[GET_NICKNAMES] Resolved ${Object.keys(idToEmail).length} emails from Total`);

        // === 3. Get UserMap Metadata ===
        const meta = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties(title,gridProperties.columnCount)'
        });

        const userMapProps = meta.data.sheets.find(s => s.properties.title === 'UserMap');
        if (!userMapProps) {
            throw new Error('UserMap sheet not found');
        }

        const userCols = userMapProps.properties.gridProperties.columnCount || 26;
        const bucketSize = Math.floor(userCols / 3); // 3 columns per bucket

        // === 4. Group Emails by Bucket ===
        const bucketToEmails = {};
        Object.values(idToEmail).forEach(email => {
            if (email) {
                const bucketIdx = getBucketIndex(email, bucketSize);
                if (!bucketToEmails[bucketIdx]) {
                    bucketToEmails[bucketIdx] = [];
                }
                bucketToEmails[bucketIdx].push(email);
            }
        });

        console.log(`[GET_NICKNAMES] Emails distributed across ${Object.keys(bucketToEmails).length} buckets`);

        // === 5. Batch Read from UserMap (Email → Nickname) ===
        const getBucketRange = (bucketIdx) => {
            const startCol = bucketIdx * 3;
            const endCol = startCol + 2;
            return `UserMap!${getColumnLetter(startCol)}:${getColumnLetter(endCol)} `;
        };

        const bucketRanges = Object.keys(bucketToEmails).map(b => getBucketRange(parseInt(b)));

        const bucketRes = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges: bucketRanges
        });

        // Build Email → Nickname map
        const emailToNickname = {};
        bucketRes.data.valueRanges.forEach(vr => {
            const rows = vr.values || [];
            rows.forEach(row => {
                if (row && row.length >= 3) {
                    const email = row[0];
                    const nickname = row[2];
                    if (email && nickname) {
                        emailToNickname[email] = nickname;
                    }
                }
            });
        });

        console.log(`[GET_NICKNAMES] Found ${Object.keys(emailToNickname).length} nicknames in UserMap`);

        // === 6. Build Final UserID → Nickname Map ===
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

        console.log(`[GET_NICKNAMES] Successfully resolved all ${ids.length} IDs`);

        // === 7. Return Response ===
        // Return plain object for backward compatibility
        res.status(200).json(finalMap);

    } catch (err) {
        console.error('[GET_NICKNAMES] Error:', err);
        sendError(res, 500, err.message, '無法讀取暱稱資料');
    }
};
