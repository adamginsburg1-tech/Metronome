# POCKET web test

A Quick Click metronome built to answer one question: is a web app on iPad
Safari good enough for daily practice (milestones M0–M2)?

It plays a click through Web Audio and records what happens: missed clicks,
timer gaps, audio interruptions, output changes, page hide/show, and offline
behaviour. A checklist and a "Copy report" button collect the results.

| Path | Contents |
|---|---|
| `src/timing.js` | Timing core, a port of `Domain/Timing` (Swift) to JS |
| `src/app.js` | Transport, Web Audio scheduler, UI, diagnostics |
| `src/styles.css`, `src/body.html` | Page |
| `public/` | Manifest and icons for the home-screen build |
| `test/` | `node --test 'web/test/*.test.js'` |
| `build.mjs` | `node web/build.mjs` → `dist/site/` (home-screen build with offline copy) and `dist/artifact.html` (preview) |

No dependencies. To try it locally: `node web/build.mjs && python3 -m http.server -d web/dist/site 8000`.

## How the clock works
A worker timer wakes the scheduler every 25 ms. The scheduler asks the
immutable `PlaybackPlan` for clicks in the next 150 ms and schedules preloaded
buffers at exact `AudioContext` times. If the scheduler wakes too late to play a
click on time, the click is skipped and counted as missed instead of being
played late. Tempo and pattern changes apply from the first bar not yet
scheduled. Audio interruptions and output changes stop playback with a message;
nothing restarts on its own.
