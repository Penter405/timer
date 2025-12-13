const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const BUCKET_SIZE = 100; // Modulo. Uses 200 columns.

// Simple string hash function
function getBucketIndex(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % BUCKET_SIZE;
}

// Convert 0-based column index to A1 notation letter (e.g. 0->A, 26->AA)
function getColumnLetter(colIndex) {
    let temp, letter = '';
    while (colIndex >= 0) {
        temp = colIndex % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        colIndex = Math.floor(colIndex / 26) - 1;
    }
    return letter;
}

// Helper to get range string for a bucket (e.g. "Sheet!A:B")
function getBucketRange(sheetName, bucketIndex) {
    const startCol = bucketIndex * 2;
    const endCol = startCol + 1;
    const startLetter = getColumnLetter(startCol);
    const endLetter = getColumnLetter(endCol);
    return `${sheetName}!${startLetter}:${endLetter}`;
}

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

        // 3. Logic: UserMap Hash Lookup (Email -> UniqueName)
        const userBucket = getBucketIndex(userEmail);
        const userRange = getBucketRange('UserMap', userBucket); // e.g. UserMap!C:D

        // 4. Logic: Counts Hash Lookup (Nickname -> Count)
        const countBucket = getBucketIndex(nickname);
        const countRange = getBucketRange('Counts', countBucket); // e.g. Counts!E:F

        // Batch Get Both Buckets
        const getRes = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges: [userRange, countRange]
        });

        const userRows = getRes.data.valueRanges[0].values || [];
        const countRows = getRes.data.valueRanges[1].values || [];

        // --- Process UserMap ---
        let existingUniqueName = null;
        let userRowIdx = -1; // Relative to the bucket list

        for (let i = 0; i < userRows.length; i++) {
            if (userRows[i][0] === userEmail) {
                existingUniqueName = userRows[i][1];
                userRowIdx = i;
                break;
            }
        }

        // --- Process Counts ---
        let currentCount = 0;
        let countRowIdx = -1;

        for (let i = 0; i < countRows.length; i++) {
            if (countRows[i][0] === nickname) {
                currentCount = parseInt(countRows[i][1] || '0');
                countRowIdx = i;
                break;
            }
        }

        // --- Decision ---
        // Always generate new unique name based on requested nickname
        // 1. Increment Count
        const newCount = currentCount + 1;

        // 2. Form Unique Name
        const newUniqueName = `${nickname}#${newCount}`;

        // 3. Prepare Writes
        const updates = [];

        // Write to Counts
        // If key exists (collision match), update Value
        // If key not exists, append to end of bucket
        const countStartColLetter = getColumnLetter(countBucket * 2);
        const countValColLetter = getColumnLetter(countBucket * 2 + 1);

        if (countRowIdx !== -1) {
            // Update existing count: Counts!{ValCol}{Row}
            // Row is 1-based. 
            // Warning: batchGet ranges are usually relative to A1, 
            // but the data array index matches row number if we fetched full column.
            const rowNum = countRowIdx + 1;
            updates.push({
                range: `Counts!${countValColLetter}${rowNum}`,
                values: [[newCount]]
            });
        } else {
            // Append new Key-Value pair to the first empty row in this bucket
            // Or just use the next row index
            const nextRow = countRows.length + 1;
            updates.push({
                range: `Counts!${countStartColLetter}${nextRow}:${countValColLetter}${nextRow}`,
                values: [[nickname, newCount]]
            });
        }

        // Write to UserMap
        // Always update mapping to new name
        const userStartColLetter = getColumnLetter(userBucket * 2);
        const userValColLetter = getColumnLetter(userBucket * 2 + 1);

        if (userRowIdx !== -1) {
            const rowNum = userRowIdx + 1;
            updates.push({
                range: `UserMap!${userValColLetter}${rowNum}`,
                values: [[newUniqueName]]
            });
        } else {
            const nextRow = userRows.length + 1;
            updates.push({
                range: `UserMap!${userStartColLetter}${nextRow}:${userValColLetter}${nextRow}`,
                values: [[userEmail, newUniqueName]]
            });
        }

        // EXECUTE BATCH UPDATE
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates
            }
        });

        res.status(200).json({ uniqueName: newUniqueName });

    } catch (error) {
        console.error('Update Nickname Hash Error:', error);
        res.status(500).json({ error: error.message });
    }
};
