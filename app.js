// Redirect if not logged in
let currentLang = 'en'; // default language


// Optional: real-time updates via SSE
const evtSource = new EventSource("/api/stream");
evtSource.onmessage = async (event) => {
    const dbBosses = JSON.parse(event.data);
    dbBosses.forEach(d => {
        const serverVal = d.last_killed ?? null;
        if (serverVal) localStorage.setItem("boss_kill_" + d.name, String(serverVal));
        else localStorage.removeItem("boss_kill_" + d.name);
    });
    renderBosses();
};

//TIMEZONE SUPPORT
// === TIMEZONE (SCHEDULED BOSSES ONLY) ===
const BASE_TZ_OFFSET = 8; // schedules are written in UTC+8
let currentTzOffset = Number(localStorage.getItem("tz_offset")) || 8;


// --- BACKEND UPDATE FUNCTIONS ---
// Update DB then re-sync immediately
async function updateBoss(name, killedAt) {
    try {
        await fetch("/api/updateBoss", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bossName: name, status: killedAt })
        });
    } catch (err) {
        console.error("updateBoss POST failed:", err);
        throw err;
    }
}

// Load bosses list and status from server (single function)
async function loadBossStatusFromDB() {
    try {
        const res = await fetch("/api/getBosses", { cache: "no-store" });
        if (!res.ok) {
            console.error("getBosses failed:", res.status, await res.text());
            return;
        }
        const dbBosses = await res.json();
        console.log("Loaded bosses from DB:", dbBosses.length, "bosses");

        // Update bosses list
        bosses = dbBosses;

        // Sync localStorage with kill times for timer calculations
        dbBosses.forEach(d => {
            const serverVal = d.last_killed ?? null;
            if (serverVal) {
                const ts = typeof serverVal === "string" ? Date.parse(serverVal) : Number(serverVal);
                if (!isNaN(ts)) {
                    localStorage.setItem("boss_kill_" + d.name, String(ts));
                } else {
                    localStorage.removeItem("boss_kill_" + d.name);
                }
            } else {
                localStorage.removeItem("boss_kill_" + d.name);
            }
        });

        // Re-render using updated bosses and localStorage values
        renderBosses();
    } catch (err) {
        console.error("Failed loading from DB:", err);
    }
}

// Poll server every 5 seconds for status + boss list changes
const POLL_INTERVAL_MS = 5000;
setInterval(loadBossStatusFromDB, POLL_INTERVAL_MS);

// Run once at page load
loadBossStatusFromDB();


function setLanguage(lang) {
    currentLang = lang;

    // Update login page if exists
    if (document.getElementById("username")) {
        document.querySelector("h2").textContent = LANG[lang].login_title;
        document.getElementById("username").placeholder = LANG[lang].username_placeholder;
        document.getElementById("password").placeholder = LANG[lang].password_placeholder;
        document.querySelector(".btn").textContent = LANG[lang].login_btn;
    }

    // Update dashboard page if exists
    if (document.querySelector(".header-title")) {
        document.querySelector(".header-title").textContent = LANG[lang].boss_schedule_title;
        document.querySelector(".logout-btn").textContent = LANG[lang].logout_btn;
    }

    // Re-render bosses so button text and status updates
    if (typeof renderBosses === "function") renderBosses();
}

// -----------------------------
// LOGIN PERSISTENCE (12 HOURS)
// -----------------------------
const LOGIN_DURATION = 12 * 60 * 60 * 1000; // 12 hours

const loginFlag = localStorage.getItem("logged_in");
const loginExpiry = localStorage.getItem("login_expiry");

if (
    loginFlag !== "true" ||
    !loginExpiry ||
    Date.now() > Number(loginExpiry)
) {
    localStorage.removeItem("logged_in");
    localStorage.removeItem("login_expiry");
    window.location.href = "index.html";
}

function logout() {
    localStorage.removeItem("logged_in");
    localStorage.removeItem("login_expiry");
    window.location.href = "index.html";
}


let bosses = [];
let currentSort = "default";

/* -----------------------------
   PARSING HELPERS
----------------------------- */

function parseRespawnHours(text) {
    if (!text) return null;
    const match = text.match(/(\d+)\s*Hour/);
    return match ? parseInt(match[1], 10) : null;
}

function parseWeeklyRespawns(text) {
    if (!text) return null;
    const entries = text.split(",").map(t => t.trim());
    const times = [];

    entries.forEach(entry => {
        const match =
            entry.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{2})/i);

        if (match) {
            times.push({
                weekday: match[1],
                hour: parseInt(match[2]),
                minute: parseInt(match[3])
            });
        }
    });

    return times.length > 0 ? times : null;
}

function weekdayToIndex(day) {
    return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].indexOf(day);
}

function dayToName(val) {
    const names = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    if (val == null) return null;
    if (typeof val === 'number') return names[val] || null;
    if (typeof val === 'string') {
        // If string looks like a number, convert
        if (/^\d+$/.test(val)) {
            const n = parseInt(val,10);
            return names[n] || val;
        }
        return val;
    }
    return String(val);
}

function getNextWeeklySpawn(schedule) {
    const now = new Date();

    // Convert "now" to UTC
    const nowUtcMs = now.getTime() + now.getTimezoneOffset() * 60000;

    // Convert UTC → BASE schedule timezone (UTC+8)
    const baseNow = new Date(nowUtcMs + 8 * 3600000);

    let soonest = null;

    schedule.forEach(item => {
        const d = new Date(baseNow);
        const today = baseNow.getDay();
        const targetDay = weekdayToIndex(item.weekday);

        let diff = targetDay - today;
        if (diff < 0) diff += 7;

        d.setDate(baseNow.getDate() + diff);
        d.setHours(item.hour, item.minute, 0, 0);

        if (d <= baseNow) {
            d.setDate(d.getDate() + 7);
        }

        if (!soonest || d < soonest) soonest = d;
    });

    // Convert BASE (UTC+8) → selected timezone
    return soonest.getTime() + (currentTzOffset - 8) * 3600000;
}


/* -----------------------------
   MAIN RENDER (PATCHED LOGIC)
----------------------------- */

// offset
function setTimezone(offset) {
    currentTzOffset = Number(offset);      // update the global variable
    localStorage.setItem("tz_offset", currentTzOffset); // persist selection
    renderBosses();                        // re-render immediately
}


/* Render */

function renderBosses() {
    const container = document.getElementById("boss-container");
    container.innerHTML = "";

    // Safety check: LANG must be loaded
    if (!LANG || !LANG[currentLang]) {
        console.warn("LANG not yet loaded, retrying...");
        setTimeout(renderBosses, 100);
        return;
    }

    const now = Date.now(); // Capture current time once per render

    // -----------------------------
    // SORTING (INSERTED HERE)
    // -----------------------------
    let sortedBosses = [...bosses];

    function getSortData(boss) {
        const hours = parseRespawnHours(boss.respawn);
        const weekly = parseWeeklyRespawns(boss.respawn);
        const lastKill = parseInt(localStorage.getItem("boss_kill_" + boss.name), 10);

        let timeLeft = 0;
        let type = "alive";

        if (hours !== null) {
            if (lastKill) {
                const respawnMs = hours * 3600 * 1000;
                timeLeft = respawnMs - (now - lastKill);
                if (timeLeft < 0) timeLeft = 0;
                type = timeLeft > 0 ? "dead" : "alive";
            }
        } else if (weekly) {
            const nextSpawn = getNextWeeklySpawn(weekly);
            timeLeft = nextSpawn - now;
            if (timeLeft < 0) timeLeft = 0;
            type = timeLeft > 0 ? "scheduled" : "alive";
        }

        return { timeLeft, type };
    }

    if (currentSort === "level") {
        sortedBosses.sort((a, b) => b.level - a.level);
    }

    if (currentSort === "respawn") {
    sortedBosses.sort((a, b) => {
        const A = getSortData(a);
        const B = getSortData(b);

        const aHasTimer = A.timeLeft > 0;
        const bHasTimer = B.timeLeft > 0;

        // Bosses with upcoming respawns first
        if (aHasTimer && !bHasTimer) return -1;
        if (!aHasTimer && bHasTimer) return 1;

        // Both have timers → soonest first
        if (aHasTimer && bHasTimer) {
            return A.timeLeft - B.timeLeft;
        }

        // Both alive → keep original order
        return 0;
    });
}
    // -----------------------------
    // RENDER (UNCHANGED LOGIC)
    // -----------------------------
    sortedBosses.forEach((boss, i) => {
        const hours = parseRespawnHours(boss.respawn);
        const weekly = parseWeeklyRespawns(boss.respawn);

        let timeLeft = 0;
        let status = "Alive";

        const lastKill = parseInt(localStorage.getItem("boss_kill_" + boss.name), 10);

        if (hours !== null) {
            if (lastKill) {
                const respawnMs = hours * 3600 * 1000;
                let elapsed = now - lastKill;
                if (elapsed < 0) elapsed = 0;
                timeLeft = respawnMs - elapsed;
                if (timeLeft < 0) timeLeft = 0;

                status = timeLeft > 0 ? LANG[currentLang].dead : LANG[currentLang].alive;
            } else {
                timeLeft = 0;
                status = LANG[currentLang].alive;
            }
        } else if (weekly) {
            const nextSpawn = getNextWeeklySpawn(weekly);
            timeLeft = nextSpawn - now;
            if (timeLeft < 0) timeLeft = 0;

            status = timeLeft > 0 ? LANG[currentLang].dead : LANG[currentLang].alive;
        }

        const card = document.createElement("div");
        card.className = `boss-card ${hours !== null ? (timeLeft > 0 ? "dead" : "alive") : "scheduled"}`;
        card.setAttribute("data-boss", boss.name);

        card.innerHTML = `
            <div class="boss-content">
                <div class="boss-left">
                    <div class="boss-title">${boss.name} <span style="opacity:0.8; font-size:16px;">(Lv. ${boss.level})</span></div>
                    <div class="boss-sub">${boss.location}</div>
                    <div class="boss-sub respawn">${LANG[currentLang].respawn}: ${boss.respawn}</div>
                    <div class="timer status" id="timer_${i}">
                        ${timeLeft > 0 ? formatTime(timeLeft) : LANG[currentLang].alive}
                    </div>

                    ${hours !== null ? `
                    <button class="datetime-picker-btn" onclick="openDTModal(${i})">
                        ${LANG[currentLang].pick_datetime}
                    </button>
                    <input type="datetime-local" class="datetime-input" id="dt_${i}">
                    <div class="datetime-display" id="dt_display_${i}">
                        ${LANG[currentLang].no_date}
                    </div>
                    ` : ""}
                </div>

                        <div class="boss-right">
                            ${boss.imageData ? `<img src="${boss.imageData}" class="boss-image">` : `<div class="boss-image-placeholder">No Image</div>`}
                        </div>
            </div>

            ${hours !== null ? `
            <div class="btn-row">
                <button class="btn kill-btn" onclick="killBoss(${i})">${LANG[currentLang].kill}</button>
                <button class="btn unkill-btn" onclick="unkillBoss(${i})">${LANG[currentLang].unkill}</button>
            </div>
            ` : ""}
            <div class="btn-row">
                <button class="btn" onclick="openEditBoss(${i})">Edit</button>
            </div>
        `;

        container.appendChild(card);

        if (timeLeft > 0) startTimer(i, timeLeft);
    });
}





/* -----------------------------
   LOCAL DATE PARSER
----------------------------- */

function parseLocalDateTime(value) {
    const [datePart, timePart] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);

    return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

/* -----------------------------
   KILL / UNKILL (PATCHED)
----------------------------- */

/* -----------------------------
   KILL / UNKILL (PATCHED)
----------------------------- */

async function killBoss(i) {
    const input = document.getElementById(`dt_${i}`);
    const selected = input && input.value
        ? parseLocalDateTime(input.value)
        : Date.now();

    const killTime = Math.min(selected, Date.now());

    // Save local copy (instant UI)
    localStorage.setItem("boss_kill_" + bosses[i].name, String(killTime));

    // UPDATE MONGODB
    try {
        await updateBoss(bosses[i].name, killTime);
    } catch (err) {
        // if update fails, leave localStorage as-is but log error
        console.error("Failed to update server when killing:", err);
    }

    // Immediately re-sync from server to ensure all browsers get same canonical source
    await loadBossStatusFromDB();

    // renderBosses() already called by loadBossStatusFromDB()
}

async function unkillBoss(i) {
    localStorage.removeItem("boss_kill_" + bosses[i].name);

    try {
        // Tell server to clear kill time (we send null; server should set last_killed to null)
        await fetch("/api/updateBoss", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bossName: bosses[i].name, status: null })
        });
    } catch (err) {
        console.error("Failed to update server when un-killing:", err);
    }

    // Immediately re-sync
    await loadBossStatusFromDB();
}


/* -----------------------------
   TIMER LOOP
----------------------------- */

function startTimer(id, timeLeft) {
    const timerEl = document.getElementById("timer_" + id);

    function tick() {
        if (!timerEl) return;

        if (timeLeft <= 0) {
            timerEl.textContent = LANG[currentLang].alive;
            return;
        }

        timerEl.textContent = formatTime(timeLeft);
        timeLeft -= 1000;

        setTimeout(tick, 1000);
    }

    tick();
}


/* -----------------------------
   FORMATTER
----------------------------- */

function formatTime(ms) {
    let sec = Math.floor(ms / 1000);

    const days = Math.floor(sec / 86400);
    sec %= 86400;

    const hours = Math.floor(sec / 3600);
    sec %= 3600;

    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;

    const parts = [];

    if (days > 0) parts.push(`${days} day${days !== 1 ? "s" : ""}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
    if (seconds >= 0) parts.push(`${seconds} second${seconds !== 1 ? "s" : ""}`);

    return parts.join(", ");
}

/* -----------------------------
   DATE/TIME MODAL FUNCTIONS
----------------------------- */

let selectedBossIndex = null;
let modalDate = new Date();

function openDTModal(index) {
    selectedBossIndex = index;

    modalDate = new Date();
    renderCalendar();

    document.getElementById("dt-modal").classList.remove("hidden");
}

function closeDTModal() {
    document.getElementById("dt-modal").classList.add("hidden");
}

function renderCalendar() {
    const monthLabel = document.getElementById("dt-month-label");
    const daysContainer = document.getElementById("dt-days");

    const year = modalDate.getFullYear();
    const month = modalDate.getMonth();

    monthLabel.textContent = modalDate.toLocaleString("default", {
        month: "long",
        year: "numeric"
    });

    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();

    daysContainer.innerHTML = "";

    for (let i = 0; i < firstDay; i++) {
        const blank = document.createElement("div");
        blank.className = "dt-day blank";
        daysContainer.appendChild(blank);
    }

    for (let day = 1; day <= lastDate; day++) {
        const d = document.createElement("div");
        d.className = "dt-day";
        d.textContent = day;

        d.onclick = () => {
            modalDate.setDate(day);
            document.querySelectorAll(".dt-day").forEach(x => x.classList.remove("selected"));
            d.classList.add("selected");
        };

        const now = new Date();
        if (
            day === now.getDate() &&
            month === now.getMonth() &&
            year === now.getFullYear()
        ) {
            d.classList.add("today");
        }

        daysContainer.appendChild(d);
    }

    renderTimeSelectors();
}

function renderTimeSelectors() {
    const hourSel = document.getElementById("dt-hour");
    const minuteSel = document.getElementById("dt-minute");

    hourSel.innerHTML = "";
    minuteSel.innerHTML = "";

    for (let h = 0; h < 24; h++) {
        const opt = document.createElement("option");
        opt.value = h;
        opt.textContent = h.toString().padStart(2, "0");
        hourSel.appendChild(opt);
    }

    for (let m = 0; m < 60; m++) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m.toString().padStart(2, "0");
        minuteSel.appendChild(opt);
    }

    hourSel.value = modalDate.getHours();
    minuteSel.value = modalDate.getMinutes();
}

document.getElementById("dt-prev-month").onclick = () => {
    modalDate.setMonth(modalDate.getMonth() - 1);
    renderCalendar();
};

document.getElementById("dt-next-month").onclick = () => {
    modalDate.setMonth(modalDate.getMonth() + 1);
    renderCalendar();
};

// Time label
document.querySelector(".dt-time-section label").textContent = LANG[currentLang].time;

// Buttons
document.querySelector(".dt-cancel").textContent = LANG[currentLang].cancel;
document.querySelector(".dt-confirm").textContent = LANG[currentLang].confirm;

function confirmDTSelection() {
    const hour = document.getElementById("dt-hour").value;
    const minute = document.getElementById("dt-minute").value;

    modalDate.setHours(hour);
    modalDate.setMinutes(minute);
    modalDate.setSeconds(0);

    const dtInput = document.getElementById(`dt_${selectedBossIndex}`);
    dtInput.value = modalDate.toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);

    const display = document.getElementById(`dt_display_${selectedBossIndex}`);
    display.textContent =
        modalDate.toLocaleDateString() + " " +
        modalDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    closeDTModal();
}

// --- Sidebar / Hamburger Menu ---
document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.getElementById("sidebar");
    const hamburger = document.getElementById("hamburger");
    const overlay = document.getElementById("overlay");
    let sidebarOpen = false;

    function toggleSidebar() {
        sidebarOpen = !sidebarOpen;
        
        if (sidebarOpen) {
            sidebar.classList.add("open");
            overlay.classList.add("active");
            hamburger.classList.add("active");
        } else {
            sidebar.classList.remove("open");
            overlay.classList.remove("active");
            hamburger.classList.remove("active");
        }
    }

    function closeSidebar() {
        sidebarOpen = false;
        sidebar.classList.remove("open");
        overlay.classList.remove("active");
        hamburger.classList.remove("active");
    }

    if (hamburger) {
        hamburger.addEventListener("click", toggleSidebar);
    }

    if (overlay) {
        overlay.addEventListener("click", closeSidebar);
    }

    // Close sidebar when clicking a link
    document.querySelectorAll(".sidebar a").forEach(link => {
        link.addEventListener("click", closeSidebar);
    });
});

document.addEventListener("DOMContentLoaded", () => {
    const sortSelect = document.getElementById("sortSelect");
    if (sortSelect) {
        sortSelect.addEventListener("change", e => {
            currentSort = e.target.value;
            renderBosses();
        });
    }
});
document.addEventListener("DOMContentLoaded", () => {
    const tzSelect = document.getElementById("tz-select");
    if (tzSelect) {
        tzSelect.value = String(currentTzOffset);
    }
});

async function saveBossFromModal() {
    // Validation (collect errors and show inline)
    clearFormErrors();
    const errors = [];
    const name = document.getElementById("boss-name").value.trim();
    const location = document.getElementById("boss-location").value.trim();
    const level = document.getElementById("boss-level").value.trim();
    const scheduleType = document.getElementById("boss-schedule-type").value;
    const imgEl = document.getElementById("boss-image");

    if (!name) errors.push("Name is required");
    if (!location) errors.push("Location is required");
    if (!level) errors.push("Level is required");
    if (!scheduleType) errors.push("Schedule Type is required");

    // Check for duplicate boss name (only when creating new boss)
    if (editingBossIndex === null && name) {
        if (bosses.some(b => b.name.toLowerCase() === name.toLowerCase())) {
            errors.push(`Boss \"${name}\" already exists. Choose a different name.`);
        }
    }

    // Build respawn string based on schedule type
    let respawn = "";
    if (scheduleType === "scheduled") {
        // If user configured explicit weekly times, use those (e.g., "Monday 12:00, Tuesday 13:00")
        if (scheduledTimes && scheduledTimes.length > 0) {
            // Validate scheduled rows
            if (!validateScheduledTimes()) {
                showFormErrors(["Please fix scheduled times before saving."]);
                return;
            }
            respawn = scheduledTimes.map(t => {
                const day = t.day || t.weekday || 'Monday';
                const hh = String(typeof t.hour === 'number' ? t.hour : (parseInt(t.hour,10)||0)).padStart(2,'0');
                const mm = String(typeof t.minute === 'number' ? t.minute : (parseInt(t.minute,10)||0)).padStart(2,'0');
                return `${day} ${hh}:${mm}`;
            }).join(', ');
        } else {
            // Fallback to duration inputs if no weekly rows present
            const days = parseInt(document.getElementById("boss-respawn-days").value, 10) || 0;
            const hours = parseInt(document.getElementById("boss-respawn-hours").value, 10) || 0;
            const minutes = parseInt(document.getElementById("boss-respawn-minutes").value, 10) || 0;
            const totalHours = days * 24 + hours;
            if (totalHours === 0 && minutes === 0) errors.push("Respawn duration must be greater than 0");
            respawn = `${totalHours} Hour${minutes > 0 ? ` ${minutes} Minute` : ""}`;
        }
    } else if (scheduleType === "unscheduled") {
        const days = parseInt(document.getElementById("boss-respawn-days").value, 10) || 0;
        const hours = parseInt(document.getElementById("boss-respawn-hours").value, 10) || 0;
        const minutes = parseInt(document.getElementById("boss-respawn-minutes").value, 10) || 0;
        const totalHours = days * 24 + hours;
        if (totalHours === 0 && minutes === 0) errors.push("Respawn duration must be greater than 0");
        respawn = `${totalHours} Hour${minutes > 0 ? ` ${minutes} Minute` : ""}`;
    }

    if (errors.length > 0) {
        showFormErrors(errors);
        return;
    }

    const payload = {
        name,
        location,
        level: Number(level),
        respawn,
        imageData: null
    };

    if (imgEl && imgEl.files && imgEl.files[0]) {
        const file = imgEl.files[0];
        if (file.size > 4 * 1024 * 1024) {
            showFormErrors(["Image must be 4MB or smaller"]);
            return;
        }
        try {
            payload.imageData = await readImageFileAsDataURL(file);
        } catch (err) {
            console.error("Failed reading image:", err);
            showFormErrors(["Failed to read image file"]);
            return;
        }
    }

    const action = editingBossIndex === null ? "create" : "update";
    try {
        const res = await fetch("/api/manageBoss", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, boss: payload })
        });
        if (!res.ok) throw new Error(await res.text());
        await loadBossStatusFromDB();
        showBossModal(false);
    } catch (err) {
        console.error("Failed to save boss:", err);
        showFormErrors(["Failed to save boss: " + err.message]);
    }
}

function showFormErrors(errors) {
    const el = document.getElementById("boss-form-errors");
    if (!el) return;
    if (!errors) {
        el.style.display = "none";
        el.innerHTML = "";
        return;
    }
    if (!Array.isArray(errors)) errors = [String(errors)];
    el.innerHTML = errors.map(e => `<div>${e}</div>`).join("");
    el.style.display = "block";
}

function clearFormErrors() {
    const el = document.getElementById("boss-form-errors");
    if (!el) return;
    el.style.display = "none";
    el.innerHTML = "";
}

async function deleteBossFromModal() {
    if (editingBossIndex === null) return;
    const boss = bosses[editingBossIndex];
    try {
        const res = await fetch("/api/manageBoss", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: boss.name })
        });
        if (!res.ok) throw new Error(await res.text());
        // Reload bosses after successful delete
        await loadBossStatusFromDB();
        showBossModal(false);
    } catch (err) {
        console.error("Failed to delete boss:", err);
        showFormErrors(["Failed to delete boss: " + err.message]);
    } finally {
        const conf = document.getElementById('boss-delete-confirm');
        if (conf) conf.style.display = 'none';
    }
}

// ADD / EDIT / DELETE BOSSES - MODAL LOGIC
// ============================================
let editingBossIndex = null;
let scheduledTimes = [];

function showBossModal(show) {
    const modal = document.getElementById("boss-modal");
    if (!modal) return;
    if (show) modal.classList.remove("hidden");
    else modal.classList.add("hidden");
    if (show) {
        // Ensure respawn UI labels reflect current values whenever modal opens
        try { toggleRespawnUI(); } catch (e) { /* ignore */ }
    }
}

function toggleRespawnUI() {
    const scheduleType = document.getElementById("boss-schedule-type").value;
    const scheduledDiv = document.getElementById("scheduled-respawn");
    const unscheduledDiv = document.getElementById("unscheduled-respawn");
    const scheduledLabel = document.getElementById("scheduled-label");
    const unscheduledLabel = document.getElementById("unscheduled-label");
    
    if (scheduleType === "scheduled") {
        // Show weekly scheduled controls, hide duration inputs
        scheduledDiv?.classList.remove("hidden");
        unscheduledDiv?.classList.add("hidden");
        if (scheduledLabel) scheduledLabel.style.display = 'block';
        if (unscheduledLabel) unscheduledLabel.style.display = 'none';
    } else if (scheduleType === "unscheduled") {
        // Unscheduled uses duration inputs
        scheduledDiv?.classList.add("hidden");
        unscheduledDiv?.classList.remove("hidden");
        if (scheduledLabel) scheduledLabel.style.display = 'none';
        if (unscheduledLabel) unscheduledLabel.style.display = 'block';
    } else {
        scheduledDiv?.classList.add("hidden");
        unscheduledDiv?.classList.add("hidden");
        if (scheduledLabel) scheduledLabel.style.display = 'none';
        if (unscheduledLabel) unscheduledLabel.style.display = 'none';
    }
}

// Render inline scheduled rows (day select + hour/min inputs)
function renderScheduledInline() {
    const container = document.getElementById('scheduled-times-list');
    if (!container) return;
    container.innerHTML = '';
    scheduledTimes.forEach((t, idx) => {
        const row = document.createElement('div');
        row.className = 'scheduled-time-item';

        const daySel = document.createElement('select');
        daySel.className = 'day-select';
        ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].forEach(d => {
            const opt = document.createElement('option'); opt.value = d; opt.textContent = d;
            const currentDay = dayToName(t.day || t.weekday);
            if (currentDay === d) opt.selected = true;
            daySel.appendChild(opt);
        });
        daySel.addEventListener('change', e => { scheduledTimes[idx].day = e.target.value; });

        const hourIn = document.createElement('input');
        hourIn.type = 'number'; hourIn.min = 0; hourIn.max = 23; hourIn.className = 'hour-input';
        hourIn.value = (t.hour == null ? '' : t.hour);
        hourIn.addEventListener('change', e => { const v = e.target.value; scheduledTimes[idx].hour = v === '' ? null : Math.max(0, Math.min(23, parseInt(v,10)||0)); });

        const minuteIn = document.createElement('input');
        minuteIn.type = 'number'; minuteIn.min = 0; minuteIn.max = 59; minuteIn.className = 'minute-input';
        minuteIn.value = (t.minute == null ? '' : t.minute);
        minuteIn.addEventListener('change', e => { const v = e.target.value; scheduledTimes[idx].minute = v === '' ? null : Math.max(0, Math.min(59, parseInt(v,10)||0)); });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button'; removeBtn.className = 'remove-scheduled'; removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => { scheduledTimes.splice(idx,1); renderScheduledInline(); });

        row.appendChild(daySel);
        row.appendChild(hourIn);
        row.appendChild(minuteIn);
        row.appendChild(removeBtn);
        container.appendChild(row);
    });

    // If no rows, show an empty placeholder
    if (scheduledTimes.length === 0) {
        const ph = document.createElement('div'); ph.className = 'rp-pill'; ph.textContent = 'No times set'; container.appendChild(ph);
    }
}

function renderScheduledTimesList() {
    const container = document.getElementById("scheduled-times-list");
    if (!container) return;
    container.innerHTML = "";
    
    scheduledTimes.forEach((time, idx) => {
        const item = document.createElement("div");
        item.className = "respawn-item";
        item.innerHTML = `
            <select onchange="updateScheduledTime(${idx}, 'day', this.value)">
                <option value="Monday" ${time.day === "Monday" ? "selected" : ""}>Monday</option>
                <option value="Tuesday" ${time.day === "Tuesday" ? "selected" : ""}>Tuesday</option>
                <option value="Wednesday" ${time.day === "Wednesday" ? "selected" : ""}>Wednesday</option>
                <option value="Thursday" ${time.day === "Thursday" ? "selected" : ""}>Thursday</option>
                <option value="Friday" ${time.day === "Friday" ? "selected" : ""}>Friday</option>
                <option value="Saturday" ${time.day === "Saturday" ? "selected" : ""}>Saturday</option>
                <option value="Sunday" ${time.day === "Sunday" ? "selected" : ""}>Sunday</option>
            </select>
            <input type="number" min="0" max="23" value="${time.hour}" onchange="updateScheduledTime(${idx}, 'hour', this.value)" placeholder="HH">
            <input type="number" min="0" max="59" value="${time.minute}" onchange="updateScheduledTime(${idx}, 'minute', this.value)" placeholder="MM">
            <button type="button" onclick="removeScheduledTime(${idx})">Remove</button>
        `;
        container.appendChild(item);
    });
}

function updateScheduledTime(idx, field, value) {
    if (field === "day") scheduledTimes[idx].day = value;
    if (field === "hour") scheduledTimes[idx].hour = parseInt(value, 10) || 0;
    if (field === "minute") scheduledTimes[idx].minute = parseInt(value, 10) || 0;
}

function removeScheduledTime(idx) {
    scheduledTimes.splice(idx, 1);
    renderScheduledTimesList();
}

function addScheduledTime() {
    scheduledTimes.push({ day: "Monday", hour: 12, minute: 0 });
    renderScheduledInline();
}

function openEditBoss(i) {
    editingBossIndex = i;
    const boss = bosses[i];
    document.getElementById("boss-modal-title").textContent = "Edit Boss";
    document.getElementById("boss-name").value = boss.name || "";
    document.getElementById("boss-location").value = boss.location || "";
    document.getElementById("boss-level").value = boss.level || "";
    document.getElementById("boss-image").value = null;
    const deleteBtn = document.getElementById("boss-delete");
    if (deleteBtn) deleteBtn.style.display = "inline-block";
    
    // Parse existing respawn to determine schedule type
    const respawn = boss.respawn || "";
    scheduledTimes = [];
    
    const hasWeekday = /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i.test(respawn);
    if (hasWeekday) {
        document.getElementById("boss-schedule-type").value = "scheduled";
        const entries = respawn.split(",").map(t => t.trim());
        entries.forEach(entry => {
            const match = entry.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{2})/i);
            if (match) {
                scheduledTimes.push({
                    day: match[1],
                    hour: parseInt(match[2], 10),
                    minute: parseInt(match[3], 10)
                });
            }
        });
    } else if (/Hour/i.test(respawn)) {
        document.getElementById("boss-schedule-type").value = "unscheduled";
        const match = respawn.match(/(\d+)\s*Hour/i);
        const totalHours = match ? parseInt(match[1], 10) : 0;
        const days = Math.floor(totalHours / 24);
        const hours = totalHours % 24;
        document.getElementById("boss-respawn-days").value = days;
        document.getElementById("boss-respawn-hours").value = hours;
        document.getElementById("boss-respawn-minutes").value = 0;
    }
    
    toggleRespawnUI();
    renderScheduledInline();
    showBossModal(true);
}

function openAddBoss() {
    editingBossIndex = null;
    document.getElementById("boss-modal-title").textContent = "Add Boss";
    document.getElementById("boss-name").value = "";
    document.getElementById("boss-location").value = "";
    document.getElementById("boss-level").value = "";
    document.getElementById("boss-schedule-type").value = "";
    document.getElementById("boss-respawn-days").value = "0";
    document.getElementById("boss-respawn-hours").value = "0";
    document.getElementById("boss-respawn-minutes").value = "0";
    document.getElementById("boss-image").value = null;
    const deleteBtn = document.getElementById("boss-delete");
    if (deleteBtn) deleteBtn.style.display = "none";
    
    scheduledTimes = [];
    toggleRespawnUI();
    renderScheduledInline();
    showBossModal(true);
}

async function readImageFileAsDataURL(file) {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = err => reject(err);
        reader.readAsDataURL(file);
    });
}


// === WEEKLY RESPAWN EDITOR MODAL ===
function showRespawnEditorModal(show) {
    const modal = document.getElementById("respawn-editor-modal");
    if (!modal) return;
    modal.classList.toggle("hidden", !show);
}

function renderRespawnEditorModal() {
    const list = document.getElementById("respawn-times-list");
    if (!list) return;
    
    list.innerHTML = "";
    scheduledTimes.forEach((time, idx) => {
        const item = document.createElement("div");
        item.className = "respawn-time-item";
        
        // Day field wrapper
        const dayWrapper = document.createElement('div');
        dayWrapper.className = 'field-wrapper';

        const dayLabel = document.createElement('div');
        dayLabel.className = 'field-label';
        dayLabel.textContent = 'Day';

        const daySelect = document.createElement("select");
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].forEach(day => {
            const opt = document.createElement("option");
            opt.value = day;
            opt.textContent = day;
            if (time.day === day) opt.selected = true;
            daySelect.appendChild(opt);
        });
        daySelect.addEventListener("change", (e) => {
            scheduledTimes[idx].day = e.target.value;
        });
        
        const hourWrapper = document.createElement('div');
        hourWrapper.className = 'field-wrapper field-wrapper-small';

        const hourLabel = document.createElement('div');
        hourLabel.className = 'field-label';
        hourLabel.textContent = 'Hour';

        const hourInput = document.createElement("input");
        hourInput.type = "number";
        hourInput.min = "0";
        hourInput.max = "23";
        hourInput.value = time.hour;
        hourInput.placeholder = "HH";
        hourInput.dataset.idx = idx;
        hourInput.dataset.field = 'hour';
        hourInput.addEventListener("change", (e) => {
            const raw = e.target.value;
            if (raw === "") {
                // empty -> required
                scheduledTimes[idx].hour = null;
                showFieldError(idx, 'hour', 'This is a required field.');
            } else {
                const v = parseInt(raw, 10);
                if (isNaN(v) || v < 0 || v > 23) {
                    showFieldError(idx, 'hour', 'Hour must be 0–23');
                    scheduledTimes[idx].hour = Math.max(0, Math.min(23, v || 0));
                } else {
                    clearFieldError(idx, 'hour');
                    scheduledTimes[idx].hour = v;
                }
            }
            hourInput.value = scheduledTimes[idx].hour == null ? "" : scheduledTimes[idx].hour;
        });
        
        const minuteWrapper = document.createElement('div');
        minuteWrapper.className = 'field-wrapper field-wrapper-small';

        const minuteLabel = document.createElement('div');
        minuteLabel.className = 'field-label';
        minuteLabel.textContent = 'Minute';

        const minuteInput = document.createElement("input");
        minuteInput.type = "number";
        minuteInput.min = "0";
        minuteInput.max = "59";
        minuteInput.value = time.minute;
        minuteInput.placeholder = "MM";
        minuteInput.dataset.idx = idx;
        minuteInput.dataset.field = 'minute';
        minuteInput.addEventListener("change", (e) => {
            const raw = e.target.value;
            if (raw === "") {
                scheduledTimes[idx].minute = null;
                showFieldError(idx, 'minute', 'This is a required field.');
            } else {
                const v = parseInt(raw, 10);
                if (isNaN(v) || v < 0 || v > 59) {
                    showFieldError(idx, 'minute', 'Minute must be 0–59');
                    scheduledTimes[idx].minute = Math.max(0, Math.min(59, v || 0));
                } else {
                    clearFieldError(idx, 'minute');
                    scheduledTimes[idx].minute = v;
                }
            }
            minuteInput.value = scheduledTimes[idx].minute == null ? "" : scheduledTimes[idx].minute;
        });
        
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn-danger";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () => {
            scheduledTimes.splice(idx, 1);
            renderRespawnEditorModal();
        });
        // assemble wrappers: day, hour, minute
        const dayErr = document.createElement('div');
        dayErr.className = 'field-error-message';
        dayErr.id = `err-${idx}-day`;
        dayErr.style.display = 'none';

        const hourErr = document.createElement('div');
        hourErr.className = 'field-error-message';
        hourErr.id = `err-${idx}-hour`;
        hourErr.style.display = 'none';

        const minuteErr = document.createElement('div');
        minuteErr.className = 'field-error-message';
        minuteErr.id = `err-${idx}-minute`;
        minuteErr.style.display = 'none';

        dayWrapper.appendChild(dayLabel);
        dayWrapper.appendChild(daySelect);
        dayWrapper.appendChild(dayErr);

        hourWrapper.appendChild(hourLabel);
        hourWrapper.appendChild(hourInput);
        hourWrapper.appendChild(hourErr);

        minuteWrapper.appendChild(minuteLabel);
        minuteWrapper.appendChild(minuteInput);
        minuteWrapper.appendChild(minuteErr);

        item.appendChild(dayWrapper);
        item.appendChild(hourWrapper);
        item.appendChild(minuteWrapper);
        item.appendChild(removeBtn);
        list.appendChild(item);
    });
}

function showFieldError(idx, field, msg) {
    const id = `err-${idx}-${field}`;
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg || 'This is a required field.';
        el.style.display = 'block';
        // add error class to input/select
        const container = el.parentElement;
        const inputs = container.querySelectorAll('input, select');
        inputs.forEach(i => {
            if (i.dataset && i.dataset.field === field) i.classList.add('field-error');
        });
    }
}

function clearFieldError(idx, field) {
    const id = `err-${idx}-${field}`;
    const el = document.getElementById(id);
    if (el) {
        el.textContent = '';
        el.style.display = 'none';
        const container = el.parentElement;
        const inputs = container.querySelectorAll('input, select');
        inputs.forEach(i => {
            if (i.dataset && i.dataset.field === field) i.classList.remove('field-error');
        });
    }
}

function validateScheduledTimes() {
    // returns true if valid; shows field errors
    let ok = true;
    scheduledTimes.forEach((t, idx) => {
        if (t.hour === null || t.hour === undefined) {
            showFieldError(idx, 'hour', 'This is a required field.');
            ok = false;
        } else if (typeof t.hour !== 'number' || t.hour < 0 || t.hour > 23) {
            showFieldError(idx, 'hour', 'Hour must be 0–23');
            ok = false;
        } else clearFieldError(idx, 'hour');

        if (t.minute === null || t.minute === undefined) {
            showFieldError(idx, 'minute', 'This is a required field.');
            ok = false;
        } else if (typeof t.minute !== 'number' || t.minute < 0 || t.minute > 59) {
            showFieldError(idx, 'minute', 'Minute must be 0–59');
            ok = false;
        } else clearFieldError(idx, 'minute');
    });
    return ok;
}

function showRespawnEditorError(msg) {
    const el = document.getElementById('respawn-editor-errors');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.innerHTML = `<div>${msg}</div>`;
    el.style.display = 'block';
}

function clearRespawnEditorError() {
    showRespawnEditorError('');
}

function updateScheduledSummary() {
    const summary = document.getElementById("scheduled-summary");
    if (!summary) return;
    // Render active scheduled times inline similar to the sample UI.
    if (scheduledTimes.length === 0) {
        summary.innerHTML = `<div class="rp-pill">No times set</div>`;
    } else {
        // show first time inline box (matches sample). Additional times shown in modal editor.
        const t = scheduledTimes[0];
        const hour = t.hour == null ? '' : String(t.hour).padStart(2, '0');
        const minute = t.minute == null ? '' : String(t.minute).padStart(2, '0');
        const displayDay = dayToName(t.day || t.weekday) || '';
        summary.innerHTML = `
            <div class="scheduled-summary-box">
                <div class="scheduled-header-row">
                    <div class="scheduled-header day-header">Day</div>
                    <div class="scheduled-header hour-header">Hours</div>
                    <div class="scheduled-header minute-header">Minutes</div>
                    <div class="scheduled-header edit-header"></div>
                </div>
                <div class="scheduled-row">
                    <div class="scheduled-col day-col"><div class="scheduled-pill">${displayDay}</div></div>
                    <div class="scheduled-col hour-col"><div class="scheduled-pill">${hour}</div></div>
                    <div class="scheduled-col minute-col"><div class="scheduled-pill">${minute}</div></div>
                    <div class="scheduled-col"><button id="inline-edit-scheduled" class="scheduled-edit-btn">Edit</button></div>
                </div>
            </div>
        `;

        // rebind inline edit button to open editor modal
        const inlineEdit = document.getElementById('inline-edit-scheduled');
        if (inlineEdit) {
            inlineEdit.addEventListener('click', () => {
                respawnEditorOriginal = JSON.stringify(scheduledTimes || []);
                renderRespawnEditorModal();
                showRespawnEditorModal(true);
            });
        }
    }
}

// Wire modal buttons
document.addEventListener("DOMContentLoaded", () => {
    const addBtn = document.getElementById("addBossBtn");
    if (addBtn) addBtn.addEventListener("click", openAddBoss);

    const saveBtn = document.getElementById("boss-save");
    if (saveBtn) saveBtn.addEventListener("click", saveBossFromModal);

    const cancelBtn = document.getElementById("boss-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", () => showBossModal(false));

    const delBtn = document.getElementById("boss-delete");
    if (delBtn) {
        delBtn.addEventListener("click", () => {
            // show inline confirmation area
            const conf = document.getElementById('boss-delete-confirm');
            if (conf) conf.style.display = 'block';
        });
    }

    const scheduleTypeSelect = document.getElementById("boss-schedule-type");
    if (scheduleTypeSelect) scheduleTypeSelect.addEventListener("change", toggleRespawnUI);

    // Weekly respawn editor modal events
    const editScheduledBtn = document.getElementById("edit-scheduled-times");
    if (editScheduledBtn) {
        editScheduledBtn.addEventListener("click", () => {
            // snapshot current scheduled times to detect unsaved changes
            respawnEditorOriginal = JSON.stringify(scheduledTimes || []);
            renderRespawnEditorModal();
            showRespawnEditorModal(true);
        });
    }

    const addRespawnTimeBtn = document.getElementById("add-respawn-time");
    if (addRespawnTimeBtn) {
        addRespawnTimeBtn.addEventListener("click", () => {
            clearRespawnEditorError();
            if (scheduledTimes.length >= 3) {
                showRespawnEditorError('Maximum of 3 scheduled times allowed');
                return;
            }
            scheduledTimes.push({ day: "Monday", hour: 12, minute: 0 });
            renderRespawnEditorModal();
        });
    }

    const respawnSaveBtn = document.getElementById("respawn-save");
    if (respawnSaveBtn) {
        respawnSaveBtn.addEventListener("click", () => {
            clearRespawnEditorError();
            if (scheduledTimes.length === 0) {
                showRespawnEditorError('Please add at least one scheduled time');
                return;
            }
            if (scheduledTimes.length > 3) {
                showRespawnEditorError('Maximum of 3 scheduled times allowed');
                return;
            }
            // validate per-field values and save
            if (!validateScheduledTimes()) {
                showRespawnEditorError('Please fix the highlighted fields');
                return;
            }
            updateScheduledSummary();
            respawnEditorOriginal = null;
            showRespawnEditorModal(false);
        });
    }

    const respawnCancelBtn = document.getElementById("respawn-cancel");
    if (respawnCancelBtn) {
        respawnCancelBtn.addEventListener("click", () => {
            const current = JSON.stringify(scheduledTimes || []);
            if (respawnEditorOriginal && current !== respawnEditorOriginal) {
                // revert silently to original values
                scheduledTimes = JSON.parse(respawnEditorOriginal || '[]');
            }
            respawnEditorOriginal = null;
            showRespawnEditorModal(false);
        });
    }
});

// Wire inline delete confirm buttons
document.addEventListener('DOMContentLoaded', () => {
    const yes = document.getElementById('boss-delete-confirm-yes');
    const no = document.getElementById('boss-delete-confirm-no');
    if (no) no.addEventListener('click', () => {
        const conf = document.getElementById('boss-delete-confirm');
        if (conf) conf.style.display = 'none';
    });
    if (yes) yes.addEventListener('click', async () => {
        // Perform deletion without native confirm
        await deleteBossFromModal(true);
    });

    // Wire add scheduled time button in modal to our inline add function
    const addSched = document.getElementById('add-scheduled-time');
    if (addSched) addSched.addEventListener('click', () => {
        if (scheduledTimes.length >= 10) return; // safety cap
        scheduledTimes.push({ day: 'Monday', hour: 12, minute: 0 });
        renderScheduledInline();
    });
});

