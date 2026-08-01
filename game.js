// ===== Stardust Tycoon =====
// Idle/clicker game. State persists in localStorage so progress survives refresh.

const SAVE_KEY = "stardustTycoonSave";

// Upgrade definitions. cost grows 1.15x per owned copy.
// unlockAt = lifetime stardust (totalMined) required before it appears in the shop.
const UPGRADES = [
  { id: "drone",      name: "Stardust Drone",        desc: "+1 ✦/sec",       baseCost: 15,      cps: 1,        unlockAt: 0 },
  { id: "fingers",    name: "Stardust Fingers",      desc: "+1 per click",   baseCost: 50,      cps: 0, clickAdd: 1, unlockAt: 0 },
  { id: "rig",        name: "Mining Rig",            desc: "+10 ✦/sec",      baseCost: 120,     cps: 10,       unlockAt: 0 },
  { id: "planet",     name: "Mining Planet",         desc: "+50 ✦/sec",      baseCost: 1300,    cps: 50,       unlockAt: 0 },
  { id: "fleet",      name: "Mining Fleet",          desc: "+100 ✦/sec",     baseCost: 14000,   cps: 100,      unlockAt: 0 },
  { id: "galaxy",     name: "Galaxy Forge",          desc: "+1000 ✦/sec",    baseCost: 200000,  cps: 1000,     unlockAt: 0 },
  { id: "multiverse", name: "Multiverse Harvester",  desc: "+1500 ✦/sec",    baseCost: 3300000, cps: 1500,     unlockAt: 0 },
  // New tiers unlock as you play (lifetime totalMined based):
  { id: "blackhole",  name: "Black Hole",            desc: "+10k ✦/sec",     baseCost: 50000000,      cps: 10000,     unlockAt: 1000000 },
  { id: "quasar",     name: "Quasar",                desc: "+100k ✦/sec",    baseCost: 500000000,     cps: 100000,    unlockAt: 10000000 },
  { id: "cosmic",     name: "Cosmic Witness",        desc: "+1M ✦/sec",      baseCost: 5000000000,    cps: 1000000,   unlockAt: 100000000 },
  { id: "omniverse",  name: "Omniverse",             desc: "+10M ✦/sec",     baseCost: 50000000000,   cps: 10000000,  unlockAt: 1000000000 },
  { id: "singularity",name: "Singularity",           desc: "+100M ✦/sec",    baseCost: 500000000000,  cps: 100000000, unlockAt: 10000000000 },
  // Click-power tiers (bigger +per click)
  { id: "rfingers",    name: "Reinforced Fingers",    desc: "+5 per click",   baseCost: 5000,          cps: 0, clickAdd: 5,   unlockAt: 0 },
  { id: "mfingers",    name: "Mecha Fingers",         desc: "+50 per click",  baseCost: 500000,        cps: 0, clickAdd: 50,  unlockAt: 0 },
  // Production multipliers (+% to ALL stardust, permanent, paid in stardust)
  { id: "amp1",        name: "Stardust Amplifier",    desc: "+5% production", baseCost: 100000,        cps: 0, mult: 0.05,   unlockAt: 0 },
  { id: "amp2",        name: "Nebula Amplifier",      desc: "+15% production",baseCost: 5000000,       cps: 0, mult: 0.15,   unlockAt: 100000 },
  { id: "amp3",        name: "Cosmic Amplifier",      desc: "+50% production",baseCost: 500000000,     cps: 0, mult: 0.5,    unlockAt: 10000000 },
];

const state = {
  stardust: 0,
  totalMined: 0,
  clickCount: 0,
  owned: {},        // id -> count
  prestige: 0,      // number of prestiges; +0.1x production each
  achieved: {},     // achievement id -> true (one-time claimed)
};

let buyQty = "1"; // "1" | "10" | "100" | "max"
let resetPending = false; // true briefly during a reset so autosave can't clobber it

// Fresh default save (used by reset).
function defaultState() {
  return { stardust: 0, totalMined: 0, clickCount: 0, owned: {}, prestige: 0, achieved: {} };
}


// Format big numbers nicely (k, M, B, T...)
function fmt(n) {
  if (n < 1000) return Math.floor(n).toString();
  const units = ["", "k", "M", "B", "T", "Qa", "Qi"];
  let u = 0;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return n.toFixed(2) + units[u];
}

const PRESTIGE_REQ = 1e7; // 10,000,000 stardust needed to prestige, every time
function prestigeMult() { return 1 + 0.1 * state.prestige; }
function productionMult() {
  let m = 1;
  for (const up of UPGRADES) if (up.mult) m += (state.owned[up.id] || 0) * up.mult;
  return m * prestigeMult();
}
function canPrestige() { return state.stardust >= PRESTIGE_REQ; }

function upgradeCost(up) {
  const count = state.owned[up.id] || 0;
  return Math.ceil(up.baseCost * Math.pow(1.15, count));
}

// Cost to buy `k` copies of `up`, starting from `startOwned`.
function batchCost(up, k, startOwned) {
  let total = 0;
  let mult = Math.pow(1.15, startOwned);
  for (let i = 0; i < k; i++) { total += up.baseCost * mult; mult *= 1.15; }
  return Math.ceil(total);
}

// How many copies of `up` we can afford with `budget`, starting from `startOwned`.
function maxAffordable(up, startOwned, budget) {
  let k = 0, cost = 0;
  let mult = Math.pow(1.15, startOwned);
  while (k < 100000) {
    const next = up.baseCost * mult;
    if (cost + next > budget) break;
    cost += next; mult *= 1.15; k++;
  }
  return { k, cost: Math.ceil(cost) };
}

function cps() {
  let total = 0;
  for (const up of UPGRADES) total += (state.owned[up.id] || 0) * (up.cps || 0);
  return total * productionMult();
}

// Stardust earned per manual click = (1 + clickAdd total) * productionMult.
function clickPowerValue() {
  let p = 1;
  for (const up of UPGRADES) if (up.clickAdd) p += (state.owned[up.id] || 0) * up.clickAdd;
  return p * productionMult();
}

// ===== Achievements =====
// Each grants a one-time stardust bonus when its condition first becomes true.
// cond(state) -> boolean. reward is added once.
const ACHIEVEMENTS = [
  { id: "first100",   name: "Pocket Change",       desc: "Mine 100 ✦ total",        reward: 50,       cond: s => s.totalMined >= 100 },
  { id: "first1k",    name: "Stardust Saver",      desc: "Mine 1k ✦ total",         reward: 500,      cond: s => s.totalMined >= 1000 },
  { id: "first1M",    name: "Millionaire",         desc: "Mine 1M ✦ total",         reward: 50000,    cond: s => s.totalMined >= 1e6 },
  { id: "first1B",    name: "Billionaire",         desc: "Mine 1B ✦ total",         reward: 5e7,      cond: s => s.totalMined >= 1e9 },
  { id: "clicks100",  name: "Clicker",             desc: "Click 100 times",         reward: 100,      cond: s => s.clickCount >= 100 },
  { id: "clicks10k",  name: "Click Frenzy",        desc: "Click 10,000 times",      reward: 10000,    cond: s => s.clickCount >= 10000 },
  { id: "drone10",    name: "Drone Fleet",         desc: "Own 10 Drones",           reward: 200,      cond: s => (s.owned.drone||0) >= 10 },
  { id: "galaxy1",    name: "Forge Master",        desc: "Own a Galaxy Forge",      reward: 2000,     cond: s => (s.owned.galaxy||0) >= 1 },
  { id: "prestige1",  name: "Ascended",            desc: "Prestige once",           reward: 1e6,      cond: s => s.prestige >= 1 },
  { id: "prestige5",  name: "Cosmic Being",        desc: "Prestige 5 times",        reward: 5e7,      cond: s => s.prestige >= 5 },
];

let toastQueue = [];
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (!state.achieved[a.id] && a.cond(state)) {
      state.achieved[a.id] = true;
      state.stardust += a.reward;
      state.totalMined += a.reward;
      toastQueue.push("🏆 " + a.name + "  +" + fmt(a.reward) + " ✦");
    }
  }
}

// ===== Rendering =====
const el = {
  stardust: document.getElementById("stardust"),
  rate: document.getElementById("rate"),
  shopList: document.getElementById("shopList"),
  totalMined: document.getElementById("totalMined"),
  clickCount: document.getElementById("clickCount"),
  perClick: document.getElementById("perClick"),
  prestigeBonus: document.getElementById("prestigeBonus"),
  prestigeBtn: document.getElementById("prestigeBtn"),
  achievementsList: document.getElementById("achievementsList"),
};

// Build the shop ONCE. After that we only mutate text/classes in place,
// so rapid clicking never waits on a full DOM rebuild.
const shopRefs = {};

function buildShop() {
  el.shopList.innerHTML = document.createElement("div"); // ensure container
  el.shopList.innerHTML = "";
  for (const up of UPGRADES) {
    const item = document.createElement("div");
    item.className = "shopItem";
    item.innerHTML = `
      <div class="info">
        <div class="name">${up.name}</div>
        <div class="desc">${up.desc}</div>
        <div class="owned">Owned: 0</div>
      </div>
      <button data-id="${up.id}">0 ✦</button>`;
    const btn = item.querySelector("button");
    btn.addEventListener("click", () => buy(up));
    el.shopList.appendChild(item);
    shopRefs[up.id] = { item, owned: item.querySelector(".owned"), btn };
  }
}

function updateShop() {
  for (const up of UPGRADES) {
    const ref = shopRefs[up.id];
    const owned = state.owned[up.id] || 0;
    const unlocked = state.totalMined >= up.unlockAt;

    ref.item.classList.toggle("locked", !unlocked);
    if (!unlocked) {
      ref.owned.textContent = "Unlocks at " + fmt(up.unlockAt) + " ✦";
      ref.btn.textContent = "🔒 Locked";
      ref.btn.disabled = true;
      ref.btn.classList.remove("affordable");
      continue;
    }

    let k;
    if (buyQty === "max") k = maxAffordable(up, owned, state.stardust).k;
    else k = Math.min(Number(buyQty), maxAffordable(up, owned, state.stardust).k);

    const canAfford = k > 0;
    const cost = canAfford ? batchCost(up, k, owned) : upgradeCost(up);

    ref.owned.textContent = "Owned: " + owned;
    if (canAfford) {
      const prefix = buyQty === "max" ? "Max x" + k : "x" + buyQty;
      ref.btn.textContent = prefix + " (" + fmt(cost) + " ✦)";
    } else {
      ref.btn.textContent = fmt(cost) + " ✦";
    }
    ref.btn.disabled = !canAfford;
    ref.btn.classList.toggle("affordable", canAfford);
  }
}

function renderHUD() {
  el.stardust.textContent = fmt(state.stardust) + " ✦";
  el.rate.textContent = fmt(cps()) + " ✦/sec";
  el.totalMined.textContent = fmt(state.totalMined);
  el.clickCount.textContent = state.clickCount;
  el.perClick.textContent = fmt(clickPowerValue() * prestigeMult());
  el.prestigeBonus.textContent = "+" + Math.round((prestigeMult() - 1) * 100) + "% (P" + state.prestige + ")";
  const nextPct = Math.round(0.1 * (state.prestige + 1) * 100);
  if (canPrestige()) {
    el.prestigeBtn.textContent = "Prestige ↻ (next: +" + nextPct + "%)";
    el.prestigeBtn.disabled = false;
    el.prestigeBtn.classList.add("ready");
  } else {
    el.prestigeBtn.textContent = "Prestige ↻ (need " + fmt(PRESTIGE_REQ) + " ✦)";
    el.prestigeBtn.disabled = true;
    el.prestigeBtn.classList.remove("ready");
  }
}

function render() {
  renderHUD();
  updateShop();
  renderAchievements();
  showToasts();
}

function renderAchievements() {
  if (!el.achievementsList) return;
  let unlocked = 0;
  let html = "";
  for (const a of ACHIEVEMENTS) {
    const got = !!state.achieved[a.id];
    if (got) unlocked++;
    html += `<div class="ach ${got ? "got" : "locked"}" title="${a.desc}">
      <span class="achName">${got ? "🏆" : "🔒"} ${a.name}</span>
      <span class="achDesc">${a.desc}</span>
      <span class="achReward">+${fmt(a.reward)} ✦</span>
    </div>`;
  }
  el.achievementsList.innerHTML = `<div class="achHeader">Achievements ${unlocked}/${ACHIEVEMENTS.length}</div>` + html;
}

// Toast popups for newly-earned achievements.
let toastEls = [];
function showToasts() {
  if (toastQueue.length === 0) return;
  const wrap = document.getElementById("toasts");
  while (toastQueue.length) {
    const msg = toastQueue.shift();
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); }, 2600);
    setTimeout(() => t.remove(), 3100);
  }
}

function buy(up) {
  if (state.totalMined < up.unlockAt) return;
  const owned = state.owned[up.id] || 0;
  let k;
  if (buyQty === "max") k = maxAffordable(up, owned, state.stardust).k;
  else k = Math.min(Number(buyQty), maxAffordable(up, owned, state.stardust).k);
  if (k <= 0) return;
  const cost = batchCost(up, k, owned);
  state.stardust -= cost;
  state.owned[up.id] = owned + k;
  save();
  render();
}

// ===== Sound (Web Audio API, no external file) =====
let soundOn = true;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playClick() {
  if (!soundOn) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(620, t);
  o.frequency.exponentialRampToValueAtTime(960, t + 0.05);
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t);
  o.stop(t + 0.1);
}

document.getElementById("soundBtn").addEventListener("click", () => {
  soundOn = !soundOn;
  document.getElementById("soundBtn").textContent = soundOn ? "🔊" : "🔇";
  if (soundOn) playClick();
});

// Buy-quantity selector
document.querySelectorAll("#buyQty button").forEach((b) => {
  b.addEventListener("click", () => {
    buyQty = b.dataset.qty;
    document.querySelectorAll("#buyQty button").forEach((x) => x.classList.toggle("active", x === b));
    render();
  });
});

// Floating "+N" number at click position
function spawnFloater(x, y, amount) {
  const clicker = document.getElementById("clicker");
  const rect = clicker.getBoundingClientRect();
  const f = document.createElement("div");
  f.className = "floater";
  f.textContent = "+" + fmt(amount);
  f.style.left = (x - rect.left) + "px";
  f.style.top = (y - rect.top) + "px";
  clicker.appendChild(f);
  f.addEventListener("animationend", () => f.remove());
}

// ===== Game loop =====
function tick() {
  const gain = cps() * (1 / 10); // 10 ticks/sec
  state.stardust += gain;
  state.totalMined += gain;
  checkAchievements();
}

document.getElementById("mineBtn").addEventListener("click", (e) => {
  const gain = clickPowerValue() * prestigeMult();
  state.stardust += gain;
  state.totalMined += gain;
  state.clickCount++;
  playClick();
  spawnFloater(e.clientX, e.clientY, gain);
  const btn = document.getElementById("mineBtn");
  btn.classList.remove("pop");
  void btn.offsetWidth; // restart animation
  btn.classList.add("pop");
  render();
});

document.getElementById("resetBtn").addEventListener("click", () => {
  if (!confirm("Reset ALL progress (including prestige)?")) return;
  // Wipe the saved game and reset the in-memory state to defaults.
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem("st_lastSeen");
  Object.assign(state, defaultState());
  // Flag so the beforeunload autosave can't restore the old data.
  resetPending = true;
  location.reload();
});

el.prestigeBtn.addEventListener("click", () =>{
  if (!canPrestige()) {
    alert("You need " + fmt(PRESTIGE_REQ) + " ✦ to prestige.");
    return;
  }
  const nextPct = Math.round(0.1 * (state.prestige + 1) * 100);
  if (confirm("Prestige now? Costs " + fmt(PRESTIGE_REQ) + " ✦ and resets stardust + upgrades, but grants +" + nextPct + "% permanent production. Total after: +" + nextPct + "%.")) {
    state.prestige += 1;
    state.stardust = 0;
    state.owned = {};
    state.clickCount = 0;
    save();
    render();
  }
});

// ===== Save / load =====
function save() {
  if (resetPending) return; // don't persist state during a reset/reload
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function load() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    Object.assign(state, data);
    state.owned = data.owned || {};
    state.prestige = data.prestige || 0;
  } catch (e) {
    console.warn("Save load failed:", e);
  }
}

// Offline progress: reward up to 8 hours away.
function applyOfflineProgress() {
  const last = Number(localStorage.getItem("st_lastSeen") || 0);
  const now = Date.now();
  if (last) {
    const secs = Math.min((now - last) / 1000, 8 * 3600);
    const gain = cps() * secs;
    if (gain > 0) {
      state.stardust += gain;
      state.totalMined += gain;
    }
  }
  localStorage.setItem("st_lastSeen", now);
}

// ===== Boot =====
load();
applyOfflineProgress();
buildShop();
checkAchievements();
render();

setInterval(() => { tick(); render(); }, 100); // 10 fps logic
setInterval(save, 5000); // autosave
window.addEventListener("beforeunload", save);
