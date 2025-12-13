const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { token, nickname } = req.body;

        if (!token || !nickname) {
            return res.status(400).json({ error: 'Missing token or nickname' });
        }

        // 1. Verify Google Token
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const userEmail = payload.email;

        // 2. Auth with Sheets
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        // 3. READ: Batch Get Counts and UserMap
        // UserMap: A(Email), B(UniqueName)
        // Counts: A(BaseName), B(CurrentCount)
        const ranges = ['UserMap!A:B', 'Counts!A:B'];
        const getRes = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges,
        });

        const userMapData = getRes.data.valueRanges[0].values || [];
        const countsData = getRes.data.valueRanges[1].values || [];

        // 4. Logic

        // A. Check current UserMap for this email
        let userRowIndex = -1; // 0-based index in the 'values' array
        // Finding index relative to the sheet, assuming data starts at Row 1
        // If header exists, we should skip it, but simple logic: scan all.
        for (let i = 0; i < userMapData.length; i++) {
            if (userMapData[i][0] === userEmail) {
                userRowIndex = i;
                break;
            }
        }

        // B. Calculate New Name
        // Find base nickname in Counts
        let countRowIndex = -1;
        let currentCount = 0;

        for (let i = 0; i < countsData.length; i++) {
            if (countsData[i][0] === nickname) {
                countRowIndex = i;
                currentCount = parseInt(countsData[i][1] || '0');
                break;
            }
        }

        const newCount = currentCount + 1;
        const uniqueName = `${nickname}#${newCount}`;

        // 5. Prepare Updates (BatchUpdate)
        const requests = [];

        // Update Counts
        if (countRowIndex !== -1) {
            // Update existing row
            requests.push({
                updateCells: {
                    range: {
                        sheetId: 0, // WARNING: Need SheetId, not Name. This is tricky. 
                        // ValueInput uses A1 notation, but batchUpdate uses sheetId.
                        // Easier to use values.update or values.append if we want to avoid getting sheet metadata.
                    }
                }
            });
            // Trying value-based batchUpdate is simpler (values.batchUpdate)
        }

        /* 
           Simpler Strategy using values.batchUpdate with A1 notation:
           We assume we can write to specific cells found by index.
           Row 1 is index 0. So Sheet Row = index + 1.
        */

        const valueUpdates = [];

        // Update Count
        if (countRowIndex !== -1) {
            // Update existing cell B{row}
            valueUpdates.push({
                range: `Counts!B${countRowIndex + 1}`,
                values: [[newCount]]
            });
        } else {
            // Append new count row. 
            // Since we can't mix update and append easily in one atomic batch without knowing next row,
            // we'll just Append a new row to Counts via a separate API call if needed, 
            // OR we assume Counts is small enough we can overwrite the whole thing? No.
            // Just use a separate append call for new base names.
        }

        // Update UserMap
        if (userRowIndex !== -1) {
            // Update existing cell B{row}
            valueUpdates.push({
                range: `UserMap!B${userRowIndex + 1}`,
                values: [[uniqueName]]
            });
        } else {
            // Append new user row
        }

        // EXECUTE UPDATES
        // Because sticking strictly to 1 request is hard when mixing updates and appends,
        // we will prioritizing correctness over strict request count minimization (2 or 3 is fine).

        // Step A: Update the Value Updates (Points 1 & 3 above)
        if (valueUpdates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: valueUpdates
                }
            });
        }

        // Step B: Handle Appends (Points 2 & 4 above)
        // If we didn't find the base name, we append it to Counts
        if (countRowIndex === -1) {
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Counts!A:B',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[nickname, newCount]] }
            });
        }

        // If we didn't find the user, we append to UserMap
        if (userRowIndex === -1) {
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'UserMap!A:B',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[userEmail, uniqueName]] }
            });
        }

        res.status(200).json({ uniqueName });

    } catch (error) {
        console.error('Update Nickname Error:', error);
        res.status(500).json({ error: error.message });
    }
};
