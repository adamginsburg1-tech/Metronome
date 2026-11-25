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
