/*
 * POCKET web timing core — a port of Domain/Timing (Swift) to plain JS.
 *
 * Same model as the Swift package: meter + grouping, tempo relative to an
 * explicit beat unit, click pattern (accent map per meter unit, subdivision
 * grid), and an immutable PlaybackPlan made of segments.
 *
 * Difference: times are seconds on the AudioContext clock (doubles), because
 * Web Audio schedules in seconds and converts to frames itself. Drift-freedom
 * comes from the same rule: every event time is computed directly as
 * `anchor + k * step`, never by adding intervals.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PocketTiming = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LEVEL = Object.freeze({ muted: 0, sub: 1, normal: 2, group: 3, downbeat: 4 });
  const LEVEL_NAMES = ["muted", "sub", "normal", "group", "downbeat"];
  const TEMPO_MIN = 20;
  const TEMPO_MAX = 300;
  const DENOMINATORS = [1, 2, 4, 8, 16, 32];

  class TimingError extends Error {}

  function defaultGrouping(num, den) {
    if (den < 8 || num <= 3) return Array(num).fill(1);
    if (num % 3 === 0) return Array(num / 3).fill(3);
    if (num % 2 === 0) return Array(num / 2).fill(2);
    return Array((num - 3) / 2).fill(2).concat([3]);
  }

  function makeMeter(num, den, grouping) {
    if (!Number.isInteger(num) || num < 1 || num > 32) throw new TimingError(`numerator ${num} must be 1…32`);
    if (!DENOMINATORS.includes(den)) throw new TimingError(`denominator ${den} must be a power of two up to 32`);
    const groups = grouping ? grouping.slice() : defaultGrouping(num, den);
    if (!groups.length || groups.some((g) => !Number.isInteger(g) || g < 1)) throw new TimingError(`invalid grouping ${groups}`);
    if (groups.reduce((a, b) => a + b, 0) !== num) throw new TimingError(`grouping ${groups.join("+")} must add up to ${num}`);
    const groupStarts = [];
    let p = 0;
    for (const g of groups) { groupStarts.push(p); p += g; }
    const compound = den >= 8 && num > 3 && num % 3 === 0;
    return Object.freeze({
      num, den, grouping: Object.freeze(groups), groupStarts: Object.freeze(groupStarts), compound,
      unitWhole: 1 / den,
      defaultBeatUnit: compound ? 3 / den : 1 / den,
      label: `${num}/${den}` + (groups.every((g) => g === 1) || compound ? "" : ` (${groups.join("+")})`),
    });
  }

  function defaultAccents(meter) {
    const map = Array(meter.num).fill(LEVEL.normal);
    if (meter.grouping.some((g) => g > 1)) for (const s of meter.groupStarts) map[s] = LEVEL.group;
    map[0] = LEVEL.downbeat;
    return map;
  }

  function makePattern({ meter, subdivision = 1, accents, subLevel = LEVEL.sub }) {
    if (!Number.isInteger(subdivision) || subdivision < 1 || subdivision > 8) throw new TimingError(`subdivision ${subdivision} must be 1…8`);
    const map = accents ? accents.slice() : defaultAccents(meter);
    if (map.length !== meter.num) throw new TimingError(`expected ${meter.num} accents, got ${map.length}`);
    return Object.freeze({
      meter, subdivision, accents: Object.freeze(map), subLevel,
      eventsPerBar: meter.num * subdivision,
      stepWhole: meter.unitWhole / subdivision,
    });
  }

  function levelAt(pattern, gridIndex) {
    return gridIndex % pattern.subdivision === 0 ? pattern.accents[gridIndex / pattern.subdivision] : pattern.subLevel;
  }

  /** BPM stored to 0.01 precision, 20–300, relative to `beatUnit` (fraction of a whole note). */
  function makeTempo(bpm, beatUnit = 1 / 4) {
    const rounded = Math.round(bpm * 100) / 100;
    if (!Number.isFinite(rounded) || rounded < TEMPO_MIN || rounded > TEMPO_MAX) throw new TimingError(`tempo ${bpm} must be ${TEMPO_MIN}–${TEMPO_MAX} BPM`);
    if (!(beatUnit > 0)) throw new TimingError("beat unit must be positive");
    return Object.freeze({ bpm: rounded, beatUnit, secondsPerWhole: 60 / (rounded * beatUnit) });
  }

  /**
   * A run of events with one pattern and one tempo. Give `bars` (whole bars) or
   * `events` (grid steps); leave both null for "until stopped" (last segment only).
   * A segment may start mid-bar (after a tempo change on a beat); it then
   * continues the bar it starts in. A *pattern* may only change on a bar line.
   */
  function makeSegment({ pattern, tempo, bars = null, events = null, role = "music" }) {
    return Object.freeze({ pattern, tempo, bars, events, role });
  }

  /** True when two patterns share a bar grid (same meter and subdivision); accents may differ. */
  function sameGrid(a, b) {
    return !!a && !!b && a.meter.num === b.meter.num && a.meter.den === b.meter.den && a.subdivision === b.subdivision;
  }

  /** Grid indices in a bar that fall on a beat of `beatUnit` (always includes 0). */
  function beatGrids(pattern, beatUnit) {
    const grids = [];
    for (let u = 0; u < pattern.meter.num; u++) {
      const ratio = (u * pattern.meter.unitWhole) / beatUnit;
      if (Math.abs(ratio - Math.round(ratio)) < 1e-9) grids.push(u * pattern.subdivision);
    }
    return grids;
  }

  class PlaybackPlan {
    /** @param segments list of segments (see makeSegment); @param startTime seconds */
    constructor(segments, startTime = 0) {
      if (!segments.length) throw new TimingError("a plan needs at least one segment");
      // Normalize to event counts, then resolve exact anchors and bar positions.
      const normalized = [];
      const resolved = [];
      let anchor = startTime;
      let grid = 0;
      let barsSoFar = 0;
      let prevPattern = null;
      segments.forEach((s, i) => {
        const per = s.pattern.eventsPerBar;
        let events = s.events;
        if (events === null && s.bars !== null) {
          if (!Number.isInteger(s.bars) || s.bars < 1) throw new TimingError(`segment ${i} must have at least one bar`);
          if (grid !== 0) throw new TimingError(`segment ${i} gives whole bars but starts mid-bar`);
          events = s.bars * per;
        }
        if (events !== null && (!Number.isInteger(events) || events < 1)) throw new TimingError(`segment ${i} must have at least one event`);
        if (events === null && i !== segments.length - 1) throw new TimingError("only the last segment may be open-ended");
        // Mid-bar, only the accents may change: the bar's grid (meter and
        // subdivision) has to stay the same or the bar would lose its shape.
        if (grid !== 0 && !sameGrid(s.pattern, prevPattern)) throw new TimingError(`segment ${i} changes meter or subdivision mid-bar`);
        const seg = makeSegment({ pattern: s.pattern, tempo: s.tempo, events, role: s.role });
        normalized.push(seg);
        const step = s.tempo.secondsPerWhole * s.pattern.stepWhole;
        const count = events === null ? Infinity : events;
        resolved.push({ segment: seg, anchor, step, count, barIndex: barsSoFar, startGrid: grid });
        if (events !== null) {
          anchor = anchor + count * step;
          const g = grid + count;
          barsSoFar += Math.floor(g / per);
          grid = g % per;
        }
        prevPattern = s.pattern;
      });
      // Music starts at bar 0; count-in bars are negative.
      let countInBars = 0;
      for (const r of resolved) {
        if (r.segment.role !== "countIn") { countInBars = r.barIndex; break; }
      }
      for (const r of resolved) { r.firstBar = r.barIndex - countInBars; Object.freeze(r); }
      this.segments = Object.freeze(normalized);
      this.startTime = startTime;
      this._r = Object.freeze(resolved);
      Object.freeze(this);
    }

    static click({ pattern, tempo, countInBars = 0, startTime = 0 }) {
      const segments = [];
      if (countInBars > 0) {
        const audible = pattern.accents.map((l) => (l === LEVEL.muted ? LEVEL.normal : l));
        segments.push(makeSegment({ pattern: makePattern({ meter: pattern.meter, subdivision: 1, accents: audible }), tempo, bars: countInBars, role: "countIn" }));
      }
      segments.push(makeSegment({ pattern, tempo }));
      return new PlaybackPlan(segments, startTime);
    }

    get endTime() {
      const last = this._r[this._r.length - 1];
      return last.count === Infinity ? null : last.anchor + last.count * last.step;
    }

    /** Audible events with t0 <= time < t1, in order. Adjacent windows never repeat or skip. */
    eventsIn(t0, t1) {
      const out = [];
      if (!(t1 > t0)) return out;
      for (let i = 0; i < this._r.length; i++) {
        const r = this._r[i];
        if (r.count !== Infinity && r.anchor + r.count * r.step <= t0) continue;
        if (r.anchor >= t1) break;
        const p = r.segment.pattern;
        for (let k = firstK(r, t0); k < r.count; k++) {
          const t = r.anchor + k * r.step;
          if (t >= t1) return out;
          const g = r.startGrid + k;
          const gi = g % p.eventsPerBar;
          const level = levelAt(p, gi);
          if (level === LEVEL.muted) continue;
          out.push({
            time: t, bar: r.firstBar + Math.floor(g / p.eventsPerBar),
            unit: Math.floor(gi / p.subdivision), sub: gi % p.subdivision, grid: gi,
            level, role: r.segment.role, segment: i,
          });
        }
      }
      return out;
    }

    /** Time of a position {bar, grid}; null if outside the plan. */
    timeOf(pos) {
      const loc = this._locate(pos);
      return loc ? this._r[loc.i].anchor + loc.k * this._r[loc.i].step : null;
    }

    startTimeOfBar(bar) { return this.timeOf({ bar, grid: 0 }); }

    /** Start and end time of segment `i` (end is Infinity for an open-ended segment). */
    segmentSpan(i) {
      const r = this._r[i];
      if (!r) return null;
      return { start: r.anchor, end: r.count === Infinity ? Infinity : r.anchor + r.count * r.step };
    }

    get segmentCount() { return this._r.length; }

    /**
     * First boundary at or after `t`. `unit` is "bar" (downbeats), "beat"
     * (beats of each segment's tempo beat unit) or "step" (the very next grid
     * point, for changes that should land immediately). Returns {bar, grid} or null.
     */
    firstBoundaryAtOrAfter(t, unit = "bar") {
      for (const r of this._r) {
        const p = r.segment.pattern;
        const per = p.eventsPerBar;
        const ok = unit === "step" ? null : new Set(unit === "beat" ? beatGrids(p, r.segment.tempo.beatUnit) : [0]);
        for (let k = firstK(r, t); k < r.count; k++) {
          const g = r.startGrid + k;
          if (!ok || ok.has(g % per)) return { bar: r.firstBar + Math.floor(g / per), grid: g % per };
        }
      }
      return null;
    }

    firstBarAtOrAfter(t) {
      const pos = this.firstBoundaryAtOrAfter(t, "bar");
      return pos ? pos.bar : null;
    }

    /** New plan identical before `pos`; `transform(segment) -> segment` applied from there on. */
    changingAt(pos, transform) {
      const loc = this._locate(pos);
      if (!loc) throw new TimingError(`bar ${pos.bar} grid ${pos.grid || 0} is outside the plan`);
      const head = this.segments.slice(0, loc.i);
      const tail = this.segments.slice(loc.i).map((s) => ({ ...s }));
      if (loc.k > 0) {
        head.push(makeSegment({ ...tail[0], events: loc.k }));
        if (tail[0].events !== null) tail[0].events -= loc.k;
      }
      return new PlaybackPlan(head.concat(tail.map((s) => makeSegment({ ...transform(s), bars: null }))), this.startTime);
    }

    changing(fromBar, transform) { return this.changingAt({ bar: fromBar, grid: 0 }, transform); }

    changingTempo(tempo, fromBar) { return this.changingTempoAt(tempo, { bar: fromBar, grid: 0 }); }

    changingTempoAt(tempo, pos) { return this.changingAt(pos, (s) => ({ ...s, tempo })); }

    changingPattern(pattern, fromBar) {
      return this.changing(fromBar, (s) => (s.role === "music" ? { ...s, pattern } : s));
    }

    _locate({ bar, grid = 0 }) {
      for (let i = 0; i < this._r.length; i++) {
        const r = this._r[i];
        const k = (bar - r.firstBar) * r.segment.pattern.eventsPerBar + grid - r.startGrid;
        if (k >= 0 && k < r.count) return { i, k };
      }
      return null;
    }
  }

  /** First event index in `r` whose time is >= t (may equal r.count). */
  function firstK(r, t) {
    const time = (k) => r.anchor + k * r.step;
    let k = Math.max(0, Math.ceil((t - r.anchor) / r.step) - 1);
    if (r.count !== Infinity) k = Math.min(k, r.count);
    while (k > 0 && time(k - 1) >= t) k--;
    while (k < r.count && time(k) < t) k++;
    return k;
  }

  return { LEVEL, LEVEL_NAMES, TEMPO_MIN, TEMPO_MAX, TimingError, makeMeter, defaultAccents, makePattern, levelAt, makeTempo, makeSegment, beatGrids, sameGrid, PlaybackPlan };
});
