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

   That is also why `emit` is an overload set rather than the obvious
   `emit<K>(type: K, ...args: Events[K])`. A rest parameter reads
   beautifully and allocates an array on every single call — 156 times
   a tick at 52 cards, in the hot loop the buffer exists to protect.
   The overloads type each call site exactly; the implementation
   signature underneath stays four fixed slots and allocates nothing.
   The price is two lines per event, which is the right price.

   Dispatch is synchronous. A listener runs inside the tick that
   emitted, so listeners stay short and never call back into the sim
   mid-solve. */

/** The events, and what each one carries. Documentation as much as
    type: this is the list of everything the sim says out loud. */
export interface Events {
  /** a contact the solver resolved: position, impulse, and which kind
      of thing was hit (Sim.CONTACT_CARD / Sim.CONTACT_WALL) */
  contact: [x: number, y: number, impulse: number, kind: number];
  /** a new table was dealt, with this many cards */
  deal: [count: number];
}

export type Listener<K extends keyof Events> = (...args: Events[K]) => void;

export interface Bus {
  on(type: "contact", fn: Listener<"contact">): void;
  on(type: "deal", fn: Listener<"deal">): void;

  emit(type: "contact", x: number, y: number, impulse: number, kind: number): void;
  emit(type: "deal", count: number): void;
}

/* the shape every listener is called with once it is in the table:
   four optional numbers, which is what the fixed-arity emit hands it.
   Narrowing back to the real signature happens at `on`, where the
   caller's type is still known. */
type AnyListener = (a?: number, b?: number, c?: number, d?: number) => void;

export function createBus(): Bus {

  var subs: Record<string, AnyListener[]> = Object.create(null);

  function on(type: keyof Events, fn: Listener<"contact"> | Listener<"deal">): void {
    (subs[type] || (subs[type] = [])).push(fn as AnyListener);
  }

  function emit(type: keyof Events, a?: number, b?: number, c?: number, d?: number): void {
    var l = subs[type];
    if(!l) return;
    for(var i=0;i<l.length;i++) l[i](a, b, c, d);
  }

  return { on:on, emit:emit };
}
