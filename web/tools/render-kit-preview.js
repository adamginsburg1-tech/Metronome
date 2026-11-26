// Usage: node web/tools/render-kit-preview.js [out.wav]
// Renders each kit: two stick clicks (count-in), then one bar of 4/4 eighths at 100 BPM.
const fs = require('fs');
const S = require(require("path").join(__dirname, "..", "src", "sounds.js"));
const sr = 44100, beat = 0.6, subGain = 0.55 * 0.55;
const order = S.KITS.map(k => k.id);
const kitLen = beat * 2 + beat * 4 + 1.0;
const total = Math.ceil(sr * kitLen * order.length);
const mix = new Float32Array(total);
const place = (x, t, g = 1) => { const o = Math.round(t * sr); for (let i = 0; i < x.length && o + i < total; i++) mix[o + i] += x[i] * g; };
order.forEach((id, n) => {
  const v = S.buildKit(id, sr);
  const t0 = n * kitLen;
  place(v.countIn, t0); place(v.countIn, t0 + beat);
  const bar = t0 + beat * 2;
  ['downbeat', 'sub', 'normal', 'sub', 'normal', 'sub', 'normal', 'sub'].forEach((lv, i) => place(v[lv], bar + i * beat / 2, lv === 'sub' ? subGain : 1));
});
const pcm = Buffer.alloc(44 + total * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + total * 2, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
pcm.write('data', 36); pcm.writeUInt32LE(total * 2, 40);
for (let i = 0; i < total; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(mix[i] * 32767))), 44 + i * 2);
fs.writeFileSync(process.argv[2] || "click-sounds-preview.wav", pcm);
console.log(`${order.length} kits, ${(total / sr).toFixed(1)} s: ${S.KITS.map(k => k.label).join(', ')}`);
