// Shared browser helpers for the review harnesses (main thread).
import { C, L, M } from "./packet.mjs";

export const now = () => performance.timeOrigin + performance.now();
export const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
/** "Visible" proxy used for every candidate: two animation frames after the change, i.e. the
 *  frame containing the change has been produced and the next one has started. It cannot see
 *  GPU raster that the browser defers past that frame; frame-gap data covers that. */
export const twoFrames = async () => {
  await nextFrame();
  await nextFrame();
};

/** Main-thread blocking probe: largest rAF gap, frame count, long tasks (Chromium only). */
export function probe() {
  const s = { maxGap: 0, frames: 0, gaps: [], longTasks: 0, longestTask: 0 };
  let last = performance.now(), raf = 0, on = true;
  const tick = (t) => {
    const g = t - last;
    s.gaps.push(g);
    if (g > s.maxGap) s.maxGap = g;
    s.frames++;
    last = t;
    if (on) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  let obs = null;
  if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        s.longTasks++;
        s.longestTask = Math.max(s.longestTask, e.duration);
      }
    });
    obs.observe({ type: "longtask" });
  }
  return () => {
    on = false;
    cancelAnimationFrame(raf);
    obs?.disconnect();
    return s;
  };
}

export const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

/** Path2D per path from a parsed scene-v1 object, via SVG path data: the incremental
 *  moveTo/bezierCurveTo API is quadratic per path in Chromium 159 (path2d-scaling.json). */
export function pathsFromScene(scene) {
  const out = [];
  for (const g of scene.groups)
    for (const p of g.paths) {
      const v = p.verbs, c = p.coords;
      let d = "", ci = 0;
      for (let k = 0; k < v.length; k++) {
        switch (v.charCodeAt(k)) {
          case 77: d += "M" + c[ci] + " " + c[ci + 1]; ci += 2; break;
          case 76: d += "L" + c[ci] + " " + c[ci + 1]; ci += 2; break;
          case 67: d += "C" + c[ci] + " " + c[ci + 1] + " " + c[ci + 2] + " " + c[ci + 3] + " " + c[ci + 4] + " " + c[ci + 5]; ci += 6; break;
          default: d += "Z";
        }
      }
      out.push(new Path2D(d));
    }
  return out;
}

/** SVG path data for path i of a GeometryPacket. */
export function packetPathData(p, i) {
  const c = p.coords, v = p.verbs;
  let s = "", ci = p.coordOffsets[i];
  for (let k = p.verbOffsets[i]; k < p.verbOffsets[i + 1]; k++) {
    const op = v[k];
    if (op === M) { s += "M" + c[ci] + " " + c[ci + 1]; ci += 2; }
    else if (op === L) { s += "L" + c[ci] + " " + c[ci + 1]; ci += 2; }
    else if (op === C) { s += "C" + c[ci] + " " + c[ci + 1] + " " + c[ci + 2] + " " + c[ci + 3] + " " + c[ci + 4] + " " + c[ci + 5]; ci += 6; }
    else s += "Z";
  }
  return s;
}

export function pathsFromPacket(p) {
  const out = new Array(p.manifest.pathCount);
  for (let i = 0; i < out.length; i++) out[i] = new Path2D(packetPathData(p, i));
  return out;
}

export const rgba = (u32) =>
  `rgba(${u32 >>> 24},${(u32 >>> 16) & 255},${(u32 >>> 8) & 255},${((u32 & 255) / 255).toFixed(4)})`;

export async function loadPacket(name) {
  const [man, bin] = await Promise.all([
    fetch(`/packets/${name}.manifest.json`).then((r) => r.json()),
    fetch(`/packets/${name}.bin`).then((r) => r.arrayBuffer()),
  ]);
  return { man, bin };
}

export function viewPacket(man, buf) {
  const [a, b, c, d, e, f] = man.layout;
  const { pathCount: n, verbCount, coordCount } = man;
  return {
    manifest: man,
    verbs: new Uint8Array(buf, a, verbCount), coords: new Float64Array(buf, b, coordCount),
    verbOffsets: new Uint32Array(buf, c, n + 1), coordOffsets: new Uint32Array(buf, d, n + 1),
    styleIndex: new Uint32Array(buf, e, n), groupIndex: new Uint32Array(buf, f, n),
  };
}
