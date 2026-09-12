# Weightless Deck

A 2D rigid-body card sandbox. 52 poker cards on a weightless table, drifting,
colliding, draggable. Units are **millimetres, grams, seconds** — a card is
63 × 88 mm and 1.8 g, so every number in the telemetry panel is a real
quantity.

**The physics is the product.** Not the rules, not the art — the way the cards
move. Treat that as the thing being protected by everything below.

## Run it

```
npm install           # once — vite and typescript
npm run dev           # dev server, hot reload; open the URL it prints
npm run build         # -> dist/
npm run preview       # serve dist/ and open it

npm test              # typecheck + physics + smoke
npm run typecheck     # tsc --noEmit
npm run physics       # solver regression only
npm run smoke         # page boot only
```

`?seed=12345` replays a table exactly, in dev or in the built page.

**Double-click-to-run is gone**, as of the TypeScript pass. A built page
cannot be opened straight off the filesystem either: ES modules are blocked
under `file://`, so `dist/index.html` needs a server in front of it —
`npm run preview` is the short way, and the Electron shell in step 5 will be
the long one. `base` is `"./"`, so dist/ can be served from any subpath.

`npm run build` also writes `dist/deck.body.html`, the self-contained
embeddable fragment: the built page with the bundle inlined and the
`<!doctype>/<html>/<head>/<body>` wrapper stripped, for dropping into a host
page that cannot serve sibling assets.

## Layout

Five ES modules in TypeScript. `src/index.html` loads exactly one of them.

| file | what it is |
|---|---|
| `src/bus.ts` | `createBus()` — one signal, many listeners |
| `src/sim.ts` | `createSim(bus)` — bodies and the solver. DOM-free, headless-testable. **Source of truth.** |
| `src/rules.ts` | `createRules(sim, bus)` — game state. Pure data, no rendering |
| `src/view.ts` | `createView(sim, rules, bus)` — canvas, DOM chrome, input |
| `src/main.ts` | the entry. Builds the other four, runs the fixed-DT clock, boots |
| `src/index.html` | styles, markup, and one `<script type="module">` |
| `vite.config.ts` | root is `src/`, build climbs out to `dist/` |
| `tools/build-body.mjs` | flattens the build into the embed fragment |
| `test/physics.mjs` | solver regression |
| `test/smoke.mjs` | the page boots, renders, and scores |

Imports name the file on disk — `./sim.ts`, not `./sim.js`. Node's type
stripping resolves specifiers literally and will not rewrite the extension;
`allowImportingTsExtensions` lets tsc and Vite agree with it.

Nothing type-checks at build time: Vite (esbuild) and `node --strip-types`
both just delete the types and run what is left. `npm run typecheck` is the
only thing that actually checks, which is why it is the first thing
`npm test` runs. It also means the source must stay **erasable** — no enums,
no namespaces, no parameter properties. `erasableSyntaxOnly` in tsconfig
rejects those where they are written rather than where node trips over them.

## The three layers

```
  sim ── events ──▶ bus ──┬──▶ rules
                          └──▶ view
   ▲                             │
   └────────── intents ──────────┘
```

The view also reads sim and rules directly, and writes to neither. Only
`sim.ts` writes to a body, and only through an intent it published itself.

**sim** owns the bodies. It integrates, resolves contacts, and knows nothing
about rules or rendering. `createSim(bus)` returns one independent table —
its own cards, its own RNG stream, its own clock — and the object it returns
is the entire interface. Reads go through getters (`sim.time`,
`sim.selected`, `sim.contactCount`), writes go through intents (`select`,
`flip`, `deal`, `scatter`, `beginDrag`, …). **Nothing outside `sim.ts`
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

The typed version of that second rule is easy to lose. The idiomatic
signature —

```ts
emit<K extends keyof Events>(type: K, ...args: Events[K]): void
```

— reads beautifully and allocates a rest array on **every call**, 156 times a
tick, inside the loop the buffer exists to protect. So `Events` is a map of
argument *tuples* used for documentation and call-site checking, and `emit`
and `on` are an **overload set** over a fixed four-slot implementation. Each
new event costs two overload lines. That is the right price. Do not "clean it
up" into a discriminated union or an object payload.

The sim reports **every** contact it resolves and takes no view on which are
interesting. Thresholds belong to subscribers: the view sparks above j>30
(cards) and j>24 (walls), and a future sound layer will want its own.

What belongs where, when it is not obvious: `glow` is body state — step()
decays it, the renderer only reads it — so it stays in the sim. `sparks` are
decoration no card ever feels, so they live in the view.

## The two tests, and why there are two

`test/physics.mjs` runs `sim.ts` headless across three scenarios
(`scatter-52`, `drift-30`, `selected-40` — the last exercises the `SEL_MASS`
26× / `SEL_GROW` 19% path that mutates mass and collider size mid-solve).

- **exact hashes at 120 ticks** — catches any solver change immediately
- **bulk statistics at 2400 ticks, ±2%** — mean speed, angular velocity,
  kinetic energy, spread

Two tiers because the sim is chaotic: after a few thousand ticks a 1-ulp
difference in `Math.cos` between node builds becomes macroscopic. Individual
trajectories diverge; bulk numbers don't. **The hash says something changed.
The statistics say whether the feel changed.**

Both suites are `.mjs` and import the `.ts` modules directly — node strips
the types. Nothing is built or bundled before a test runs, so a test failure
is never a build artefact.

`test/physics.mjs` imports the sim and *also* reads it as text, to check no
`document.`/`window.`/`Math.random(` has appeared. Importing proves it runs
headless today; reading it proves nothing headless-breaking is hiding behind
a branch this suite never takes.

`test/smoke.mjs` stands a stub DOM up on `globalThis`, imports the entry
module and drives 90 animation frames. The stubs have to be globals and the
import has to be dynamic — a static import hoists above them and the modules
find no `document`. It checks a contact reaches the rules layer and comes
back out on the telemetry panel. The physics test cannot see whether the
layers still agree with each other; this can, and with five files it is the
test that earns its keep.

## Commit discipline

> **Never change structure and feel in the same commit.**

- A **structural** change must leave the exact hashes **unchanged**. If a hash
  moves during a refactor, you broke something. Investigate — don't re-record.
- A **feel** change is its own commit, deliberately re-recorded with
  `npm run physics:update`, with the stat deltas in the commit message.

`git log test/golden.json` is then a readable history of every time the
physics actually changed. Every other commit is provably inert.

## Where the feel lives

In `sim.ts`, and it is mostly *not* in the solver:

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

**TypeScript, strict, with no `any` anywhere in `src/`.** The solver is the
code most worth typing honestly, so if strict mode makes something ugly the
answer is to fix the shape, not to loosen the flag. The port needed exactly
one non-null assertion (the 2d context) and one cast (inside the bus, where a
listener table cannot express "the listeners under key K take Events[K]").

**`var` is still `var` in `src/`.** The TypeScript port was types only; a
var/let/const pass is a separate commit whenever someone wants it, and
keeping the two apart is what made "the hashes did not move" a readable
claim.

**CSS is the design system.** `readTheme()` reads CSS custom properties and
feeds them to the canvas, so one variable re-skins DOM and simulation together.
Keep that bridge. DOM handles menus, HUD, settings, typography and
accessibility; canvas handles the table.

DOM and canvas don't interleave in z-order. Rule of thumb: **DOM for anything
that outlives a frame and doesn't follow a card; canvas for anything attached
to a card.**

## Layout note

The live game is `src/`; `test/`, `tools/` and `package.json` stay at the
root and reach into it. The TypeScript port went in place rather than into a
sibling folder, so `src/` is the only live copy of the physics — which is
what step 1 existed to guarantee.

**`Don't Touch For Now/`** (formerly `html version/`) is a frozen reference:
the single-file JS game as it stood before the sim/rules/view split. Nothing
in the project reads it, no test covers it, no build sees it, and it should
not be edited — the name is the instruction.

It is kept because it is the baseline every refactor gets diffed against, and
it has earned that twice. Both the layer split and the TypeScript port were
checked by recording every canvas call and argument for 90 frames at a fixed
seed and diffing the stream against this page: 118,105 operations, identical
each time, from the source modules and from the minified bundle alike.

It is also the last version that runs by double-clicking — classic scripts,
no server, no build — which makes it the quickest way to see what the table
looked like before any of this.

## Roadmap

1. ~~Seeded RNG + physics regression test~~ done
2. ~~Extract `sim.js`; generate `deck.body.html`~~ done
3. ~~Rules/view split + event bus~~ done. Sound is the next thing that should
   subscribe to `contact` — it needs no new signal, only a listener.
4. ~~TypeScript + Vite~~ done. `sim.js` → `sim.ts` was as mechanical as
   hoped; the test harnesses were not. `new Function` over concatenated
   sources does not survive ES modules, so both were rewritten to import.
5. **Electron shell + Steamworks** — next. Independent of everything above.
   `npm run build` already emits a `dist/` with relative asset URLs, which is
   what the shell needs in order to load it off disk.

Electron notes for later: the overlay needs `electronEnableSteamOverlay()`,
`contextIsolation: false`, `nodeIntegration: true`. The usual overlay bug is a
page that stops repainting — not an issue here, the ambient drift means the
canvas never goes static. ~150 MB download is the real cost. Steam Deck needs
`--no-sandbox`.
