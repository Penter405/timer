// --- 存檔 Storage / API Connection ---
const STORAGE_KEY = 'rubik_timer_sessions_v2';
let googleIdToken = null;

// Google Sign-In Callback
window.handleCredentialResponse = function (response) {
    if (response.credential) {
        googleIdToken = response.credential;
        console.log("Signed in with Google");
        // Optional: Show user info or change UI

        // Sync check: Maybe upload unsynced times? (Advanced)
    }
};

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

        // API Endpoint (Change to your Production URL when deployed)
        // const API_URL = 'http://localhost:3000/api/save_time'; 
        const API_URL = '/api/save_time'; // Relative path works if valid

        fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${googleIdToken}`
            },
            body: JSON.stringify({
                time: latestInfo.ms, // raw ms
                scramble: latestInfo.scramble,
                date: latestInfo.at
            })
        })
            .then(res => res.json())
            .then(data => console.log('Saved to Sheet:', data))
            .catch(err => console.error('Cloud Save Error:', err));
    }
}
