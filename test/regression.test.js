// Regression tests for Stardust Tycoon (game.js).
//
// Zero dependencies: uses Node's built-in `node:test` + `node:assert`.
// Run with:  node --test test/
//
// game.js is a browser script, so we load it inside a `new Function` wrapper
// with a minimal DOM/localStorage/window shim and grab its internals through
// an appended `module.exports`. Only the pieces under test (fmt, offline
// progress, shop build, core loop) are exercised — no real browser needed.

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test, beforeEach } = require("node:test");

// ---------------------------------------------------------------------------
// DOM / browser shim
// ---------------------------------------------------------------------------

const innerHTMLWrites = [];

function makeEl(id) {
  const listeners = {};
  return {
    id,
    innerHTML: "",
    textContent: "",
    className: "",
    disabled: false,
    dataset: {},
    children: [],
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelector() {
      return makeEl(id + ">" + Math.random());
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    remove() {},
    getBoundingClientRect() {
      return { left: 0, top: 0 };
    },
    get offsetWidth() {
      return 0;
    },
  };
}

// Keep a record of every innerHTML write so the #11 regression can prove the
// bogus "[object HTMLDivElement]" assignment no longer happens.
const elCache = new Map();
function getEl(id) {
  if (!elCache.has(id)) {
    const el = makeEl(id);
    let inner = "";
    Object.defineProperty(el, "innerHTML", {
      get: () => inner,
      set: (v) => {
        inner = String(v);
        // Real DOM semantics: clearing innerHTML removes children.
        if (inner === "") el.children.length = 0;
        innerHTMLWrites.push(String(v));
      },
    });
    elCache.set(id, el);
  }
  return elCache.get(id);
}

const localStorage = {
  store: new Map(),
  getItem(k) {
    return this.store.has(k) ? this.store.get(k) : null;
  },
  setItem(k, v) {
    this.store.set(k, String(v));
  },
  removeItem(k) {
    this.store.delete(k);
  },
  clear() {
    this.store.clear();
  },
};

class FakeAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.destination = {};
  }
  resume() {}
  createOscillator() {
    return {
      type: "",
      frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
      start() {},
      stop() {},
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    };
  }
}

global.document = {
  getElementById: getEl,
  createElement: (tag) => getEl("created:" + tag),
  querySelectorAll: () => [],
};
global.localStorage = localStorage;
global.window = {
  AudioContext: FakeAudioContext,
  webkitAudioContext: FakeAudioContext,
  addEventListener() {},
};
// Keep the game's boot loop/autosave from actually running during tests.
global.setInterval = () => 0;

// ---------------------------------------------------------------------------
// Load game.js and expose internals
// ---------------------------------------------------------------------------

const gamePath = path.join(__dirname, "..", "game.js");
const src = fs.readFileSync(gamePath, "utf8");
const footer =
  "\n;module.exports = { fmt, applyOfflineProgress, buildShop, buy, tick, loop, save, load, " +
  "state, UPGRADES, cps, productionMult, maxAffordable, batchCost, defaultState, SAVE_KEY, shopRefs };";

const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function("module", "exports", "require", src + footer)(mod, mod.exports, require);
const game = mod.exports;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let fakeNow = 1_000_000_000_000; // controlled "wall clock" for offline tests
beforeEach(() => {
  Object.assign(game.state, game.defaultState());
  game.state.owned = {};
  game.state.achieved = {};
  localStorage.clear();
  innerHTMLWrites.length = 0;
  fakeNow = 1_000_000_000_000;
  Date.now = () => fakeNow;
});

const HOUR_MS = 3600 * 1000;

// ---------------------------------------------------------------------------
// #10 — fmt() unit ladder past Qi
// ---------------------------------------------------------------------------

test("fmt: small numbers render as integers", () => {
  assert.strictEqual(game.fmt(0), "0");
  assert.strictEqual(game.fmt(999), "999");
});

test("fmt: ladder below Qi is unchanged", () => {
  assert.strictEqual(game.fmt(1500), "1.50k");
  assert.strictEqual(game.fmt(1e6), "1.00M");
  assert.strictEqual(game.fmt(1e12), "1.00T");
  assert.strictEqual(game.fmt(1e15), "1.00Qa");
  assert.strictEqual(game.fmt(1e18), "1.00Qi");
});

test("fmt: units above Qi render with the right scale (issue #10)", () => {
  assert.strictEqual(game.fmt(1e21), "1.00Sx");
  assert.strictEqual(game.fmt(1.5e21), "1.50Sx");
  assert.strictEqual(game.fmt(1e24), "1.00Sp");
  assert.strictEqual(game.fmt(1e27), "1.00Oc");
  assert.strictEqual(game.fmt(1e30), "1.00No");
  assert.strictEqual(game.fmt(1e33), "1.00Dc");
  assert.strictEqual(game.fmt(1e36), "1.00UDc");
  assert.strictEqual(game.fmt(1e48), "1.00QiDc");
});

// ---------------------------------------------------------------------------
// #9 — applyOfflineProgress() clock-rollback handling
// ---------------------------------------------------------------------------

function setCps(targetCps) {
  // Own enough Mining Rigs (+10 ✦/sec each) to hit targetCps with no
  // multipliers. Rigs are used (not drones) so tick() doesn't fire the
  // +200 "Drone Fleet" achievement and muddy exact assertions.
  game.state.owned = { rig: targetCps / 10 };
}

test("offline: pays the real gap and advances the timestamp", () => {
  setCps(10);
  localStorage.setItem("st_lastSeen", String(fakeNow - 2 * HOUR_MS));
  game.applyOfflineProgress();
  assert.strictEqual(game.state.stardust, 10 * 2 * 3600);
  assert.strictEqual(localStorage.getItem("st_lastSeen"), String(fakeNow));
});

test("offline: caps the payout at 8 hours", () => {
  setCps(10);
  localStorage.setItem("st_lastSeen", String(fakeNow - 20 * HOUR_MS));
  game.applyOfflineProgress();
  assert.strictEqual(game.state.stardust, 10 * 8 * 3600);
  assert.strictEqual(localStorage.getItem("st_lastSeen"), String(fakeNow));
});

test("offline: clock rollback is a no-op and does not poison st_lastSeen (issue #9)", () => {
  setCps(10);
  const lastGood = fakeNow;
  localStorage.setItem("st_lastSeen", String(lastGood));

  // Boot 1: clock rolled back 1h. No payout, and the good timestamp is kept.
  fakeNow = lastGood - HOUR_MS;
  game.applyOfflineProgress();
  assert.strictEqual(game.state.stardust, 0, "no payout on rollback");
  assert.strictEqual(
    localStorage.getItem("st_lastSeen"),
    String(lastGood),
    "rolled-back timestamp must not be written back"
  );

  // Boot 2: clock recovered, 1h of real time passed. Pays exactly the real gap.
  fakeNow = lastGood + HOUR_MS;
  game.applyOfflineProgress();
  assert.strictEqual(game.state.stardust, 10 * 3600, "pays only the real elapsed gap");
  assert.strictEqual(localStorage.getItem("st_lastSeen"), String(fakeNow));
});

test("offline: corrupt far-future timestamp self-heals instead of locking payouts", () => {
  setCps(10);
  localStorage.setItem("st_lastSeen", String(fakeNow + 100 * HOUR_MS)); // corrupt
  game.applyOfflineProgress();
  assert.strictEqual(game.state.stardust, 0);
  assert.strictEqual(localStorage.getItem("st_lastSeen"), String(fakeNow), "corrupt timestamp repaired");

  // A normal boot afterwards works again.
  fakeNow += 2 * HOUR_MS;
  game.applyOfflineProgress();
  assert.strictEqual(game.state.stardust, 10 * 2 * 3600);
});

test("offline: missing timestamp initializes without paying out", () => {
  setCps(10);
  game.applyOfflineProgress();
  assert.strictEqual(game.state.stardust, 0);
  assert.strictEqual(localStorage.getItem("st_lastSeen"), String(fakeNow));
});

// ---------------------------------------------------------------------------
// #11 — buildShop() dead code removal
// ---------------------------------------------------------------------------

test("shop: buildShop clears the list and never writes [object HTMLDivElement] (issue #11)", () => {
  game.buildShop();
  assert.strictEqual(Object.keys(game.shopRefs).length, game.UPGRADES.length);
  assert.ok(
    !innerHTMLWrites.includes("[object HTMLDivElement]"),
    "no bogus innerHTML assignment survives"
  );
  // Shop list container holds exactly one item per upgrade.
  assert.strictEqual(getEl("shopList").children.length, game.UPGRADES.length);
});

// ---------------------------------------------------------------------------
// Core loop still works (acceptance criterion)
// ---------------------------------------------------------------------------

test("core loop: tick accumulates cps and loop renders without throwing", () => {
  setCps(10);
  game.tick();
  assert.strictEqual(game.state.stardust, 10 * (1 / 10));
  assert.strictEqual(game.state.totalMined, 10 * (1 / 10));
  assert.doesNotThrow(() => game.loop());
});

test("core loop: buy() decrements stardust and increments owned", () => {
  game.state.stardust = 1_000_000;
  game.state.totalMined = 1_000_000;
  game.buy(game.UPGRADES[0]); // drone, baseCost 15
  assert.strictEqual(game.state.owned.drone, 1);
  assert.strictEqual(game.state.stardust, 1_000_000 - 15);
});

test("core loop: save/load round-trips state", () => {
  game.state.stardust = 12345;
  game.state.totalMined = 67890;
  game.state.owned = { drone: 7 };
  game.save();
  Object.assign(game.state, game.defaultState()); // wipe
  game.load();
  assert.strictEqual(game.state.stardust, 12345);
  assert.strictEqual(game.state.totalMined, 67890);
  assert.strictEqual(game.state.owned.drone, 7);
});
