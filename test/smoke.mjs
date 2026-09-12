/* Weightless Deck — boot smoke test
   ------------------------------------------------------------------
   test/physics.mjs proves the solver is unchanged. It says nothing
   about whether the *page* still works — whether the layers still
   agree about the interfaces between them, whether boot() throws,
   whether the render and input paths run.

   This loads every script the page loads, against a stub DOM, boots
   the game and drives real animation frames. It is a wiring check,
   not a visual one: it catches "the layers drifted apart", which is
   the failure the physics test structurally cannot see — and which
   got more likely, not less, the moment there were four of them.

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

/* ---------- load the page the way the browser would ---------- */

const html = readFileSync(join(ROOT, "Weightless Deck.html"), "utf8");

/* Load exactly what the page loads, in the order the page loads it.
   Reading the tags rather than naming the files is what stops this
   test passing against a set of scripts the browser would never
   assemble that way. */
const tags = [...html.matchAll(/<script\s+src=["']([^"']+)["']\s*>/g)].map((m) => m[1]);
const inline = /<script>([\s\S]*?)<\/script>/.exec(html);
const pageSrc =
  tags.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n;\n") +
  (inline ? "\n;\n" + inline[1] : "");

let failures = 0;
const pass = (m) => console.log("  \x1b[32mPASS\x1b[0m  " + m);
const fail = (m) => { console.log("  \x1b[31mFAIL\x1b[0m  " + m); failures++; };

console.log("\nWeightless Deck — boot smoke test\n");

/* the layers only mean anything if the page actually loads all of
   them, in an order where each one's dependencies already exist */
const WANT = ["bus.js", "sim.js", "rules.js", "view.js", "main.js"];
const missing = WANT.filter((f) => !tags.includes(f));
if (missing.length) {
  fail(`the page does not load ${missing.join(", ")} — it will not run in a browser`);
} else if (WANT.some((f, i) => tags.indexOf(f) !== i)) {
  fail(`the page loads its scripts out of order: ${tags.join(", ")}`);
} else {
  pass(`the page loads ${tags.join(", ")}`);
}

let game;
try {
  // classic scripts sharing one scope, exactly as in the page
  const load = new Function(
    "window","document","getComputedStyle","matchMedia","MutationObserver",
    "requestAnimationFrame","cancelAnimationFrame","devicePixelRatio",
    "performance","localStorage","location",
    pageSrc + "\nreturn game;"
  );
  game = load(
    win, doc, win.getComputedStyle, win.matchMedia, win.MutationObserver,
    win.requestAnimationFrame, win.cancelAnimationFrame, win.devicePixelRatio,
    win.performance, win.localStorage, win.location
  );
  pass("every script loads and the game boots without throwing");
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
