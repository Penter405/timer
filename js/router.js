// --- Page Router ---
let currentPage = 'home';
let loggedIn = false;

function initRouter() {
    // Set up navigation event listeners
    document.getElementById('navHome')?.addEventListener('click', () => showPage('home'));
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
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function handleLoginClick() {
    if (!loggedIn) {
        // Trigger Google Sign-In
        // The actual login is handled by Google's library
        console.log('Please sign in with Google button in header');
    }
}

function handleLogout() {
    loggedIn = false;
    googleIdToken = null;
    updateNavBar();
    
    // Disable auto-select for next time
    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.disableAutoSelect();
    }
    
    console.log('Logged out');
    alert('已登出');
}

function updateNavBar() {
    const logoutBtn = document.getElementById('navLogout');
    
    if (loggedIn) {
        logoutBtn?.classList.remove('hidden');
    } else {
        logoutBtn?.classList.add('hidden');
    }
}

// Initialize router when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRouter);
} else {
    initRouter();
}
