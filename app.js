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

// Load from server (force no-cache) and sync localStorage
async function loadBossStatusFromDB() {
    try {
        const res = await fetch("/api/getBosses", { cache: "no-store" });
        if (!res.ok) {
            console.error("getBosses failed:", res.status, await res.text());
            return;
        }
        const dbBosses = await res.json();

        dbBosses.forEach(d => {
            // Use last_killed (DB field). Accept either `last_killed` or `status` for compatibility.
            const serverVal = d.last_killed ?? d.status ?? null;

            if (serverVal) {
                // If serverVal is a Date string, convert to number; if it's number already, keep it.
                const ts = typeof serverVal === "string" ? Date.parse(serverVal) : Number(serverVal);
                if (!isNaN(ts)) {
                    localStorage.setItem("boss_kill_" + d.name, String(ts));
                } else {
                    // If parsing failed, remove key to treat as alive
                    localStorage.removeItem("boss_kill_" + d.name);
                }
            } else {
                localStorage.removeItem("boss_kill_" + d.name);
            }
        });

        // Re-render using updated localStorage values
        renderBosses();
    } catch (err) {
        console.error("Failed loading from DB:", err);
    }
}

// Poll server every 5 seconds (keep this)
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

if (localStorage.getItem("logged_in") !== "true") {
    window.location.href = "index.html";
}

function logout() {
    localStorage.removeItem("logged_in");
    window.location.href = "index.html";
}

let bosses = [];

// Load bosses.json
fetch("bosses.json")
    .then(res => res.json())
    .then(data => {
        bosses = data;
        renderBosses();
    });

/* -----------------------------
   PARSING HELPERS
----------------------------- */

function parseRespawnHours(text) {
    const match = text.match(/(\d+)\s*Hour/);
    return match ? parseInt(match[1], 10) : null;
}

function parseWeeklyRespawns(text) {
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
    const today = now.getDay();
    const nowMs = now.getTime();

    let soonest = null;

    schedule.forEach(item => {
        const targetDay = weekdayToIndex(item.weekday);
        const date = new Date(now);

        let diff = targetDay - today;
        if (diff < 0) diff += 7;

        date.setDate(now.getDate() + diff);
        date.setHours(item.hour, item.minute, 0, 0);

        if (date.getTime() <= nowMs) {
            date.setDate(date.getDate() + 7);
        }

        if (!soonest || date < soonest) soonest = date;
    });

    return soonest;
}

/* -----------------------------
   MAIN RENDER (PATCHED LOGIC)
----------------------------- */

function renderBosses() {
    const container = document.getElementById("boss-container");
    container.innerHTML = "";

    const now = Date.now(); // Capture current time once per render

    bosses.forEach((boss, i) => {
        const hours = parseRespawnHours(boss.respawn);
        const weekly = parseWeeklyRespawns(boss.respawn);

        let timeLeft = 0;
        let status = "Alive";

        // Get server-synced last_killed from localStorage
        const lastKill = parseInt(localStorage.getItem("boss_kill_" + boss.name), 10);

        if (hours !== null) {
            if (lastKill) {
                const respawnMs = hours * 3600 * 1000;
                let elapsed = now - lastKill; // difference from server timestamp
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
                    <img src="${getBossImage(boss.name)}" class="boss-image">
                </div>
            </div>

            ${hours !== null ? `
            <div class="btn-row">
                <button class="btn kill-btn" data-boss="${boss.name}" onclick="killBoss(${i})">${LANG[currentLang].kill}</button>
                <button class="btn unkill-btn" onclick="unkillBoss(${i})">${LANG[currentLang].unkill}</button>
            </div>
            ` : ""}
        `;

        container.appendChild(card);

        if (timeLeft > 0) startTimer(i, timeLeft); // start countdown from server timestamp
    });
}


/* -----------------------------
   IMAGE SUPPORT
----------------------------- */

function getBossImage(name) {
    const images = {
        "Venatus": "images/Venatus.png",
        "Livera": "images/Livera.png",
        "Lady Dalia": "images/Lady_Dalia.png",
        "Thymele": "images/Thymele.png",
        "Baron Braudmore": "images/Baron_Braudmore.png",
        "Milavy": "images/Milavy.png",
        "Wannitas": "images/Wannitas.png",
        "Duplican": "images/Duplican.png",
        "Shuliar": "images/Shuliar.png",
        "Titore": "images/Titore.png",
        "Larba": "images/Larba.png",
        "Catena": "images/Catena.png",
        "Auraq": "images/Auraq.png",
        "Secreta": "images/Secreta.png",
        "Ordo": "images/Ordo.png",
        "Asta": "images/Asta.png",
        "Chaiflock": "images/Chaiflock.png",
        "Benji": "images/Benji.png",
    };

    return images[name] || "images/default.png";
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


