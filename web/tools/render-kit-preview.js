// Usage: node web/tools/render-kit-preview.js [out.wav]
// Renders every kit (recorded, then synthesized): sticks count-in (two clicks),
// then one bar of 4/4 eighths at 100 BPM, rotating takes like the app does.
const fs = require("fs");
const path = require("path");
const S = require(path.join(__dirname, "..", "src", "sounds.js"));
const samplesDir = path.join(__dirname, "..", "samples");
const sr = 44100, beat = 0.6, subGain = 0.55 * 0.55;

const kits = [];
const index = JSON.parse(fs.readFileSync(path.join(samplesDir, "kits.json"), "utf8"));
for (const k of index.kits) {
  const files = Object.fromEntries(Object.entries(k.levels).map(([lv, takes]) => [lv, takes.map((t) => S.decodeWav(fs.readFileSync(path.join(samplesDir, t.file))))]));
  kits.push({ label: `${k.label} (recorded)`, voices: S.buildSampleKit(files) });
}
for (const k of S.KITS) {
  const v = S.buildKit(k.id, sr);
  kits.push({ label: `${k.label} (synth)`, voices: Object.fromEntries(Object.entries(v).map(([n, x]) => [n, [x]])) });
}

const kitLen = beat * 2 + beat * 4 + 1.0;
const total = Math.ceil(sr * kitLen * kits.length);
const mix = new Float32Array(total);
const place = (x, t, g = 1) => { const o = Math.round(t * sr); for (let i = 0; i < x.length && o + i < total; i++) mix[o + i] += x[i] * g; };
kits.forEach(({ voices }, n) => {
  const counters = {};
  const take = (lv) => { counters[lv] = ((counters[lv] || 0) + 1) % voices[lv].length; return voices[lv][counters[lv]]; };
  const t0 = n * kitLen;
  place(take("countIn"), t0); place(take("countIn"), t0 + beat);
  ["downbeat", "sub", "normal", "sub", "normal", "sub", "normal", "sub"].forEach((lv, i) => place(take(lv), t0 + beat * 2 + i * beat / 2, lv === "sub" ? subGain : 1));
});
// Same master curve as the app at 60% volume, then a safety limit.
const g = Math.pow(0.6, 2) * 1.8;
let pk = 0;
for (let i = 0; i < total; i++) { mix[i] *= g; pk = Math.max(pk, Math.abs(mix[i])); }
if (pk > 0.98) for (let i = 0; i < total; i++) mix[i] *= 0.98 / pk;
const pcm = Buffer.alloc(44 + total * 2);
pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + total * 2, 4); pcm.write("WAVE", 8); pcm.write("fmt ", 12);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
pcm.write("data", 36); pcm.writeUInt32LE(total * 2, 40);
for (let i = 0; i < total; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(mix[i] * 32767))), 44 + i * 2);
const out = process.argv[2] || "click-sounds-preview.wav";
fs.writeFileSync(out, pcm);
console.log(`${kits.length} kits, ${(total / sr).toFixed(1)} s → ${out}\n${kits.map((k) => k.label).join(", ")}`);
