/* Weightless Deck — boot smoke test
   ------------------------------------------------------------------
   test/physics.mjs proves the solver is unchanged. It says nothing
   about whether the *page* still works — whether the layers still
   agree about the interfaces between them, whether boot() throws,
   whether the render and input paths run.

   This stands a stub DOM up on globalThis, imports the page's entry
   module, and drives real animation frames. It is a wiring check, not
   a visual one: it catches "the layers drifted apart", which is the
   failure the physics test structurally cannot see — and which got
   more likely, not less, the moment there were five files.

   The stubs go on globalThis rather than being passed in as
   parameters, because that is the only place a module can find them:
   view.ts reads `document` and `window` while it is being imported,
   so the import has to be dynamic and has to happen after this file
   has finished lying about the browser.

     node test/smoke.mjs
*/

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "src");

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
  getComputedStyle: () => ({ getPropertyValue: (k) => CSS_VARS[k] ?? "" })
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

/* Install the browser the modules expect. `performance` already exists
   in node and is not writable by assignment, so it goes in by
   definition — the game reads performance.now() while it is being
   imported, and a clock that counts frames keeps the run repeatable. */
Object.assign(globalThis, {
  window: win,
  document: doc,
  getComputedStyle: win.getComputedStyle,
  matchMedia: win.matchMedia,
  MutationObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: win.requestAnimationFrame,
  cancelAnimationFrame: win.cancelAnimationFrame,
  devicePixelRatio: win.devicePixelRatio,
  location: win.location,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
});
Object.defineProperty(globalThis, "performance", {
  value: { now: () => frames.length * 16.67 },
  configurable: true, writable: true
});

let failures = 0;
const pass = (m) => console.log("  \x1b[32mPASS\x1b[0m  " + m);
const fail = (m) => { console.log("  \x1b[31mFAIL\x1b[0m  " + m); failures++; };

console.log("\nWeightless Deck — boot smoke test\n");

/* This file imports the entry module itself, so it would happily pass
   against a page that had stopped loading it. Check the tag. */
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const entry = /<script\s+type=["']module["']\s+src=["']\.\/main\.(t|j)s["']\s*>/.exec(html);
entry
  ? pass(`the page loads ./main.${entry[1]}s as a module`)
  : fail("the page has no <script type=\"module\" src=\"./main.ts\"> — it will not run in a browser");

/* ---------- boot ---------- */

let game;
try {
  /* dynamic, and after the stubs above: a static import would be
     hoisted above them and the modules would find no document */
  ({ game } = await import("../src/main.js"));
  pass("the entry module imports and the game boots without throwing");
} catch (e) {
  fail("boot threw: " + e.message);
  console.log("\n" + e.stack.split("\n").slice(0, 6).join("\n") + "\n");
  process.exit(1);
}

if (game.sim.cards && game.sim.cards.length > 0) {
  pass(`boot dealt ${game.sim.cards.length} cards`);
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

const moved = game.sim.cards.some((c) => c.vx !== 0 || c.vy !== 0);
moved ? pass("cards are in motion after boot")
      : fail("no card has velocity — the sim is not being stepped");

const finite = game.sim.cards.every((c) =>
  Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.a));
finite ? pass("all card state finite after the render loop")
       : fail("NaN reached card state through the page path");

/* the whole point of the split: a contact in the solver has to reach
   the rules layer and come back out on the panel. Each leg of that
   can break silently, so check both. */
if (game.rules.contacts > 0 && game.rules.impact > 0) {
  pass(`rules scored ${game.rules.contacts.toLocaleString()} contacts ` +
       `from the bus (${(game.rules.impact / 1000).toFixed(1)} µJ)`);
} else {
  fail("the rules layer saw no contacts — sim -> rules is not wired");
}

const shown = els.get("tImpact")?.textContent;
/^[\d.]+ [µm]?J$/.test(shown ?? "")
  ? pass(`telemetry shows the score: ${shown}`)
  : fail(`the score never reached the panel — tImpact reads ${JSON.stringify(shown)}`);

console.log(failures ? `\n\x1b[31m${failures} failing\x1b[0m\n`
                     : "\n\x1b[32mall checks passed\x1b[0m\n");
process.exit(failures ? 1 : 0);
