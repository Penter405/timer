// --- 顏色定義 Colors ---
const COLORS = ['white', 'orange', 'red', '#4ade80']; // 0:Idle, 1:Inspection, 2:Hold, 3:Ready

// --- 工具 Tools ---
const WCA_EVENT = { type: '333', mode: 'normal' }; // 3x3x3 Sighted

function calcTime(ms, type = 'single') {
    if (WCA_EVENT.type === '333') {
        // WCA 9f1: Truncate single results to hundredths
        if (type === 'single') return Math.floor(ms / 10) * 10;
        // WCA 9f1: Round averages to hundredths
        if (type === 'average') return Math.round(ms / 10) * 10;
    }
    return ms;
}

function fmt(ms) {
    if (ms == null) return '-';
    if (isNaN(ms)) return '-';
    // Input ms is expected to be already processed (truncated/rounded)
    const totalCent = Math.round(ms / 10); // Safe to simple round/floor now
    const m = Math.floor(totalCent / 6000);
    const s = Math.floor((totalCent % 6000) / 100).toString().padStart(2, '0');
    const c = (totalCent % 100).toString().padStart(2, '0');
    return m > 0 ? `${m}:${s}.${c}` : `${s}.${c}`;
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
    const cent = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
    display.textContent = minutes > 0 ? `${minutes}:${seconds}.${cent}` : `${seconds}.${cent}`;
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
    clearInterval(intervalId);

    renderTime(finalMs); // Sync display to exact final time

    if (save) {
        addTime(finalMs);
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
    if (e.code === 'Space') {
        e.preventDefault();
        if (spaceHeld) {
            spaceHeld = false;
            endHold();
        }
    }
});

// Touch/Mouse Events for Button
startBtn.addEventListener('mousedown', beginHold);
startBtn.addEventListener('mouseup', endHold);
startBtn.addEventListener('touchstart', e => {
    e.preventDefault();
    beginHold();
});
startBtn.addEventListener('touchend', e => {
    e.preventDefault();
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
    if (e.target.closest('button')) return;

    if (fullMode || holding) {
        endHold();
    }
}

document.body.addEventListener('mousedown', areaHoldStart);
document.body.addEventListener('mouseup', areaHoldEnd);
document.body.addEventListener('touchstart', areaHoldStart, { passive: false });
document.body.addEventListener('touchend', areaHoldEnd, { passive: false });

// Init
newScramble();
renderStats();
