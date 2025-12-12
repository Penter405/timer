// --- 存檔 Storage / API Connection ---
const STORAGE_KEY = 'rubik_timer_sessions_v2';

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}
