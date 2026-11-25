// Render worker for the OffscreenCanvas variant of the Canvas 2D candidate (same draw code
// path: path data -> Path2D, culling, clips). The main thread keeps the document and the
// hit-test index; this worker holds only a disposable render-cache copy of the packet.
import { validatePacket } from "./packet.mjs";
import { packetPathData, rgba } from "./common.mjs";

let canvas, ctx, p, paths, bounds, cam, dpr, w, h, snap = null, snapCam = null;
// Display-only raster cache inside the worker: snapshot of the last exact frame.
const snapshot = () => {
  if (!snap) snap = new OffscreenCanvas(canvas.width, canvas.height);
  snap.width = canvas.width; snap.height = canvas.height;
  snap.getContext("2d").drawImage(canvas, 0, 0);
  snapCam = { ...cam };
};
const blit = () => {
  const k = cam.s / snapCam.s;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, dpr * (cam.tx - k * snapCam.tx), dpr * (cam.ty - k * snapCam.ty));
  ctx.drawImage(snap, 0, 0);
};
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
    if (m.cache) snapshot();
    const drawMs = performance.now() - t2;
    if (m.commit) await new Promise(raf); // let the worker frame commit to the placeholder canvas
    self.postMessage({ type: "drawn", buildMs, drawMs });
  } else if (m.type === "pan" || m.type === "zoom") {
    // Worker-driven gesture series on the worker's rAF; with m.cache the frames blit the
    // snapshot and one exact redraw follows the gesture (settle).
    const xs = [];
    let last = await new Promise(raf), k = 0;
    while (k++ < m.frames) {
      if (m.type === "pan") cam.tx -= 12;
      else {
        const f = 1.04, cx = w / 2, cy = h / 2;
        cam = { s: cam.s * f, tx: cx - (cx - cam.tx) * f, ty: cy - (cy - cam.ty) * f };
      }
      if (m.cache && snap) blit();
      else draw();
      const t = await new Promise(raf);
      xs.push(t - last);
      last = t;
    }
    let settleMs = null;
    if (m.cache) {
      const t = performance.now();
      draw();
      snapshot();
      ctx.getImageData?.(0, 0, 1, 1);
      settleMs = performance.now() - t;
    }
    self.postMessage({ type: "panned", intervals: xs, settleMs });
  }
};
