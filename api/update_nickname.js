const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
    res.setHeader("Access-Control-Allow-Origin", "https://penter405.github.io");
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
        const { token, nickname } = req.body;
        if (!token) return res.status(400).json({ error: 'Missing token' });
        // Nickname is now optional. If missing, we just register/fetch the ID.

        // 1. Verify Google Token
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const userEmail = ticket.getPayload().email.toLowerCase();

        // 2. Auth with Sheets
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        // 3. Metadata & Buckets
        const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,gridProperties.columnCount)' });
        const sheetProps = meta.data.sheets.map(s => s.properties);
        const userMapProps = sheetProps.find(p => p.title === 'UserMap');
        const countsProps = sheetProps.find(p => p.title === 'Counts');

        if (!userMapProps || !countsProps) throw new Error("Missing 'UserMap' or 'Counts'");

        const userCols = userMapProps.gridProperties.columnCount || 26;
        const countCols = countsProps.gridProperties.columnCount || 26;
        const userBucketSize = Math.floor(userCols / 3);
        const countBucketSize = Math.floor(countCols / 2);

        const userBucket = getBucketIndex(userEmail, userBucketSize);
        const userRange = getBucketRange('UserMap', userBucket);

        let countBucket, countRange;
        if (nickname) {
            countBucket = getBucketIndex(nickname, countBucketSize);
            countRange = getBucketRange('Counts', countBucket);
        }

        // 4. Batch Get (UserMap + Counts) - Counts only needed if nickname provided
        const ranges = [userRange];
        if (nickname) ranges.push(countRange);

        const getRes = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges: ranges
        });

        const userRows = getRes.data.valueRanges[0].values || [];
        const countRows = (nickname && getRes.data.valueRanges[1]) ? (getRes.data.valueRanges[1].values || []) : [];

        // --- Process UserMap Lookup ---
        let existingID = null;
        let existingUniqueName = null;
        let userRowIdx = -1;

        for (let i = 0; i < userRows.length; i++) {
            if (userRows[i][0] === userEmail) {
                existingID = userRows[i][1];
                existingUniqueName = userRows[i][2];
                userRowIdx = i;
                break;
            }
        }

        // --- Acquire ID & Nickname (Sync with Total Sheet) ---
        let userID = existingID;

        // Use user's requested nickname as base. 
        // We still use Counts to ensure Nicknames are unique in UserMap, 
        // BUT for 'Total' sheet we just store the nickname without the hash? 
        // Or do we store the full unique name? Let's store full unique name.

        // Calculate New Unique Name (Only if nickname provided)
        let newUniqueName = null;
        let countRowIdx = -1;
        let currentCount = 0;
        let newCount = 0;

        if (nickname) {
            for (let i = 0; i < countRows.length; i++) {
                if (countRows[i][0] === nickname) {
                    currentCount = parseInt(countRows[i][1] || '0');
                    countRowIdx = i;
                    break;
                }
            }
            newCount = currentCount + 1;
            newUniqueName = `${nickname}#${newCount}`;
        }

        // Logic: Only increment generation if this ISN'T the same user keeping their name.
        // But for simplicity, we always return the unique name.
        // If user already has this nickname (e.g. existingUniqueName starts with `nickname#`), we could reuse?
        // Let's generate new always for safety to avoid collisions.



        if (!userID) {
            // New User! Append to 'Total' sheet [Email] (Nickname Col B optional, but we can write it initially)
            // User requested strict Lookup: ID -> Email -> Hash -> UserMap -> Nickname.
            // So Total is primarily ID <-> Email.
            const totalAppend = await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Total!A:B',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[userEmail]] } // Schema Compliance: Total sheet ONLY stores Email (Col A)
            });

            const updatedRange = totalAppend.data.updates.updatedRange;
            const match = updatedRange.match(/!A(\d+):/);
            if (match && match[1]) {
                userID = match[1];
            } else {
                throw new Error("Failed to generate User ID from Total sheet");
            }
        } else {
            // Existing User: DO NOT update 'Total' sheet.
            // ID and Email are immutable in 'Total'.
            // Nickname changes only affect 'UserMap'.
        }

        // --- Prepare Writes to UserMap and Counts ---
        const updates = [];

        // 1. Write to Counts (Only if nickname provided)
        if (nickname) {
            const countStartColLetter = getColumnLetter(countBucket * 2);
            const countValColLetter = getColumnLetter(countBucket * 2 + 1);
            if (countRowIdx !== -1) {
                const rowNum = countRowIdx + 1;
                updates.push({ range: `Counts!${countValColLetter}${rowNum}`, values: [[newCount]] });
            } else {
                const nextRow = countRows.length + 1;
                updates.push({ range: `Counts!${countStartColLetter}${nextRow}:${countValColLetter}${nextRow}`, values: [[nickname, newCount]] });
            }
        }

        // 2. Write to UserMap [Email, ID, UniqueName]
        // If nickname is NULL, we still write [Email, ID, ""] to ensure UserMap exists for this user.
        const userStartColLetter = getColumnLetter(userBucket * 3);
        const userRow = [userEmail, userID, newUniqueName || ''];

        if (userRowIdx !== -1) {
            const rowNum = userRowIdx + 1;
            const endColLetter = getColumnLetter(userBucket * 3 + 2);
            updates.push({ range: `UserMap!${userStartColLetter}${rowNum}:${endColLetter}${rowNum}`, values: [userRow] });
        } else {
            const nextRow = userRows.length + 1;
            const endColLetter = getColumnLetter(userBucket * 3 + 2);
            updates.push({ range: `UserMap!${userStartColLetter}${nextRow}:${endColLetter}${nextRow}`, values: [userRow] });
        }

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: { valueInputOption: 'USER_ENTERED', data: updates }
        });

        res.status(200).json({ uniqueName: newUniqueName, userId: userID });

    } catch (error) {
        console.error('Update Nickname Error:', error);
        res.status(500).json({ error: error.message });
    }
};
