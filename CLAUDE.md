# Weightless Deck

A 2D rigid-body card sandbox. 52 poker cards on a weightless table, drifting,
colliding, draggable. Units are **millimetres, grams, seconds** — a card is
63 × 88 mm and 1.8 g, so every number in the telemetry panel is a real
quantity.

**The physics is the product.** Not the rules, not the art — the way the cards
move. Treat that as the thing being protected by everything below.

## Run it

Open `html version/Weightless Deck.html`. No server, no build step. `sim.js`
must sit next to it. `?seed=12345` replays a table exactly.

```
npm test              # everything (no dependencies to install)
npm run physics       # solver regression only
npm run smoke         # page boot only
npm run build         # regenerate deck.body.html
```

## Layout

| file | what it is |
|---|---|
| `html version/sim.js` | the solver. DOM-free, headless-testable. **Source of truth.** |
| `html version/Weightless Deck.html` | the page: styles, markup, render + input + UI |
| `html version/deck.body.html` | **generated** — never edit by hand |
| `tools/build-body.mjs` | generates the above; `--check` fails if stale |
| `test/physics.mjs` | solver regression |
| `test/smoke.mjs` | page boots and renders |

`sim.js` declares its top level **globally on purpose**. The page reads and
writes `selected`, `time` and `contactCount` directly, exactly as it did when
everything lived in one closure. This is a deliberate interim state — it goes
away in the TypeScript pass. Don't "fix" it in isolation.

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
animation frames. The physics test cannot see whether `sim.js` and the page
still agree about their shared bindings — this can.

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
manifolds per tick, measured at **0.244 ms/tick in V8**, under 3% of a 120 Hz
budget.

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

The JS game lives in `html version/`; `test/`, `tools/` and `package.json`
stay at the root and reach into it. The TypeScript port will get its own
sibling folder.

**When the TS port works, it replaces this one.** Two live copies of the
physics is the divergence hazard step 1 existed to remove, and only
`html version/sim.js` is covered by the test suite. Keep this folder as a
frozen reference, not a second thing to maintain — the old version lives in
git history either way.

## Roadmap

1. ~~Seeded RNG + physics regression test~~ done
2. ~~Extract `sim.js`; generate `deck.body.html`~~ done
3. **Rules/view split + event bus** — next. `solveManifold` already computes a
   collision impulse `j` and fires `spark()` above `j > 30`; route that to an
   event bus so sound, score and VFX all subscribe to one signal. Three layers:
   sim (owns bodies, knows no rules) → rules (pure data, testable) → view.
4. TypeScript. First step that forces a build and loses double-click-to-run —
   delay while it's free to delay. `sim.js` → `sim.ts` should be nearly
   mechanical.
5. Electron shell + Steamworks. Independent of everything above.

Electron notes for later: the overlay needs `electronEnableSteamOverlay()`,
`contextIsolation: false`, `nodeIntegration: true`. The usual overlay bug is a
page that stops repainting — not an issue here, the ambient drift means the
canvas never goes static. ~150 MB download is the real cost. Steam Deck needs
`--no-sandbox`.
