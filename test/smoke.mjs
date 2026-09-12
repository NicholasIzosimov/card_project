/* Weightless Deck — boot smoke test
   ------------------------------------------------------------------
   test/physics.mjs proves the solver is unchanged. It says nothing
   about whether the *page* still works — whether sim.js and the
   inline script still agree about their shared bindings, whether
   boot() throws, whether the render and input paths run.

   This loads both scripts against a stub DOM, boots the game, and
   drives real animation frames. It is a wiring check, not a visual
   one: it catches "sim.js and the page drifted apart", which is the
   failure the physics test structurally cannot see.

     node test/smoke.mjs
*/

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/* ---------- the smallest DOM that will hold the game ---------- */

const CSS_VARS = {
  "--face": "#FCFAF4", "--face-line": "rgba(24,26,36,.18)",
  "--card-ink": "#1A1C26", "--carmine": "#B0303A",
  "--amber": "#B9761A", "--amber-bright": "#D9902B",
  "--back-1": "#243049", "--back-2": "#38496B",
  "--shadow": "rgba(38,34,26,.34)", "--aura": "217,145,43"
};

const drawCalls = { count: 0 };

function makeCtx() {
  const noop = () => { drawCalls.count++; };
  const ctx = {
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 10 })
  };
  for (const m of ["arc","beginPath","clearRect","clip","fill","fillRect",
                   "restore","rotate","save","scale","setTransform","stroke",
                   "translate","fillText","moveTo","lineTo","quadraticCurveTo",
                   "closePath","rect","strokeRect"]) ctx[m] = noop;
  return ctx;
}

function makeEl(id) {
  const listeners = {};
  return {
    id, className: "", value: "14", textContent: "", checked: false,
    width: 1200, height: 800, clientWidth: 1200, clientHeight: 800,
    style: {}, dataset: {}, open: true,
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    setPointerCapture() {}, releasePointerCapture() {},
    hasPointerCapture: () => false,
    setAttribute() {}, getAttribute: () => null,
    appendChild() {}, querySelector: () => null,
    fire(t, ev) { (listeners[t] || []).forEach((f) => f(ev)); },
    _listeners: listeners
  };
}

const els = new Map();
const el = (id) => {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
};

const frames = [];
const win = {
  devicePixelRatio: 2,
  innerWidth: 1200,
  innerHeight: 800,
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  addEventListener() {},
  requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
  cancelAnimationFrame() {},
  location: { search: "?seed=4242" },
  MutationObserver: class { observe() {} disconnect() {} },
  getComputedStyle: () => ({ getPropertyValue: (k) => CSS_VARS[k] ?? "" }),
  performance: { now: () => frames.length * 16.67 },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
};
win.window = win;

const doc = {
  getElementById: el,
  documentElement: makeEl("html"),
  body: makeEl("body"),
  createElement: (t) => makeEl(t),
  addEventListener() {},
  querySelector: () => null
};

/* ---------- load sim.js, then the page script, as the browser would ---------- */

const simSrc = readFileSync(join(ROOT, "sim.js"), "utf8");
const html = readFileSync(join(ROOT, "Weightless Deck.html"), "utf8");
const pageSrc = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

let failures = 0;
const pass = (m) => console.log("  \x1b[32mPASS\x1b[0m  " + m);
const fail = (m) => { console.log("  \x1b[31mFAIL\x1b[0m  " + m); failures++; };

console.log("\nWeightless Deck — boot smoke test\n");

/* this file concatenates the two scripts itself, so it would happily
   pass even if the page had stopped loading sim.js. check the tag. */
if (/<script\s+src=["']sim\.js["']\s*>/.test(html)) {
  pass("the page loads sim.js");
} else {
  fail("the page has no <script src=\"sim.js\"> tag — it will not run in a browser");
}

let sim;
try {
  // sim.js declares at top level; give the page script the same scope
  const load = new Function(
    "window","document","getComputedStyle","matchMedia","MutationObserver",
    "requestAnimationFrame","cancelAnimationFrame","devicePixelRatio",
    "performance","localStorage","location",
    simSrc + "\n;\n" + pageSrc +
    "\nreturn { cards, step, DT, time, contactCount };"
  );
  sim = load(
    win, doc, win.getComputedStyle, win.matchMedia, win.MutationObserver,
    win.requestAnimationFrame, win.cancelAnimationFrame, win.devicePixelRatio,
    win.performance, win.localStorage, win.location
  );
  pass("sim.js + page script load and boot without throwing");
} catch (e) {
  fail("boot threw: " + e.message);
  console.log("\n" + e.stack.split("\n").slice(0, 6).join("\n") + "\n");
  process.exit(1);
}

if (sim.cards && sim.cards.length > 0) {
  pass(`boot dealt ${sim.cards.length} cards`);
} else {
  fail("boot produced no cards — the page is not reaching deal()");
}

/* drive real animation frames */
const before = drawCalls.count;
let ticked = 0;
try {
  for (let i = 0; i < 90 && frames.length; i++) {
    const fn = frames.shift();
    fn(1000 + i * 16.67);
    ticked++;
  }
} catch (e) {
  fail(`frame ${ticked} threw: ${e.message}`);
  console.log("\n" + e.stack.split("\n").slice(0, 6).join("\n") + "\n");
}

if (ticked >= 60) pass(`ran ${ticked} animation frames clean`);
else if (!failures) fail(`only ${ticked} frames ran — the rAF loop is not self-sustaining`);

const drew = drawCalls.count - before;
drew > 0 ? pass(`render path issued ${drew.toLocaleString()} canvas calls`)
         : fail("render path issued no canvas calls — nothing is being drawn");

const moved = sim.cards.some((c) => c.vx !== 0 || c.vy !== 0);
moved ? pass("cards are in motion after boot")
      : fail("no card has velocity — the sim is not being stepped");

const finite = sim.cards.every((c) =>
  Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.a));
finite ? pass("all card state finite after the render loop")
       : fail("NaN reached card state through the page path");

console.log(failures ? `\n\x1b[31m${failures} failing\x1b[0m\n`
                     : "\n\x1b[32mall checks passed\x1b[0m\n");
process.exit(failures ? 1 : 0);
