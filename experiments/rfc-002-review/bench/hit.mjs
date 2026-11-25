// Renderer-independent hit-test service prototype (RFC-002 §7). Exact fill-rule test on the
// packet geometry (cubics flattened at `tol` document px), with:
//  - an item index over path bounds, or subpath bounds for paths with many subpaths
//    (a closed subpath contributes zero winding to points outside its bounding box, so the
//    candidate subpaths alone decide the fill rule exactly);
//  - a horizontal band index of flattened edges for very large subpaths (rays cross only the
//    edges spanning the query's y).
// Two item-index variants: uniform grid and packed STR R-tree (static BVH).
import { C, L, M, Z } from "./packet.mjs";

export function flattenCubic(out, x0, y0, x1, y1, x2, y2, x3, y3, tol) {
  const ddx = Math.max(Math.abs(x0 - 2 * x1 + x2), Math.abs(x1 - 2 * x2 + x3));
  const ddy = Math.max(Math.abs(y0 - 2 * y1 + y2), Math.abs(y1 - 2 * y2 + y3));
  const n = Math.max(1, Math.min(256, Math.ceil(Math.sqrt((0.75 * Math.hypot(ddx, ddy)) / tol))));
  for (let i = 1; i <= n; i++) {
    const t = i / n, mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    out.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
  }
}

/** Calls fn(subIndex, pts[]) for each subpath of path i as a closed polyline (x,y pairs). */
export function forEachSubpath(p, i, tol, fn) {
  const v = p.verbs, c = p.coords;
  let ci = p.coordOffsets[i], pts = null, sx = 0, sy = 0, cx = 0, cy = 0, s = -1;
  const flush = () => {
    if (pts && pts.length >= 6) fn(s, pts);
  };
  for (let k = p.verbOffsets[i]; k < p.verbOffsets[i + 1]; k++) {
    const op = v[k];
    if (op === M) {
      flush();
      s++;
      sx = cx = c[ci]; sy = cy = c[ci + 1]; ci += 2;
      pts = [sx, sy];
    } else if (op === L) {
      cx = c[ci]; cy = c[ci + 1]; ci += 2;
      pts.push(cx, cy);
    } else if (op === C) {
      flattenCubic(pts, cx, cy, c[ci], c[ci + 1], c[ci + 2], c[ci + 3], c[ci + 4], c[ci + 5], tol);
      cx = c[ci + 4]; cy = c[ci + 5]; ci += 6;
    } else {
      cx = sx; cy = sy;
    }
  }
  flush();
}

// Non-zero winding contribution of the closed polyline pts at (x, y): +1/-1 per crossing of
// the ray to +x (direction-signed). Even-odd uses the parity of the crossing count.
function winding(pts, x, y, from = 0, to = pts.length) {
  let w = 0, cross = 0;
  const n = pts.length;
  for (let k = from; k < to; k += 2) {
    const x0 = pts[k], y0 = pts[k + 1];
    const k2 = k + 2 === n ? 0 : k + 2;
    const x1 = pts[k2], y1 = pts[k2 + 1];
    if ((y0 <= y) !== (y1 <= y)) {
      const xi = x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
      if (xi > x) {
        w += y1 > y0 ? 1 : -1;
        cross++;
      }
    }
  }
  return [w, cross];
}

const BAND_THRESHOLD = 2048; // flattened points per subpath above which a band index is built

class BandedSubpath {
  constructor(pts) {
    this.pts = pts;
    let y0 = Infinity, y1 = -Infinity;
    for (let k = 1; k < pts.length; k += 2) {
      y0 = Math.min(y0, pts[k]);
      y1 = Math.max(y1, pts[k]);
    }
    const nb = Math.max(1, Math.min(4096, Math.ceil(pts.length / 64)));
    this.y0 = y0; this.h = (y1 - y0) / nb || 1; this.nb = nb;
    const lists = Array.from({ length: nb }, () => []);
    const n = pts.length;
    for (let k = 0; k < n; k += 2) {
      const k2 = k + 2 === n ? 0 : k + 2;
      const a = Math.min(pts[k + 1], pts[k2 + 1]), b = Math.max(pts[k + 1], pts[k2 + 1]);
      const ba = Math.max(0, Math.floor((a - y0) / this.h)), bb = Math.min(nb - 1, Math.floor((b - y0) / this.h));
      for (let q = ba; q <= bb; q++) lists[q].push(k);
    }
    this.bands = lists.map((l) => Uint32Array.from(l));
  }
  winding(x, y) {
    const q = Math.floor((y - this.y0) / this.h);
    if (q < 0 || q >= this.nb) return [0, 0];
    let w = 0, cross = 0;
    const pts = this.pts, n = pts.length;
    for (const k of this.bands[q]) {
      const k2 = k + 2 === n ? 0 : k + 2;
      const y0 = pts[k + 1], y1 = pts[k2 + 1];
      if ((y0 <= y) !== (y1 <= y)) {
        const xi = pts[k] + ((y - y0) * (pts[k2] - pts[k])) / (y1 - y0);
        if (xi > x) {
          w += y1 > y0 ? 1 : -1;
          cross++;
        }
      }
    }
    return [w, cross];
  }
}

class Grid {
  constructor(items, bbox) {
    const n = items.length / 4;
    const [x0, y0, x1, y1] = bbox;
    const cell = Math.max(1, Math.sqrt(((x1 - x0) * (y1 - y0)) / Math.max(1, n)) * 1.5);
    this.x0 = x0; this.y0 = y0; this.cell = cell;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / cell)); this.ny = Math.max(1, Math.ceil((y1 - y0) / cell));
    const counts = new Uint32Array(this.nx * this.ny + 1);
    const span = (k) => [
      Math.max(0, Math.floor((items[4 * k] - x0) / cell)), Math.max(0, Math.floor((items[4 * k + 1] - y0) / cell)),
      Math.min(this.nx - 1, Math.floor((items[4 * k + 2] - x0) / cell)), Math.min(this.ny - 1, Math.floor((items[4 * k + 3] - y0) / cell)),
    ];
    for (let k = 0; k < n; k++) {
      const [a, b, c, d] = span(k);
      for (let gy = b; gy <= d; gy++) for (let gx = a; gx <= c; gx++) counts[gy * this.nx + gx + 1]++;
    }
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    this.start = counts.slice();
    this.ids = new Uint32Array(counts[counts.length - 1]);
    const fill = counts.slice();
    for (let k = 0; k < n; k++) {
      const [a, b, c, d] = span(k);
      for (let gy = b; gy <= d; gy++) for (let gx = a; gx <= c; gx++) this.ids[fill[gy * this.nx + gx]++] = k;
    }
    this.items = items;
    this.bytes = this.start.byteLength + this.ids.byteLength;
  }
  query(x, y, out) {
    const gx = Math.floor((x - this.x0) / this.cell), gy = Math.floor((y - this.y0) / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.nx || gy >= this.ny) return;
    const c = gy * this.nx + gx, it = this.items;
    for (let j = this.start[c]; j < this.start[c + 1]; j++) {
      const k = this.ids[j];
      if (x >= it[4 * k] && x <= it[4 * k + 2] && y >= it[4 * k + 1] && y <= it[4 * k + 3]) out.push(k);
    }
  }
}

class StrTree {
  // Packed Sort-Tile-Recursive R-tree, node size 16, built bottom-up.
  constructor(items) {
    const n = items.length / 4, B = 16;
    let level = Array.from({ length: n }, (_, k) => k);
    const boxes = [items]; // level 0 boxes are the items
    const children = [];
    let cur = items, curIds = level;
    this.levels = [];
    while (curIds.length > 1 || this.levels.length === 0) {
      const m = curIds.length;
      const cx = (k) => cur[4 * k] + cur[4 * k + 2], cy = (k) => cur[4 * k + 1] + cur[4 * k + 3];
      const sorted = [...curIds].sort((a, b) => cx(a) - cx(b));
      const slices = Math.ceil(Math.sqrt(Math.ceil(m / B)));
      const per = slices * B;
      const groups = [];
      for (let s = 0; s < m; s += per) {
        const slice = sorted.slice(s, s + per).sort((a, b) => cy(a) - cy(b));
        for (let g = 0; g < slice.length; g += B) groups.push(slice.slice(g, g + B));
      }
      const nb = new Float64Array(groups.length * 4);
      groups.forEach((g, gi) => {
        let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
        for (const k of g) {
          a = Math.min(a, cur[4 * k]); b = Math.min(b, cur[4 * k + 1]);
          c = Math.max(c, cur[4 * k + 2]); d = Math.max(d, cur[4 * k + 3]);
        }
        nb.set([a, b, c, d], gi * 4);
      });
      this.levels.push({ boxes: cur, groups });
      cur = nb;
      curIds = groups.map((_, gi) => gi);
      if (groups.length === 1) {
        this.levels.push({ boxes: nb, groups: [[0]] });
        break;
      }
    }
    this.bytes = this.levels.reduce((s, l) => s + l.boxes.byteLength + l.groups.reduce((t, g) => t + 8 * g.length, 0), 0);
    void boxes; void children; void level;
  }
  query(x, y, out) {
    const L = this.levels;
    const visit = (lv, gi) => {
      const { boxes, groups } = L[lv];
      for (const k of groups[gi]) {
        if (x < boxes[4 * k] || x > boxes[4 * k + 2] || y < boxes[4 * k + 1] || y > boxes[4 * k + 3]) continue;
        if (lv === 0) out.push(k);
        else visit(lv - 1, k);
      }
    };
    visit(L.length - 1, 0);
  }
}

export class HitIndex {
  /** p: packet, derived: validatePacket() result, kind: "grid" | "str". */
  constructor(p, derived, { kind = "grid", tol = 0.05, subpathThreshold = 8 } = {}) {
    const t0 = performance.now();
    this.p = p; this.tol = tol;
    const n = p.manifest.pathCount;
    this.evenOdd = p.manifest.styles.map((s) => s.evenOdd);
    const sub = derived.subStart; // verb index of each M, ascending
    const items = [], itemPath = [], itemSub = [];
    this.subCount = new Uint32Array(n);
    let si = 0;
    this.whole = new Uint8Array(n);
    this.polys = new Map(); // lazily flattened per path (or per subpath) polylines
    this.flattenMs = 0;
    for (let i = 0; i < n; i++) {
      const v0 = p.verbOffsets[i], v1 = p.verbOffsets[i + 1];
      const firstSub = si;
      while (si < sub.length && sub[si] < v1) si++;
      const count = si - firstSub;
      this.subCount[i] = count;
      if (count > subpathThreshold) {
        // Subpath bounds from control points (conservative hull bounds).
        let ci = p.coordOffsets[i], k = v0;
        for (let s = 0; s < count; s++) {
          const end = s + 1 < count ? sub[firstSub + s + 1] : v1;
          let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
          for (; k < end; k++) {
            const op = p.verbs[k], m = op === C ? 6 : op === Z ? 0 : 2;
            for (let j = 0; j < m; j += 2) {
              const x = p.coords[ci + j], y = p.coords[ci + j + 1];
              if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
            }
            ci += m;
          }
          items.push(a, b, c, d); itemPath.push(i); itemSub.push(s);
        }
      } else {
        const bb = derived.bounds;
        items.push(bb[4 * i], bb[4 * i + 1], bb[4 * i + 2], bb[4 * i + 3]);
        itemPath.push(i); itemSub.push(-1);
        this.whole[i] = 1;
      }
    }
    this.items = Float64Array.from(items);
    this.itemPath = Uint32Array.from(itemPath);
    this.itemSub = Int32Array.from(itemSub);
    const t1 = performance.now();
    const bbox = [0, 0, p.manifest.width, p.manifest.height];
    this.index = kind === "grid" ? new Grid(this.items, bbox) : new StrTree(this.items);
    this.buildMs = { items: t1 - t0, index: performance.now() - t1 };
    this.itemCount = this.items.length / 4;
    this.bytes = this.items.byteLength + this.itemPath.byteLength + this.itemSub.byteLength + this.index.bytes;
    this.hidden = new Set(); // hidden or locked group ids
    this.clips = p.manifest.groups.map((g) => g.clip);
    this._cand = [];
  }
  /** Flattened polylines of path i, one entry per subpath (banded if huge). Cached. */
  subpaths(i) {
    let e = this.polys.get(i);
    if (!e) {
      const t = performance.now();
      e = [];
      forEachSubpath(this.p, i, this.tol, (s, pts) => (e[s] = pts.length > BAND_THRESHOLD ? new BandedSubpath(pts) : pts));
      this.polys.set(i, e);
      this.flattenMs += performance.now() - t;
    }
    return e;
  }
  pathContains(i, x, y, subs) {
    const e = this.subpaths(i);
    let w = 0, cross = 0;
    const list = subs ?? e.keys();
    for (const s of list) {
      const sp = e[s];
      if (!sp) continue;
      const [dw, dc] = sp instanceof BandedSubpath ? sp.winding(x, y) : winding(sp, x, y);
      w += dw; cross += dc;
    }
    return this.evenOdd[this.p.styleIndex[i]] ? (cross & 1) === 1 : w !== 0;
  }
  /** Topmost visible path containing document point (x, y), or -1. */
  hit(x, y) {
    const cand = this._cand;
    cand.length = 0;
    this.index.query(x, y, cand);
    if (!cand.length) return -1;
    // Group candidate items per path, topmost (largest index) first.
    const byPath = new Map();
    for (const k of cand) {
      const i = this.itemPath[k];
      const g = this.p.groupIndex[i], clip = this.clips[g];
      if (this.hidden.has(g)) continue;
      if (clip && (x < clip.x || y < clip.y || x > clip.x + clip.width || y > clip.y + clip.height)) continue;
      let l = byPath.get(i);
      if (!l) byPath.set(i, (l = []));
      if (this.itemSub[k] >= 0) l.push(this.itemSub[k]);
    }
    const order = [...byPath.keys()].sort((a, b) => b - a);
    for (const i of order) {
      const subs = this.whole[i] ? null : byPath.get(i);
      if (this.pathContains(i, x, y, subs)) return i;
    }
    return -1;
  }
}
