// Run with: node --test 'web/test/*.test.js'
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/timing.js");

const quarterPlan = (bpm, { pattern = {}, ...rest } = {}) =>
  T.PlaybackPlan.click({ pattern: T.makePattern({ meter: T.makeMeter(4, 4), ...pattern }), tempo: T.makeTempo(bpm), ...rest });

test("quarter notes at 60/120/300 BPM land on exact times", () => {
  for (const [bpm, interval] of [[60, 1], [120, 0.5], [300, 0.2]]) {
    const ev = quarterPlan(bpm).eventsIn(0, interval * 16 - 1e-9);
    assert.equal(ev.length, 16);
    ev.forEach((e, k) => {
      assert.ok(Math.abs(e.time - k * interval) < 1e-12, `${bpm} BPM event ${k}`);
      assert.equal(e.bar, Math.floor(k / 4));
      assert.equal(e.level, k % 4 === 0 ? T.LEVEL.downbeat : T.LEVEL.normal);
    });
  }
});

test("meter defaults match the Swift core", () => {
  assert.deepEqual(T.makeMeter(7, 8).grouping, [2, 2, 3]);
  assert.deepEqual(T.makeMeter(6, 8).grouping, [3, 3]);
  assert.deepEqual(T.makeMeter(5, 8).grouping, [2, 3]);
  assert.deepEqual(T.makeMeter(4, 4).grouping, [1, 1, 1, 1]);
  assert.equal(T.makeMeter(6, 8).defaultBeatUnit, 3 / 8);
  assert.deepEqual(T.defaultAccents(T.makeMeter(4, 4)), [4, 2, 2, 2]);
  assert.deepEqual(T.defaultAccents(T.makeMeter(7, 8)), [4, 2, 3, 2, 3, 2, 2]);
  assert.throws(() => T.makeMeter(7, 8, [3, 3]));
  assert.throws(() => T.makeTempo(19.99));
  assert.throws(() => T.makeTempo(300.01));
  assert.throws(() => T.makePattern({ meter: T.makeMeter(4, 4), subdivision: 9 }));
});

test("6/8 at dotted quarter = 60 has a two-second bar", () => {
  const meter = T.makeMeter(6, 8);
  const plan = T.PlaybackPlan.click({ pattern: T.makePattern({ meter }), tempo: T.makeTempo(60, meter.defaultBeatUnit) });
  assert.ok(Math.abs(plan.startTimeOfBar(1) - 2) < 1e-12);
  assert.deepEqual(plan.eventsIn(0, 2 - 1e-9).map((e) => e.level), [4, 2, 2, 3, 2, 2]);
});

test("no drift: septuplets at 113.37 BPM stay within 1 µs over an hour", () => {
  const plan = quarterPlan(113.37, { pattern: { subdivision: 7 } });
  const ev = plan.eventsIn(0, 3600);
  const step = 60 / 113.37 / 7;
  let worst = 0;
  ev.forEach((e, k) => { worst = Math.max(worst, Math.abs(e.time - k * step)); });
  assert.ok(worst < 1e-6, `worst ${worst}`);
  assert.equal(ev.length, Math.ceil(3600 / step));
});

test("adjacent random windows return each event exactly once", () => {
  const meter = T.makeMeter(7, 8);
  const plan = T.PlaybackPlan.click({ pattern: T.makePattern({ meter, subdivision: 5 }), tempo: T.makeTempo(241.3, 1 / 8), countInBars: 2, startTime: 0.1 });
  const total = 120;
  const reference = plan.eventsIn(0, total);
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const got = [];
  for (let t = 0; t < total;) {
    const end = Math.min(total, t + 0.0001 + rand() * 0.2);
    got.push(...plan.eventsIn(t, end));
    t = end;
  }
  assert.deepEqual(got, reference);
});

test("count-in precedes bar 0, units only", () => {
  const plan = quarterPlan(120, { pattern: { subdivision: 2 }, countInBars: 1 });
  const ev = plan.eventsIn(0, 3 - 1e-9);
  assert.deepEqual(ev.filter((e) => e.role === "countIn").map((e) => e.time), [0, 0.5, 1, 1.5]);
  const music = ev.filter((e) => e.role === "music");
  assert.equal(music[0].time, 2);
  assert.equal(music[0].bar, 0);
  assert.equal(music.length, 4);
});

test("muted units keep the grid", () => {
  const meter = T.makeMeter(4, 4);
  const pattern = T.makePattern({ meter, accents: [4, 0, 2, 0], subLevel: 0 });
  const plan = T.PlaybackPlan.click({ pattern, tempo: T.makeTempo(120) });
  assert.deepEqual(plan.eventsIn(0, 2 - 1e-9).map((e) => e.time), [0, 1]);
});

test("tempo change at next bar keeps earlier events identical", () => {
  const original = quarterPlan(112.3, { pattern: { subdivision: 2 }, countInBars: 1, startTime: 5.25 });
  const now = 12.34;
  const bar = original.firstBarAtOrAfter(now);
  const boundary = original.startTimeOfBar(bar);
  assert.ok(boundary >= now && original.startTimeOfBar(bar - 1) < now);
  const changed = original.changingTempo(T.makeTempo(117.3), bar);
  assert.deepEqual(changed.eventsIn(0, boundary), original.eventsIn(0, boundary));
  const after = changed.eventsIn(boundary, boundary + 10);
  assert.equal(after[0].time, boundary);
  assert.equal(after[0].level, T.LEVEL.downbeat);
  after.forEach((e, k) => assert.ok(Math.abs(e.time - (boundary + k * 60 / 117.3 / 2)) < 1e-9));
});

test("pattern change at next bar switches meter cleanly", () => {
  const plan = quarterPlan(120);
  const changed = plan.changingPattern(T.makePattern({ meter: T.makeMeter(7, 8) }), 2);
  assert.equal(changed.startTimeOfBar(2), 4);
  // 7/8 at quarter = 120 → 3.5 quarters = 1.75 s per bar.
  const ev = changed.eventsIn(4, 4 + 1.75 - 1e-9);
  assert.equal(ev.length, 7);
  assert.deepEqual(ev.map((e) => e.level), [4, 2, 3, 2, 3, 2, 2]);
});

test("firstBarAtOrAfter", () => {
  const plan = quarterPlan(120, { countInBars: 1 });
  assert.equal(plan.firstBarAtOrAfter(0), -1);
  assert.equal(plan.firstBarAtOrAfter(0.01), 0);
  assert.equal(plan.firstBarAtOrAfter(2), 0);
  assert.equal(plan.firstBarAtOrAfter(2.01), 1);
  assert.equal(plan.firstBarAtOrAfter(202), 100);
});

test("invalid plans are rejected", () => {
  const pattern = T.makePattern({ meter: T.makeMeter(4, 4) });
  const tempo = T.makeTempo(120);
  assert.throws(() => new T.PlaybackPlan([]));
  assert.throws(() => new T.PlaybackPlan([T.makeSegment({ pattern, tempo }), T.makeSegment({ pattern, tempo, bars: 1 })]));
  assert.throws(() => new T.PlaybackPlan([T.makeSegment({ pattern, tempo, bars: 0 })]));
});

test("beat grids follow the tempo's beat unit", () => {
  const four = T.makePattern({ meter: T.makeMeter(4, 4), subdivision: 2 });
  assert.deepEqual(T.beatGrids(four, 1 / 4), [0, 2, 4, 6]);
  const six = T.makePattern({ meter: T.makeMeter(6, 8) });
  assert.deepEqual(T.beatGrids(six, 3 / 8), [0, 3]);
  const seven = T.makePattern({ meter: T.makeMeter(7, 8) });
  assert.deepEqual(T.beatGrids(seven, 1 / 8), [0, 1, 2, 3, 4, 5, 6]);
});

test("tempo change on the next beat lands mid-bar and keeps the bar counting", () => {
  const plan = quarterPlan(120, { pattern: { subdivision: 2 } });
  // At t = 0.3 s the next beat is beat 2 of bar 0 (t = 0.5, grid 2).
  const pos = plan.firstBoundaryAtOrAfter(0.3, "beat");
  assert.deepEqual(pos, { bar: 0, grid: 2 });
  const changed = plan.changingTempoAt(T.makeTempo(60), pos);
  assert.deepEqual(changed.eventsIn(0, 0.5), plan.eventsIn(0, 0.5));
  const after = changed.eventsIn(0.5, 9);
  // From beat 2: eighths at 60 BPM = 0.5 s apart.
  after.forEach((e, k) => assert.ok(Math.abs(e.time - (0.5 + k * 0.5)) < 1e-9));
  assert.deepEqual(after.slice(0, 5).map((e) => [e.bar, e.unit, e.sub]), [[0, 1, 0], [0, 1, 1], [0, 2, 0], [0, 2, 1], [0, 3, 0]]);
  assert.equal(after[6].bar, 1);
  assert.equal(after[6].level, T.LEVEL.downbeat);
  assert.equal(changed.startTimeOfBar(1), 3.5);
});

test("next beat in 6/8 is the next dotted quarter", () => {
  const meter = T.makeMeter(6, 8);
  const plan = T.PlaybackPlan.click({ pattern: T.makePattern({ meter }), tempo: T.makeTempo(60, meter.defaultBeatUnit) });
  assert.deepEqual(plan.firstBoundaryAtOrAfter(0.1, "beat"), { bar: 0, grid: 3 });
  assert.deepEqual(plan.firstBoundaryAtOrAfter(1.1, "beat"), { bar: 1, grid: 0 });
});

test("pattern change after a mid-bar tempo change still lands on the bar line", () => {
  const plan = quarterPlan(120).changingTempoAt(T.makeTempo(100), { bar: 0, grid: 1 });
  const changed = plan.changingPattern(T.makePattern({ meter: T.makeMeter(3, 4) }), 1);
  const bar1 = changed.startTimeOfBar(1);
  assert.ok(Math.abs(bar1 - (0.5 + 3 * 0.6)) < 1e-9);
  assert.deepEqual(changed.eventsIn(bar1, bar1 + 1.8 - 1e-9).map((e) => e.level), [4, 2, 2]);
  assert.throws(() => plan.changingAt({ bar: 0, grid: 2 }, (s) => ({ ...s, pattern: T.makePattern({ meter: T.makeMeter(3, 4) }) })));
});

test("segment spans tile the timeline for a practice ladder", () => {
  const meter = T.makeMeter(4, 4);
  const play = T.makePattern({ meter, subdivision: 2 });
  const silent = T.makePattern({ meter, accents: [0, 0, 0, 0], subLevel: 0 });
  const countIn = T.makePattern({ meter });
  const t1 = T.makeTempo(120), t2 = T.makeTempo(150);
  const plan = new T.PlaybackPlan([
    T.makeSegment({ pattern: countIn, tempo: t1, bars: 1, role: "countIn" }),
    T.makeSegment({ pattern: play, tempo: t1, bars: 2 }),
    T.makeSegment({ pattern: silent, tempo: t2, bars: 3 }),
    T.makeSegment({ pattern: countIn, tempo: t2, bars: 1, role: "countIn" }),
    T.makeSegment({ pattern: play, tempo: t2, bars: 2 }),
  ], 1);
  assert.equal(plan.segmentCount, 5);
  const spans = [0, 1, 2, 3, 4].map((i) => plan.segmentSpan(i));
  assert.deepEqual(spans.map((s) => +s.start.toFixed(9)), [1, 3, 7, 11.8, 13.4]);
  for (let i = 1; i < 5; i++) assert.equal(spans[i].start, spans[i - 1].end);
  assert.ok(Math.abs(plan.endTime - 16.6) < 1e-9);
  // The rest is silent: no events between the end of stage 1 and the count-in.
  assert.equal(plan.eventsIn(spans[2].start, spans[2].end).length, 0);
  assert.equal(plan.eventsIn(spans[3].start, spans[3].end).every((e) => e.role === "countIn"), true);
  assert.equal(plan.segmentSpan(9), null);
});

test("'step' boundary is the very next grid point", () => {
  const plan = quarterPlan(120, { pattern: { subdivision: 2 } });
  assert.deepEqual(plan.firstBoundaryAtOrAfter(0.3, "step"), { bar: 0, grid: 2 });
  assert.deepEqual(plan.firstBoundaryAtOrAfter(0.26, "step"), { bar: 0, grid: 2 });
  assert.deepEqual(plan.firstBoundaryAtOrAfter(0.2, "step"), { bar: 0, grid: 1 });
  const changed = plan.changingTempoAt(T.makeTempo(60), plan.firstBoundaryAtOrAfter(0.2, "step"));
  assert.deepEqual(changed.eventsIn(0, 0.25), plan.eventsIn(0, 0.25));
  assert.ok(Math.abs(changed.eventsIn(0.25, 2)[1].time - 0.75) < 1e-9); // from 0.25 s, eighths 0.5 s apart
});

test("accents can change mid-bar; meter or subdivision cannot", () => {
  const meter = T.makeMeter(4, 4);
  const plan = quarterPlan(120);
  const accented = T.makePattern({ meter, accents: [4, 0, 3, 2] });
  const changed = plan.changingAt({ bar: 0, grid: 1 }, (s) => ({ ...s, pattern: accented }));
  assert.deepEqual(changed.eventsIn(0, 2 - 1e-9).map((e) => [e.unit, e.level]), [[0, 4], [2, 3], [3, 2]]);
  assert.deepEqual(changed.eventsIn(2, 4 - 1e-9).map((e) => e.level), [4, 3, 2]);
  assert.throws(() => plan.changingAt({ bar: 0, grid: 1 }, (s) => ({ ...s, pattern: T.makePattern({ meter, subdivision: 2 }) })));
  assert.throws(() => plan.changingAt({ bar: 0, grid: 1 }, (s) => ({ ...s, pattern: T.makePattern({ meter: T.makeMeter(3, 4) }) })));
});

// ---------- gap click ----------
const GAP_SEQUENCE_12345_30 = "0000001000000001000000000101011000011001000100000110001000110000"; // must match the Swift core (GapTests)

test("cycle gaps: play 2 bars, 2 silent, repeating; count-in never silent", () => {
  const plan = quarterPlan(120, { countInBars: 1, gaps: { mode: "cycle", play: 2, mute: 2 } });
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((b) => plan.isGapBar(b)), [false, false, true, true, false, false, true, true]);
  assert.equal(plan.isGapBar(-1), false);
  const audible = plan.eventsIn(0, 2 + 8 * 2 - 1e-9);
  assert.equal(audible.filter((e) => e.role === "countIn").length, 4);
  assert.deepEqual([...new Set(audible.filter((e) => e.role === "music").map((e) => e.bar))], [0, 1, 4, 5]);
  const all = plan.eventsIn(0, 18 - 1e-9, { includeGaps: true });
  assert.equal(all.filter((e) => e.gap).length, 16);
  assert.ok(all.filter((e) => e.gap).every((e) => [2, 3, 6, 7].includes(e.bar)));
});

test("random gaps are reproducible from the seed and follow the rules", () => {
  const make = (seed) => quarterPlan(120, { gaps: { mode: "random", percent: 30, seed } });
  const seq = (p) => Array.from({ length: 64 }, (_, b) => (p.isGapBar(b) ? 1 : 0)).join("");
  assert.equal(seq(make(12345)), GAP_SEQUENCE_12345_30);
  assert.equal(seq(make(12345)), seq(make(12345)));
  assert.notEqual(seq(make(12345)), seq(make(777)));
  const long = make(42);
  const bars = Array.from({ length: 5000 }, (_, b) => long.isGapBar(b));
  assert.equal(bars[0] || bars[1], false, "warm-up bars are never silent");
  for (let b = 2; b < bars.length; b++) assert.ok(!(bars[b] && bars[b - 1] && bars[b - 2]), `3 silent bars in a row at ${b}`);
  const share = bars.filter(Boolean).length / bars.length;
  assert.ok(share > 0.2 && share < 0.32, `share ${share}`);
});

test("gaps never move clicks and survive tempo changes", () => {
  const plain = quarterPlan(120, { pattern: { subdivision: 2 } });
  const gapped = plain.withGaps({ mode: "cycle", play: 1, mute: 1 });
  const all = gapped.eventsIn(0, 8, { includeGaps: true });
  assert.deepEqual(all.map((e) => e.time), plain.eventsIn(0, 8).map((e) => e.time));
  const changed = gapped.changingTempoAt(T.makeTempo(90), { bar: 1, grid: 0 });
  assert.equal(changed.isGapBar(1), true);
  assert.deepEqual(changed.gaps, gapped.gaps);
  // adjacent windows still never repeat or skip
  let got = [];
  for (let t = 0; t < 20; t += 0.137) got = got.concat(changed.eventsIn(t, Math.min(20, t + 0.137)));
  assert.deepEqual(got, changed.eventsIn(0, 20));
});

// ---------- swing ----------
test("swing delays only the second note of each pair; beats stay exact", () => {
  const meter = T.makeMeter(4, 4);
  const eighths = T.PlaybackPlan.click({ pattern: T.makePattern({ meter, subdivision: 2, swing: 60 }), tempo: T.makeTempo(120) });
  // Beat = 0.5 s; the off-eighth lands at 60% of the beat (0.3 s) instead of 0.25 s.
  const ev = eighths.eventsIn(0, 2 - 1e-9);
  assert.deepEqual(ev.map((e) => +e.time.toFixed(9)), [0, 0.3, 0.5, 0.8, 1, 1.3, 1.5, 1.8]);
  const sixteenths = T.PlaybackPlan.click({ pattern: T.makePattern({ meter, subdivision: 4, swing: 60 }), tempo: T.makeTempo(120) });
  // Sixteenths pair within each eighth: 0, 0.15, 0.25, 0.4, 0.5 …
  assert.deepEqual(sixteenths.eventsIn(0, 0.5 + 1e-9).map((e) => +e.time.toFixed(9)), [0, 0.15, 0.25, 0.4, 0.5]);
  // Triplet swing ≈ 67%
  const triplet = T.PlaybackPlan.click({ pattern: T.makePattern({ meter, subdivision: 2, swing: 67 }), tempo: T.makeTempo(120) });
  assert.ok(Math.abs(triplet.eventsIn(0, 0.5)[1].time - 0.335) < 1e-9);
});

test("swing ignores subdivisions that don't pair, and is bounded", () => {
  const meter = T.makeMeter(4, 4);
  const triplets = T.PlaybackPlan.click({ pattern: T.makePattern({ meter, subdivision: 3, swing: 70 }), tempo: T.makeTempo(120) });
  assert.deepEqual(triplets.eventsIn(0, 0.5 - 1e-9).map((e) => +e.time.toFixed(9)), [0, +(0.5 / 3).toFixed(9), +(1 / 3).toFixed(9)]);
  assert.throws(() => T.makePattern({ meter, subdivision: 2, swing: 80 }));
  assert.throws(() => T.makePattern({ meter, subdivision: 2, swing: 40 }));
  // Heaviest swing still keeps every note in order.
  const heavy = T.PlaybackPlan.click({ pattern: T.makePattern({ meter, subdivision: 8, swing: 75 }), tempo: T.makeTempo(300) });
  const times = heavy.eventsIn(0, 10).map((e) => e.time);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
});

test("swing: windows stay exact and swing can change mid-bar", () => {
  const meter = T.makeMeter(4, 4);
  const plan = T.PlaybackPlan.click({ pattern: T.makePattern({ meter, subdivision: 2, swing: 64 }), tempo: T.makeTempo(97) });
  let got = [];
  for (let t = 0; t < 30; t += 0.0737) got = got.concat(plan.eventsIn(t, Math.min(30, t + 0.0737)));
  assert.deepEqual(got, plan.eventsIn(0, 30));
  const straight = T.makePattern({ meter, subdivision: 2 });
  const changed = plan.changingAt({ bar: 0, grid: 2 }, (s) => ({ ...s, pattern: straight }));
  const ev = changed.eventsIn(0, 60 / 97 * 4 - 1e-9).map((e) => e.time / (60 / 97));
  assert.ok(Math.abs(ev[1] - 0.64) < 1e-9, "first pair still swung");
  assert.ok(Math.abs(ev[3] - 1.5) < 1e-9, "straight from beat 2");
});
