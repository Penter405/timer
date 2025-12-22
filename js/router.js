// --- Page Router ---
let currentPage = 'home';
window.loggedIn = false;

function initRouter() {
    // Set up navigation event listeners
    document.getElementById('navTitle')?.addEventListener('click', () => showPage('home'));
    document.getElementById('navLogin')?.addEventListener('click', handleLoginClick);
    document.getElementById('navLogout')?.addEventListener('click', handleLogout);
    document.getElementById('navMore')?.addEventListener('click', () => showPage('more'));

    // More menu items
    document.getElementById('moreSettings')?.addEventListener('click', () => showPage('settings'));
    document.getElementById('moreScoreboard')?.addEventListener('click', () => showPage('scoreboard'));

    // Show home page by default
    showPage('home');
}

function showPage(pageName) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // Show selected page
    const targetPage = document.getElementById(pageName + 'Page');
    if (targetPage) {
        targetPage.classList.add('active');
    }

    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const navBtn = document.getElementById('nav' + capitalize(pageName));
    if (navBtn) {
        navBtn.classList.add('active');
    }

    currentPage = pageName;

    // Initialize scoreboard controls when navigating to scoreboard page (no auto-fetch)
    if (pageName === 'scoreboard' && typeof initScoreboardControls === 'function') {
        initScoreboardControls();
    }
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function handleLoginClick() {
    if (!window.loggedIn) {
        // Trigger Google Sign-In
        // The actual login is handled by Google's library
        console.log('Please sign in with Google button in header');
    }
}

function handleLogout() {
    window.loggedIn = false;
    googleIdToken = null;
    window.updateNavBar();

    // Clear User Data from Local Storage and UI
    localStorage.removeItem('rubik_nickname');
    localStorage.removeItem('rubik_user_id');

    // Clear Input Box
    const nicknameEl = document.getElementById('settingsNickname');
    if (nicknameEl) nicknameEl.value = '';

    // Clear Greeting
    const greetingEl = document.getElementById('nicknameGreeting');
    if (greetingEl) greetingEl.textContent = '';

    // Reset parallelogram button to "登入"
    if (typeof window.updateParallelogramDisplay === 'function') {
        window.updateParallelogramDisplay('登入');
    }

    // Disable auto-select for next time
    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.disableAutoSelect();
        // Optional: Revoke token if you want to force re-consent
    }

    console.log('Logged out');
    alert('已登出');
}

window.updateNavBar = function () {
    const logoutBtn = document.getElementById('navLogout');
    const googleBtn = document.getElementById('googleSignInBtn');
    const parallelogramBtn = document.getElementById('userParallelogram');

    if (window.loggedIn) {
        logoutBtn?.classList.remove('hidden');
        // Hide Google button, show parallelogram
        if (googleBtn) googleBtn.style.display = 'none';
        parallelogramBtn?.classList.remove('hidden');
    } else {
        logoutBtn?.classList.add('hidden');
        // Show Google button, hide parallelogram
        if (googleBtn) googleBtn.style.display = '';
        parallelogramBtn?.classList.add('hidden');
    }
}

// Initialize router when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRouter);
} else {
    initRouter();
}
