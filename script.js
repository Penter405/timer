// --- 顏色定義 Colors ---
const COLORS = ['white', 'orange', 'red', '#4ade80']; // 0:Idle, 1:Inspection, 2:Hold, 3:Ready

// --- 工具 Tools ---
const WCA_EVENT = { type: '333', mode: 'normal' }; // 3x3x3 Sighted

function calcTime(ms, type = 'single') {
    if (WCA_EVENT.type === '333') {
        // WCA 9f1: Truncate single results to hundredths - DISABLED per user request
        // if (type === 'single') return Math.floor(ms / 10) * 10;

        // WCA 9f1: Round averages to hundredths
        if (type === 'average') return Math.round(ms / 10) * 10;
    }
    return ms;
}

function fmt(ms) {
    if (ms == null) return '-';
    if (isNaN(ms)) return '-';
    // Input ms is expected to be already processed (truncated/rounded)
    // Input ms is expected to be full precision now
    // const totalCent = Math.round(ms / 10); 

    // Display 3 decimal places
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    const msStr = (ms % 1000).toString().padStart(3, '0');

    return m > 0 ? `${m}:${s}.${msStr}` : `${s}.${msStr}`;
}

// --- 亂序產生器 Scramble Generator ---
const MOVES = ['U', 'D', 'L', 'R', 'F', 'B'];
const SUFFIX = ['', "'", '2'];

function genScramble(len = 20) {
    let res = [],
        prev = null;
    for (let i = 0; i < len; i++) {
        let m;
        do {
            m = MOVES[Math.floor(Math.random() * MOVES.length)];
        } while (m === prev);
        prev = m;
        res.push(m + SUFFIX[Math.floor(Math.random() * SUFFIX.length)]);
    }
    return res.join(' ');
}

//Storage logic moved to connect.js

// --- 狀態 State ---
let times = loadTimes();
let running = false;
let startAt = 0;
let intervalId = null;

// Stackmat State Logic
let holdStart = null;
let ready = false; // Green light
let holding = false; // Touching
let inspectionOn = false;
let inspectionTimer = null;
let inspectionSec = 15;
let inspectionHoldTimeout = null;
let inspectionReady = false;

// Result Popup State
let pendingResult = null; // { ms: number, scramble: string }
let popupShowTime = 0; // Timestamp when popup appeared (used for 100ms delay check)

// Full Mode (Touch Anywhere)
let fullMode = false;

// --- 元件 Elements ---
const display = document.getElementById('display');
const scrambleEl = document.getElementById('scramble');
const inspEl = document.getElementById('inspSec');
const startBtn = document.getElementById('startBtn');
const toggleBtn = document.getElementById('toggleInspection');
const historyEl = document.getElementById('history');

// --- 計時 Timer Functions ---
function renderTime(ms) {
    if (ms == null) {
        display.textContent = '00:00.00';
        return;
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    const msStr = (ms % 1000).toString().padStart(3, '0'); // 3 digits
    display.textContent = minutes > 0 ? `${minutes}:${seconds}.${msStr}` : `${seconds}.${msStr}`;
}

function startTimer() {
    if (!ready || running) return;
    running = true;
    startAt = Date.now();
    intervalId = setInterval(() => renderTime(Date.now() - startAt), 16);
    display.style.color = COLORS[0]; // White
    clearInterval(inspectionTimer);
    inspectionOn = false;
    inspEl.textContent = '-';
}

function stopTimer(save = true) {
    if (!running) return;
    let finalMs = Date.now() - startAt;

    // Apply WCA Rules (Truncate for singles)
    finalMs = calcTime(finalMs, 'single');

    running = false;
    fullMode = false; // Stop full mode on timer stop
    document.body.classList.remove('no-select'); // Enable selection
    clearInterval(intervalId);

    renderTime(finalMs); // Sync display to exact final time

    if (save) {
        // Show popup instead of saving directly
        showResultPopup(finalMs, scrambleEl.textContent);
    } else {
        display.style.color = COLORS[0]; // White
    }
}

function addTime(ms) {
    times.unshift({
        ms: ms,
        at: new Date().toISOString(),
        scramble: scrambleEl.textContent
    });
    saveTimes(times);
    renderStats();
    newScramble();
    resetInspection();
}

function renderStats() {
    const lastEl = document.getElementById('last');
    const ao5El = document.getElementById('ao5');
    const ao12El = document.getElementById('ao12');
    const bestEl = document.getElementById('best');
    const worstEl = document.getElementById('worst');

    // Clear history element
    historyEl.innerHTML = '';

    // Render History
    times.forEach((t, index) => {
        const div = document.createElement('div');
        div.className = 'time-item';
        div.innerHTML = `<div style="color:var(--muted);width:30px;font-size:12px;">${times.length - index}.</div><div style="font-weight:600;flex-grow:1;text-align:right;">${fmt(t.ms)}</div>`;
        historyEl.appendChild(div);
    });

    lastEl.textContent = times.length ? fmt(times[0].ms) : '-';
    // Use calcTime('average') for stats
    ao5El.textContent = times.length >= 5 ? fmt(calcTime(avg(times.slice(0, 5).map(x => x.ms)), 'average')) : '-';
    ao12El.textContent = times.length >= 12 ? fmt(calcTime(avg(times.slice(0, 12).map(x => x.ms)), 'average')) : '-';
    bestEl.textContent = times.length ? fmt(Math.min(...times.map(x => x.ms))) : '-';
    worstEl.textContent = times.length ? fmt(Math.max(...times.map(x => x.ms))) : '-';
}

function avg(arr) {
    // Simple mean (assuming input array is correct length)
    // Note: WCA Ao5 usually requires removing best/worst, but here we just implement the Mean logic requested.
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function newScramble() {
    scrambleEl.textContent = genScramble(20);
    stopPlaying(); // Reset full mode and holding
    display.style.color = COLORS[0]; // Reset to White
}

// --- 長按機制 Holding Logic (Stackmat Style) ---
function beginHold() {
    if (running) {
        stopTimer(true);
        return;
    }
    holding = true;
    ready = false;
    holdStart = Date.now();
    display.style.color = COLORS[2]; // Red
    setZoomLock(true); // Lock zoom during hold

    // check long press > 0.55s
    setTimeout(() => {
        if (holding) {
            ready = true;
            display.style.color = COLORS[3]; // Green
        }
    }, 550);
}

function endHold() {
    if (holding) {
        holding = false;
        if (ready) {
            startTimer();
        } else {
            // Cancelled
            if (inspectionOn) {
                display.style.color = COLORS[1]; // Return to Orange
            } else {
                display.style.color = COLORS[0]; // Return to White
            }
        }
    }
}

// --- 事件監聽 Event Listeners ---
let spaceHeld = false;
document.addEventListener('keydown', e => {
    // Disable play keyboard when result popup is showing
    const resultPopupVisible = resultPopup && !resultPopup.classList.contains('hidden');
    if (resultPopupVisible) {
        // Prevent Space from scrolling page when popup is showing
        if (e.code === 'Space') e.preventDefault();
        return;
    }

    // Check if play keyboard shortcuts are allowed
    if (typeof canUsePlayKeyboard === 'function' && !canUsePlayKeyboard()) return;

    if (e.code === 'Space') {
        e.preventDefault();
        if (!spaceHeld) {
            spaceHeld = true;
            beginHold();
        }
    }
    if (e.code === 'KeyS') {
        e.preventDefault();
        if (running) stopTimer(false);
        newScramble();
        // renderTime(null); // Removed to preserve displayed time
        resetInspection();
    }
    if (e.code === 'KeyI') {
        e.preventDefault();
        startInspection();
    }
});

document.addEventListener('keyup', e => {
    // Always handle keyup for Space if it was held (to properly end hold)
    if (e.code === 'Space' && spaceHeld) {
        e.preventDefault();
        spaceHeld = false;
        endHold();
    }
});

// Touch/Mouse Events for Button
startBtn.addEventListener('mousedown', (e) => {
    if (pendingResult !== null) return; // Don't capture when popup is showing
    beginHold();
});
startBtn.addEventListener('mouseup', (e) => {
    if (pendingResult !== null) return; // Don't capture when popup is showing
    endHold();
});
startBtn.addEventListener('touchstart', e => {
    e.preventDefault();
    if (pendingResult !== null) return; // Don't capture when popup is showing
    beginHold();
});
startBtn.addEventListener('touchend', e => {
    e.preventDefault();
    if (pendingResult !== null) return; // Don't capture when popup is showing
    endHold();
});

document.getElementById('newScramble').addEventListener('click', () => {
    if (running) stopTimer(false);
    newScramble();
    // renderTime(null); // Removed to preserve displayed time
    resetInspection();
});

document.getElementById('exportCsv').addEventListener('click', () => {
    let csvContent = "data:text/csv;charset=utf-8,Time,Date,Scramble\n";
    times.forEach(row => {
        csvContent += `${fmt(row.ms)},${row.at},${row.scramble}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "rubik_times.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

document.getElementById('clear').addEventListener('click', () => {
    if (confirm('確定要清除所有紀錄嗎？')) {
        times = [];
        saveTimes(times);
        renderStats();
    }
});


// --- 檢查倒數 Inspection Logic ---
function resetInspection() {
    inspectionOn = false;
    inspectionReady = false;
    clearInterval(inspectionTimer);
    inspEl.textContent = '-';
}

function startInspection() {
    if (running) return;
    resetInspection();
    inspectionOn = true;
    fullMode = true; // Enable Full Mode
    document.body.classList.add('no-select'); // Disable selection
    setZoomLock(true); // Lock zoom during inspection

    // Set color to Orange
    display.style.color = COLORS[1];

    inspectionSec = 15;
    inspEl.textContent = inspectionSec;
    inspectionTimer = setInterval(() => {
        inspectionSec--;
        inspEl.textContent = inspectionSec;
        if (inspectionSec <= 0) {
            clearInterval(inspectionTimer);
            inspectionOn = false;

            // Row 102: Reset color to White
            display.style.color = COLORS[0];

            // Row 103: Stop playing (disable full mode & touch & holding)
            stopPlaying();
        }
    }, 1000);
}

function stopPlaying() {
    holding = false;
    ready = false;
    fullMode = false;
    document.body.classList.remove('no-select'); // Enable selection
    setZoomLock(false); // Unlock zoom when idle
}

// Inspection Toggle Button Long Press
function inspectionHoldStart(e) {
    if (e.cancelable) e.preventDefault();
    if (!inspectionOn) startInspection();
    inspectionReady = false;
    inspectionHoldTimeout = setTimeout(() => {
        inspectionReady = true;
        resetInspection();
        // New Logic: Long press reset
        stopPlaying();
        display.style.color = COLORS[0];
    }, 1000);
}

function inspectionHoldEnd(e) {
    if (e.cancelable) e.preventDefault();
    clearTimeout(inspectionHoldTimeout);
    inspectionHoldTimeout = null;
    // logic adjustment if needed.
}

toggleBtn.addEventListener('mousedown', inspectionHoldStart);
toggleBtn.addEventListener('mouseup', inspectionHoldEnd);
toggleBtn.addEventListener('touchstart', inspectionHoldStart, { passive: false });
toggleBtn.addEventListener('touchend', inspectionHoldEnd, { passive: false });


// --- Global Touch to Start (Full support) ---
function areaHoldStart(e) {
    // If result popup is showing, don't handle body events
    if (pendingResult !== null) return;

    // If clicking a button, ignore
    if (e.target.closest('button')) return;

    // Logic: If Running -> Touch stops it (Standard)
    if (running) {
        stopTimer(true); // Save history!
        return;
    }

    // If Not Running
    // Only allow start if Full Mode is ON (e.g. during Inspection)
    if (fullMode) {
        beginHold();
    }
    // If fullMode is OFF, clicking background does NOTHING (user must use standard inputs or inspection)
}
function areaHoldEnd(e) {
    // If result popup is showing, don't handle body events
    if (pendingResult !== null) return;

    if (e.target.closest('button')) return;

    if (fullMode || holding) {
        endHold();
    }
}

document.body.addEventListener('mousedown', areaHoldStart);
document.body.addEventListener('mouseup', areaHoldEnd);
document.body.addEventListener('touchstart', areaHoldStart, { passive: false });
document.body.addEventListener('touchend', areaHoldEnd, { passive: false });

// --- Prevent Pinch Zoom During Timer/Inspection/Popup ---
// Block multi-touch gestures when timer is active or popup is showing
function isZoomBlocked() {
    return running || inspectionOn || holding || pendingResult !== null;
}

// Dynamic viewport zoom control
function setZoomLock(locked) {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
        if (locked) {
            viewport.setAttribute('content', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no');
        } else {
            viewport.setAttribute('content', 'width=device-width,initial-scale=1');
        }
    }
}

document.addEventListener('touchstart', (e) => {
    // If multiple fingers and timer is in active state, prevent zoom
    if (e.touches.length > 1 && isZoomBlocked()) {
        e.preventDefault();
    }
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    // Prevent pinch zoom during timing/inspection/popup
    if (e.touches.length > 1 && isZoomBlocked()) {
        e.preventDefault();
    }
}, { passive: false });

// Also prevent double-tap zoom during active states
let lastTouchTime = 0;
document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchTime < 300 && isZoomBlocked()) {
        e.preventDefault();
    }
    lastTouchTime = now;
}, { passive: false });

// --- Result Confirmation Popup Logic ---
const resultPopup = document.getElementById('resultPopup');
const popupTimeEl = document.getElementById('popupTime');
const resultOKBtn = document.getElementById('resultOK');
const resultPlus2Btn = document.getElementById('resultPlus2');
const resultDNFBtn = document.getElementById('resultDNF');

function showResultPopup(ms, scramble) {
    pendingResult = { ms: ms, scramble: scramble };
    popupShowTime = Date.now(); // Record when popup appeared
    popupTimeEl.textContent = fmt(ms);
    resultPopup.classList.remove('hidden');

    // Reset zoom to default scale when popup appears
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
        viewport.setAttribute('content', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no');
    }
}

function hideResultPopup() {
    resultPopup.classList.add('hidden');
    pendingResult = null;
    popupTouchStartValid = false; // Reset touch validity
    setZoomLock(false); // Unlock zoom when popup closes
}

// Track if the current touch STARTED after popup was shown + 100ms
// This ensures popup only accepts taps where touchstart happens after popup appears
const POPUP_TOUCH_DELAY = 100; // ms - touchstart must happen this long after popup shows
let popupTouchStartValid = false; // True if current touch started after popup + delay

// Listen for touchstart to check if it happens after popup + delay
document.addEventListener('touchstart', (e) => {
    if (pendingResult !== null) {
        // Check if this touchstart is valid (happened after popup + delay)
        popupTouchStartValid = (Date.now() - popupShowTime > POPUP_TOUCH_DELAY);
    }
}, { passive: true, capture: true });

// For mouse: check on mousedown
document.addEventListener('mousedown', (e) => {
    if (pendingResult !== null) {
        popupTouchStartValid = (Date.now() - popupShowTime > POPUP_TOUCH_DELAY);
    }
}, { capture: true });

function isPopupClickValid() {
    return popupTouchStartValid;
}

// Direct action functions (bypass touch validation - used by keyboard shortcuts)
function doResultOK() {
    if (pendingResult) {
        addTime(pendingResult.ms);
    }
    hideResultPopup();
}

function doResultPlus2() {
    if (pendingResult) {
        const adjustedMs = pendingResult.ms + 2000;
        addTime(adjustedMs);
        renderTime(adjustedMs);
    }
    hideResultPopup();
}

function doResultDNF() {
    hideResultPopup();
    newScramble();
}

// OK Button: Save as-is
resultOKBtn.addEventListener('click', () => {
    if (!isPopupClickValid()) return; // Ignore if touch started before popup
    doResultOK();
});

// +2 Button: Add 2 seconds (2000ms)
resultPlus2Btn.addEventListener('click', () => {
    if (!isPopupClickValid()) return; // Ignore if touch started before popup
    doResultPlus2();
});

// DNF Button: Discard (don't save)
resultDNFBtn.addEventListener('click', () => {
    if (!isPopupClickValid()) return; // Ignore if touch started before popup
    doResultDNF();
});

// Keyboard shortcuts for popup (O=OK, 2=+2, D=DNF)
// These bypass touch validation since keyboard doesn't have the same timing issues
document.addEventListener('keydown', (e) => {
    if (!resultPopup.classList.contains('hidden')) {
        // Check if confirm keyboard shortcuts are allowed
        if (typeof canUseConfirmKeyboard === 'function' && !canUseConfirmKeyboard()) return;

        if (e.key === 'o' || e.key === 'O' || e.key === 'Enter') {
            e.preventDefault();
            doResultOK(); // Direct call, bypasses touch validation
        } else if (e.key === '2') {
            e.preventDefault();
            doResultPlus2(); // Direct call, bypasses touch validation
        } else if (e.key === 'd' || e.key === 'D' || e.key === 'Escape') {
            e.preventDefault();
            doResultDNF(); // Direct call, bypasses touch validation
        }
    }
});

// Prevent popup clicks from bubbling to body event handlers
// Also set touch validity on popup button touches
resultPopup.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    // Set validity when user clicks/touches popup
    if (pendingResult !== null) {
        popupTouchStartValid = (Date.now() - popupShowTime > POPUP_TOUCH_DELAY);
    }
});
resultPopup.addEventListener('mouseup', (e) => {
    e.stopPropagation();
});
resultPopup.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    // Set validity when user touches popup
    if (pendingResult !== null) {
        popupTouchStartValid = (Date.now() - popupShowTime > POPUP_TOUCH_DELAY);
    }
}, { passive: false });
resultPopup.addEventListener('touchend', (e) => {
    e.stopPropagation();
}, { passive: false });


// --- Keyboard Settings & Shortcut Logic ---

/**
 * Detect if the device likely has a physical keyboard.
 */
function hasKeyboard() {
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
    const hasHover = window.matchMedia('(hover: hover)').matches;
    return hasFinePointer && hasHover;
}

/**
 * Check if user is focused in an input field
 */
function isInputFocused() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || active.isContentEditable;
}

/**
 * Get keyboard settings from localStorage
 */
function getKeyboardSettings() {
    const defaults = {
        enabled: hasKeyboard(), // Default based on device detection
        playHints: true,
        confirmHints: true,
        playEnabled: true,
        confirmEnabled: true
    };

    const saved = localStorage.getItem('keyboard_settings');
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
 * Save keyboard settings to localStorage
 */
function saveKeyboardSettings(settings) {
    localStorage.setItem('keyboard_settings', JSON.stringify(settings));
}

/**
 * Initialize keyboard settings UI
 */
function initKeyboardSettings() {
    const masterToggle = document.getElementById('keyboardMasterToggle');
    const subSettings = document.getElementById('keyboardSubSettings');
    const playHintsToggle = document.getElementById('keyboardPlayHints');
    const confirmHintsToggle = document.getElementById('keyboardConfirmHints');
    const playEnabledToggle = document.getElementById('keyboardPlayEnabled');
    const confirmEnabledToggle = document.getElementById('keyboardConfirmEnabled');

    if (!masterToggle) return; // Settings page not loaded yet

    const settings = getKeyboardSettings();

    // Set initial values
    masterToggle.checked = settings.enabled;
    if (playHintsToggle) playHintsToggle.checked = settings.playHints;
    if (confirmHintsToggle) confirmHintsToggle.checked = settings.confirmHints;
    if (playEnabledToggle) playEnabledToggle.checked = settings.playEnabled;
    if (confirmEnabledToggle) confirmEnabledToggle.checked = settings.confirmEnabled;

    // Show/hide sub-settings
    if (subSettings) {
        subSettings.classList.toggle('hidden', !settings.enabled);
    }

    // Master toggle handler
    masterToggle.addEventListener('change', () => {
        const newEnabled = masterToggle.checked;
        if (subSettings) {
            subSettings.classList.toggle('hidden', !newEnabled);
        }
        const current = getKeyboardSettings();
        current.enabled = newEnabled;
        saveKeyboardSettings(current);
        updateButtonHints();
    });

    // Sub-toggle handlers
    const subToggles = [
        { el: playHintsToggle, key: 'playHints' },
        { el: confirmHintsToggle, key: 'confirmHints' },
        { el: playEnabledToggle, key: 'playEnabled' },
        { el: confirmEnabledToggle, key: 'confirmEnabled' }
    ];

    subToggles.forEach(({ el, key }) => {
        if (el) {
            el.addEventListener('change', () => {
                const current = getKeyboardSettings();
                current[key] = el.checked;
                saveKeyboardSettings(current);
                updateButtonHints();
            });
        }
    });

    // Apply initial hints
    updateButtonHints();
}

/**
 * Update all button texts with/without keyboard shortcuts based on settings
 */
function updateButtonHints() {
    const settings = getKeyboardSettings();

    // Home page buttons
    const toggleInspBtn = document.getElementById('toggleInspection');
    const newScrambleBtn = document.getElementById('newScramble');
    const startBtnEl = document.getElementById('startBtn');

    // Popup buttons
    const okBtn = document.getElementById('resultOK');
    const plus2Btn = document.getElementById('resultPlus2');
    const dnfBtn = document.getElementById('resultDNF');

    // Show play hints only if enabled AND playHints is on
    const showPlayHints = settings.enabled && settings.playHints;
    // Show confirm hints only if enabled AND confirmHints is on
    const showConfirmHints = settings.enabled && settings.confirmHints;

    if (showPlayHints) {
        if (toggleInspBtn) toggleInspBtn.innerHTML = '<span class="btn-label">開始檢查</span><span class="btn-hint">(I)</span>';
        if (newScrambleBtn) newScrambleBtn.innerHTML = '<span class="btn-label">新亂序</span><span class="btn-hint">(S)</span>';
        if (startBtnEl) startBtnEl.innerHTML = '<span class="btn-label">開始/停止</span><span class="btn-hint">(Space)</span>';
    } else {
        if (toggleInspBtn) toggleInspBtn.innerHTML = '<span class="btn-label">開始檢查</span>';
        if (newScrambleBtn) newScrambleBtn.innerHTML = '<span class="btn-label">新亂序</span>';
        if (startBtnEl) startBtnEl.innerHTML = '<span class="btn-label">開始/停止</span>';
    }

    if (showConfirmHints) {
        if (okBtn) okBtn.innerHTML = '<span class="btn-label">OK</span><span class="btn-hint">(O)</span>';
        if (plus2Btn) plus2Btn.innerHTML = '<span class="btn-label">+2</span><span class="btn-hint">(2)</span>';
        if (dnfBtn) dnfBtn.innerHTML = '<span class="btn-label">DNF</span><span class="btn-hint">(D)</span>';
    } else {
        if (okBtn) okBtn.textContent = 'OK';
        if (plus2Btn) plus2Btn.textContent = '+2';
        if (dnfBtn) dnfBtn.textContent = 'DNF';
    }
}

/**
 * Check if play keyboard shortcuts are allowed
 */
function canUsePlayKeyboard() {
    if (isInputFocused()) return false;
    const settings = getKeyboardSettings();
    return settings.enabled && settings.playEnabled;
}

/**
 * Check if confirm keyboard shortcuts are allowed
 */
function canUseConfirmKeyboard() {
    if (isInputFocused()) return false;
    const settings = getKeyboardSettings();
    return settings.enabled && settings.confirmEnabled;
}

// Init
newScramble();
renderStats();
updateButtonHints();

// Initialize keyboard settings when settings page is visited
// This will be called by router when navigating to settings page
window.initKeyboardSettings = initKeyboardSettings;

// Also try to init on DOM ready (in case already on settings page)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKeyboardSettings);
} else {
    initKeyboardSettings();
}
