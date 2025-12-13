const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

// Configuration
// In Vercel Dashboard, set these Environment Variables:
// GOOGLE_CLIENT_EMAIL: (From Service Account JSON)
// GOOGLE_PRIVATE_KEY: (From Service Account JSON, preserve line breaks)
// GOOGLE_SHEET_ID: (The ID of your Google Sheet)
// GOOGLE_CLIENT_ID: (The Client ID from your Google Cloud OAuth Client)

module.exports = async (req, res) => {
    // 1. Handle CORS Preflight
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 2. Verify Google ID Token (Authentication)
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }

        const idToken = authHeader.split(' ')[1];
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const userEmail = payload.email;
        // You can also get name, picture, etc.

        // 3. Prepare Data for Sheets
        const { time, scramble, date: rawDate, nickname } = req.body;

        // Custom Formatting
        // Time: ms -> seconds (34190 -> 34.190)
        const formattedTime = (time / 1000).toFixed(3);

        // Date: ISO -> YYYY/MM/DD@HH:MM:SS (UTC+8)
        const d = new Date(rawDate);

        // Convert to Taipei Time string first to handle timezone correctly
        const twDateStr = d.toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour12: false });
        const twDate = new Date(twDateStr); // Create new Date object from the shifted time string

        const yyyy = twDate.getFullYear();
        const mm = String(twDate.getMonth() + 1).padStart(2, '0');
        const dd = String(twDate.getDate()).padStart(2, '0');
        const hh = String(twDate.getHours()).padStart(2, '0');
        const min = String(twDate.getMinutes()).padStart(2, '0');
        const ss = String(twDate.getSeconds()).padStart(2, '0');

        const formattedDateOnly = `${yyyy}/${mm}/${dd}`;
        const formattedTimeOnly = `${hh}:${min}:${ss}`;

        // 4. Authenticate with Google Sheets (Authorization)
        let credentials;
        try {
            credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        } catch (e) {
            console.error("Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON", e);
            throw new Error("Invalid Credentials format");
        }

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // 5. Append to Sheet
        // Order: Nickname | Time(s) | Scramble | Email | Date | Time | Status
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A:G', // Expanded range to G
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [
                    [
                        nickname || 'Anonymous', // Nickname
                        formattedTime,           // Time (seconds)
                        scramble,                // Scramble
                        userEmail,               // Email
                        formattedDateOnly,       // Date (YYYY/MM/DD)
                        formattedTimeOnly,       // Time (HH:MM:SS)
                        'Verified'               // Status
                    ]
                ],
            },
        });

        return res.status(200).json({ success: true, rows: response.data.updates.updatedRows });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
};
