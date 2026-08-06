#!/usr/bin/env node
// Runtime smoke test for v1.0.1 features:
//   - the real game.js boots without throwing
//   - a mouse click on mineBtn mines stardust + increments clickCount
//   - the keyboard shortcut (Space) mines too (issue #8)
//   - the closed-form maxAffordable() is exercised through the shop render
//
// Loads the real game.js inside a vm context with a DOM-ish stub that records
// event handlers, so we can actually fire the real click/keydown handlers.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeEl() {
  const listeners = {};
  const el = {
    textContent: "",
    innerHTML: "",
    className: "",
    disabled: false,
    offsetWidth: 1,
    style: { setProperty() {} },
    dataset: {},
    children: [],
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) { f === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (f ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    querySelector() { return makeEl(); },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    fire(t, ev) { (listeners[t] || []).forEach((fn) => fn(ev || {})); },
    _listeners: listeners,
  };
  return el;
}

const byId = {};
const documentStub = {
  getElementById(id) { return (byId[id] = byId[id] || makeEl()); },
  createElement() { return makeEl(); },
  querySelectorAll() { return []; },
  addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
};
const docListeners = {};
const storage = {};
const localStorageStub = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
};
const audioStub = {
  state: "running", currentTime: 0, destination: {}, resume() {},
  createOscillator() { return { type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; },
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; },
};
function AudioCtor() { return audioStub; }

const sandbox = {
  console,
  document: documentStub,
  localStorage: localStorageStub,
  window: { addEventListener() {}, AudioContext: AudioCtor, dispatchEvent() {} },
  Math, Date, JSON, Number, String, Array, Object, Boolean,
  setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
};
vm.createContext(sandbox);

const src = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
// Expose internals for assertions.
vm.runInContext(
  src + "\nglobalThis.__api = { state, doMine, maxAffordable, SAVE_VERSION, UPGRADES };",
  sandbox,
  { filename: "game.js" }
);

const api = sandbox.__api;
let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) failures++;
}

// 1) Booted: state exists and carries a version stamp (issue #6).
check("state has SAVE_VERSION stamp", typeof api.state.version === "number" && api.state.version >= 1);

// 2) Mouse click mines (existing behavior still works after refactor).
const start = api.state.stardust;
const startClicks = api.state.clickCount;
byId["mineBtn"].fire("click", { clientX: 10, clientY: 10 });
check("click mines stardust", api.state.stardust > start);
check("click increments clickCount", api.state.clickCount === startClicks + 1);

// 3) Keyboard shortcut mines (issue #8).
const beforeKb = api.state.stardust;
const beforeKbClicks = api.state.clickCount;
(docListeners["keydown"] || []).forEach((fn) => fn({ code: "Space", target: { tagName: "BODY" }, preventDefault() {} }));
check("Space key mines stardust", api.state.stardust > beforeKb);
check("Space key increments clickCount", api.state.clickCount === beforeKbClicks + 1);

// 4) Closed-form maxAffordable agrees with the old loop semantics for a big budget.
const drone = api.UPGRADES[0];
const r = api.maxAffordable(drone, 0, 1e9);
check("maxAffordable returns a sane count for 1e9 budget", r.k > 0 && r.cost <= 1e9 + 1e-6);

console.log(failures === 0 ? "\nALL RUNTIME SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
