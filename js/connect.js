// --- 存檔 Storage / API Connection ---
const STORAGE_KEY = 'rubik_timer_sessions_v2';
let googleIdToken = null;

// Google Sign-In Callback
window.handleCredentialResponse = function (response) {
    if (response.credential) {
        googleIdToken = response.credential;

        // Update login state (defined in router.js)
        if (typeof window.loggedIn !== 'undefined') {
            window.loggedIn = true;
            window.updateNavBar();
        }

        // Greeting Logic
        const greetingEl = document.getElementById('nicknameGreeting');
        if (greetingEl) {
            greetingEl.textContent = '你好';
            // Clear any stale local storage from previous user
            // We rely on syncNickname to restore it if it exists for THIS user.
            localStorage.removeItem('rubik_nickname');
        }

        // --- NEW: Sync Nickname from Cloud ---
        const payload = parseJwt(response.credential);
        if (payload && payload.email) {
            syncNickname(payload.email);
        }

        console.log("Signed in with Google");
        // Optional: Show user info or change UI

        // Sync check: Maybe upload unsynced times? (Advanced)
    }
};

// --- Utils & Sync Logic ---
function parseJwt(token) {
    try {
        var base64Url = token.split('.')[1];
        var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) { return {}; }
}

// Constants SHEET_ID and USER_MAP_URL are defined in scoreboard.js (loaded first)

async function syncNickname(email) {
    if (!googleIdToken) return;

    // Auto-Register / Fetch ID on Login
    // We send NO nickname to trigger a "Get or Create ID" only.
    const API_URL = 'https://timer-neon-two.vercel.app/api/update_nickname';

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: googleIdToken,
                nickname: "" // Empty nickname = Registration Mode
            })
        });

        if (!res.ok) throw new Error('Sync Failed');
        const data = await res.json();

        // If we got an ID, we are good. 
        // If we got a uniqueName, update local storage.
        if (data.uniqueName) {
            localStorage.setItem('rubik_nickname', data.uniqueName);
            const greetingEl = document.getElementById('nicknameGreeting');
            if (greetingEl) greetingEl.textContent = `你好 ${data.uniqueName}`;
        } else if (data.userId) {
            // No nickname yet, but we have an ID! 
            // Fallback greeting
            const greetingEl = document.getElementById('nicknameGreeting');
            if (greetingEl) greetingEl.textContent = `你好 #${data.userId}`;
        }

    } catch (e) {
        console.error("Auto-Registration Failed", e);
        // Silent fail is ok for background sync
    }
}

// Auto-load nickname on startup
// Auto-load nickname on startup
// Auto-load nickname on startup
document.addEventListener('DOMContentLoaded', () => {
    const savedName = localStorage.getItem('rubik_nickname');
    const nicknameEl = document.getElementById('settingsNickname');
    const greetingEl = document.getElementById('nicknameGreeting');

    // Greeting logic moved to handleCredentialResponse to ensure strict login state.
    // DOMContentLoaded cleanup.

    // Do not auto-fill input. Keeping it empty for updates.
    // if (savedName && nicknameEl) {
    //    nicknameEl.value = savedName;
    // }

    const updateBtn = document.getElementById('updateNicknameBtn');
    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            if (!googleIdToken) {
                alert('請先登入 Google 帳號！');
                return;
            }
            const inputName = nicknameEl.value.trim();
            if (!inputName) {
                alert('請輸入暱稱！');
                return;
            }

            // Call API
            const API_URL = 'https://timer-neon-two.vercel.app/api/update_nickname';
            // Disable button
            updateBtn.disabled = true;
            updateBtn.textContent = '...';

            fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: googleIdToken,
                    nickname: inputName
                })
            })
                .then(res => {
                    if (!res.ok) throw new Error('API Error');
                    return res.json();
                })
                .then(data => {
                    const uniqueName = data.uniqueName;
                    // Update Greeting, NOT input value
                    if (greetingEl) greetingEl.textContent = `你好 ${uniqueName}`;

                    // Save to local storage
                    localStorage.setItem('rubik_nickname', uniqueName);
                    alert(`上傳成功！您的 ID 是：${uniqueName}`);
                })
                .catch(err => {
                    console.error(err);
                    alert('更新失敗，請稍後再試。');
                })
                .finally(() => {
                    updateBtn.disabled = false;
                    updateBtn.textContent = '上傳';
                });
        });
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
        // Get Nickname strictly from localStorage (Sync/Upload sets this)
        // Fallback: Check input box only if LS is empty AND input has value
        let nickname = localStorage.getItem('rubik_nickname') || '';
        const nicknameEl = document.getElementById('settingsNickname');

        if (!nickname && nicknameEl && nicknameEl.value.trim()) {
            nickname = nicknameEl.value.trim();
            localStorage.setItem('rubik_nickname', nickname);
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
