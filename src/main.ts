/* Weightless Deck — wiring.
   ------------------------------------------------------------------
   The entry module, and the only file that knows all the layers exist.
   It builds them, points them at each other, and runs the clock:

     bus    one signal, many listeners.
     sim    owns the bodies. Integrates, resolves contacts, knows
            nothing about rules or rendering, and never touches the
            DOM.
     rules  game state. Pure data, fed by events.
     view   draws the table and the chrome, and turns input into sim
            intents. Reads sim and rules; mutates neither.

   Everything here is orchestration. If something in this file starts
   doing physics or drawing, it is in the wrong file.

   Importing this module builds and boots the game — that is the whole
   job of the page's one <script type="module">. The handles come back
   out as `game` so test/smoke.mjs can drive it, and it is parked on
   window as well so the browser console can poke at it. */

import { createBus } from "./bus.ts";
import { createSim } from "./sim.ts";
import { createRules } from "./rules.ts";
import { createView } from "./view.ts";

import type { Bus } from "./bus.ts";
import type { Sim } from "./sim.ts";
import type { Rules } from "./rules.ts";
import type { View } from "./view.ts";

/** What survives a hot reload: enough to deal the same size table
    again, not the table itself. */
interface Saved { n?: number }

export interface Game {
  sim: Sim;
  rules: Rules;
  view: View;
  bus: Bus;
}

/* The host page may provide a hot-reload bridge. It is not ours and it
   is not always there, so it is declared optional and every use is
   guarded. */
declare global {
  interface Window {
    claude?: {
      hot?: {
        snapshot(fn: () => Saved): void;
        ready?(fn: (saved: Saved) => void): void;
        data?: Saved;
      };
    };
    game?: Game;
  }
}

function start(): Game {

  var bus = createBus();
  var sim = createSim(bus);

  /* seed: ?seed=123 replays a table exactly; otherwise the clock */
  var q = /[?&]seed=(\d+)/.exec(location.search);
  sim.setSeed(q ? parseInt(q[1],10) : (Date.now() >>> 0));

  var rules = createRules(sim, bus);
  var view = createView(sim, rules, bus);

  /* ---------- the clock ----------
     Fixed DT with an accumulator: the solver only ever sees the
     timestep its constants were tuned for, whatever the display is
     doing. MAX_STEPS caps the catch-up so a backgrounded tab does not
     come back and simulate a minute of table in one frame. */

  var acc = 0, last = performance.now();

  function frame(now: number): void {
    var dt = Math.min(0.05, (now - last)/1000);
    last = now;
    acc += dt;
    sim.resetContacts();
    var steps = 0;
    while(acc >= sim.DT && steps < sim.MAX_STEPS){
      sim.step(sim.DT);
      view.advance(sim.DT);
      acc -= sim.DT;
      steps++;
    }
    if(steps === sim.MAX_STEPS) acc = 0;
    view.render();
    view.telemetry(dt);
    requestAnimationFrame(frame);
  }

  function boot(saved: Saved): void {
    view.resize();
    sim.deal(saved && saved.n ? saved.n : 14, false);
    view.showCount(sim.cards.length);
    /* open on a live table: one card already lifted, mid-drift */
    sim.select(sim.cards[(sim.cards.length/2)|0], true);
    sim.stir(260, 1.6);
    for(var s=0;s<40;s++){ sim.step(sim.DT); view.advance(sim.DT); }
    requestAnimationFrame(frame);
  }

  if(window.claude && window.claude.hot){
    var hot = window.claude.hot;
    hot.snapshot(function(){ return {n:sim.cards.length}; });
    hot.ready ? hot.ready(boot) : boot(hot.data || {});
  } else {
    boot({});
  }

  return { sim:sim, rules:rules, view:view, bus:bus };
}

export var game = start();

window.game = game;
