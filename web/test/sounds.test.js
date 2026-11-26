// Run with: node --test 'web/test/*.test.js'
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/sounds.js");

const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (x, n) => Math.sqrt(x.slice(0, n).reduce((s, v) => s + v * v, 0) / Math.min(n, x.length));

for (const sr of [44100, 48000]) {
  test(`every kit renders clean voices at ${sr} Hz`, () => {
    for (const kit of S.KITS) {
      for (const opts of [{}, { accentStyle: "level" }, { countIn: "kit" }]) {
        const v = S.buildKit(kit.id, sr, opts);
        for (const [name, x] of Object.entries(v)) {
          const where = `${kit.id}/${name} ${JSON.stringify(opts)}`;
          assert.ok(x.length > sr * 0.02 && x.length < sr * 0.6, `${where}: length ${x.length}`);
          assert.ok(x.every(Number.isFinite), `${where}: non-finite sample`);
          assert.ok(peak(x) <= S.MAX_PEAK + 1e-6, `${where}: peak ${peak(x)}`);
          // Loudness hits its target unless the peak cap had to hold it back.
          const loud = rms(x, Math.round(sr * 0.03));
          assert.ok(loud <= S.LEVEL_RMS[name] + 1e-4, `${where}: too loud ${loud}`);
          assert.ok(loud >= S.LEVEL_RMS[name] - 1e-4 || peak(x) >= S.MAX_PEAK - 1e-4, `${where}: too quiet ${loud}`);
          assert.ok(Math.abs(x[0]) < 0.05, `${where}: starts with a jump (${x[0]})`);
          assert.ok(Math.abs(x[x.length - 1]) < 1e-3, `${where}: does not end at silence`);
        }
      }
    }
  });
}

test("accents are louder than normal beats", () => {
  for (const kit of S.KITS) {
    const v = S.buildKit(kit.id, 48000);
    const L = (x) => rms(x, 1440);
    assert.ok(L(v.downbeat) > L(v.group) && L(v.group) > L(v.normal), kit.id);
  }
});

test("kits sit at a similar loudness", () => {
  const levels = S.KITS.map((k) => rms(S.buildKit(k.id, 48000).normal, 1440));
  assert.ok(Math.max(...levels) / Math.min(...levels) < 1.6, levels.map((l) => l.toFixed(3)).join(" "));
});

test("accent style 'pitch' changes pitch; 'level' keeps it", () => {
  // Zero crossings in the first 10 ms track pitch for the tonal kits.
  const crossings = (x) => { let c = 0; for (let i = 1; i < 480; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) c++; return c; };
  const pitched = S.buildKit("beep", 48000);
  assert.ok(crossings(pitched.downbeat) > crossings(pitched.normal) * 1.3);
  const level = S.buildKit("beep", 48000, { accentStyle: "level" });
  assert.ok(Math.abs(crossings(level.downbeat) - crossings(level.normal)) <= 1);
});

test("the count-in is distinct from bar 1", () => {
  for (const kit of S.KITS) {
    const v = S.buildKit(kit.id, 48000);
    const n = Math.min(v.countIn.length, v.downbeat.length);
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(v.countIn[i] - v.downbeat[i]);
    assert.ok(diff / n > 0.01, kit.id);
  }
});

test("rendering is deterministic", () => {
  const a = S.buildKit("rim", 48000), b = S.buildKit("rim", 48000);
  assert.deepEqual(Array.from(a.normal), Array.from(b.normal));
  assert.ok(rms(a.normal, 2000) > 0.01);
});

test("square-wave kits are band-limited (no aliasing above the audible band)", () => {
  // Energy above 18 kHz relative to total, via a crude high-pass difference.
  const sr = 48000;
  for (const id of ["cowbell", "digital", "rim", "beep"]) {
    const x = S.buildKit(id, sr).normal;
    const hp = Float32Array.from(x);
    const c = S.biquad("highpass", 18000, 0.7, sr);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < hp.length; i++) { const y = c.b0 * hp[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2; x2 = x1; x1 = hp[i]; y2 = y1; y1 = y; hp[i] = y; }
    const e = (a) => a.reduce((s, v) => s + v * v, 0);
    assert.ok(e(hp) / e(x) < 0.02, `${id}: ${(e(hp) / e(x) * 100).toFixed(1)}% above 18 kHz`);
  }
});
