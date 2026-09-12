/* Weightless Deck — the event bus.
   ------------------------------------------------------------------
   One signal, many listeners. The sim reports what happened; sound,
   score and VFX subscribe to the same report instead of each one
   growing its own hook into the solver.

   Payloads are positional arguments, never objects. The sim reports
   contacts out of the middle of an eight-iteration solver that
   already makes something like 725k allocations a second at 52
   cards — an event object per contact would be the most expensive
   thing in the game. Four slots is the budget; if an event ever
   wants a fifth, add a slot here rather than reaching for an object.

   Dispatch is synchronous. A listener runs inside the tick that
   emitted, so listeners stay short and never call back into the sim
   mid-solve. */

"use strict";

function createBus(){

  var subs = Object.create(null);

  function on(type, fn){
    (subs[type] || (subs[type] = [])).push(fn);
  }

  function emit(type, a, b, c, d){
    var l = subs[type];
    if(!l) return;
    for(var i=0;i<l.length;i++) l[i](a, b, c, d);
  }

  return { on:on, emit:emit };
}
