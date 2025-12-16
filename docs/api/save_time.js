const getSheetsClient = require('./sheetsClient');

module.exports = async (req, res) => {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    try {
        const { userID, time, scramble, date } = req.body;
        if (!userID || !time) return res.status(400).json({ error: 'Missing userID or time' });

        const d = new Date(date);
        const formattedDate = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        const formattedTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'ScoreBoard!A:F',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[userID, time, scramble, formattedDate, formattedTime, 'Verified']] }
        });

        res.status(200).json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
