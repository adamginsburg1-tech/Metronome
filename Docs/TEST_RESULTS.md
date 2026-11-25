# Test results

Only results that were actually run are recorded here. Thresholds in the plan
are targets until evidence appears in this file.

## 2026-11-25 · Domain timing tests (Linux)

- **Environment:** Swift 6.0 (`swift:6.0-noble` Docker image), Ubuntu 24.04 x86_64, debug build
- **Command:** `swift test`
- **Result:** 28 tests, 0 failures (≈1.7 s)

| Area | What was checked | Result |
|---|---|---|
| Exact grids | 60/120/300 BPM 4/4 at 48 kHz land on exact frames; 7/8 (2+2+3); 6/8 dotted-quarter | Pass |
| All combinations | 10 meters × subdivisions 1–8 × 6 tempos (20–300, incl. 113.37, 187.5) × 44.1/48/96 kHz, 20 s each: every onset within ½ frame; event counts exact | Pass |
| 60-minute drift | Septuplets at 113.37 BPM, 48 kHz: max onset error ≤ 0.5 frame over 1 h. Naive rounded-interval accumulation drifts > 100 frames over the same run | Pass |
| Lookahead windows | Random windows 1–8820 frames over 2 min (7/8, quintuplets, 241.3 BPM, count-in) equal one full scan; no duplicates | Pass |
| Deep window | Window at 50 min equals full scan | Pass |
| Count-in / muting | Count-in bar −1 then bar 0 downbeat; muted units silent but grid intact | Pass |
| Tempo change | Change queued at next bar: earlier events identical, new tempo exact from the bar | Pass |
| Many changes | 180 consecutive +1 BPM changes (septuplets, 44.1 kHz) stay within ½ frame of reference; no overflow | Pass |
| Validation | Bad meters, groupings, subdivisions, tempos, sample rates, plans rejected | Pass |

**Not yet tested (needs Mac/iPad):** real playback, latency, transport stop
response, audio session interruptions, UI, accessibility.
