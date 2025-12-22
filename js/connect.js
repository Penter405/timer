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

        // Update parallelogram button to show loading
        updateParallelogramDisplay('載入中...');

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
            credentials: 'include', // Include cookies if needed
            body: JSON.stringify({
                token: googleIdToken,
                nickname: "" // Empty nickname = Registration/Sync Mode
            })
        });

        if (!res.ok) throw new Error('Sync Failed');
        const data = await res.json();

        console.log('[SYNC] Server response:', data);

        const greetingEl = document.getElementById('nicknameGreeting');

        // Handle new user welcome
        if (data.isNewUser) {
            console.log('🎉 新用戶註冊！User ID:', data.userID);
        }

        // Store userID in localStorage
        if (data.userID) {
            localStorage.setItem('rubik_user_id', data.userID);
        }

        // Update greeting based on response
        if (data.uniqueName) {
            // User has a nickname registered
            localStorage.setItem('rubik_nickname', data.uniqueName);
            if (greetingEl) greetingEl.textContent = `你好 ${data.uniqueName}`;
            // Update parallelogram button
            updateParallelogramDisplay(data.uniqueName);
            console.log('[SYNC] Nickname loaded:', data.uniqueName);
        } else if (data.userID) {
            // No nickname yet, but we have an ID (new user or no nickname set)
            const displayName = `ID:${data.userID}`;
            if (greetingEl) greetingEl.textContent = `你好 ${displayName}`;
            // Update parallelogram button
            updateParallelogramDisplay(displayName);
            console.log('[SYNC] User ID registered:', data.userID);
        }

    } catch (e) {
        console.error('[SYNC] Auto-Registration Failed:', e);
        // Silent fail is ok for background sync
        // User can still use the app, just won't have cloud sync
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
            updateBtn.textContent = '上傳中...';

            fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
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
                    console.log('[UPDATE] Server response:', data);

                    const uniqueName = data.uniqueName;
                    // Update Greeting, NOT input value
                    if (greetingEl) greetingEl.textContent = `你好 ${uniqueName}`;

                    // Save to local storage
                    localStorage.setItem('rubik_nickname', uniqueName);

                    // Clear input field for next update
                    if (nicknameEl) nicknameEl.value = '';

                    alert(`✅ 上傳成功！\n您的 ID 是：${uniqueName}`);
                })
                .catch(err => {
                    console.error('[UPDATE] Error:', err);
                    alert('❌ 更新失敗，請稍後再試。');
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

        // Get userID from localStorage
        const userID = localStorage.getItem('rubik_user_id');
        if (!userID) {
            console.warn('[SAVE_TIME] No userID found, skipping cloud save');
            return; // Skip if no userID
        }

        fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${googleIdToken}`
            },
            body: JSON.stringify({
                userID: userID,
                time: latestInfo.ms, // raw ms
                scramble: latestInfo.scramble,
                date: latestInfo.at
            })
        })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then(data => console.log('Saved to Sheet:', data))
            .catch(err => console.error('Cloud Save Error:', err));
    }
}

// --- Parallelogram User Button Functions ---

/**
 * Update the parallelogram button display text
 */
function updateParallelogramDisplay(text) {
    const displayEl = document.getElementById('userNicknameDisplay');
    if (displayEl) {
        displayEl.textContent = text || '登入';
    }
}

/**
 * Initialize the parallelogram button click handler
 */
function initParallelogramButton() {
    const btn = document.getElementById('userParallelogram');
    if (!btn) return;

    btn.addEventListener('click', () => {
        // If not logged in, trigger Google Sign-In
        if (!window.loggedIn) {
            if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
                google.accounts.id.prompt((notification) => {
                    console.log('[PARALLELOGRAM] Google Sign-In prompt:', notification);
                });
            } else {
                console.warn('[PARALLELOGRAM] Google Sign-In API not ready');
                alert('Google 登入尚未載入，請稍後再試。');
            }
        }
        // If logged in, clicking does nothing (or could navigate to settings)
    });

    // Apply saved colors on init
    applyParallelogramColors();
}

/**
 * Get parallelogram color settings from localStorage
 */
function getParallelogramSettings() {
    const defaults = {
        bgColor: 'gradient-cyan',
        textColor: '#e6eef6'
    };

    const saved = localStorage.getItem('parallelogram_settings');
    if (saved) {
        try {
            return { ...defaults, ...JSON.parse(saved) };
        } catch (e) {
            return defaults;
        }
    }
    return defaults;
}

/**
 * Save parallelogram color settings to localStorage
 */
function saveParallelogramSettings(settings) {
    localStorage.setItem('parallelogram_settings', JSON.stringify(settings));
}

/**
 * Apply parallelogram colors to the button
 */
function applyParallelogramColors() {
    const btn = document.getElementById('userParallelogram');
    if (!btn) return;

    const settings = getParallelogramSettings();

    // Remove all gradient classes first
    btn.classList.remove('gradient-cyan', 'gradient-purple', 'gradient-green', 'gradient-orange');

    // Apply background color
    if (settings.bgColor.startsWith('gradient-')) {
        btn.classList.add(settings.bgColor);
        btn.style.background = ''; // Clear inline style
    } else {
        btn.style.background = settings.bgColor;
    }

    // Apply text color
    btn.style.color = settings.textColor;
}

/**
 * Initialize parallelogram color settings UI
 */
function initParallelogramSettings() {
    const bgColorSelect = document.getElementById('parallelogramBgColor');
    const textColorSelect = document.getElementById('parallelogramTextColor');

    if (!bgColorSelect || !textColorSelect) return;

    const settings = getParallelogramSettings();

    // Set initial values
    bgColorSelect.value = settings.bgColor;
    textColorSelect.value = settings.textColor;

    // Background color change handler
    bgColorSelect.addEventListener('change', () => {
        const current = getParallelogramSettings();
        current.bgColor = bgColorSelect.value;
        saveParallelogramSettings(current);
        applyParallelogramColors();
    });

    // Text color change handler
    textColorSelect.addEventListener('change', () => {
        const current = getParallelogramSettings();
        current.textColor = textColorSelect.value;
        saveParallelogramSettings(current);
        applyParallelogramColors();
    });
}

// Initialize parallelogram button on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initParallelogramButton();
        initParallelogramSettings();
    });
} else {
    initParallelogramButton();
    initParallelogramSettings();
}

// Export for use in other modules
window.updateParallelogramDisplay = updateParallelogramDisplay;
window.applyParallelogramColors = applyParallelogramColors;
