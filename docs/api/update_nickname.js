const getSheetsClient = require('./sheetsClient');

function getColumnLetter(colIndex) {
    let temp, letter = '';
    while (colIndex >= 0) {
        temp = colIndex % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        colIndex = Math.floor(colIndex / 26) - 1;
    }
    return letter;
}

function getBucketIndex(str, bucketSize) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % bucketSize;
}

function getBucketRange(sheetName, bucketIndex, cols) {
    const startCol = bucketIndex * cols;
    const endCol = startCol + cols - 1;
    return `${sheetName}!${getColumnLetter(startCol)}:${getColumnLetter(endCol)}`;
}

module.exports = async (req, res) => {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    try {
        const { email, nickname } = req.body;
        if (!email) return res.status(400).json({ error: 'Missing email' });

        // === 取得 UserMap bucket ===
        const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,gridProperties.columnCount)' });
        const userMapProps = meta.data.sheets.find(s => s.properties.title === 'UserMap');
        const userCols = userMapProps.properties.gridProperties.columnCount || 26;
        const userBucketSize = Math.floor(userCols / 3);
        const userBucket = getBucketIndex(email, userBucketSize);
        const userRange = getBucketRange('UserMap', userBucket, 3);

        const userRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: userRange });
        const rows = userRes.data.values || [];

        let userRowIdx = rows.findIndex(r => r[0] === email);
        let userID = userRowIdx !== -1 ? rows[userRowIdx][1] : null;

        if (!userID) {
            // 新用戶，新增到 Total sheet
            const totalAppend = await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Total!A:A',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[email]] }
            });
            const match = totalAppend.data.updates.updatedRange.match(/!A(\d+):/);
            userID = match ? match[1] : null;
        }

        // 計算唯一暱稱
        const uniqueName = nickname ? `${nickname}#${userID}` : '';

        // 更新 UserMap
        const updateRange = userRowIdx !== -1 ? `${userRange.split(':')[0]}:${getColumnLetter(userBucket * 3 + 2)}${userRowIdx + 1}` : `${getBucketRange('UserMap', userBucket, 3)}${rows.length + 1}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[email, userID, uniqueName]] }
        });

        res.status(200).json({ uniqueName, userID });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
