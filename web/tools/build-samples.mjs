// Turns raw percussion recordings into POCKET click samples.
//   node web/tools/build-samples.mjs <raw-dir>
// Reads web/samples/manifest.json, writes web/samples/<kit>/<level>-<n>.wav
// (16-bit mono, onset at the start, tail trimmed, loudness-matched) and
// web/samples/kits.json. Raw files stay outside the repo.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(here, "..", "samples");
const rawDir = process.argv[2];
if (!rawDir) { console.error("usage: node web/tools/build-samples.mjs <raw-dir>"); process.exit(2); }

const REF_RMS = 0.108;      // loudness of a "normal" click; the app scales per level
const MAX_PEAK = 0.95;
const LEVELS = ["downbeat", "group", "normal", "sub"];

function decodeWav(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(...buf.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= buf.length;) {
    const id = tag(o), size = view.getUint32(o + 4, true);
    if (id === "fmt ") fmt = { format: view.getUint16(o + 8, true), channels: view.getUint16(o + 10, true), sr: view.getUint32(o + 12, true), bits: view.getUint16(o + 22, true) };
    if (id === "data") data = { offset: o + 8, size: Math.min(size, buf.length - o - 8) };
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("missing fmt or data chunk");
  const { channels, bits, sr } = fmt;
  const bytes = bits / 8, frames = Math.floor(data.size / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = data.offset + (i * channels + c) * bytes;
      let v;
      if (fmt.format === 3 && bits === 32) v = view.getFloat32(p, true);
      else if (bits === 16) v = view.getInt16(p, true) / 32768;
      else if (bits === 24) { let x = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16); if (x & 0x800000) x -= 0x1000000; v = x / 8388608; }
      else if (bits === 32) v = view.getInt32(p, true) / 2147483648;
      else throw new Error(`unsupported ${bits}-bit WAV`);
      sum += v;
    }
    out[i] = sum / channels;
  }
  return { sr, data: out };
}

function encodeWav16(data, sr) {
  const out = Buffer.alloc(44 + data.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + data.length * 2, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sr, 24); out.writeUInt32LE(sr * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  return out;
}

/** Onset at the start, tail trimmed, faded, loudness-matched. */
function prepare({ sr, data }, maxDur) {
  let mean = 0;
  for (const v of data) mean += v;
  mean /= data.length;
  const x = data.map((v) => v - mean);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  // Onset: first sample above 10% of peak, then back up to where the signal is
  // still under 1% of peak (at most 1 ms), so the whole attack is kept.
  let i = x.findIndex((v) => Math.abs(v) >= 0.1 * peak);
  const floor = 0.01 * peak, back = Math.round(sr * 0.001);
  let start = i;
  while (start > 0 && i - start < back && Math.abs(x[start - 1]) > floor) start--;
  if (i - start >= back) start = i - Math.round(sr * 0.0003);
  start = Math.max(0, Math.min(start, i - 8)); // keep the fade-in clear of the attack
  // End: where 10 ms RMS falls below -60 dB of peak, or maxDur.
  const win = Math.round(sr * 0.01);
  let end = Math.min(x.length, start + Math.round(maxDur * sr));
  for (let j = start + win; j < end; j += win) {
    let s = 0;
    for (let k = j; k < j + win && k < x.length; k++) s += x[k] * x[k];
    if (Math.sqrt(s / win) < peak * 0.001) { end = j + win; break; }
  }
  const y = Float32Array.from(x.subarray(start, end));
  const fadeIn = Math.min(4, y.length); // 0.1 ms: removes a step, never touches the attack
  for (let k = 0; k < fadeIn; k++) y[k] *= 0.5 - 0.5 * Math.cos((Math.PI * k) / fadeIn);
  const fadeOut = Math.min(y.length, Math.round(sr * 0.015));
  for (let k = 0; k < fadeOut; k++) y[y.length - 1 - k] *= k / fadeOut;
  const w30 = Math.min(y.length, Math.round(sr * 0.03));
  let s = 0, pk = 0;
  for (let k = 0; k < w30; k++) s += y[k] * y[k];
  for (const v of y) pk = Math.max(pk, Math.abs(v));
  const g = Math.min(REF_RMS / Math.sqrt(s / w30), MAX_PEAK / pk);
  for (let k = 0; k < y.length; k++) y[k] *= g;
  return { y, rawPeak: peak, onsetMs: ((i - start) / sr) * 1000 };
}

const manifest = JSON.parse(readFileSync(join(samplesDir, "manifest.json"), "utf8"));
const kits = [];
for (const kit of manifest.kits) {
  rmSync(join(samplesDir, kit.id), { recursive: true, force: true });
  mkdirSync(join(samplesDir, kit.id), { recursive: true });
  let levels = kit.levels;
  const decoded = new Map();
  const load = (f) => { if (!decoded.has(f)) decoded.set(f, decodeWav(readFileSync(join(rawDir, kit.dir, f)))); return decoded.get(f); };
  if (kit.byLoudness) {
    // Sort hits loudest first and deal them out: downbeat, group, normal, sub.
    const sorted = kit.byLoudness.map((f) => ({ f, pk: load(f).data.reduce((m, v) => Math.max(m, Math.abs(v)), 0) })).sort((a, b) => b.pk - a.pk);
    levels = { downbeat: [sorted[0].f], group: [sorted[Math.min(1, sorted.length - 1)].f], normal: sorted.slice(1, -1).map((s) => s.f), sub: [sorted[sorted.length - 1].f] };
    if (!levels.normal.length) levels.normal = [sorted[0].f];
  }
  const out = { id: kit.id, label: kit.label, note: kit.note, levels: {} };
  for (const level of LEVELS) {
    out.levels[level] = [];
    levels[level].forEach((f, n) => {
      const src = load(f);
      const { y, onsetMs } = prepare(src, kit.maxDur);
      const name = `${level}-${n + 1}.wav`;
      writeFileSync(join(samplesDir, kit.id, name), encodeWav16(y, src.sr));
      out.levels[level].push({ file: `${kit.id}/${name}`, from: f, sr: src.sr, ms: Math.round((y.length / src.sr) * 1000) });
      console.log(`${kit.id.padEnd(8)} ${name.padEnd(13)} ${String(Math.round((y.length / src.sr) * 1000)).padStart(4)} ms  onset ${onsetMs.toFixed(2)} ms after start  ← ${f}`);
    });
  }
  kits.push(out);
}
writeFileSync(join(samplesDir, "kits.json"), JSON.stringify({ source: manifest.source, kits }, null, 2) + "\n");
/**
 * Synthesized drums (ours, so no licence questions): `spec` is a take's settings,
 * e.g. { pitch: 150, click: 1, decay: 0.24, seed: 1 }.
 *  kick: sine falling from `pitch` to 46 Hz (35 ms), body decay `decay` s, a short
 *  filtered-noise and 1.6 kHz click for the beater, gentle saturation.
 */
function synthDrum(kind, spec) {
  const sr = 44100, n = Math.round(sr * 0.5), data = new Float32Array(n);
  let seed = spec.seed >>> 0 || 1;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  if (kind !== "kick") throw new Error(`unknown synth drum ${kind}`);
  // Tuned for small speakers too: a body that ends at 52 Hz, a 2nd harmonic from
  // saturation, and a beater click (noise + 2.8 kHz) so the kick reads on an iPad.
  let phase = 0, lp = 0, hp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 52 + (spec.pitch - 52) * Math.exp(-t / 0.03);
    phase += (2 * Math.PI * f) / sr;
    const attack = Math.min(1, t / 0.001);
    const body = Math.sin(phase) * Math.exp(-t / spec.decay) * attack;
    const punch = 0.35 * Math.sin(2 * phase) * Math.exp(-t / 0.05);
    const white = rnd();
    hp = 0.6 * (hp + white - prev); prev = white;                  // brightened noise for the beater
    lp += 0.5 * (hp - lp);
    const beater = spec.click * (0.9 * lp * Math.exp(-t / 0.003) + 0.45 * Math.sin(2 * Math.PI * 2800 * t) * Math.exp(-t / 0.004));
    data[i] = Math.tanh(2.2 * (body + punch + beater)) / Math.tanh(2.2);
  }
  return { sr, data };
}

// Groove voices (kick, snare, …): one file set per voice and level, written to
// web/samples/drums/<voice>/<level>-<n>.wav and listed in drums.json.
const voices = [];
rmSync(join(samplesDir, "drums"), { recursive: true, force: true });
for (const v of manifest.voices || []) {
  mkdirSync(join(samplesDir, "drums", v.id), { recursive: true });
  const out = { id: v.id, label: v.label, levels: {} };
  for (const [level, files] of Object.entries(v.levels)) {
    out.levels[level] = files.map((f, n) => {
      const src = v.synth ? synthDrum(v.synth, f) : decodeWav(readFileSync(join(rawDir, v.dir, f)));
      const { y, onsetMs } = prepare(src, v.maxDur);
      const file = `drums/${v.id}/${level}-${n + 1}.wav`;
      writeFileSync(join(samplesDir, file), encodeWav16(y, src.sr));
      const from = v.synth ? `synth ${v.synth} ${JSON.stringify(f)}` : f;
      console.log(`${v.id.padEnd(8)} ${level}-${n + 1}  ${String(Math.round((y.length / src.sr) * 1000)).padStart(4)} ms  onset ${onsetMs.toFixed(2)} ms  ← ${from}`);
      return { file, from, sr: src.sr, ms: Math.round((y.length / src.sr) * 1000) };
    });
  }
  voices.push(out);
}
writeFileSync(join(samplesDir, "drums.json"), JSON.stringify({ source: manifest.source, voices }, null, 2) + "\n");
console.log(`wrote ${voices.length} groove voices`);
console.log(`wrote ${kits.length} kits`);
