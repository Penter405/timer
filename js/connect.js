// --- 存檔 Storage / API Connection ---
const STORAGE_KEY = 'rubik_timer_sessions_v2';
let googleIdToken = null;

// Google Sign-In Callback
window.handleCredentialResponse = function (response) {
    if (response.credential) {
        googleIdToken = response.credential;

        // Update login state (defined in router.js)
        if (typeof loggedIn !== 'undefined') {
            loggedIn = true;
            updateNavBar();
        }

        console.log("Signed in with Google");
        // Optional: Show user info or change UI

        // Sync check: Maybe upload unsynced times? (Advanced)
    }
};

// Auto-load nickname on startup
document.addEventListener('DOMContentLoaded', () => {
    const savedName = localStorage.getItem('rubik_nickname');
    const nicknameEl = document.getElementById('settingsNickname');
    if (savedName && nicknameEl) {
        nicknameEl.value = savedName;
    }
});

function loadTimes() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error("Failed to load times", e);
        return [];
    }
}

function saveTimes(arr) {
    // 1. Local Save
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));

    // 2. Cloud Save (if logged in)
    if (googleIdToken && arr.length > 0) {
        const latestInfo = arr[0]; // The most recent solve

        // Only save if it looks like a new solve (you might want to track synced state)
        // For simple logging: just send the latest one.

        // API Endpoint - Points to Vercel Backend
        const API_URL = 'https://timer-neon-two.vercel.app/api/save_time';

        // Get Nickname from Settings (or load from localStorage if not on page)
        let nickname = '';
        const nicknameEl = document.getElementById('settingsNickname');
        if (nicknameEl) {
            nickname = nicknameEl.value;
            // Auto-save nickname to local storage preference
            localStorage.setItem('rubik_nickname', nickname);
        } else {
            nickname = localStorage.getItem('rubik_nickname') || '';
        }

        fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${googleIdToken}`
            },
            body: JSON.stringify({
                time: latestInfo.ms, // raw ms
                scramble: latestInfo.scramble,
                date: latestInfo.at,
                nickname: nickname
            })
        })
            .then(res => res.json())
            .then(data => console.log('Saved to Sheet:', data))
            .catch(err => console.error('Cloud Save Error:', err));
    }
}
