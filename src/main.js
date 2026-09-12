/* Weightless Deck — wiring.
   ------------------------------------------------------------------
   The only file that knows all the layers exist. It builds them,
   points them at each other, and runs the clock:

     sim    owns the bodies. Integrates, resolves contacts, knows
            nothing about rules or rendering, and never touches the
            DOM.
     view   draws the table and the chrome, and turns input into sim
            intents. Reads sim; mutates nothing.

   Everything here is orchestration. If something in this file starts
   doing physics or drawing, it is in the wrong file.

   The running game is handed back as `game` so test/smoke.mjs can
   drive it and the browser console can poke at it. */

var game = (function(){
"use strict";

var bus = createBus();
var sim = createSim(bus);

/* seed: ?seed=123 replays a table exactly; otherwise the clock */
var q = /[?&]seed=(\d+)/.exec(location.search);
sim.setSeed(q ? parseInt(q[1],10) : (Date.now() >>> 0));

var view = createView(sim, bus);

/* ---------- the clock ----------
   Fixed DT with an accumulator: the solver only ever sees the
   timestep its constants were tuned for, whatever the display is
   doing. MAX_STEPS caps the catch-up so a backgrounded tab does not
   come back and simulate a minute of table in one frame. */

var acc = 0, last = performance.now();

function frame(now){
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

function boot(saved){
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
  window.claude.hot.snapshot(function(){ return {n:sim.cards.length}; });
  window.claude.hot.ready ? window.claude.hot.ready(boot) : boot(window.claude.hot.data || {});
} else {
  boot({});
}

return { sim:sim, view:view, bus:bus };

})();
