# Weightless Deck

A 2D rigid-body card sandbox. 52 poker cards on a weightless table, drifting,
colliding, draggable. Units are **millimetres, grams, seconds** — a card is
63 × 88 mm and 1.8 g, so every number in the telemetry panel is a real
quantity.

**The physics is the product.** Not the rules, not the art — the way the cards
move. Treat that as the thing being protected by everything below.

## Run it

Open `src/Weightless Deck.html`. No server, no build step. The four scripts
it loads must sit next to it. `?seed=12345` replays a table exactly.

```
npm test              # everything (no dependencies to install)
npm run physics       # solver regression only
npm run smoke         # page boot only
npm run build         # regenerate deck.body.html
```

## Layout

Five classic scripts, loaded in dependency order. No modules: `type="module"`
cannot load from `file://`, and double-click-to-run is worth more than import
syntax until the TypeScript pass takes it away.

| file | what it is |
|---|---|
| `src/bus.js` | `createBus()` — one signal, many listeners |
| `src/sim.js` | `createSim(bus)` — bodies and the solver. DOM-free, headless-testable. **Source of truth.** |
| `src/rules.js` | `createRules(sim, bus)` — game state. Pure data, no rendering |
| `src/view.js` | `createView(sim, rules, bus)` — canvas, DOM chrome, input |
| `src/main.js` | builds the other four, runs the fixed-DT clock, boots |
| `src/Weightless Deck.html` | styles, markup, and the five script tags |
| `src/deck.body.html` | **generated** — never edit by hand |
| `tools/build-body.mjs` | generates the above; `--check` fails if stale |
| `test/physics.mjs` | solver regression |
| `test/smoke.mjs` | the page boots, renders, and scores |

## The three layers

```
  sim ── events ──▶ bus ──┬──▶ rules
                          └──▶ view
   ▲                             │
   └────────── intents ──────────┘
```

The view also reads sim and rules directly, and writes to neither. Only
`sim.js` writes to a body, and only through an intent it published itself.

**sim** owns the bodies. It integrates, resolves contacts, and knows nothing
about rules or rendering. `createSim(bus)` returns one independent table —
its own cards, its own RNG stream, its own clock — and the object it returns
is the entire interface. Reads go through getters (`sim.time`,
`sim.selected`, `sim.contactCount`), writes go through intents (`select`,
`flip`, `deal`, `scatter`, `beginDrag`, …). **Nothing outside `sim.js`
touches a body.** Adding a third way in is how this rots.

**rules** is game state: score, and eventually turns and legal moves. Pure
data — feed it events, read the numbers back. It never renders and never
reads a body; if a rule needs something, the event grows a field.

**view** draws the table and the chrome and turns input into intents. It
reads sim and rules and mutates neither.

Two rules about the `contact` event, both of which the solver will punish
you for ignoring:

- **Report on solver iteration 0 only.** `solveManifold` and `solveWalls`
  visit every contact `ITER` (8) times per tick. The gate is the one
  `spark()` always used; without it every listener hears each contact eight
  times.
- **Never allocate per contact.** Contacts go into a preallocated
  `Float64Array` and are drained once at the end of the tick. The sim already
  makes ~725k allocations/sec at 52 cards and reports ~156 contacts/tick;
  an event object apiece would be the most expensive thing in the game.
  Payloads are positional arguments for the same reason.

The sim reports **every** contact it resolves and takes no view on which are
interesting. Thresholds belong to subscribers: the view sparks above j>30
(cards) and j>24 (walls), and a future sound layer will want its own.

What belongs where, when it is not obvious: `glow` is body state — step()
decays it, the renderer only reads it — so it stays in the sim. `sparks` are
decoration no card ever feels, so they live in the view.

## The two tests, and why there are two

`test/physics.mjs` runs `sim.js` headless across three scenarios
(`scatter-52`, `drift-30`, `selected-40` — the last exercises the `SEL_MASS`
26× / `SEL_GROW` 19% path that mutates mass and collider size mid-solve).

- **exact hashes at 120 ticks** — catches any solver change immediately
- **bulk statistics at 2400 ticks, ±2%** — mean speed, angular velocity,
  kinetic energy, spread

Two tiers because the sim is chaotic: after a few thousand ticks a 1-ulp
difference in `Math.cos` between node builds becomes macroscopic. Individual
trajectories diverge; bulk numbers don't. **The hash says something changed.
The statistics say whether the feel changed.**

`test/smoke.mjs` boots the real page against a stub DOM and drives 90
animation frames. It loads whatever `<script src>` tags the page actually
carries, in that order, and checks a contact reaches the rules layer and
comes back out on the panel. The physics test cannot see whether the layers
still agree with each other — this can, and with five files it is the test
that earns its keep.

## Commit discipline

> **Never change structure and feel in the same commit.**

- A **structural** change must leave the exact hashes **unchanged**. If a hash
  moves during a refactor, you broke something. Investigate — don't re-record.
- A **feel** change is its own commit, deliberately re-recorded with
  `npm run physics:update`, with the stat deltas in the commit message.

`git log test/golden.json` is then a readable history of every time the
physics actually changed. Every other commit is provably inert.

## Where the feel lives

In `sim.js`, and it is mostly *not* in the solver:

- two out-of-phase drift harmonics per card (`t*0.63/t*1.41`, `t*0.77/t*1.19`)
  with random per-card phase, so the table never visibly loops
- `SEL_MASS = 26` — selecting a card makes it 26× heavier mid-simulation
- `SEL_GROW = 0.19` — and grows its collider 19%, every frame
- the mouse spring written as an *acceleration* (`SPRING_K`/`SPRING_C`) so the
  heavy selected card still answers the pointer immediately
- a soft edge cushion plus weak centre cohesion, so the deck reads as a table
  rather than a border

The inline comments explaining *why* each constant is what it is are the
highest-value text in the repo. Preserve them through any refactor.

Known sensitivity: the selected-card path is far more friction-sensitive than
the rest of the table. A +14% `MU_CARD` change moves bulk speed ~14% almost
everywhere but **~70%** in `selected-40`, and kinetic energy ~364%. Re-run the
suite after touching any friction or damping constant.

## Stack decisions (settled — don't relitigate)

**Target: lightweight game, Steam via Electron, browser as a first-class
target.** Staying minimal and procedural — no sprite art.

**Do NOT port the physics to an engine.** Box2D/Rapier/Unity/Godot Physics all
fight this code: it mutates collider size every tick, swaps mass 1.8 g ↔ 46.8 g
continuously, and works in millimetres (Box2D is tuned for 0.1–10 m). There is
also no performance reason — 52 cards is ~193 broadphase pairs and ~144
manifolds per tick, measured at **0.26 ms/tick in V8** — 0.24 in the solver,
the rest dispatching contact events — about 3% of a 120 Hz budget.

**Do NOT adopt PixiJS.** This was evaluated and rejected. The renderer is
deeply Canvas2D-idiomatic: `shadowBlur` ×3, a `createLinearGradient` per card
per frame (the specular sweep that keeps the light fixed in world space while
the card rotates), `quadraticCurveTo`, `clip()`, `fillText`. Pixi has no
`shadowBlur` — moving to it means rewriting the visual identity as shaders,
which buys nothing at 52 cards. If profiling ever implicates the shadows, the
fix is caching card faces to offscreen canvases, not a renderer swap.

**Godot was evaluated and rejected** for this target: C# cannot export to web
(Microsoft dropped .NET WASM from the roadmap), and GDScript would need a
structure-of-arrays rewrite of the solver to handle ~585k `applyImpulse` calls
and ~725k allocations per second — which would make the constants above hostile
to tuning.

**CSS is the design system.** `readTheme()` reads CSS custom properties and
feeds them to the canvas, so one variable re-skins DOM and simulation together.
Keep that bridge. DOM handles menus, HUD, settings, typography and
accessibility; canvas handles the table.

DOM and canvas don't interleave in z-order. Rule of thumb: **DOM for anything
that outlives a frame and doesn't follow a card; canvas for anything attached
to a card.**

## Layout note

The live game is `src/`; `test/`, `tools/` and `package.json` stay at the
root and reach into it. The TypeScript port will get its own sibling folder.

`html version/` is a **frozen reference** — the single-file version as it
stood before the sim/rules/view split. Nothing reads it, no test covers it,
and it should not be edited. It is there to diff against, and git history
holds it either way.

**When the TS port works, it replaces `src/`.** Two live copies of the
physics is the divergence hazard step 1 existed to remove.

## Roadmap

1. ~~Seeded RNG + physics regression test~~ done
2. ~~Extract `sim.js`; generate `deck.body.html`~~ done
3. ~~Rules/view split + event bus~~ done. Sound is the next thing that should
   subscribe to `contact` — it needs no new signal, only a listener.
4. TypeScript. First step that forces a build and loses double-click-to-run —
   delay while it's free to delay. `sim.js` → `sim.ts` should be nearly
   mechanical.
5. Electron shell + Steamworks. Independent of everything above.

Electron notes for later: the overlay needs `electronEnableSteamOverlay()`,
`contextIsolation: false`, `nodeIntegration: true`. The usual overlay bug is a
page that stops repainting — not an issue here, the ambient drift means the
canvas never goes static. ~150 MB download is the real cost. Steam Deck needs
`--no-sandbox`.
