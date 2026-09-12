/* Weightless Deck — the rules.
   ------------------------------------------------------------------
   Game state: score, and eventually turns and legal moves. Pure data.
   No canvas, no DOM, no bodies — everything in here can be tested by
   feeding it events and reading the numbers back out.

   It learns what the table did from the bus, and when it wants
   something to happen it asks the sim through an intent. Those are
   the only two wires. If a rule ever has to reach into a body to
   decide something, the event it is listening to is missing a field —
   add the field, don't add the reach.

   There are no game rules yet; this is still a sandbox. What is here
   is one real rule, wired end to end, so the seam is something that
   works rather than something that is planned: the energy the table
   spends on contacts accumulates into a score. */

"use strict";

function createRules(sim, bus){

  /* accumulated collision energy, g·mm²/s² — the same unit the
     telemetry panel already prints kinetic energy in, so the two
     numbers are comparable quantities rather than arbitrary points */
  var impact = 0;
  var contacts = 0;   /* every contact the solver resolved: knocks
                         and cards leaning on each other alike */

  /* An impulse j is a change in momentum, g·mm/s, and the energy
     behind it goes as j²/2m.

     m here is one card at rest mass. Two equal cards colliding have a
     reduced mass of m/2 and a selected card is SEL_MASS heavier, so a
     big hit involving a held card is undercounted. That is a fair
     trade for a number on a panel; when a rule needs it exact, the
     contact event grows a mass field rather than the rules layer
     growing a way to look bodies up. */
  bus.on("contact", function(x, y, j){
    impact += j*j / (2*sim.CARD_M);
    contacts++;
  });

  /* a new table is a new score */
  bus.on("deal", function(){
    impact = 0;
    contacts = 0;
  });

  return {
    get impact(){ return impact; },
    get contacts(){ return contacts; }
  };
}
