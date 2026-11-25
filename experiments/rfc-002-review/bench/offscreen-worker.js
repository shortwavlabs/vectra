// Render worker for the OffscreenCanvas variant of the Canvas 2D candidate (same draw code
// path: path data -> Path2D, culling, clips). The main thread keeps the document and the
// hit-test index; this worker holds only a disposable render-cache copy of the packet.
import { validatePacket } from "./packet.mjs";
import { packetPathData, rgba } from "./common.mjs";

let canvas, ctx, p, paths, bounds, cam, dpr, w, h;
const draw = () => {
  const n = p.manifest.pathCount, styles = p.manifest.styles, gi = p.groupIndex, si = p.styleIndex;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.tx, dpr * cam.ty);
  const vx0 = -cam.tx / cam.s, vy0 = -cam.ty / cam.s, vx1 = vx0 + w / cam.s, vy1 = vy0 + h / cam.s;
  let g = -1, clipped = false;
  for (let i = 0; i < n; i++) {
    if (gi[i] !== g) {
      if (clipped) ctx.restore();
      g = gi[i];
      const c = p.manifest.groups[g].clip;
      clipped = !!c;
      if (c) { ctx.save(); ctx.beginPath(); ctx.rect(c.x, c.y, c.width, c.height); ctx.clip(); }
    }
    if (bounds[4 * i] > vx1 || bounds[4 * i + 2] < vx0 || bounds[4 * i + 1] > vy1 || bounds[4 * i + 3] < vy0) continue;
    const st = styles[si[i]];
    if (st.fill == null) continue;
    ctx.fillStyle = rgba(st.fill);
    ctx.fill(paths[i], st.evenOdd ? "evenodd" : "nonzero");
  }
  if (clipped) ctx.restore();
};
const raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16);
self.onmessage = async ({ data: m }) => {
  if (m.type === "init") {
    canvas = m.canvas; ctx = canvas.getContext("2d"); dpr = m.dpr; w = m.w; h = m.h;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    self.postMessage({ type: "ready", workerRaf: !!self.requestAnimationFrame });
  } else if (m.type === "scene") {
    const t = performance.now();
    p = m.packet;
    bounds = validatePacket(p).bounds;
    paths = Array.from({ length: p.manifest.pathCount }, (_, i) => new Path2D(packetPathData(p, i)));
    const buildMs = performance.now() - t;
    cam = m.cam;
    const t2 = performance.now();
    draw();
    self.postMessage({ type: "drawn", buildMs, drawMs: performance.now() - t2 });
  } else if (m.type === "pan") {
    // Worker-driven pan series: frame intervals measured on the worker's rAF.
    const xs = [];
    let last = await new Promise(raf), k = 0;
    while (k++ < m.frames) {
      cam.tx -= 12;
      draw();
      const t = await new Promise(raf);
      xs.push(t - last);
      last = t;
    }
    self.postMessage({ type: "panned", intervals: xs });
  }
};
