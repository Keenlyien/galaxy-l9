// Redirect if not logged in
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
   MAIN RENDER
----------------------------- */

function renderBosses() {
    const container = document.getElementById("boss-container");
    container.innerHTML = "";

    bosses.forEach((boss, i) => {
        const hours = parseRespawnHours(boss.respawn);
        const weekly = parseWeeklyRespawns(boss.respawn);

        let timeLeft = 0;
        let status = "Alive";

        if (hours !== null) {
            const lastKill = localStorage.getItem("boss_kill_" + boss.name);

            if (lastKill) {
                const respawnMs = hours * 3600 * 1000;
                timeLeft = respawnMs - (Date.now() - parseInt(lastKill));
                status = timeLeft > 0 ? "Dead" : "Alive";
            }

        } else if (weekly) {
            const nextSpawn = getNextWeeklySpawn(weekly);
            timeLeft = nextSpawn - new Date();
            status = "Dead";
        }

        const card = document.createElement("div");
        card.className = `boss-card ${hours !== null ? (timeLeft > 0 ? "dead" : "alive") : "scheduled"}`;

        card.innerHTML = `
            <div class="boss-content">

                <div class="boss-left">
                    <div class="boss-title">${boss.name} <span style="opacity:0.8; font-size:16px;">(Lv. ${boss.level})</span></div>
                    <div class="boss-sub">${boss.location}</div>
                    <div class="boss-sub">Respawn: ${boss.respawn}</div>
                    <div class="timer" id="timer_${i}">
                        ${timeLeft > 0 ? formatTime(timeLeft) : "Alive"}
                    </div>

                    ${hours !== null ? `
                    <button class="datetime-picker-btn" onclick="openDTModal(${i})">
                        Pick Date & Time
                    </button>

                    <input type="datetime-local" class="datetime-input" id="dt_${i}">
                    <div class="datetime-display" id="dt_display_${i}">
                        No date selected
                    </div>
                    ` : ""}
                </div>

                <div class="boss-right">
                    <img src="${getBossImage(boss.name)}" class="boss-image">
                </div>

            </div>

            ${hours !== null ? `
            <div class="btn-row">
                <button class="btn kill-btn" onclick="killBoss(${i})">Kill</button>
                <button class="btn unkill-btn" onclick="unkillBoss(${i})">Unkill</button>
            </div>
            ` : ""}
        `;


        container.appendChild(card);

        if (timeLeft > 0) startTimer(i, timeLeft);
    });
}

function getBossImage(name) {
    const images = {
        "Venatus": "images/venatus.png",
        "Livera": "images/livera.png",
        "Lady Dalia": "images/lady_dalia.png",
        "Thymele": "images/thymele.png",
        "Baron Braudmore": "images/baron_braudmore.png",
        "Milavy": "images/milavy.png",
        "Wannitas": "images/wannitas.png",
        "Duplican": "images/duplican.png",
        "Shuliar": "images/shuliar.png",
        "Titore": "images/titore.png",
        "Larba": "images/larba.png",
        "Catena": "images/catena.png",
        "Auraq": "images/auraq.png",
        "Secreta": "images/secreta.png",
        "Ordo": "images/ordo.png",
        "Asta": "images/asta.png",
        "Chaiflock": "images/chaiflock.png",
        "Benji": "images/benji.png",
    };

    return images[name] || "images/default.png"; // fallback
}


/* -----------------------------
      DATE/TIME POPUP SYSTEM
----------------------------- */

let selectedBossIndex = null;
let modalDate = new Date();

function openDTModal(index) {
    selectedBossIndex = index;

    modalDate = new Date(); // reset default
    renderCalendar();

    document.getElementById("dt-modal").classList.remove("hidden");
}

function closeDTModal() {
    document.getElementById("dt-modal").classList.add("hidden");
}

/* ===== Calendar Rendering ===== */
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

/* ===== Time Dropdowns ===== */
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

/* ===== Month Navigation ===== */
document.getElementById("dt-prev-month").onclick = () => {
    modalDate.setMonth(modalDate.getMonth() - 1);
    renderCalendar();
};

document.getElementById("dt-next-month").onclick = () => {
    modalDate.setMonth(modalDate.getMonth() + 1);
    renderCalendar();
};

/* ===== Confirm Selection ===== */
function confirmDTSelection() {
    const hour = document.getElementById("dt-hour").value;
    const minute = document.getElementById("dt-minute").value;

    modalDate.setHours(hour);
    modalDate.setMinutes(minute);
    modalDate.setSeconds(0);

    const dtInput = document.getElementById(`dt_${selectedBossIndex}`);
    dtInput.value = modalDate.toISOString().slice(0, 16);

    const display = document.getElementById(`dt_display_${selectedBossIndex}`);
    display.textContent =
        modalDate.toLocaleDateString() + " " +
        modalDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    closeDTModal();
}

/* -----------------------------
   KILL / UNKILL
----------------------------- */

function killBoss(i) {
    const input = document.getElementById(`dt_${i}`);
    const killTime = input.value ? new Date(input.value).getTime() : Date.now();

    localStorage.setItem("boss_kill_" + bosses[i].name, killTime);
    renderBosses();
}

function unkillBoss(i) {
    localStorage.removeItem("boss_kill_" + bosses[i].name);
    renderBosses();
}

/* -----------------------------
   TIMER LOOP
----------------------------- */

function startTimer(id, timeLeft) {
    const timerEl = document.getElementById("timer_" + id);

    function tick() {
        if (!timerEl) return;

        if (timeLeft <= 0) {
            timerEl.textContent = "Alive";
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

