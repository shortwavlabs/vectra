// Path2D construction scaling: incremental API calls vs SVG path-data string, single compound
// path vs many independent paths. Reports ms and µs per cubic.
const out = [];
const cubicRing = (path, cx, cy, r) => {
  const k = 0.5522847498 * r;
  path.moveTo(cx + r, cy);
  path.bezierCurveTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r);
  path.bezierCurveTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy);
  path.bezierCurveTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r);
  path.bezierCurveTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy);
  path.closePath();
};
const ringD = (cx, cy, r) => {
  const k = 0.5522847498 * r, f = (v) => v.toFixed(2);
  return `M${f(cx + r)} ${f(cy)}C${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)}C${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)}C${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)}C${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)}Z`;
};
for (const subpaths of [1000, 5000, 10000, 25000, 50000]) {
  const anchors = subpaths * 5;
  let t = performance.now();
  const single = new Path2D();
  for (let i = 0; i < subpaths; i++) cubicRing(single, (i % 400) * 10, Math.floor(i / 400) * 10, 4);
  const singleMs = performance.now() - t;
  t = performance.now();
  const many = [];
  for (let i = 0; i < subpaths; i++) { const p = new Path2D(); cubicRing(p, (i % 400) * 10, Math.floor(i / 400) * 10, 4); many.push(p); }
  const manyMs = performance.now() - t;
  t = performance.now();
  let d = "";
  for (let i = 0; i < subpaths; i++) d += ringD((i % 400) * 10, Math.floor(i / 400) * 10, 4);
  const strMs = performance.now() - t;
  t = performance.now();
  const fromString = new Path2D(d);
  const parseMs = performance.now() - t;
  // addPath of many small into one
  t = performance.now();
  const merged = new Path2D();
  for (const p of many) merged.addPath(p);
  const addPathMs = performance.now() - t;
  out.push({ anchors, singleMs, manyMs, dStringBuildMs: strMs, dStringParseMs: parseMs, addPathMs,
    usPerAnchorSingle: (1000 * singleMs) / anchors, usPerAnchorMany: (1000 * manyMs) / anchors, usPerAnchorParse: (1000 * parseMs) / anchors });
  if (singleMs > 20000) break;
}
window.__done = out;
