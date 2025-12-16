const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

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
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) { return res.status(401).json({ error: 'Missing or invalid Authorization header' }); }
        const idToken = authHeader.split(' ')[1];
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
        const userEmail = ticket.getPayload().email.toLowerCase();

        // Prepare Data
        const { time, scramble, date: rawDate } = req.body;
        const formattedTime = (time / 1000).toFixed(3);
        const d = new Date(rawDate);
        const twDateStr = d.toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour12: false });
        const twDate = new Date(twDateStr);
        const formattedDateOnly = `${twDate.getFullYear()}/${String(twDate.getMonth() + 1).padStart(2, '0')}/${String(twDate.getDate()).padStart(2, '0')}`;
        const formattedTimeOnly = `${String(twDate.getHours()).padStart(2, '0')}:${String(twDate.getMinutes()).padStart(2, '0')}:${String(twDate.getSeconds()).padStart(2, '0')}`;

        // Auth with Sheets
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        // PRIVACY LOOKUP: Email -> UserID
        const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,gridProperties.columnCount)' });
        const userMapProps = meta.data.sheets.find(s => s.properties.title === 'UserMap');
        if (!userMapProps) throw new Error("Missing 'UserMap' sheet");

        const userCols = userMapProps.properties.gridProperties.columnCount || 26;
        const userBucketSize = Math.floor(userCols / 3);
        const userBucket = getBucketIndex(userEmail, userBucketSize);
        const userRange = getBucketRange('UserMap', userBucket);

        const getRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: userRange });
        const rows = getRes.data.values || [];

        let userID = null;
        for (const row of rows) {
            // Row format: [Email, ID, Nickname]
            if (row[0] === userEmail) {
                userID = row[1];
                break;
            }
        }

        if (!userID) {
            return res.status(400).json({ error: 'User not registered. Please create a nickname first.' });
        }

        // Append to ScoreBoard (Verified: Email excluded)
        // Store: UserID | Time | Scramble | Date | Time | Status
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'ScoreBoard!A:F',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [
                    [
                        `'${userID}`,            // User's ID (Opaque)
                        `'${formattedTime}`,
                        `'${scramble}`,
                        `'${formattedDateOnly}`,
                        `'${formattedTimeOnly}`,
                        `'Verified`
                    ]
                ],
            },
        });

        return res.status(200).json({ success: true, id: userID });

    } catch (error) {
        console.error('Save Time Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
