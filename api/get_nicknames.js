const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

// --- Helper Functions (Duplicated from update_nickname.js for isolation) ---
function getColumnLetter(colIndex) {
    let temp, letter = '';
    while (colIndex >= 0) {
        temp = colIndex % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        colIndex = Math.floor(colIndex / 26) - 1;
    }
    return letter;
}

function getBucketRange(sheetName, bucketIndex) {
    const startCol = bucketIndex * 3; // 3 columns: Email, ID, Nickname
    const endCol = startCol + 2;
    const startLetter = getColumnLetter(startCol);
    const endLetter = getColumnLetter(endCol);
    return `${sheetName}!${startLetter}:${endLetter}`;
}

function getBucketIndex(str, bucketSize) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % bucketSize;
}

module.exports = async (req, res) => {
    // === CORS headers（一定要在最前面）===
    const allowedOrigins = [
        'https://penter405.github.io',
        'http://127.0.0.1:5500',
        'http://localhost:5500',
        'http://localhost:3000'
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version");

    // === 回 preflight ===
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // === 真正的 API ===
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { ids } = req.body; // Expect array of IDs [1, 2, 5]
        if (!ids || !Array.isArray(ids)) {
            return res.status(400).json({ error: 'Missing or invalid IDs array' });
        }

        if (ids.length === 0) {
            return res.status(200).json({});
        }

        // 2. Auth with Sheets
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        // 3. Metadata for Bucketing
        const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,gridProperties.columnCount)' });
        const userMapProps = meta.data.sheets.find(s => s.properties.title === 'UserMap');
        if (!userMapProps) throw new Error("Missing 'UserMap' sheet");

        const userCols = userMapProps.properties.gridProperties.columnCount || 26;
        const userBucketSize = Math.floor(userCols / 3);

        // 4. Step A: Get Emails from Total Sheet (ID -> Email)
        // IDs correspond to Row Numbers in 'Total'. Email is in Column A.
        const headerRanges = ids.map(id => `Total!A${id}`);
        // Deduplicate ranges to save quota if duplicate IDs requested
        const uniqueRanges = [...new Set(headerRanges)];

        const totalRes = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges: uniqueRanges
        });

        const idToEmail = {};
        const emailsToResolve = [];

        // Map the results back to IDs
        // batchGet returns valueRanges in same order as requested
        totalRes.data.valueRanges.forEach((rangeData, idx) => {
            const rangeStr = rangeData.range; // e.g. 'Total!A5'
            // Extract Row Number from Range (safer than index assumption if some fail?)
            // Actually batchGet index matches request index.
            // Let's recover the requested ID from our uniqueRanges array
            const reqRange = uniqueRanges[idx]; // 'Total!A5'
            const reqId = reqRange.replace('Total!A', ''); // '5'

            if (rangeData.values && rangeData.values[0] && rangeData.values[0][0]) {
                const email = rangeData.values[0][0];
                idToEmail[reqId] = email;
                emailsToResolve.push(email);
            }
        });

        // 5. Step B: Get Nicknames from UserMap (Email -> Hash -> UserMap -> Nickname)
        const bucketMap = {}; // bucketIdx -> [emails]

        emailsToResolve.forEach(email => {
            const bIdx = getBucketIndex(email, userBucketSize);
            if (!bucketMap[bIdx]) bucketMap[bIdx] = [];
            bucketMap[bIdx].push(email);
        });

        const uniqueBuckets = Object.keys(bucketMap);
        if (uniqueBuckets.length === 0) return res.status(200).json({});

        const bucketRanges = uniqueBuckets.map(bIdx => getBucketRange('UserMap', bIdx));

        const bucketRes = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges: bucketRanges
        });

        const emailToNickname = {};

        // Process each bucket result
        bucketRes.data.valueRanges.forEach(vr => {
            const rows = vr.values || [];
            rows.forEach(row => {
                // Row: [Email, ID, Nickname]
                if (row.length >= 3) {
                    emailToNickname[row[0]] = row[2];
                }
            });
        });

        // 6. Final Map: ID -> Nickname
        const finalMap = {};
        ids.forEach(id => {
            const email = idToEmail[id];
            if (email && emailToNickname[email]) {
                finalMap[id] = emailToNickname[email];
            } else {
                // Fallback? Or just leave undefined
                // Client side falls back to "User#ID"
            }
        });

        return res.status(200).json(finalMap);

    } catch (error) {
        console.error('Get Nicknames Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
