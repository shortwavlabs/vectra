// Renderer-independent geometric hit testing (RFC-002 §9, R02 §7), over the document's own
// packets through read-only chunk views. It never uses a rendered frame.
//
// - Index: a uniform grid over item bounds in document space; paths with more than 8 subpaths
//   are indexed per subpath (a 195k-subpath halftone is otherwise one item).
// - Exact test: winding number on cubics flattened to typed-array polylines (lazily, cached per
//   subpath) at 0.05 local units, nonzero or evenodd. A closed subpath whose bounds exclude the
//   point contributes no winding, so only subpaths whose bounds contain the point are tested.
//   Subpaths above 2,048 points get a horizontal band index over their edges.
// - Semantics: topmost item in paint order; effective clips are closed rectangles; hidden or
//   fully clipped items are not in the evaluation; locked items are skipped (they are drawn but
//   not selectable on the canvas).
import type { Evaluation } from "../document/evaluate.ts";
import type { ChunkView, GeometryStore } from "../document/geometry-store.ts";
import type { Matrix, NodeId } from "../document/model.ts";

const VERB_M = 0;
const VERB_L = 1;
const VERB_C = 2;
const VERB_Z = 3;
const SUBPATH_INDEX_ABOVE = 8;
const BAND_ABOVE = 2048;
const TOLERANCE = 0.05;

interface Subpath {
  readonly v0: number; // first verb (the M)
  readonly v1: number; // one past the last verb
  readonly c0: number; // first coord
  readonly bounds: [number, number, number, number]; // local
  poly?: Float64Array; // flattened, closed implicitly
  bands?: { y0: number; h: number; edges: Uint32Array[] };
}
interface Item {
  readonly k: number; // draw-list index (paint order)
  readonly nodeId: NodeId;
  readonly locked: boolean;
  readonly evenOdd: boolean;
  readonly inverse: Matrix | null; // document → local
  readonly clip: { x: number; y: number; w: number; h: number } | null;
  readonly view: ChunkView;
  readonly subpaths: Subpath[];
}
interface Entry {
  readonly item: Item;
  readonly sub: number; // subpath index, or -1 for the whole path
  readonly box: [number, number, number, number]; // document
}

const invert = (m: Matrix): Matrix | null => {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || det === 0) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
const mapBox = (
  m: Matrix,
  b: [number, number, number, number],
): [number, number, number, number] => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[0], b[3]],
    [b[2], b[3]],
  ] as const) {
    const [X, Y] = apply(m, x, y);
    x0 = Math.min(x0, X);
    y0 = Math.min(y0, Y);
    x1 = Math.max(x1, X);
    y1 = Math.max(y1, Y);
  }
  return [x0, y0, x1, y1];
};
const inBox = (b: readonly number[], x: number, y: number) =>
  x >= b[0]! && x <= b[2]! && y >= b[1]! && y <= b[3]!;

function subpathsOf(view: ChunkView, pathIndex: number): Subpath[] {
  const out: Subpath[] = [];
  const v0 = view.verbOffset(pathIndex);
  const v1 = view.verbOffset(pathIndex + 1);
  let c = view.coordOffset(pathIndex);
  let cur: { v0: number; c0: number; b: [number, number, number, number] } | null = null;
  const close = (end: number) => {
    if (cur) out.push({ v0: cur.v0, v1: end, c0: cur.c0, bounds: cur.b });
  };
  for (let v = v0; v < v1; v++) {
    const verb = view.verb(v);
    if (verb === VERB_M) {
      close(v);
      cur = { v0: v, c0: c, b: [Infinity, Infinity, -Infinity, -Infinity] };
    }
    const n = verb === VERB_C ? 6 : verb === VERB_Z ? 0 : 2;
    for (let j = 0; j < n; j += 2) {
      const x = view.coord(c + j);
      const y = view.coord(c + j + 1);
      const b = cur!.b;
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
    c += n;
  }
  close(v1);
  return out;
}

function flatten(view: ChunkView, s: Subpath): Float64Array {
  const pts: number[] = [];
  let c = s.c0;
  let x = 0;
  let y = 0;
  for (let v = s.v0; v < s.v1; v++) {
    const verb = view.verb(v);
    if (verb === VERB_M || verb === VERB_L) {
      x = view.coord(c);
      y = view.coord(c + 1);
      pts.push(x, y);
      c += 2;
    } else if (verb === VERB_C) {
      const x1 = view.coord(c);
      const y1 = view.coord(c + 1);
      const x2 = view.coord(c + 2);
      const y2 = view.coord(c + 3);
      const x3 = view.coord(c + 4);
      const y3 = view.coord(c + 5);
      // Segment count from the control polygon length (≥ the curve length).
      const len =
        Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
      const n = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(len / TOLERANCE))));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        pts.push(
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        );
      }
      x = x3;
      y = y3;
      c += 6;
    }
  }
  return Float64Array.from(pts);
}

/** Winding of the implicitly closed polyline around (x, y), via edges crossing the ray y. */
function winding(p: Float64Array, x: number, y: number, edges?: Uint32Array): number {
  const n = p.length / 2;
  let w = 0;
  const edge = (i: number) => {
    const j = (i + 1) % n;
    const ax = p[2 * i]!;
    const ay = p[2 * i + 1]!;
    const bx = p[2 * j]!;
    const by = p[2 * j + 1]!;
    if (ay <= y) {
      if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++;
    } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
  };
  if (edges) for (const i of edges) edge(i);
  else for (let i = 0; i < n; i++) edge(i);
  return w;
}

function bandsOf(p: Float64Array, b: [number, number, number, number]) {
  const n = p.length / 2;
  const count = Math.max(1, Math.ceil(n / 64));
  const h = (b[3] - b[1]) / count || 1;
  const lists: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ya = p[2 * i + 1]!;
    const yb = p[2 * j + 1]!;
    const k0 = Math.max(0, Math.min(count - 1, Math.floor((Math.min(ya, yb) - b[1]) / h)));
    const k1 = Math.max(0, Math.min(count - 1, Math.floor((Math.max(ya, yb) - b[1]) / h)));
    for (let k = k0; k <= k1; k++) lists[k]!.push(i);
  }
  return { y0: b[1], h, edges: lists.map((l) => Uint32Array.from(l)) };
}

export class HitTester {
  readonly #entries: Entry[] = [];
  readonly #grid = new Map<number, Entry[]>();
  readonly #cell: number;
  readonly #origin: [number, number];
  readonly #cols: number;
  readonly buildMs: number;

  constructor(ev: Evaluation, store: GeometryStore) {
    const t0 = performance.now();
    const views = new Map<string, ChunkView>();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    ev.drawList.forEach((it, k) => {
      let view = views.get(it.chunkId);
      if (!view) views.set(it.chunkId, (view = store.view(it.chunkId)));
      const subpaths = subpathsOf(view, it.pathIndex);
      const r = ev.runs[it.groupRun]?.clip ?? null;
      const item: Item = {
        k,
        nodeId: it.nodeId,
        locked: it.locked,
        evenOdd: it.evenOdd,
        inverse: invert(it.transform),
        clip: r,
        view,
        subpaths,
      };
      if (!item.inverse || subpaths.length === 0) return;
      const add = (sub: number, local: [number, number, number, number]) => {
        let box = mapBox(it.transform, local);
        if (r)
          box = [
            Math.max(box[0], r.x),
            Math.max(box[1], r.y),
            Math.min(box[2], r.x + r.w),
            Math.min(box[3], r.y + r.h),
          ];
        if (box[0] > box[2] || box[1] > box[3]) return;
        this.#entries.push({ item, sub, box });
        x0 = Math.min(x0, box[0]);
        y0 = Math.min(y0, box[1]);
        x1 = Math.max(x1, box[2]);
        y1 = Math.max(y1, box[3]);
      };
      if (subpaths.length > SUBPATH_INDEX_ABOVE) subpaths.forEach((s, i) => add(i, s.bounds));
      else {
        const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const s of subpaths) {
          b[0] = Math.min(b[0], s.bounds[0]);
          b[1] = Math.min(b[1], s.bounds[1]);
          b[2] = Math.max(b[2], s.bounds[2]);
          b[3] = Math.max(b[3], s.bounds[3]);
        }
        add(-1, b);
      }
    });
    const n = Math.max(1, this.#entries.length);
    const w = Math.max(1e-9, x1 - x0);
    const h = Math.max(1e-9, y1 - y0);
    this.#cell = Math.max(w, h) / Math.max(1, Math.ceil(Math.sqrt(n)));
    this.#origin = [x0, y0];
    this.#cols = Math.max(1, Math.ceil(w / this.#cell) + 1);
    for (const e of this.#entries) {
      const [c0, r0] = this.#cellOf(e.box[0], e.box[1]);
      const [c1, r1] = this.#cellOf(e.box[2], e.box[3]);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const key = r * this.#cols + c;
          let list = this.#grid.get(key);
          if (!list) this.#grid.set(key, (list = []));
          list.push(e);
        }
    }
    this.buildMs = performance.now() - t0;
  }

  get size(): number {
    return this.#entries.length;
  }

  #cellOf(x: number, y: number): [number, number] {
    return [
      Math.floor((x - this.#origin[0]) / this.#cell),
      Math.floor((y - this.#origin[1]) / this.#cell),
    ];
  }

  #subWinding(item: Item, s: Subpath, lx: number, ly: number): number {
    if (!inBox(s.bounds, lx, ly)) return 0;
    s.poly ??= flatten(item.view, s);
    if (s.poly.length / 2 > BAND_ABOVE) {
      s.bands ??= bandsOf(s.poly, s.bounds);
      const k = Math.max(
        0,
        Math.min(s.bands.edges.length - 1, Math.floor((ly - s.bands.y0) / s.bands.h)),
      );
      return winding(s.poly, lx, ly, s.bands.edges[k]);
    }
    return winding(s.poly, lx, ly);
  }

  /** Topmost selectable node at document point (x, y), or null. */
  hit(x: number, y: number): NodeId | null {
    const [c, r] = this.#cellOf(x, y);
    if (c < 0 || r < 0 || c >= this.#cols) return null;
    const cands = (this.#grid.get(r * this.#cols + c) ?? []).filter((e) => inBox(e.box, x, y));
    // Group candidates by item, topmost (highest paint index) first.
    const byItem = new Map<Item, Entry[]>();
    for (const e of cands) {
      const l = byItem.get(e.item);
      if (l) l.push(e);
      else byItem.set(e.item, [e]);
    }
    const items = [...byItem.keys()].sort((a, b) => b.k - a.k);
    for (const item of items) {
      if (item.locked) continue;
      const cl = item.clip;
      if (cl && !(x >= cl.x && x <= cl.x + cl.w && y >= cl.y && y <= cl.y + cl.h)) continue;
      const [lx, ly] = apply(item.inverse!, x, y);
      let w = 0;
      const entries = byItem.get(item)!;
      if (entries[0]!.sub === -1)
        for (const s of item.subpaths) w += this.#subWinding(item, s, lx, ly);
      else for (const e of entries) w += this.#subWinding(item, item.subpaths[e.sub]!, lx, ly);
      if (item.evenOdd ? w % 2 !== 0 : w !== 0) return item.nodeId;
    }
    return null;
  }
}
