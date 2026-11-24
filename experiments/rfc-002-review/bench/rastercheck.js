// Is Canvas 2D raster fast on the GPU, or does the forced readback trigger CPU fallback?
// A: 10 draws then ONE readback (amortised raster-complete cost per draw)
// B: fresh canvas, 10 × (draw + readback)
// C: willReadFrequently canvas (CPU raster by request), 10 × (draw + readback)
import { validatePacket } from "./packet.mjs";
import { loadPacket, viewPacket, rgba } from "./common.mjs";
import { dString } from "./renderers.mjs";
const W = 2560, H = 1600, out = [];
for (const name of ["concert-small-venue-1280-halftone", "architecture-street-halftone", "portrait-large-color", "synthetic-many-1m"]) {
  const { man, bin } = await loadPacket(name);
  const p = viewPacket(man, bin);
  validatePacket(p);
  const paths = Array.from({ length: man.pathCount }, (_, i) => new Path2D(dString(p, i)));
  const fills = Array.from({ length: man.pathCount }, (_, i) => rgba(man.styles[p.styleIndex[i]].fill ?? 0));
  const s = Math.min(W / man.width, H / man.height);
  const draw = (ctx) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    for (let i = 0; i < paths.length; i++) {
      ctx.fillStyle = fills[i];
      ctx.fill(paths[i], man.styles[p.styleIndex[i]].evenOdd ? "evenodd" : "nonzero");
    }
  };
  const mk = (opts) => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    document.body.append(c);
    return c.getContext("2d", opts);
  };
  const row = { name, anchors: null };
  let ctx = mk();
  draw(ctx); ctx.getImageData(0, 0, 1, 1); // warm
  ctx = mk();
  let t = performance.now();
  for (let k = 0; k < 10; k++) draw(ctx);
  ctx.getImageData(0, 0, 1, 1);
  row.A_tenDrawsOneReadbackPerDrawMs = (performance.now() - t) / 10;
  ctx = mk();
  t = performance.now();
  for (let k = 0; k < 10; k++) { draw(ctx); ctx.getImageData(0, 0, 1, 1); }
  row.B_readbackEveryDrawMs = (performance.now() - t) / 10;
  ctx = mk({ willReadFrequently: true });
  t = performance.now();
  for (let k = 0; k < 10; k++) { draw(ctx); ctx.getImageData(0, 0, 1, 1); }
  row.C_cpuCanvasPerDrawMs = (performance.now() - t) / 10;
  out.push(row);
  document.body.replaceChildren();
}
window.__done = { ok: true, results: out };
