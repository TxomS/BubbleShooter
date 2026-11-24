# BUBBLESHOOTER

A cosmic take on the classic bubble shooter. Aim, bounce shots off the walls, and match three or more planets to pop them in a supernova. Works with mouse, touch and keyboard, on phones and desktop.

Built with Vite, TypeScript and plain HTML5 Canvas. No game engine, no backend, no database: scores live in each browser's `localStorage`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run dev:lan    # same, but reachable from your phone on the same Wi-Fi
npm test           # unit tests for the game rules
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

## How to play

- **Aim** with the mouse, or touch and drag. The dotted line shows the path, bounces included.
- **Shoot** with a click, or lift your finger. Drag back below the launcher to cancel. Keyboard: left/right arrows and space. Esc pauses.
- **Match 3+** of the same planet to pop them. Anything left hanging from popped planets falls for bonus points.
- Every shot that doesn't pop lights one **DESCENT** light. When they're all lit, the ceiling drops a row.
- If planets cross the **event horizon** (dashed red line), the signal is lost.
- Your rank climbs as your score does.

## Modes

The game opens on a menu: **Play**, **Leaderboard**, **How to play** and **Settings**. **Play** lists the missions: Easy, Medium, Hard, Impossible, then Endless.

| Mode | Levels | Planets | Starting rows | Ceiling drops after | Aim preview |
| --- | --- | --- | --- | --- | --- |
| Easy | 5 | 3 to 5 | 4 to 6 | 7 to 5 misses | 2 bounces |
| Medium | 5 | 4 to 6 | 5 to 7 | 5 to 4 misses | 2 bounces |
| Hard | 5 | 5 to 6 | 6 to 9 | 4 to 3 misses | 1 bounce |
| Impossible | 5 | 6 | 8 to 11 | 3 misses | none past the first wall |
| Endless | none | 4 to 6, growing | 5 to 8, growing | 6 to 4 misses | 2 bounces |

- Each difficulty is one run of five levels, always played from level 1. Nothing is locked or tracked between visits: pick a mission and it starts over, whether or not you finished it last time. Score carries through the run, and the last level ends it with a leaderboard entry. Losing ends the run too, with a one-tap retry of that level.
- **Endless** has no levels. Clear the board and a fresh wave glides in on its own, a little harder each time. It only ends when planets reach the event horizon.
- Every mode has its own leaderboard (top 10). Scores and settings are saved in the browser (per device).

## Settings

**Music** and **Sound effects** each have an on/off switch and a volume slider, and they are independent: turn one off and the other keeps playing. The speaker button in the game switches sound effects on and off.

## Deploy to Vercel (free)

1. Push this repo to GitHub.
2. On vercel.com choose **Add New, then Project**, and import the repo.
3. Vercel detects Vite on its own (build command `npm run build`, output `dist`). Click **Deploy**.

Every push to `main` redeploys automatically. The Hobby plan is meant for personal, non-commercial projects.

## Where things live

```
src/game/      rules: grid, matching, shot physics, scoring, levels, modes (no rendering, fully unit tested)
src/render/    canvas drawing: planets, background, effects, the menu's drifting planets
src/audio/     synthesised sound effects and generative music (Web Audio, no audio files)
src/ui/        menu screens, in-game HUD and dialogs, settings
src/input/     mouse, touch and keyboard controls
src/storage/   leaderboard per mode and preferences (localStorage)
tests/         unit tests
scripts/       make-icons.mjs regenerates the app icons (npm run icons)
```

## Tuning the game

Each mode's levels (planet types, starting rows, misses before the ceiling drops, aim preview) are small tables in [`src/game/modes.ts`](src/game/modes.ts). Board size, shot speed, rank thresholds and the nebula colour for each rank are in [`src/game/config.ts`](src/game/config.ts). Scoring is in [`src/game/score.ts`](src/game/score.ts).

## Later ideas

- **Shared leaderboard** for friends: `ScoreStore` in `src/storage/scores.ts` is the seam. Add a Vercel Function backed by a free hosted database and implement the same interface.
- Offline support with a service worker.
