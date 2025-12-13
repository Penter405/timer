const SHEET_ID = '1RlcaqvG1fiSXPhQBoidYVk3dwsi1bojO6Y9FnF1ZYoY';
// Use Google Visualization API Query Language to get JSON
const JSON_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
const USER_MAP_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=UserMap`;

async function fetchUserMap() {
    try {
        const response = await fetch(USER_MAP_URL);
        if (!response.ok) return {}; // Fail silent, show emails

        const text = await response.text();
        const jsonString = text.substring(47).slice(0, -2);
        const json = JSON.parse(jsonString);

        // Parse Column-Based Hash Table (Bucket Size = 100 => 200 Cols)
        // Scan all rows and all column pairs
        const map = {};
        const rows = json.table.rows;

        if (!rows) return {};

        rows.forEach(row => {
            const cells = row.c;
            if (!cells) return;

            // Loop through column pairs (Bucket 0 to 99+)
            // Safer to just loop through all cells in pairs
            for (let i = 0; i < cells.length - 1; i += 2) {
                const keyCell = cells[i];
                const valCell = cells[i + 1];

                if (keyCell && keyCell.v && valCell && valCell.v) {
                    map[keyCell.v] = valCell.v;
                }
            }
        });

        return map;

    } catch (e) {
        console.error("Fetch User Map Error", e);
        return {};
    }
}

async function fetchLeaderboard() {
    const container = document.getElementById('leaderboard');
    if (!container) return;

    container.innerHTML = '<p>正在讀取排行榜...</p>';

    try {
        // Parallel Fetch: Scoreboard & UserMap
        const [boardRes, userMap] = await Promise.all([
            fetch(JSON_URL),
            fetchUserMap()
        ]);

        if (!boardRes.ok) throw new Error('Network error');

        const text = await boardRes.text();
        // The response comes wrapped in: /*O_o*/ google.visualization.Query.setResponse({...});
        // We need to extract the JSON object.
        const jsonString = text.substring(47).slice(0, -2);
        const json = JSON.parse(jsonString);

        const rows = json.table.rows;

        // Map JSON data to our structure
        // Columns: 0:Email(was Nickname), 1:Time, 2:Scramble, 3:Email, 4:Date, 5:TimeStr, 6:Status
        const times = rows.map(row => {
            const cells = row.c;
            if (!cells) return null;

            // Helper to safe get value
            const getVal = (idx) => cells[idx] ? (cells[idx].v === null ? '' : cells[idx].v) : '';

            // Time column (1) is passed as string or number in JSON depending on input
            let timeVal = getVal(1);
            // If it's a string, try parse; if it's number, use it.
            // Google Sheets JSON might treat numbers as numbers.
            const time = parseFloat(timeVal);

            if (isNaN(time)) return null;

            // Lookup Nickname using Email (Col 0)
            const email = getVal(0);
            // If email is in map, use it. Else show First part of email or 'Anonymous'
            let displayName = userMap[email];

            if (!displayName) {
                displayName = email.split('@')[0] || 'Anonymous';
            }

            return {
                nickname: displayName,
                time: time,
                scramble: getVal(2),
                date: getVal(3),
                timeStr: getVal(4),
                status: getVal(5)
            };
        }).filter(item => item !== null);

        // Sort by time (ascending)
        times.sort((a, b) => a.time - b.time);

        renderLeaderboard(times);

    } catch (err) {
        console.error(err);
        container.innerHTML = `<p style="color:red">無法讀取排行榜<br><small>請確認 Google Sheet 已開啟「知道連結者可檢視」權限，並且存在 UserMap 分頁。</small></p>`;
    }
}

// parseCSV function removed as we are using JSON now


function renderLeaderboard(data) {
    const container = document.getElementById('leaderboard');

    if (data.length === 0) {
        container.innerHTML = '<p>尚無數據</p>';
        return;
    }

    let html = `
    <table class="leaderboard-table" style="width:100%; border-collapse: collapse;">
        <thead>
            <tr style="text-align:left; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <th style="padding:8px;">#</th>
                <th style="padding:8px;">暱稱</th>
                <th style="padding:8px;">秒數</th>
                <th style="padding:8px;">日期</th>
                <th style="padding:8px;">時間</th>
            </tr>
        </thead>
        <tbody>
    `;

    data.forEach((item, index) => {
        // Highlight top 3
        let rankStyle = '';
        if (index === 0) rankStyle = 'color:#fbbf24; font-weight:bold;'; // Gold
        if (index === 1) rankStyle = 'color:#94a3b8; font-weight:bold;'; // Silver
        if (index === 2) rankStyle = 'color:#b45309; font-weight:bold;'; // Bronze

        html += `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding:8px; ${rankStyle}">${index + 1}</td>
            <td style="padding:8px;">${escapeHtml(item.nickname)}</td>
            <td style="padding:8px; font-family:monospace; font-size:1.1em; color:var(--accent);">${item.time.toFixed(3)}</td>
            <td style="padding:8px; font-size:0.9em; color:var(--muted);">${item.date || '-'}</td>
            <td style="padding:8px; font-size:0.9em; color:var(--muted);">${item.timeStr || '-'}</td>
        </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

