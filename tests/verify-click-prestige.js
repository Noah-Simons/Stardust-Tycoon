#!/usr/bin/env node
// Regression check for Issue #1: prestige must not be double-applied to clicks.
//
// clickPowerValue() already ends with `* productionMult()`, and productionMult()
// already includes `* prestigeMult()`. Before the fix, the click handler and the
// per-click HUD multiplied by prestigeMult() a second time, so each click awarded
// prestige-squared stardust.
//
// This script loads the real game.js in a stubbed browser DOM, fires the real
// mineBtn click handler, and asserts the stardust gained equals clickPowerValue()
// exactly (prestige applied exactly once).
//
// Run: node tests/verify-click-prestige.js
// Exit 0 = PASS (prestige applied once), exit 1 = FAIL (double-count reproduced),
// exit 2 = environment/setup error.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---- Minimal DOM/browser stubs -------------------------------------------------

function makeEl() {
  return {
    textContent: "",
    innerHTML: "",
    className: "",
    disabled: false,
    offsetWidth: 1,
    style: { setProperty() {} },
    dataset: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); },
    },
    listeners: {},
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    appendChild() {},
    remove() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
  };
}

const byId = {};
const documentStub = {
  getElementById(id) { return (byId[id] = byId[id] || makeEl()); },
  createElement() { return makeEl(); },
  querySelectorAll() { return []; },
};

const storage = {};
const localStorageStub = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
};

const audioCtxStub = {
  state: "running",
  currentTime: 0,
  destination: {},
  resume() {},
  createOscillator() {
    return {
      type: "",
      frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {}, start() {}, stop() {},
    };
  },
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  },
};
function AudioContextCtor() { return audioCtxStub; }

const sandbox = {
  console,
  document: documentStub,
  localStorage: localStorageStub,
  window: { addEventListener() {}, AudioContext: AudioContextCtor },
  Math, Date, JSON, Number, String, Array, Object, Boolean,
  setTimeout: () => 0,
  setInterval: () => 0,
  clearTimeout: () => {},
  clearInterval: () => {},
};
vm.createContext(sandbox);

// ---- Load the real game.js and expose its module-scope bindings -----------------

const src = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
vm.runInContext(
  src + "\nglobalThis.__api = { state, clickPowerValue, prestigeMult, productionMult, cps };",
  sandbox,
  { filename: "game.js" }
);

const api = sandbox.__api;
const mineBtn = byId["mineBtn"];
if (!mineBtn || !mineBtn.listeners.click || mineBtn.listeners.click.length === 0) {
  console.error("FAIL: mineBtn click handler not registered by game.js");
  process.exit(2);
}
const handler = mineBtn.listeners.click[0];

// ---- Scenario: prestige 5 (+50%), 3 Fingers (+1 each), 2 Reinforced Fingers (+5 each),
// ---- 1 Stardust Amplifier (+5% production) --------------------------------------

const s = api.state;
s.prestige = 5;
s.owned = { fingers: 3, rfingers: 2, amp1: 1 };
s.stardust = 0;
s.totalMined = 0;
s.clickCount = 0;

const expected = api.clickPowerValue(); // already includes prestigeMult() via productionMult()
if (!(expected > 0)) {
  console.error("FAIL: setup produced non-positive click power", expected);
  process.exit(2);
}

handler({ clientX: 5, clientY: 5 }); // invoke the real registered click handler

const gained = s.stardust;
const ok = Math.abs(gained - expected) < 1e-9;

console.log(`prestigeMult()                 = ${api.prestigeMult()}`);
console.log(`clickPowerValue() (expected)   = ${expected}`);
console.log(`stardust gained on one click   = ${gained}`);
if (!ok) console.log(`over-awarded by factor        = ${(gained / expected).toFixed(6)}`);
console.log(
  ok
    ? "\nPASS: click gain matches clickPowerValue() — prestige applied exactly once."
    : "\nFAIL: click gain does not match clickPowerValue() — prestige double-applied."
);
process.exit(ok ? 0 : 1);
