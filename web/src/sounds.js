/*
 * POCKET click sounds — synthesized, deterministic, no recordings.  (v2)
 *
 * Each kit is a recipe of layers. Layer types:
 *   sine | tri | square   tonal partials, optional pitch sweep at the strike
 *   noise                 filtered noise (strikes, air)
 *   metal                 six detuned squares at the classic 808 cymbal ratios
 * Envelopes: attack, optional hold, then a fast decay plus an optional slower
 * second decay (decay2 / mix2), like real struck objects. A kit can add a short
 * "room" (a few low-passed early reflections) for body.
 *
 * Voices (downbeat, group, normal, sub, countIn) are normalized by loudness
 * (RMS over the first 30 ms) rather than peak, so a short digital tick and a
 * ringing cowbell sit at a similar level; peaks never exceed 0.95.
 *
 * Pure functions: the app copies the arrays into AudioBuffers; tests run in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PocketSounds = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PEAK = 0.95;
  // Loudness targets (RMS over the first 30 ms) per voice.
  // Set low enough that even very short, spiky sounds (tick, hi-hat, digital)
  // reach their target below the peak cap, so accents stay louder in every kit.
  const LEVEL_RMS = { downbeat: 0.16, group: 0.132, normal: 0.108, sub: 0.108, countIn: 0.12 };
  // Pitch factors with accentStyle "pitch": +4 and +2 semitones for accents.
  const LEVEL_PITCH = { downbeat: 1.26, group: 1.12, normal: 1, sub: 0.97 };
  const METAL_RATIOS = [205.3, 304.4, 369.6, 522.7, 540, 800];

  /** Count-in: two hickory sticks clicked together, the way drummers count off. */
  const STICKS = {
    dur: 0.08, room: 0.6,
    layers: [
      { type: "noise", decay: 0.004, amp: 1, filter: [{ type: "bandpass", f: 3100, q: 1.8 }] },
      { type: "sine", freq: 2280, decay: 0.014, amp: 0.55, sweep: { from: 1.06, time: 0.003 } },
      { type: "sine", freq: 3560, decay: 0.007, amp: 0.3 },
      { type: "sine", freq: 1180, decay: 0.01, amp: 0.25 },
    ],
  };

  const KITS = [
    {
      id: "wood", label: "Wood block", note: "Warm, hollow",
      recipe: { dur: 0.13, room: 0.5, layers: [
        { type: "sine", freq: 760, decay: 0.05, amp: 1, sweep: { from: 1.05, time: 0.004 } },
        { type: "sine", freq: 1985, decay: 0.019, amp: 0.38 },
        { type: "sine", freq: 3120, decay: 0.008, amp: 0.15 },
        { type: "noise", decay: 0.003, amp: 0.4, filter: [{ type: "bandpass", f: 1500, q: 1.2 }] },
      ] },
    },
    {
      id: "tick", label: "Tick", note: "Mechanical metronome",
      recipe: { dur: 0.06, room: 0.35, layers: [
        { type: "noise", decay: 0.0025, amp: 1, filter: [{ type: "bandpass", f: 2600, q: 2 }] },
        { type: "noise", decay: 0.0018, amp: 0.55, delay: 0.0016, filter: [{ type: "bandpass", f: 4200, q: 3 }] },
        { type: "sine", freq: 1820, decay: 0.012, amp: 0.45 },
        { type: "sine", freq: 640, decay: 0.009, amp: 0.25 },
      ] },
    },
    {
      id: "clave", label: "Clave", note: "Bright, cutting",
      recipe: { dur: 0.14, room: 0.45, layers: [
        { type: "sine", freq: 2350, decay: 0.055, amp: 1, sweep: { from: 1.025, time: 0.003 } },
        { type: "sine", freq: 3620, decay: 0.012, amp: 0.12 },
        { type: "sine", freq: 820, decay: 0.01, amp: 0.12 },
        { type: "noise", decay: 0.0015, amp: 0.3, filter: [{ type: "bandpass", f: 2400, q: 4 }] },
      ] },
    },
    {
      id: "rim", label: "Rim", note: "Cross-stick",
      recipe: { dur: 0.13, room: 0.7, layers: [
        { type: "tri", freq: 455, decay: 0.022, amp: 0.85, filter: [{ type: "highpass", f: 250, q: 0.7 }] },
        { type: "tri", freq: 1667, decay: 0.011, amp: 0.55 },
        { type: "noise", decay: 0.006, amp: 0.6, filter: [{ type: "bandpass", f: 2300, q: 1.1 }] },
        { type: "noise", decay: 0.0012, amp: 0.35, filter: [{ type: "highpass", f: 5000, q: 0.7 }] },
      ] },
    },
    {
      id: "cowbell", label: "Cowbell", note: "Two-tone, rings",
      recipe: { dur: 0.32, room: 0.3, layers: [
        { type: "square", freq: 540, decay: 0.018, decay2: 0.15, mix2: 0.38, amp: 0.6, filter: [{ type: "bandpass", f: 1000, q: 1.1 }, { type: "lowpass", f: 5000, q: 0.7 }] },
        { type: "square", freq: 800, decay: 0.018, decay2: 0.15, mix2: 0.38, amp: 0.6, filter: [{ type: "bandpass", f: 1000, q: 1.1 }, { type: "lowpass", f: 5000, q: 0.7 }] },
        { type: "noise", decay: 0.002, amp: 0.15, filter: [{ type: "highpass", f: 3000, q: 0.7 }] },
      ] },
    },
    {
      id: "hat", label: "Hi-hat", note: "Closed, metallic",
      recipe: { dur: 0.1, layers: [
        { type: "metal", freq: 1, decay: 0.032, amp: 1, attack: 0.0004, filter: [{ type: "highpass", f: 7200, q: 0.7 }, { type: "bandpass", f: 10200, q: 0.9 }] },
        { type: "noise", decay: 0.014, amp: 0.3, filter: [{ type: "highpass", f: 9000, q: 0.7 }] },
      ] },
    },
    {
      id: "beep", label: "Beep", note: "Pure tone, accent a fifth up",
      pitch: { downbeat: 1.5, group: 1.25, normal: 1, sub: 0.84 },
      recipe: { dur: 0.08, layers: [
        { type: "sine", freq: 1000, attack: 0.0015, hold: 0.022, decay: 0.012, amp: 1 },
        { type: "sine", freq: 2000, attack: 0.0015, hold: 0.022, decay: 0.008, amp: 0.06 },
      ] },
    },
    {
      id: "digital", label: "Digital", note: "Short, precise",
      recipe: { dur: 0.03, layers: [
        { type: "square", freq: 1800, attack: 0.0002, hold: 0.0015, decay: 0.003, amp: 1, filter: [{ type: "highpass", f: 600, q: 0.7 }, { type: "lowpass", f: 9000, q: 0.7 }] },
      ] },
    },
  ];

  const ACCENT_STYLES = [
    { id: "pitch", label: "Pitch and volume" },
    { id: "level", label: "Volume only" },
  ];
  const COUNT_IN_SOUNDS = [
    { id: "sticks", label: "Sticks" },
    { id: "kit", label: "Same kit, lower" },
  ];

  // ---------- tiny DSP ----------
  /** RBJ cookbook biquad coefficients (bandpass = constant 0 dB peak gain). */
  function biquad(type, f, q, sr) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === "lowpass") { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
    else if (type === "highpass") { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; }
    const a0 = 1 + alpha;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
  }
  function filterInPlace(x, c) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const y = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
      x[i] = y;
    }
  }
  /**
   * Band-limited waveforms: odd harmonics only up to 0.45 × the sample rate, so
   * nothing folds back as aliasing (a naive square wave sounds gritty).
   */
  function wave(type, ph, f, sr) {
    if (type === "sine") return Math.sin(ph);
    const limit = 0.45 * sr;
    let v = 0;
    if (type === "square") {
      for (let k = 1; k * f < limit; k += 2) v += Math.sin(k * ph) / k;
      return (4 / Math.PI) * v;
    }
    // triangle
    for (let k = 1, sign = 1; k * f < limit; k += 2, sign = -sign) v += (sign * Math.sin(k * ph)) / (k * k);
    return (8 / (Math.PI * Math.PI)) * v;
  }

  function renderLayer(layer, n, sr, pitch, decayScale, rnd) {
    const buf = new Float32Array(n);
    const attack = layer.attack || 0.0004;
    const hold = layer.hold || 0;
    const decay = layer.decay * decayScale;
    const decay2 = layer.decay2 ? layer.decay2 * decayScale : 0;
    const mix2 = layer.mix2 || 0;
    const delay = Math.round((layer.delay || 0) * sr);
    const f0 = (layer.freq || 0) * pitch;
    const sweep = layer.sweep;
    let phase = 0;
    const phases = METAL_RATIOS.map(() => 0);
    for (let i = delay; i < n; i++) {
      const t = (i - delay) / sr;
      let v;
      if (layer.type === "noise") v = rnd();
      else if (layer.type === "metal") {
        v = 0;
        for (let k = 0; k < METAL_RATIOS.length; k++) {
          const fk = METAL_RATIOS[k] * pitch;
          phases[k] += (2 * Math.PI * fk) / sr;
          v += wave("square", phases[k], fk, sr);
        }
        v /= METAL_RATIOS.length;
      } else {
        const f = sweep ? f0 * (1 + (sweep.from - 1) * Math.exp(-t / sweep.time)) : f0;
        phase += (2 * Math.PI * f) / sr;
        v = wave(layer.type, phase, f, sr);
      }
      const after = Math.max(0, t - hold);
      let env = (1 - mix2) * Math.exp(-after / decay) + (decay2 ? mix2 * Math.exp(-after / decay2) : 0);
      env *= Math.min(1, t / attack);
      buf[i] = v * env;
    }
    for (const f of layer.filter || []) filterInPlace(buf, biquad(f.type, f.f * (f.type === "highpass" ? 1 : pitch), f.q, sr));
    return buf;
  }

  /** Render one recipe at `pitch`, normalized to loudness `targetRms`. */
  function render(recipe, sr, pitch, targetRms, decayScale = 1) {
    const roomTail = recipe.room ? 0.03 : 0;
    const n = Math.max(1, Math.round((recipe.dur * decayScale + roomTail) * sr));
    const out = new Float32Array(n);
    let seed = 0x2f6b;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
    for (const layer of recipe.layers) {
      const buf = renderLayer(layer, n, sr, pitch, decayScale, rnd);
      for (let i = 0; i < n; i++) out[i] += buf[i] * layer.amp;
    }
    if (recipe.room) {
      // A few early reflections, low-passed, for body (a small practice room).
      const dry = Float32Array.from(out);
      const wet = Float32Array.from(dry);
      filterInPlace(wet, biquad("lowpass", 3500, 0.7, sr));
      for (const [ms, g] of [[6.7, 0.22], [11.3, 0.15], [17.9, 0.1], [26.1, 0.06]]) {
        const d = Math.round((ms / 1000) * sr);
        for (let i = d; i < n; i++) out[i] += wet[i - d] * g * recipe.room;
      }
    }
    // Fade the last 4 ms so a voice never ends on a click of its own.
    const fade = Math.min(n, Math.round(sr * 0.004));
    for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
    // Loudness normalization over the first 30 ms, capped by peak.
    const win = Math.min(n, Math.round(sr * 0.03));
    let sum = 0, max = 0;
    for (let i = 0; i < win; i++) sum += out[i] * out[i];
    for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(out[i]));
    const rms = Math.sqrt(sum / win);
    if (rms > 0 && max > 0) {
      const g = Math.min(targetRms / rms, MAX_PEAK / max);
      for (let i = 0; i < n; i++) out[i] *= g;
    }
    return out;
  }

  /**
   * All voices of a kit at sample rate `sr`.
   * opts.accentStyle: "pitch" (default) or "level"; opts.countIn: "sticks" (default) or "kit".
   */
  function buildKit(id, sr, opts = {}) {
    const kit = KITS.find((k) => k.id === id) || KITS[0];
    const pitches = opts.accentStyle === "level" ? { downbeat: 1, group: 1, normal: 1, sub: 1 } : (kit.pitch || LEVEL_PITCH);
    const voices = {};
    for (const level of ["downbeat", "group", "normal", "sub"]) voices[level] = render(kit.recipe, sr, pitches[level], LEVEL_RMS[level]);
    voices.countIn = opts.countIn === "kit"
      ? render(kit.recipe, sr, 0.75, LEVEL_RMS.countIn, 1.6)
      : render(STICKS, sr, 1, LEVEL_RMS.countIn);
    return voices;
  }

  return { KITS, ACCENT_STYLES, COUNT_IN_SOUNDS, LEVEL_RMS, MAX_PEAK, buildKit, render, biquad };
});
