const getSheetsClient = require('./sheetsClient');

module.exports = async (req, res) => {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    try {
        const { ids } = req.body; // [1,2,5]
        if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid IDs array' });

        // 讀 Total!A:B 對應 Email
        const ranges = ids.map(id => `Total!A${id}`);
        const totalRes = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
        const idToEmail = {};
        totalRes.data.valueRanges.forEach((vr, idx) => { idToEmail[ids[idx]] = vr.values ? vr.values[0][0] : null; });

        // 讀 UserMap 對應暱稱
        const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,gridProperties.columnCount)' });
        const userMapProps = meta.data.sheets.find(s => s.properties.title === 'UserMap');
        const userCols = userMapProps.properties.gridProperties.columnCount || 26;
        const bucketSize = Math.floor(userCols / 3);

        const getColumnLetter = (colIndex) => {
            let temp, letter = '';
            while (colIndex >= 0) { temp = colIndex % 26; letter = String.fromCharCode(temp + 65) + letter; colIndex = Math.floor(colIndex / 26) - 1; }
            return letter;
        };
        const getBucketRange = (bucketIdx) => `${userMapProps.properties.title}!${getColumnLetter(bucketIdx * 3)}:${getColumnLetter(bucketIdx * 3 + 2)}`;
        const getBucketIndex = (str) => { let h = 0; for (const c of str) { h = (h << 5) - h + c.charCodeAt(0); h |= 0; } return Math.abs(h) % bucketSize; };

        const buckets = {};
        Object.values(idToEmail).forEach(email => { if (email) { const b = getBucketIndex(email); buckets[b] = buckets[b] || []; buckets[b].push(email); } });

        const bucketRanges = Object.keys(buckets).map(b => getBucketRange(b));
        const bucketRes = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: bucketRanges });
        const emailToNickname = {};
        bucketRes.data.valueRanges.forEach(vr => (vr.values || []).forEach(r => { if (r.length >= 3) emailToNickname[r[0]] = r[2]; }));

        const finalMap = {};
        ids.forEach(id => { const email = idToEmail[id]; finalMap[id] = emailToNickname[email] || null; });
        res.status(200).json(finalMap);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
