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
// Auto-load nickname on startup
document.addEventListener('DOMContentLoaded', () => {
    const savedName = localStorage.getItem('rubik_nickname');
    const nicknameEl = document.getElementById('settingsNickname');
    if (savedName && nicknameEl) {
        nicknameEl.value = savedName;
    }

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
            updateBtn.textContent = '上傳中...';

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
                    alert(`您的暱稱已更新為：${uniqueName}`);
                    nicknameEl.value = uniqueName;
                    localStorage.setItem('rubik_nickname', uniqueName);
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
