/* Weightless Deck — physics regression test
   ------------------------------------------------------------------
   Extracts the @sim-start/@sim-end region straight out of the game
   file and runs it headless. No build step, no dependencies.

     node test/physics.mjs            run the suite
     node test/physics.mjs --update   re-record the golden values

   Two kinds of check, on purpose:

     exact    a short run's state is hashed bit-for-bit. Catches any
              change to the solver the moment you make it.
     bulk     a long run is compared on summary statistics with a
              tolerance. The sim is chaotic, so after a few thousand
              ticks a 1-ulp difference in Math.cos between two node
              builds becomes macroscopic — individual trajectories
              diverge but the bulk numbers do not. This is the check
              that actually means "the feel is unchanged".
*/

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SIM = join(HERE, "..", "sim.js");
const GOLDEN = join(HERE, "golden.json");
const UPDATE = process.argv.includes("--update");

/* ---------- load the sim ---------- */

function loadSim() {
  const src = readFileSync(SIM, "utf8");

  for (const bad of ["document.", "window.", "Math.random("]) {
    if (src.includes(bad)) {
      throw new Error(`sim.js is no longer headless: found ${bad}`);
    }
  }

  const factory = new Function(
    src +
    "\nreturn { setSeed, rnd, deal, scatter, step, cards, opts, DT, BW, BH," +
    "  select(i){ selected = (i == null ? null : cards[i]); } };"
  );
  return factory();
}

/* ---------- state capture ---------- */

function hash(cards) {
  const f = new Float64Array(cards.length * 6);
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    f[i*6] = c.x;  f[i*6+1] = c.y;  f[i*6+2] = c.a;
    f[i*6+3] = c.vx; f[i*6+4] = c.vy; f[i*6+5] = c.w;
  }
  const b = new Uint8Array(f.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function stats(cards) {
  let speed = 0, omega = 0, ke = 0;
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const c of cards) {
    speed += Math.hypot(c.vx, c.vy);
    omega += Math.abs(c.w);
    ke    += 0.5 * c.m * (c.vx*c.vx + c.vy*c.vy);
    if (c.x < minx) minx = c.x;  if (c.x > maxx) maxx = c.x;
    if (c.y < miny) miny = c.y;  if (c.y > maxy) maxy = c.y;
  }
  const n = cards.length;
  return {
    meanSpeed: speed / n,      // mm/s   — how lively the table is
    meanOmega: omega / n,      // rad/s  — how much it tumbles
    kinetic:   ke,             // g·mm²/s²
    spanX:     maxx - minx,    // mm     — how far the deck spreads
    spanY:     maxy - miny
  };
}

/* ---------- scenarios ---------- */

const SCENARIOS = {
  "scatter-52": (sim, ticks) => {
    sim.setSeed(12345);
    sim.deal(52, true);
    for (let i = 0; i < ticks; i++) sim.step(sim.DT);
  },
  "drift-30": (sim, ticks) => {
    sim.setSeed(777);
    sim.deal(30, false);
    for (let i = 0; i < ticks; i++) sim.step(sim.DT);
  },
  // exercises the SEL_MASS 26x / SEL_GROW 19% path, which mutates
  // mass and collider size every tick while the solver is running
  "selected-40": (sim, ticks) => {
    sim.setSeed(2024);
    sim.deal(40, true);
    sim.select(20);
    for (let i = 0; i < ticks; i++) sim.step(sim.DT);
  }
};

const EXACT_TICKS = 120;
const BULK_TICKS  = 2400;
const TOLERANCE   = 0.02;          // 2% on bulk statistics

/* ---------- runner ---------- */

let failures = 0;
const results = {};

function pass(msg)  { console.log("  \x1b[32mPASS\x1b[0m  " + msg); }
function fail(msg)  { console.log("  \x1b[31mFAIL\x1b[0m  " + msg); failures++; }

function run(name, ticks) {
  const sim = loadSim();
  SCENARIOS[name](sim, ticks);
  return sim;
}

console.log("\nWeightless Deck — physics regression\n");

/* 1. sanity: nothing is NaN and nothing escaped the table */
console.log("invariants");
for (const name of Object.keys(SCENARIOS)) {
  const sim = run(name, BULK_TICKS);
  const diag = Math.hypot(sim.BW, sim.BH);
  let bad = null;
  for (const c of sim.cards) {
    for (const k of ["x","y","a","vx","vy","w","m"]) {
      if (!Number.isFinite(c[k])) { bad = `${k} is ${c[k]}`; break; }
    }
    if (!bad && (c.x < -diag || c.x > sim.BW + diag ||
                 c.y < -diag || c.y > sim.BH + diag)) {
      bad = `card escaped the table at (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`;
    }
    if (bad) break;
  }
  bad ? fail(`${name}: ${bad}`)
      : pass(`${name}: all state finite, all cards on the table`);
}

/* 2. determinism: the same seed must replay exactly */
console.log("\ndeterminism");
for (const name of Object.keys(SCENARIOS)) {
  const a = hash(run(name, EXACT_TICKS).cards);
  const b = hash(run(name, EXACT_TICKS).cards);
  a === b ? pass(`${name}: same seed replays identically (${a})`)
          : fail(`${name}: same seed diverged — ${a} vs ${b}`);
}

/* 3. the seed is actually wired in, not decorative */
{
  const sim1 = loadSim(); sim1.setSeed(1); sim1.deal(52, true);
  for (let i = 0; i < EXACT_TICKS; i++) sim1.step(sim1.DT);
  const sim2 = loadSim(); sim2.setSeed(2); sim2.deal(52, true);
  for (let i = 0; i < EXACT_TICKS; i++) sim2.step(sim2.DT);
  hash(sim1.cards) !== hash(sim2.cards)
    ? pass("different seeds produce different tables")
    : fail("seed has no effect — RNG is not wired into the sim");
}

/* 4. exact golden hashes on the short runs */
console.log("\nexact state (" + EXACT_TICKS + " ticks)");
for (const name of Object.keys(SCENARIOS)) {
  results[name] = { hash: hash(run(name, EXACT_TICKS).cards) };
}

/* 5. bulk statistics on the long runs */
console.log("\nbulk statistics (" + BULK_TICKS + " ticks, ±" +
            (TOLERANCE*100).toFixed(0) + "%)");
for (const name of Object.keys(SCENARIOS)) {
  results[name].stats = stats(run(name, BULK_TICKS).cards);
}

if (UPDATE || !existsSync(GOLDEN)) {
  writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + "\n");
  console.log(
    (UPDATE ? "\n  recorded" : "\n  no golden file — created") +
    ` ${GOLDEN.replace(/.*[\\/]/, "")}. Review the numbers below, then commit it.\n`
  );
  for (const [name, r] of Object.entries(results)) {
    console.log(`  ${name}  ${r.hash}`);
    for (const [k, v] of Object.entries(r.stats)) {
      console.log(`    ${k.padEnd(10)} ${v.toFixed(4)}`);
    }
  }
} else {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const drifted = [];

  for (const name of Object.keys(SCENARIOS)) {
    const g = golden[name];
    if (!g) { fail(`${name}: no golden entry — run with --update`); continue; }
    g.hash === results[name].hash
      ? pass(`${name}: ${g.hash}`)
      : (fail(`${name}: ${g.hash} -> ${results[name].hash}`), drifted.push(name));
  }

  console.log("");
  for (const name of Object.keys(SCENARIOS)) {
    const g = golden[name]; if (!g) continue;
    const bad = [];
    for (const [k, want] of Object.entries(g.stats)) {
      const got = results[name].stats[k];
      const rel = Math.abs(got - want) / (Math.abs(want) || 1);
      if (rel > TOLERANCE) bad.push(`${k} ${want.toFixed(3)} -> ${got.toFixed(3)}  (${(rel*100).toFixed(1)}%)`);
    }
    bad.length ? fail(`${name}: ${bad.join("; ")}`)
               : pass(`${name}: within tolerance`);
  }

  if (drifted.length) {
    console.log(
      "\n  The exact hash moved for: " + drifted.join(", ") + "." +
      "\n  If the bulk statistics above still pass, this is almost certainly" +
      "\n  a harmless refactor or a different node build. If they also moved," +
      "\n  the feel of the table changed — check the constants you touched." +
      "\n  Re-record deliberately with:  node test/physics.mjs --update"
    );
  }
}

console.log(failures ? `\n\x1b[31m${failures} failing\x1b[0m\n`
                     : "\n\x1b[32mall checks passed\x1b[0m\n");
process.exit(failures ? 1 : 0);
