const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

module.exports = async (req, res) => {
    // 1. CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { return res.status(405).json({ error: 'Method Not Allowed' }); }

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

        // 3. Optimization Strategy
        // Instead of fetching individual rows (quota heavy), we fetch the entire Nickname column (Col B).
        // Total!B:B.
        // ID 1 is Row 1.

        // Fetch Total!B:B
        const getRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Total!B:B'
        });

        const rows = getRes.data.values || [];
        const resultMap = {};

        // 4. Map IDs to Nicknames
        // Note: Sheets API is 1-indexed for rows, but array is 0-indexed.
        // Row 1 is index 0.
        // So ID 1 (Row 1) = rows[0].

        ids.forEach(id => {
            const rowIndex = parseInt(id) - 1;
            if (rowIndex >= 0 && rowIndex < rows.length) {
                // Return nickname if exists, else fallback
                const nick = rows[rowIndex][0];
                if (nick) {
                    resultMap[id] = nick;
                }
            }
        });

        return res.status(200).json(resultMap);

    } catch (error) {
        console.error('Get Nicknames Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
