/*
 * POCKET click sounds — synthesized, deterministic, no recordings.
 *
 * Each kit is a recipe of layers (tones and filtered noise with exponential
 * decays). Voices are rendered once per sample rate into Float32Arrays:
 * downbeat, group, normal, sub (subdivision) and countIn. Accented voices are
 * pitched up (or only louder, with accentStyle "level"); every voice is
 * normalized to a fixed peak so kits sit at a similar level.
 *
 * Pure functions, no Web Audio needed: the app copies the arrays into
 * AudioBuffers, and the tests run in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PocketSounds = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Peak level of each voice (before the master and subdivision volumes).
  const LEVEL_PEAK = { downbeat: 0.9, group: 0.76, normal: 0.62, sub: 0.62, countIn: 0.72 };
  // Pitch factors with accentStyle "pitch": +4 and +2 semitones for accents.
  const LEVEL_PITCH = { downbeat: 1.26, group: 1.12, normal: 1, sub: 0.97 };

  /** Count-in: two sticks clicked together, the way drummers count off. */
  const STICKS = {
    dur: 0.07,
    layers: [
      { type: "noise", decay: 0.005, amp: 1, filter: { type: "bandpass", f: 2900, q: 2.5 } },
      { type: "sine", freq: 2150, decay: 0.012, amp: 0.55 },
      { type: "sine", freq: 3400, decay: 0.006, amp: 0.25 },
    ],
  };

  const KITS = [
    {
      id: "wood", label: "Wood block", note: "Warm, hollow",
      recipe: { dur: 0.11, layers: [
        { type: "sine", freq: 820, decay: 0.032, amp: 1 },
        { type: "sine", freq: 2110, decay: 0.012, amp: 0.35 },
        { type: "noise", decay: 0.004, amp: 0.45, filter: { type: "bandpass", f: 1700, q: 3 } },
      ] },
    },
    {
      id: "tick", label: "Tick", note: "Mechanical metronome",
      recipe: { dur: 0.05, layers: [
        { type: "noise", decay: 0.0035, amp: 1, filter: { type: "bandpass", f: 3800, q: 5 } },
        { type: "sine", freq: 1500, decay: 0.006, amp: 0.4 },
      ] },
    },
    {
      id: "clave", label: "Clave", note: "Bright, cutting",
      recipe: { dur: 0.12, layers: [
        { type: "sine", freq: 2450, decay: 0.045, amp: 1 },
        { type: "noise", decay: 0.002, amp: 0.3, filter: { type: "bandpass", f: 2500, q: 6 } },
      ] },
    },
    {
      id: "rim", label: "Rim", note: "Cross-stick",
      recipe: { dur: 0.12, layers: [
        { type: "noise", decay: 0.012, amp: 0.9, filter: { type: "bandpass", f: 1900, q: 1.5 } },
        { type: "sine", freq: 470, decay: 0.03, amp: 0.6 },
        { type: "sine", freq: 1650, decay: 0.015, amp: 0.4 },
      ] },
    },
    {
      id: "cowbell", label: "Cowbell", note: "Two-tone, sustains",
      recipe: { dur: 0.26, layers: [
        { type: "square", freq: 540, decay: 0.085, amp: 0.6, filter: { type: "bandpass", f: 900, q: 1.2 } },
        { type: "square", freq: 800, decay: 0.085, amp: 0.6, filter: { type: "bandpass", f: 900, q: 1.2 } },
        { type: "noise", decay: 0.003, amp: 0.2, filter: { type: "highpass", f: 3000, q: 0.7 } },
      ] },
    },
    {
      id: "hat", label: "Hi-hat", note: "Closed, sits back",
      recipe: { dur: 0.09, layers: [
        { type: "noise", decay: 0.02, amp: 1, filter: { type: "highpass", f: 7000, q: 0.7 } },
        { type: "noise", decay: 0.01, amp: 0.5, filter: { type: "bandpass", f: 10000, q: 1 } },
      ] },
    },
    {
      id: "beep", label: "Beep", note: "Pure tone, accent a fifth up",
      pitch: { downbeat: 1.5, group: 1.25, normal: 1, sub: 0.84 },
      recipe: { dur: 0.09, layers: [
        { type: "sine", freq: 1000, decay: 0.04, amp: 1, attack: 0.0012 },
      ] },
    },
    {
      id: "digital", label: "Digital", note: "Short, precise",
      recipe: { dur: 0.03, layers: [
        { type: "square", freq: 2000, decay: 0.004, amp: 1, filter: { type: "highpass", f: 800, q: 0.7 } },
        { type: "noise", decay: 0.001, amp: 0.3, filter: { type: "highpass", f: 3000, q: 0.7 } },
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

  /** Render one recipe at `pitch` and normalize its peak to `peak`. */
  function render(recipe, sr, pitch, peak, decayScale = 1) {
    const n = Math.max(1, Math.round(recipe.dur * decayScale * sr));
    const out = new Float32Array(n);
    let seed = 0x2f6b;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
    for (const layer of recipe.layers) {
      const buf = new Float32Array(n);
      const f = (layer.freq || 0) * pitch;
      const attack = layer.attack || 0.0004;
      const decay = layer.decay * decayScale;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let v;
        if (layer.type === "noise") v = rnd();
        else if (layer.type === "square") v = Math.sin(2 * Math.PI * f * t) >= 0 ? 1 : -1;
        else v = Math.sin(2 * Math.PI * f * t);
        buf[i] = v * Math.exp(-t / decay) * Math.min(1, t / attack);
      }
      if (layer.filter) filterInPlace(buf, biquad(layer.filter.type, layer.filter.f * pitch, layer.filter.q, sr));
      for (let i = 0; i < n; i++) out[i] += buf[i] * layer.amp;
    }
    // Fade the last 3 ms so a voice never ends on a click of its own.
    const fade = Math.min(n, Math.round(sr * 0.003));
    for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(out[i]));
    if (max > 0) for (let i = 0; i < n; i++) out[i] *= peak / max;
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
    for (const level of ["downbeat", "group", "normal", "sub"]) voices[level] = render(kit.recipe, sr, pitches[level], LEVEL_PEAK[level]);
    voices.countIn = opts.countIn === "kit"
      ? render(kit.recipe, sr, 0.75, LEVEL_PEAK.countIn, 1.6)
      : render(STICKS, sr, 1, LEVEL_PEAK.countIn);
    return voices;
  }

  return { KITS, ACCENT_STYLES, COUNT_IN_SOUNDS, LEVEL_PEAK, buildKit, render, biquad };
});
