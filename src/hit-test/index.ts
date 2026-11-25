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

/** A path being scanned for its subpaths; resumable at any verb (a halftone is one huge path). */
interface Scan {
  readonly k: number;
  readonly view: ChunkView;
  readonly v1: number;
  v: number;
  c: number;
  cur: { v0: number; c0: number; b: [number, number, number, number] } | null;
  readonly subpaths: Subpath[];
  /** After the scan: the item, and the next subpath to add as an index entry (bounded too). */
  item?: Item | null;
  added?: number;
}

/**
 * The hit index, built incrementally: `step(units)` advances by at most `units` verbs or entries
 * and can stop inside any path, so preparation runs in bounded slices off the click path. A query
 * is answered only by a complete index (`ready`); a partial index is never consulted. Built
 * without `deferred`, the constructor completes the index at once (the reference build).
 */
export class HitTester {
  readonly #entries: Entry[] = [];
  readonly #grid = new Map<number, Entry[]>();
  #cell = 1;
  #origin: [number, number] = [0, 0];
  #cols = 1;
  /** Total build time across steps (ms), and the number of steps taken. */
  buildMs = 0;
  steps = 0;
  readonly #ev: Evaluation;
  readonly #store: GeometryStore;
  readonly #views = new Map<string, ChunkView>();
  #phase: "scan" | "grid" | "done" = "scan";
  #k = 0;
  #scan: Scan | null = null;
  #placed = 0;
  #x0 = Infinity;
  #y0 = Infinity;
  #x1 = -Infinity;
  #y1 = -Infinity;

  constructor(ev: Evaluation, store: GeometryStore, o: { deferred?: boolean } = {}) {
    this.#ev = ev;
    this.#store = store;
    if (!o.deferred) this.step(Infinity);
  }

  get ready(): boolean {
    return this.#phase === "done";
  }

  /** Advances the build by at most `units` (verbs scanned or entries placed); true when done. */
  step(units: number): boolean {
    const t0 = performance.now();
    let budget = units;
    while (budget > 0 && this.#phase !== "done") {
      if (this.#phase === "scan") budget -= this.#scanStep(budget);
      else budget -= this.#gridStep(budget);
    }
    this.buildMs += performance.now() - t0;
    this.steps++;
    return this.ready;
  }

  /** Advances for about `ms` of wall time, in steps of `units`; true when done. */
  slice(ms: number, units = 4096): boolean {
    const end = performance.now() + ms;
    while (!this.ready && performance.now() < end) this.step(units);
    return this.ready;
  }

  #scanStep(budget: number): number {
    const list = this.#ev.drawList;
    if (!this.#scan) {
      if (this.#k >= list.length) {
        this.#startGrid();
        return 1;
      }
      const it = list[this.#k]!;
      let view = this.#views.get(it.chunkId);
      if (!view) this.#views.set(it.chunkId, (view = this.#store.view(it.chunkId)));
      this.#scan = {
        k: this.#k,
        view,
        v: view.verbOffset(it.pathIndex),
        v1: view.verbOffset(it.pathIndex + 1),
        c: view.coordOffset(it.pathIndex),
        cur: null,
        subpaths: [],
      };
    }
    const sc = this.#scan;
    const view = sc.view;
    let used = 0;
    const close = (end: number) => {
      if (sc.cur) sc.subpaths.push({ v0: sc.cur.v0, v1: end, c0: sc.cur.c0, bounds: sc.cur.b });
    };
    for (; sc.v < sc.v1 && used < budget; sc.v++, used++) {
      const verb = view.verb(sc.v);
      if (verb === VERB_M) {
        close(sc.v);
        sc.cur = { v0: sc.v, c0: sc.c, b: [Infinity, Infinity, -Infinity, -Infinity] };
      }
      const n = verb === VERB_C ? 6 : verb === VERB_Z ? 0 : 2;
      for (let j = 0; j < n; j += 2) {
        const x = view.coord(sc.c + j);
        const y = view.coord(sc.c + j + 1);
        const b = sc.cur!.b;
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x;
        if (y > b[3]) b[3] = y;
      }
      sc.c += n;
    }
    if (sc.v >= sc.v1 && sc.item === undefined) {
      close(sc.v1);
      sc.item = this.#makeItem(sc);
      sc.added = 0;
      used++;
    }
    if (sc.item !== undefined) {
      // Entries are added in units too: a 195k-subpath path is one item with 195k entries.
      used += this.#addEntries(sc, Math.max(1, budget - used));
      if (sc.item === null || sc.added! >= this.#entryCount(sc.item)) {
        this.#scan = null;
        this.#k++;
      }
    }
    return Math.max(1, used);
  }

  /** Entries an item contributes: one per subpath above the threshold, else one. */
  #entryCount(item: Item): number {
    return item.subpaths.length > SUBPATH_INDEX_ABOVE ? item.subpaths.length : 1;
  }

  #makeItem(sc: Scan): Item | null {
    const it = this.#ev.drawList[sc.k]!;
    const subpaths = sc.subpaths;
    const r = this.#ev.runs[it.groupRun]?.clip ?? null;
    const item: Item = {
      k: sc.k,
      nodeId: it.nodeId,
      locked: it.locked,
      evenOdd: it.evenOdd,
      inverse: invert(it.transform),
      clip: r,
      view: sc.view,
      subpaths,
    };
    return item.inverse && subpaths.length > 0 ? item : null;
  }

  /** Adds up to `budget` of the scanned item's entries; returns the units used. */
  #addEntries(sc: Scan, budget: number): number {
    const item = sc.item;
    if (!item) return 0;
    const it = this.#ev.drawList[item.k]!;
    const r = item.clip;
    const subpaths = item.subpaths;
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
      this.#x0 = Math.min(this.#x0, box[0]);
      this.#y0 = Math.min(this.#y0, box[1]);
      this.#x1 = Math.max(this.#x1, box[2]);
      this.#y1 = Math.max(this.#y1, box[3]);
    };
    if (subpaths.length > SUBPATH_INDEX_ABOVE) {
      const end = Math.min(subpaths.length, sc.added! + budget);
      for (let i = sc.added!; i < end; i++) add(i, subpaths[i]!.bounds);
      const used = end - sc.added!;
      sc.added = end;
      return used;
    }
    const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of subpaths) {
      b[0] = Math.min(b[0], s.bounds[0]);
      b[1] = Math.min(b[1], s.bounds[1]);
      b[2] = Math.max(b[2], s.bounds[2]);
      b[3] = Math.max(b[3], s.bounds[3]);
    }
    add(-1, b);
    sc.added = 1;
    return Math.max(1, subpaths.length);
  }

  #startGrid(): void {
    const n = Math.max(1, this.#entries.length);
    const w = Math.max(1e-9, this.#x1 - this.#x0);
    const h = Math.max(1e-9, this.#y1 - this.#y0);
    this.#cell = Math.max(w, h) / Math.max(1, Math.ceil(Math.sqrt(n)));
    this.#origin = [this.#x0, this.#y0];
    this.#cols = Math.max(1, Math.ceil(w / this.#cell) + 1);
    this.#phase = "grid";
  }

  #gridStep(budget: number): number {
    let used = 0;
    while (this.#placed < this.#entries.length && used < budget) {
      const e = this.#entries[this.#placed++]!;
      const [c0, r0] = this.#cellOf(e.box[0], e.box[1]);
      const [c1, r1] = this.#cellOf(e.box[2], e.box[3]);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const key = r * this.#cols + c;
          let list = this.#grid.get(key);
          if (!list) this.#grid.set(key, (list = []));
          list.push(e);
          used++;
        }
      used++;
    }
    if (this.#placed >= this.#entries.length) this.#phase = "done";
    return Math.max(1, used);
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

  /** Topmost selectable node at document point (x, y), or null. Only a complete index answers. */
  hit(x: number, y: number): NodeId | null {
    if (!this.ready) throw new Error("hit index not ready: a partial index never answers");
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
