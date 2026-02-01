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

// -----------------------------
function showBossModal(show) {
    const modal = document.getElementById("boss-modal");
    if (!modal) return;
    if (show) modal.classList.remove("hidden");
    else modal.classList.add("hidden");
}

function openEditBoss(i) {
    editingBossIndex = i;
    const boss = bosses[i];
    document.getElementById("boss-modal-title").textContent = "Edit Boss";
    document.getElementById("boss-name").value = boss.name || "";
    document.getElementById("boss-location").value = boss.location || "";
    document.getElementById("boss-level").value = boss.level || "";
    document.getElementById("boss-respawn").value = boss.respawn || "";
    document.getElementById("boss-image").value = null;
    document.getElementById("boss-delete").style.display = "inline-block";
    showBossModal(true);
}

function openAddBoss() {
    editingBossIndex = null;
    document.getElementById("boss-modal-title").textContent = "Add Boss";
    document.getElementById("boss-name").value = "";
    document.getElementById("boss-location").value = "";
    document.getElementById("boss-level").value = "";
    document.getElementById("boss-respawn").value = "";
    document.getElementById("boss-image").value = null;
    document.getElementById("boss-delete").style.display = "none";
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

async function saveBossFromModal() {
    // Validation
    const name = document.getElementById("boss-name").value.trim();
    const location = document.getElementById("boss-location").value.trim();
    const level = document.getElementById("boss-level").value.trim();
    const scheduleType = document.getElementById("boss-schedule-type").value;
    const imgEl = document.getElementById("boss-image");

    if (!name) return alert("Name is required *");
    if (!location) return alert("Location is required *");
    if (!level) return alert("Level is required *");
    if (!scheduleType) return alert("Schedule Type is required *");

    // Check for duplicate boss name (only when creating new boss)
    if (editingBossIndex === null) {
        if (bosses.some(b => b.name.toLowerCase() === name.toLowerCase())) {
            return alert(`Boss "${name}" already exists. Choose a different name.`);
        }
    }

    // Build respawn string based on schedule type
    let respawn = "";
    if (scheduleType === "scheduled") {
        if (scheduledTimes.length === 0) return alert("Please add at least one scheduled time *");
        respawn = scheduledTimes.map(t => `${t.day} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`).join(", ");
    } else if (scheduleType === "unscheduled") {
        const days = parseInt(document.getElementById("boss-respawn-days").value, 10) || 0;
        const hours = parseInt(document.getElementById("boss-respawn-hours").value, 10) || 0;
        const minutes = parseInt(document.getElementById("boss-respawn-minutes").value, 10) || 0;
        const totalHours = days * 24 + hours;
        if (totalHours === 0 && minutes === 0) return alert("Respawn duration must be greater than 0 *");
        respawn = `${totalHours} Hour${minutes > 0 ? ` ${minutes} Minute` : ""}`;
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
        if (file.size > 4 * 1024 * 1024) return alert("Image must be 4MB or smaller");
        try {
            payload.imageData = await readImageFileAsDataURL(file);
        } catch (err) {
            console.error("Failed reading image:", err);
            return alert("Failed to read image file");
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
        alert("Failed to save boss: " + err.message);
    }
}

async function deleteBossFromModal() {
    if (editingBossIndex === null) return;
    const boss = bosses[editingBossIndex];
    if (!confirm(`Delete boss ${boss.name}? This cannot be undone.`)) return;
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
        alert("Failed to delete boss: " + err.message);
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
}

function toggleRespawnUI() {
    const scheduleType = document.getElementById("boss-schedule-type").value;
    const scheduledDiv = document.getElementById("scheduled-respawn");
    const unscheduledDiv = document.getElementById("unscheduled-respawn");
    
    if (scheduleType === "scheduled") {
        scheduledDiv?.classList.remove("hidden");
        unscheduledDiv?.classList.add("hidden");
        updateScheduledSummary();
    } else if (scheduleType === "unscheduled") {
        scheduledDiv?.classList.add("hidden");
        unscheduledDiv?.classList.remove("hidden");
    } else {
        scheduledDiv?.classList.add("hidden");
        unscheduledDiv?.classList.add("hidden");
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
    renderScheduledTimesList();
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
        
        const hourInput = document.createElement("input");
        hourInput.type = "number";
        hourInput.min = "0";
        hourInput.max = "23";
        hourInput.value = time.hour;
        hourInput.placeholder = "HH";
        hourInput.addEventListener("change", (e) => {
            scheduledTimes[idx].hour = Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0));
            hourInput.value = scheduledTimes[idx].hour;
        });
        
        const minuteInput = document.createElement("input");
        minuteInput.type = "number";
        minuteInput.min = "0";
        minuteInput.max = "59";
        minuteInput.value = time.minute;
        minuteInput.placeholder = "MM";
        minuteInput.addEventListener("change", (e) => {
            scheduledTimes[idx].minute = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
            minuteInput.value = scheduledTimes[idx].minute;
        });
        
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn-danger";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () => {
            scheduledTimes.splice(idx, 1);
            renderRespawnEditorModal();
        });
        
        item.appendChild(daySelect);
        item.appendChild(hourInput);
        item.appendChild(minuteInput);
        item.appendChild(removeBtn);
        list.appendChild(item);
    });
}

function updateScheduledSummary() {
    const summary = document.getElementById("scheduled-summary");
    if (!summary) return;
    
    if (scheduledTimes.length === 0) {
        summary.textContent = "No times set";
    } else {
        summary.textContent = scheduledTimes
            .map(t => `${t.day} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`)
            .join(", ");
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
    if (delBtn) delBtn.addEventListener("click", deleteBossFromModal);

    const scheduleTypeSelect = document.getElementById("boss-schedule-type");
    if (scheduleTypeSelect) scheduleTypeSelect.addEventListener("change", toggleRespawnUI);

    // Weekly respawn editor modal events
    const editScheduledBtn = document.getElementById("edit-scheduled-times");
    if (editScheduledBtn) {
        editScheduledBtn.addEventListener("click", () => {
            renderRespawnEditorModal();
            showRespawnEditorModal(true);
        });
    }

    const addRespawnTimeBtn = document.getElementById("add-respawn-time");
    if (addRespawnTimeBtn) {
        addRespawnTimeBtn.addEventListener("click", () => {
            scheduledTimes.push({ day: "Monday", hour: 12, minute: 0 });
            renderRespawnEditorModal();
        });
    }

    const respawnSaveBtn = document.getElementById("respawn-save");
    if (respawnSaveBtn) {
        respawnSaveBtn.addEventListener("click", () => {
            updateScheduledSummary();
            showRespawnEditorModal(false);
        });
    }

    const respawnCancelBtn = document.getElementById("respawn-cancel");
    if (respawnCancelBtn) {
        respawnCancelBtn.addEventListener("click", () => {
            showRespawnEditorModal(false);
        });
    }
});

