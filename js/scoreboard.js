const SHEET_ID = '***REMOVED***';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

async function fetchLeaderboard() {
    const container = document.getElementById('leaderboard');
    if (!container) return;

    container.innerHTML = '<p>正在讀取排行榜...</p>';

    try {
        const response = await fetch(CSV_URL);
        if (!response.ok) throw new Error('Network error');

        const text = await response.text();
        const rows = parseCSV(text);

        // Filter and map data
        // Expected columns: Nickname(0), Time(1), Scramble(2), Email(3), Date(4), Status(5)
        const times = rows.map(row => {
            if (row.length < 5) return null;
            const time = parseFloat(row[1]);
            if (isNaN(time)) return null;
            return {
                nickname: row[0] || 'Anonymous',
                time: time,
                scramble: row[2],
                date: row[4],
                status: row[5]
            };
        }).filter(item => item !== null);

        // Sort by time (ascending)
        times.sort((a, b) => a.time - b.time);

        renderLeaderboard(times);

    } catch (err) {
        console.error(err);
        container.innerHTML = `<p style="color:red">無法讀取排行榜<br><small>請確認 Google Sheet 已開啟「知道連結者可檢視」權限。</small></p>`;
    }
}

function parseCSV(text) {
    // Simple CSV parser (handles basic quotes if needed, but simple split might suffice for now)
    // For robustness, assuming standard CSV
    const lines = text.split('\n');
    return lines.map(line => {
        // Handle basic CSV parsing (ignoring complex quote cases for now)
        // Better to use a regex or library if data contains commas
        // For simple Rubik's data, split(',') might work unless scramble has commas
        // Scramble usually spaces. Date has colons. 
        // Let's use a slightly better regex for CSV split
        const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
        // Fallback to simple split if regex fails or for simplicity
        return line.split(',').map(cell => cell.replace(/^"|"$/g, '').trim());
    });
}

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
                <th style="padding:8px;">時間</th>
                <th style="padding:8px;">日期</th>
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
            <td style="padding:8px; font-size:0.9em; color:var(--muted);">${formatDate(item.date)}</td>
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

function formatDate(dateStr) {
    // Try to format YYYY/MM/DD@HH:MM:SS to something shorter?
    // Or just return as is
    if (!dateStr) return '-';
    return dateStr.split('@')[0]; // Show date only to save space? Or full?
    // Let's show full for now or based on width
}
