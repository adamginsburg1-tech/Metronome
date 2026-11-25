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

  function makeSegment({ pattern, tempo, bars = null, role = "music" }) {
    return Object.freeze({ pattern, tempo, bars, role });
  }

  class PlaybackPlan {
    /** @param segments list of {pattern, tempo, bars|null, role}; @param startTime seconds */
    constructor(segments, startTime = 0) {
      if (!segments.length) throw new TimingError("a plan needs at least one segment");
      segments.forEach((s, i) => {
        if (s.bars !== null && (!Number.isInteger(s.bars) || s.bars < 1)) throw new TimingError(`segment ${i} must have at least one bar`);
        if (s.bars === null && i !== segments.length - 1) throw new TimingError("only the last segment may be open-ended");
      });
      let countInBars = 0;
      for (const s of segments) { if (s.role !== "countIn") break; countInBars += s.bars || 0; }

      const resolved = [];
      let anchor = startTime;
      let firstBar = -countInBars;
      for (const s of segments) {
        const step = s.tempo.secondsPerWhole * s.pattern.stepWhole;
        const count = s.bars === null ? Infinity : s.bars * s.pattern.eventsPerBar;
        resolved.push(Object.freeze({ segment: s, anchor, step, count, firstBar }));
        if (s.bars !== null) { anchor = anchor + count * step; firstBar += s.bars; }
      }
      this.segments = Object.freeze(segments.slice());
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
        const time = (k) => r.anchor + k * r.step;
        if (r.count !== Infinity && time(r.count) <= t0) continue;
        if (time(0) >= t1) break;
        let k = Math.max(0, Math.ceil((t0 - r.anchor) / r.step) - 1);
        if (r.count !== Infinity) k = Math.min(k, r.count);
        while (k > 0 && time(k - 1) >= t0) k--;
        while (time(k) < t0) k++;
        const p = r.segment.pattern;
        for (; k < r.count; k++) {
          const t = time(k);
          if (t >= t1) return out;
          const g = k % p.eventsPerBar;
          const level = levelAt(p, g);
          if (level === LEVEL.muted) continue;
          out.push({
            time: t, bar: r.firstBar + Math.floor(k / p.eventsPerBar),
            unit: Math.floor(g / p.subdivision), sub: g % p.subdivision,
            level, role: r.segment.role, segment: i,
          });
        }
      }
      return out;
    }

    startTimeOfBar(bar) {
      const i = this._segmentIndexOfBar(bar);
      if (i < 0) return null;
      const r = this._r[i];
      return r.anchor + (bar - r.firstBar) * r.segment.pattern.eventsPerBar * r.step;
    }

    /** First bar starting at or after `t` — where a queued change should land. */
    firstBarAtOrAfter(t) {
      for (const r of this._r) {
        const perBar = r.segment.pattern.eventsPerBar;
        const start = (b) => r.anchor + b * perBar * r.step;
        const bars = r.segment.bars === null ? Infinity : r.segment.bars;
        let b = Math.max(0, Math.ceil((t - r.anchor) / (perBar * r.step)) - 1);
        if (b >= bars) continue;
        while (b > 0 && start(b - 1) >= t) b--;
        while (b < bars && start(b) < t) b++;
        if (b >= bars) continue;
        return r.firstBar + b;
      }
      return null;
    }

    /** New plan identical before `bar`; `transform(segment) -> segment` applied from `bar` on. */
    changing(fromBar, transform) {
      const i = this._segmentIndexOfBar(fromBar);
      if (i < 0) throw new TimingError(`bar ${fromBar} is outside the plan`);
      const r = this._r[i];
      const offset = fromBar - r.firstBar;
      const head = this.segments.slice(0, i);
      const tail = this.segments.slice(i).map((s) => ({ ...s }));
      if (offset > 0) {
        head.push(makeSegment({ ...tail[0], bars: offset }));
        if (tail[0].bars !== null) tail[0].bars -= offset;
      }
      return new PlaybackPlan(head.concat(tail.map((s) => makeSegment(transform(s)))), this.startTime);
    }

    changingTempo(tempo, fromBar) {
      return this.changing(fromBar, (s) => ({ ...s, tempo }));
    }

    changingPattern(pattern, fromBar) {
      return this.changing(fromBar, (s) => (s.role === "music" ? { ...s, pattern } : s));
    }

    _segmentIndexOfBar(bar) {
      for (let i = 0; i < this._r.length; i++) {
        const r = this._r[i];
        if (bar < r.firstBar) continue;
        if (r.segment.bars !== null && bar >= r.firstBar + r.segment.bars) continue;
        return i;
      }
      return -1;
    }
  }

  return { LEVEL, LEVEL_NAMES, TEMPO_MIN, TEMPO_MAX, TimingError, makeMeter, defaultAccents, makePattern, levelAt, makeTempo, makeSegment, PlaybackPlan };
});
