# CHOPSTIX

**Play: https://enspiration-eth.github.io/chopstix/**

**Launch it. Stage it. Catch it.** A deliberately unfair, QWOP-style rocket game for the browser.

You don't fly the rocket. You fly **four keys**: two engine banks, plus a gimbal that pushes the nose each way. Lift a 121 m stainless-steel stack off the pad. Climb to the target altitude shown on screen and hot-stage the upper stage inside the release window. Then fly the booster back and set it into the launch tower's catch arms ("chopsticks") slowly enough that they close on it.

Fan-made homage. It isn't affiliated with any launch company, and it has no logos or trademarks. All geometry, textures and sound are procedural.

## Controls

| Key | Does |
| --- | --- |
| `Q` | Left engine bank (throttle). Torques the nose **right** |
| `P` | Right engine bank (throttle). Torques the nose **left** |
| `W` | Gimbal: nose **left** (grid fins too, after staging) |
| `O` | Gimbal: nose **right** |
| `Space` | Stage: release the upper stage (only inside the window) |
| `Esc` | Pause / menu · `R` retry · `M` mute · `H` how to fly |

You need **both banks** to lift off. One bank alone spins you. On touch devices, the same five controls appear as multi-touch pads, `W`/`Q` under the left thumb and `O`/`P` under the right. Hold several at once.

**Scoring:** max altitude, release accuracy (how close to the target and how upright), the landing (speed, sink rate, drift and tilt at the arms) and the fuel left. A catch is worth far more than a touchdown on the pad. Your best score is saved locally.

## Tech

- **TypeScript + Vite**, with **three.js** for rendering.
- **Foldkit** (Elm architecture on **Effect**) owns the whole app shell:
  - screens (title / how-to / flight / pause / result), the webcast HUD, callouts and best-score persistence;
  - keyboard and visibility subscriptions.
  - The three.js `Game` is a Foldkit `Mount` resource, acquired and released with `Effect.acquireRelease`. Its telemetry and events stream back as messages.
  - Raw flight inputs (keys and touch pads) go straight to the sim, which keeps a 60 Hz message loop off the critical path. Everything else goes through `update`.
- **Pure fixed-timestep physics** (`src/sim`), at 120 Hz with no DOM and no three.js:
  - 2D rigid body, two engine banks with spool lag, a gimbal, and grid fins;
  - atmosphere, wind and gusts, an aerodynamic centre of pressure (unstable going up, stable falling), breakup limits;
  - tower collision, catch geometry and scoring.
  - It's deterministic per seed and unit-tested (`npm test`). The tests include a bang-bang "autopilot" that uses *only the four keys* and catches the booster on most seeds. That proves it can be done, and the same autopilot drives the attract mode.
- **Shaders and effects** (`src/engine`):
  - GLSL engine plumes with Mach diamonds, a heat gradient and altitude-dependent expansion;
  - atmospheric sky going from blue to black with the sun and a limb glow;
  - a curved procedural Earth (coastline, marsh, ocean glint, aerial haze);
  - billboard cumulus plus a cloud deck the rocket punches holes through;
  - pad steam, contrail, hot-staging fireball, explosion debris and sparks;
  - bloom, film grain, vignette, chromatic aberration and camera shake;
  - procedural brushed-steel textures with heat tint, and WebAudio engine roar.

## Performance

- An adaptive quality governor picks LOW / MEDIUM / HIGH. Each tier sets the DPR cap (1 / 1.5 / 2), bloom on or off, cloud count, particle budget and plume segments.
  - Phones start at MEDIUM. The tier drops when frame time stays above about 22 ms and climbs back when there's headroom.
- The game engine chunk is lazy-loaded after the UI paints.
- The viewport is locked: no zoom, no scroll, `touch-action: none`, safe-area insets, and a landscape hint in portrait.
- The game pauses automatically when the tab is hidden.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173  (add ?debug for window.__game())
npm run typecheck
npm test
npm run build
node scripts/shots.mjs   # headless screenshots (needs `npx vite preview --port 4173`)
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
