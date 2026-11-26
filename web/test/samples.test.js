// Recorded kits (web/samples): processed files load, start on the attack, and level correctly.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../src/sounds.js");

const dir = path.join(__dirname, "..", "samples");
const { kits, source } = JSON.parse(fs.readFileSync(path.join(dir, "kits.json"), "utf8"));
const load = (kit) => Object.fromEntries(Object.entries(kit.levels).map(([lv, takes]) => [lv, takes.map((t) => S.decodeWav(fs.readFileSync(path.join(dir, t.file))))]));
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (x, n) => Math.sqrt(x.slice(0, n).reduce((s, v) => s + v * v, 0) / Math.min(n, x.length));

test("the starter set is the CC0 VCSL library", () => {
  assert.match(source, /CC0/);
  assert.match(source, /VCSL/);
  assert.deepEqual(kits.map((k) => k.id), ["wood", "clave", "rim", "cowbell", "agogo", "log", "hat"]);
});

test("every recorded take starts on its attack (within 1 ms)", () => {
  for (const kit of kits) {
    for (const [level, takes] of Object.entries(load(kit))) {
      takes.forEach((t, i) => {
        const pk = peak(t.data);
        const first = t.data.findIndex((v) => Math.abs(v) >= 0.1 * pk);
        assert.ok(first / t.sr < 0.001, `${kit.id}/${level}-${i + 1}: attack at ${(first / t.sr * 1000).toFixed(2)} ms`);
        assert.ok(Math.abs(t.data[t.data.length - 1]) < 1e-3, `${kit.id}/${level}-${i + 1}: does not end at silence`);
        assert.ok(t.data.length / t.sr <= 0.5, `${kit.id}/${level}-${i + 1}: too long`);
      });
    }
  }
});

test("built kits: peaks capped, accents louder, count-in present, both accent styles", () => {
  for (const kit of kits) {
    const files = load(kit);
    for (const opts of [{}, { accentStyle: "level" }, { countIn: "kit" }]) {
      const v = S.buildSampleKit(files, opts);
      for (const level of ["downbeat", "group", "normal", "sub", "countIn"]) {
        assert.ok(v[level].length >= 1, `${kit.id}/${level}`);
        for (const x of v[level]) {
          assert.ok(x.every(Number.isFinite) && peak(x) <= S.MAX_PEAK + 1e-6, `${kit.id}/${level} ${JSON.stringify(opts)}`);
        }
      }
      const L = (arr) => Math.max(...arr.map((x) => rms(x, Math.round(v.sampleRate * 0.03))));
      assert.ok(L(v.downbeat) > L(v.normal), `${kit.id} ${JSON.stringify(opts)}: downbeat not louder`);
    }
    // "Louder only" uses the normal takes for accents.
    const level = S.buildSampleKit(files, { accentStyle: "level" });
    assert.equal(level.downbeat.length, files.normal.length);
  }
});
