// Generates synthetic scene-v1 workloads and the correctness fixture, validates each through
// the real engine (WASM `sceneToSvg`, which parses and validates the scene) and writes
// JSON + SVG to tests/output/rfc-002-review/scenes/ (gitignored; regenerate with this script).
// Deterministic (fixed-seed PRNG). Usage: node experiments/rfc-002-review/bench/gen-scenes.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import init, { sceneToSvg } from "../../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";

const root = new URL("../../../", import.meta.url);
await init({ module_or_path: readFileSync(new URL("packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm", root)) });
const outDir = new URL("tests/output/rfc-002-review/scenes/", root);
mkdirSync(outDir, { recursive: true });

let seed = 0x9e3779b9;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 2 ** 32;
};
const q = (v) => Math.round(v * 100) / 100;
const K = 0.5522847498;
/** Circle as M + 4 cubics + Z (5 anchors). ccw reverses direction. */
function circle(cx, cy, r, ccw = false) {
  const k = K * r;
  const pts = ccw
    ? [[cx + r, cy], [cx + r, cy - k, cx + k, cy - r, cx, cy - r], [cx - k, cy - r, cx - r, cy - k, cx - r, cy],
       [cx - r, cy + k, cx - k, cy + r, cx, cy + r], [cx + k, cy + r, cx + r, cy + k, cx + r, cy]]
    : [[cx + r, cy], [cx + r, cy + k, cx + k, cy + r, cx, cy + r], [cx - k, cy + r, cx - r, cy + k, cx - r, cy],
       [cx - r, cy - k, cx - k, cy - r, cx, cy - r], [cx + k, cy - r, cx + r, cy - k, cx + r, cy]];
  return { verbs: "MCCCCZ", coords: pts.flat().map(q) };
}
const join = (...parts) => ({ verbs: parts.map((p) => p.verbs).join(""), coords: parts.flatMap((p) => p.coords) });
const poly = (pts) => ({ verbs: "M" + "L".repeat(pts.length - 1) + "Z", coords: pts.flat().map(q) });

const PALETTE = ["#1b1b1f", "#d7263d", "#f46036", "#2e294e", "#1b998b", "#c5d86d", "#e0b0ff", "#ffcc00"];
const META = (mode) => ({
  generator: "rfc-002-review synthetic", engineVersion: "synthetic", mode, presetVersion: 1, seed: 1,
  sourceWidth: 4000, sourceHeight: 3000, params: {},
});

function manyScene(targetAnchors) {
  const groups = PALETTE.map((_, i) => ({ id: `g${i}`, clip: null, paths: [] }));
  let anchors = 0;
  while (anchors < targetAnchors) {
    const ci = Math.floor(rnd() * PALETTE.length);
    const cx = 20 + rnd() * 3960, cy = 20 + rnd() * 2960, r = 3 + rnd() * 17;
    const kind = rnd();
    let path;
    if (kind < 0.7) {
      path = { ...circle(cx, cy, r), fill: { color: PALETTE[ci], paletteId: `c${ci}` }, stroke: null, fillRule: "nonzero" };
      anchors += 5;
    } else if (kind < 0.9) {
      // Ring with a hole: nonzero with reversed inner subpath.
      path = { ...join(circle(cx, cy, r), circle(cx, cy, r * 0.5, true)), fill: { color: PALETTE[ci], paletteId: `c${ci}` }, stroke: null, fillRule: "nonzero" };
      anchors += 10;
    } else {
      // Translucent overlap, literal colour (no palette id).
      path = { ...circle(cx, cy, r * 1.5), fill: { color: PALETTE[ci] + "99", paletteId: null }, stroke: null, fillRule: "nonzero" };
      anchors += 5;
    }
    groups[ci].paths.push(path);
  }
  return {
    version: 1, width: 4000, height: 3000, background: null,
    palette: PALETTE.map((color, i) => ({ id: `c${i}`, color })),
    groups: groups.filter((g) => g.paths.length), metadata: META("synthetic-many"),
  };
}

function correctnessScene() {
  const star = (cx, cy, r) =>
    poly([0, 2, 4, 1, 3].map((i) => [cx + r * Math.sin((i * 2 * Math.PI) / 5), cy - r * Math.cos((i * 2 * Math.PI) / 5)]));
  const fill = (color) => ({ color, paletteId: null });
  const P = (geom, color, fillRule = "nonzero") => ({ ...geom, fill: fill(color), stroke: null, fillRule });
  const sCurve = { verbs: "MCCLZ", coords: [420, 470, 470, 380, 560, 560, 610, 470, 640, 420, 700, 420, 720, 470, 720, 560].map(q) };
  return {
    version: 1, width: 800, height: 600, background: null, palette: [],
    groups: [
      { id: "fillrules", clip: null, paths: [
        P(star(110, 120, 90), "#1b1b1f", "nonzero"),            // centre filled
        P(star(310, 120, 90), "#1b1b1f", "evenodd"),            // centre hole
      ] },
      { id: "holes", clip: null, paths: [
        P(join(circle(510, 120, 80), circle(510, 120, 40)), "#2e294e", "evenodd"),          // hole
        P(join(circle(700, 120, 80), circle(700, 120, 40)), "#2e294e", "nonzero"),          // same dir: no hole
        P(join(circle(700, 310, 80), circle(700, 310, 40, true)), "#1b998b", "nonzero"),    // reversed: hole
      ] },
      { id: "alpha-order", clip: null, paths: [
        P(circle(110, 330, 70), "#d7263d80"),
        P(circle(170, 330, 70), "#1b998b80"),
        P(circle(140, 380, 70), "#2e294e80"),
      ] },
      { id: "clipped", clip: { x: 260, y: 250, width: 160, height: 120 }, paths: [P(circle(340, 330, 110), "#f46036")] },
      { id: "cubic", clip: null, paths: [
        P(circle(510, 330, 90), "#c5d86d"),
        P(sCurve, "#d7263d"),
        P(poly([[40, 560], [380, 560], [380, 561], [40, 561]]), "#1b1b1f"),                // 1 px bar
        ...Array.from({ length: 20 }, (_, i) => P(circle(60 + i * 16, 520, 0.8 + i * 0.25), "#1b1b1f")),
      ] },
    ],
    metadata: { ...META("synthetic-correctness"), sourceWidth: 800, sourceHeight: 600 },
  };
}

const manifest = [];
const write = (name, scene) => {
  const json = JSON.stringify(scene);
  const svg = sceneToSvg(json); // throws a JSON error string if the engine rejects the scene
  writeFileSync(new URL(`${name}.scene.json`, outDir), json);
  writeFileSync(new URL(`${name}.svg`, outDir), svg);
  let anchors = 0, paths = 0;
  for (const g of scene.groups) for (const p of g.paths) { paths++; anchors += p.verbs.replaceAll("Z", "").length; }
  manifest.push({ name, anchors, paths, jsonBytes: json.length, svgBytes: svg.length,
    sha256: createHash("sha256").update(json).digest("hex") });
};
write("synthetic-correctness", correctnessScene());
for (const [label, n] of [["10k", 1e4], ["100k", 1e5], ["250k", 2.5e5], ["500k", 5e5], ["1m", 1e6]])
  write(`synthetic-many-${label}`, manyScene(n));
writeFileSync(new URL("MANIFEST.json", outDir), JSON.stringify(manifest, null, 2));
console.table(manifest.map(({ sha256, ...r }) => r));
