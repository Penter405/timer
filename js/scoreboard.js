const SHEET_ID = '***REMOVED***';
// Target 'ScoreBoard' sheet now
const JSON_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=ScoreBoard`;
const API_NICKNAMES_URL = 'https://timer-neon-two.vercel.app/api/get_nicknames'; // Vercel API

// Default timezone is UK (Europe/London)
const DEFAULT_TIMEZONE = 'Europe/London';

/**
 * Get current selected timezone
 * @returns {string} - Timezone string (e.g., 'Asia/Taipei')
 */
function getSelectedTimezone() {
    return localStorage.getItem('scoreboard_timezone') || DEFAULT_TIMEZONE;
}

/**
 * Convert date and time string to selected timezone
 * @param {string} dateStr - Date string (e.g., '2025/12/17')
 * @param {string} timeStr - Time string (e.g., '19:30:00')
 * @param {string} timezone - Target timezone
 * @returns {object} - { date: string, time: string }
 */
function convertToTimezone(dateStr, timeStr, timezone) {
    if (!dateStr || !timeStr) return { date: dateStr || '-', time: timeStr || '-' };

    try {
        // Parse the original date/time (assume it's in UK timezone)
        const [year, month, day] = dateStr.split('/').map(Number);
        const [hour, minute, second] = timeStr.split(':').map(Number);

        // Create date in UK timezone
        const ukDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0));
        // Adjust for UK timezone offset (simplified - doesn't handle BST perfectly)

        // Format in target timezone
        const options = {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };

        const formatter = new Intl.DateTimeFormat('en-GB', options);
        const parts = formatter.formatToParts(ukDate);

        const getPart = (type) => parts.find(p => p.type === type)?.value || '';

        const newDate = `${getPart('year')}/${getPart('month')}/${getPart('day')}`;
        const newTime = `${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;

        return { date: newDate, time: newTime };
    } catch (e) {
        console.error('Timezone conversion error:', e);
        return { date: dateStr, time: timeStr };
    }
}

/**
 * Initialize timezone selector
 */
function initTimezoneSelector() {
    const selector = document.getElementById('timezoneSelect');
    if (!selector) return;

    // Set saved value
    selector.value = getSelectedTimezone();

    // Listen for changes
    selector.addEventListener('change', (e) => {
        localStorage.setItem('scoreboard_timezone', e.target.value);
        fetchLeaderboard(); // Refresh with new timezone
    });
}

async function fetchNicknamesFromAPI(ids) {
    if (!ids || ids.length === 0) return {};
    try {
        const res = await fetch(API_NICKNAMES_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [...new Set(ids)] }) // Unique IDs
        });
        if (!res.ok) throw new Error('API Error');
        return await res.json();
    } catch (e) {
        console.error("Fetch Nicknames API Error", e);
        return {};
    }
}

async function fetchLeaderboard() {
    const container = document.getElementById('leaderboard');
    if (!container) return;

    container.innerHTML = '<p>正在讀取排行榜...</p>';

    try {
        // 1. Fetch Scoreboard Data (Public)
        const boardRes = await fetch(JSON_URL);
        if (!boardRes.ok) throw new Error('Network error');

        const text = await boardRes.text();
        const jsonString = text.substring(47).slice(0, -2);
        const json = JSON.parse(jsonString);

        if (!json.table || !json.table.rows) {
            renderLeaderboard([]);
            return;
        }

        const rows = json.table.rows;

        // 2. Extract User IDs to resolve (Col 0)
        const idsToResolve = [];

        // Helper to safe get value
        const getVal = (row, idx) => {
            const cell = row.c[idx];
            let v = cell ? (cell.v === null ? '' : cell.v) : '';
            if (typeof v === 'string' && v.startsWith("'")) v = v.substring(1);
            return v;
        };

        const rawData = rows.map(row => {
            const c = row.c;
            if (!c) return null;

            const userId = getVal(row, 0); // Col A: UserID
            if (userId) idsToResolve.push(userId);

            // Time column (1)
            let timeVal = getVal(row, 1);
            const time = parseFloat(timeVal);

            if (isNaN(time)) return null;

            return {
                userId: userId,
                time: time,
                scramble: getVal(row, 2),
                date: getVal(row, 3),
                timeStr: getVal(row, 4),
                status: getVal(row, 5)
            };
        }).filter(item => item !== null);

        // 3. Resolve Nicknames via Backend API (Privacy Safe)
        const nicknameMap = await fetchNicknamesFromAPI(idsToResolve);

        // 4. Merge Data
        const times = rawData.map(item => {
            let displayName = nicknameMap[item.userId];
            if (!displayName) displayName = `User#${item.userId}`; // Fallback

            return {
                ...item,
                nickname: displayName
            };
        });

        // Sort by time (ascending)
        times.sort((a, b) => a.time - b.time);

        renderLeaderboard(times);

    } catch (err) {
        console.error(err);
        container.innerHTML = `<p style="color:red">無法讀取排行榜<br><small>請確認網路連線或 API 是否正常運作。</small></p>`;
    }
}

function renderLeaderboard(data) {
    const container = document.getElementById('leaderboard');

    if (data.length === 0) {
        container.innerHTML = '<p>尚無數據</p>';
        return;
    }

    // Get selected timezone
    const timezone = getSelectedTimezone();

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

        // Convert timezone
        const converted = convertToTimezone(item.date, item.timeStr, timezone);

        html += `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding:8px; ${rankStyle}">${index + 1}</td>
            <td style="padding:8px;">${escapeHtml(item.nickname)}</td>
            <td style="padding:8px; font-family:monospace; font-size:1.1em; color:var(--accent);">${item.time.toFixed(3)}</td>
            <td style="padding:8px; font-size:0.9em; color:var(--muted);">${converted.date}</td>
            <td style="padding:8px; font-size:0.9em; color:var(--muted);">${converted.time}</td>
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

/* Expose to Global Scope for Router */
if (typeof window !== 'undefined') {
    window.fetchLeaderboard = fetchLeaderboard;
    window.initTimezoneSelector = initTimezoneSelector;

    // Initialize timezone selector when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTimezoneSelector);
    } else {
        initTimezoneSelector();
    }
}
