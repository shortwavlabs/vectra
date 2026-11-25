// R02 spatial-index comparison (Node; the hit-test service is renderer-independent JS):
// uniform grid vs packed STR R-tree (static BVH), with subpath indexing on (threshold 8) and
// off (whole-path items only, i.e. the large compound path is one item). Build time, bytes,
// warm and cold query time over 2,000 random points, plus a no-false-hit check inside holes.
// Usage: node index-bench.mjs > out.json
import { readFileSync } from "node:fs";
import { validatePacket } from "./packet.mjs";
import { HitIndex } from "./hit.mjs";

const root = new URL("../../../", import.meta.url);
const SCENES = ["concert-small-venue-bw", "architecture-street-bw", "texture-bark-bw", "architecture-street-limited",
  "portrait-large-color", "architecture-street-halftone", "synthetic-many-250k", "synthetic-many-1m", "synthetic-correctness"];
const load = (name) => {
  const man = JSON.parse(readFileSync(new URL(`tests/output/rfc-002-review/packets/${name}.manifest.json`, root)));
  const buf = new Uint8Array(readFileSync(new URL(`tests/output/rfc-002-review/packets/${name}.bin`, root))).buffer;
  const [a, b, c, d, e, f] = man.layout, n = man.pathCount;
  return { manifest: man, verbs: new Uint8Array(buf, a, man.verbCount), coords: new Float64Array(buf, b, man.coordCount),
    verbOffsets: new Uint32Array(buf, c, n + 1), coordOffsets: new Uint32Array(buf, d, n + 1),
    styleIndex: new Uint32Array(buf, e, n), groupIndex: new Uint32Array(buf, f, n) };
};
const pct = (xs, p) => [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
let seed = 99;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const out = [];
for (const name of SCENES) {
  const p = load(name), derived = validatePacket(p);
  const pts = Array.from({ length: 2000 }, () => [rnd() * p.manifest.width, rnd() * p.manifest.height]);
  let reference = null;
  for (const [kind, subpathThreshold] of [["grid", 8], ["str", 8], ["grid", Infinity], ["str", Infinity]]) {
    const t = performance.now();
    const h = new HitIndex(p, derived, { kind, subpathThreshold });
    const buildMs = performance.now() - t;
    const cold = [], warm = [], res = [];
    for (const [x, y] of pts) {
      let t0 = performance.now();
      res.push(h.hit(x, y));
      cold.push(performance.now() - t0);
    }
    for (const [x, y] of pts) {
      const t0 = performance.now();
      for (let k = 0; k < 5; k++) h.hit(x, y);
      warm.push((performance.now() - t0) / 5);
    }
    if (!reference) reference = res;
    const agree = res.filter((v, i) => v === reference[i]).length;
    out.push({ name, index: kind, subpathIndex: subpathThreshold !== Infinity, items: h.itemCount, bytes: h.bytes,
      buildMs: +buildMs.toFixed(2), coldP50: +pct(cold, 50).toFixed(4), coldP95: +pct(cold, 95).toFixed(4), coldMax: +Math.max(...cold).toFixed(2),
      warmP50: +pct(warm, 50).toFixed(4), warmP95: +pct(warm, 95).toFixed(4), warmMax: +Math.max(...warm).toFixed(3),
      hits: res.filter((v) => v >= 0).length, agreeWithFirstVariant: agree, flattenMs: +h.flattenMs.toFixed(1) });
    console.error(JSON.stringify(out.at(-1)));
  }
}
// No false hit inside holes / evenodd centres (correctness scene, all variants).
const p = load("synthetic-correctness"), d = validatePacket(p);
const checks = [[110, 120, 0], [310, 120, -1], [510, 120, -1], [570, 120, 2], [700, 120, 3], [700, 310, -1], [760, 310, 4], [140, 360, 7], [340, 330, 8], [340, 240, -1], [510, 330, 9]];
const holeChecks = [];
for (const [kind, thr] of [["grid", 8], ["str", 8], ["grid", Infinity], ["str", Infinity]]) {
  const h = new HitIndex(p, d, { kind, subpathThreshold: thr });
  holeChecks.push({ index: kind, subpathIndex: thr !== Infinity, failures: checks.filter(([x, y, want]) => h.hit(x, y) !== want) });
}
console.log(JSON.stringify({ node: process.version, results: out, holeChecks }, null, 1));
