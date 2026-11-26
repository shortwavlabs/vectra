// G-DOC-R stage D: a chunked copy-on-write map for the document's node map and parent index
// (STAGE-D-DESIGN §1). Immutable once built, ReadonlyMap-compatible, no dependency.
//
// Entries are kept sorted by (key number, key): the key number is the C1 ID number for keys
// of the form "xxx_<digits>" (every key of a valid document), and +Infinity otherwise, with
// ties broken by the key string. The sorted sequence is cut into chunks of a few hundred
// entries, a two-level B+-tree. Iteration order is therefore determined by the contents
// alone, whatever the chunk boundaries or edit history (AM-2 "deterministic bucket
// iteration"), and it follows ID order, which is creation order. An edit copies only the
// chunks it touches and the small chunk directory; the rest is shared with the predecessor.
// Locality: a trace's nodes, a group's children and a deleted layer's nodes have neighbouring
// IDs, so they fall in few chunks, and a tree walk reads chunks almost sequentially (a cached
// chunk hint makes those lookups O(1) at the directory level). A key may hold `undefined`,
// exactly as in a Map.

/** Deletion marker for `NodeMap.with` and Draft overlays; never a stored value. */
export const DELETED: unique symbol = Symbol("NodeMap.deleted");
type Write<V> = V | typeof DELETED;

/** Sort number of a key: the ID number of "xxx_<1–15 digits>", else +Infinity. */
export function keyNumber(k: string): number {
  const n = k.length;
  if (n < 5 || n > 19 || k.charCodeAt(3) !== 95) return Infinity;
  let v = 0;
  for (let i = 4; i < n; i++) {
    const d = k.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return Infinity;
    v = v * 10 + d;
  }
  return v;
}
/** Total order on (number, key): numbers first, then code-unit order of the keys. */
const cmp = (na: number, ka: string, nb: number, kb: string) =>
  na !== nb ? (na < nb ? -1 : 1) : ka < kb ? -1 : ka > kb ? 1 : 0;

/** Chunk sizes: built at TARGET, split above MAX, merged below MIN. */
export const CHUNK = Object.freeze({ TARGET: 512, MAX: 1024, MIN: 128 });

type Entry<V> = [n: number, k: string, v: V];
/** One chunk: parallel arrays sorted by (number, key). Never mutated once built. */
export interface Chunk<V> {
  readonly nums: Float64Array;
  readonly keys: readonly string[];
  readonly vals: readonly V[];
}
const EMPTY_CHUNK: Chunk<never> = Object.freeze({
  nums: new Float64Array(0),
  keys: Object.freeze([]),
  vals: Object.freeze([]),
});
const chunkOf = <V>(e: readonly Entry<V>[]): Chunk<V> => ({
  nums: Float64Array.from(e, (x) => x[0]),
  keys: e.map((x) => x[1]),
  vals: e.map((x) => x[2]),
});
/** Sorted entries cut into chunks of about TARGET (all of them when there are few). */
function cut<V>(e: readonly Entry<V>[]): Chunk<V>[] {
  if (e.length === 0) return [];
  const parts = Math.max(1, Math.round(e.length / CHUNK.TARGET));
  const out: Chunk<V>[] = [];
  for (let p = 0; p < parts; p++)
    out.push(
      chunkOf(
        e.slice(Math.floor((p * e.length) / parts), Math.floor(((p + 1) * e.length) / parts)),
      ),
    );
  return out;
}
/** Position of (n, k) in `c`, or -1 (binary search on the numbers; keys only on ties). */
function indexIn<V>(c: Chunk<V>, n: number, k: string): number {
  const nums = c.nums;
  let lo = 0;
  let hi = nums.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cmp(nums[mid]!, c.keys[mid]!, n, k) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo < nums.length && nums[lo] === n && c.keys[lo] === k ? lo : -1;
}
/**
 * The chunk `c` with sorted `list` applied, as zero, one or several chunks. Updates only: the
 * numbers and keys are shared and only the values are copied. Otherwise one merge pass into
 * parallel arrays (no per-entry allocation).
 */
function rebuild<V>(c: Chunk<V>, list: Entry<Write<V>>[]): Chunk<V>[] {
  list.sort((x, y) => cmp(x[0], x[1], y[0], y[1]));
  const at = list.map(([n, k]) => indexIn(c, n, k));
  if (list.every(([, , v], i) => v !== DELETED && at[i]! >= 0)) {
    const vals = c.vals.slice();
    list.forEach(([, , v], i) => (vals[at[i]!] = v as V));
    return [{ nums: c.nums, keys: c.keys, vals }];
  }
  const nums: number[] = [];
  const keys: string[] = [];
  const vals: V[] = [];
  let i = 0;
  const copyTo = (end: number) => {
    for (; i < end; i++) {
      nums.push(c.nums[i]!);
      keys.push(c.keys[i]!);
      vals.push(c.vals[i]!);
    }
  };
  list.forEach(([n, k, v], j) => {
    const pos = at[j]!;
    copyTo(pos >= 0 ? pos : lowerBound(c, n, k));
    if (pos >= 0) i++; // replaced or deleted
    if (v !== DELETED) {
      nums.push(n);
      keys.push(k);
      vals.push(v as V);
    }
  });
  copyTo(c.keys.length);
  return split(nums, keys, vals);
}
/** First position in `c` whose (number, key) is not below (n, k). */
function lowerBound<V>(c: Chunk<V>, n: number, k: string): number {
  let lo = 0;
  let hi = c.keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cmp(c.nums[mid]!, c.keys[mid]!, n, k) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** Parallel sorted arrays as chunks: none, one, or cut at TARGET when above MAX. */
function split<V>(nums: number[], keys: string[], vals: V[]): Chunk<V>[] {
  const len = keys.length;
  if (len === 0) return [];
  const parts = len > CHUNK.MAX ? Math.round(len / CHUNK.TARGET) : 1;
  const out: Chunk<V>[] = [];
  for (let p = 0; p < parts; p++) {
    const a = Math.floor((p * len) / parts);
    const b = Math.floor(((p + 1) * len) / parts);
    out.push({
      nums: Float64Array.from(nums.slice(a, b)),
      keys: keys.slice(a, b),
      vals: vals.slice(a, b),
    });
  }
  return out;
}

/** Iterates chunks' parallel arrays without a generator. */
class ChunkIterator<V, T> implements MapIterator<T> {
  #c = 0;
  #i = 0;
  readonly #chunks: readonly Chunk<V>[];
  readonly #pick: (c: Chunk<V>, i: number) => T;
  constructor(chunks: readonly Chunk<V>[], pick: (c: Chunk<V>, i: number) => T) {
    this.#chunks = chunks;
    this.#pick = pick;
  }
  next(): IteratorResult<T, undefined> {
    const cs = this.#chunks;
    while (this.#c < cs.length) {
      const c = cs[this.#c]!;
      if (this.#i < c.keys.length) return { value: this.#pick(c, this.#i++), done: false };
      this.#c++;
      this.#i = 0;
    }
    return { value: undefined, done: true };
  }
  [Symbol.iterator](): this {
    return this;
  }
}

export class NodeMap<V> implements ReadonlyMap<string, V> {
  readonly #chunks: readonly Chunk<V>[];
  /** First entry of each chunk (the directory), for locating a key's chunk. */
  readonly #firstNums: Float64Array;
  readonly #firstKeys: readonly string[];
  readonly #size: number;
  /** The last chunk a lookup landed in: a cache, not state (walks hit it repeatedly). */
  #hint = 0;

  private constructor(chunks: readonly Chunk<V>[], size: number) {
    const cs = chunks.length ? chunks : [EMPTY_CHUNK as Chunk<V>];
    this.#chunks = cs;
    this.#firstNums = Float64Array.from(cs, (c) => (c.keys.length ? c.nums[0]! : -Infinity));
    this.#firstKeys = cs.map((c) => c.keys[0] ?? "");
    this.#size = size;
  }

  static empty<V>(): NodeMap<V> {
    return new NodeMap<V>([], 0);
  }

  /** Builds a map from entries (later duplicates win), O(n log n). */
  static from<V>(entries: Iterable<readonly [string, V]>): NodeMap<V> {
    const dedup = new Map<string, V>();
    for (const [k, v] of entries) dedup.set(k, v);
    const e: Entry<V>[] = [];
    for (const [k, v] of dedup) e.push([keyNumber(k), k, v]);
    e.sort((a, b) => cmp(a[0], a[1], b[0], b[1]));
    return new NodeMap(cut(e), e.length);
  }

  /** `m` itself when it is a NodeMap, else a NodeMap with its entries. */
  static of<V>(m: ReadonlyMap<string, V>): NodeMap<V> {
    return m instanceof NodeMap ? (m as NodeMap<V>) : NodeMap.from(m);
  }

  /** Index of the chunk that holds (or would hold) (n, k). */
  #locate(n: number, k: string): number {
    const fn = this.#firstNums;
    const fk = this.#firstKeys;
    const last = fn.length - 1;
    const h = this.#hint;
    if (
      (h === 0 || cmp(fn[h]!, fk[h]!, n, k) <= 0) &&
      (h === last || cmp(fn[h + 1]!, fk[h + 1]!, n, k) > 0)
    )
      return h;
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (cmp(fn[mid]!, fk[mid]!, n, k) <= 0) lo = mid;
      else hi = mid - 1;
    }
    this.#hint = lo;
    return lo;
  }

  get size(): number {
    return this.#size;
  }
  get(k: string): V | undefined {
    const n = keyNumber(k);
    const c = this.#chunks[this.#locate(n, k)]!;
    const i = indexIn(c, n, k);
    return i < 0 ? undefined : c.vals[i];
  }
  has(k: string): boolean {
    const n = keyNumber(k);
    return indexIn(this.#chunks[this.#locate(n, k)]!, n, k) >= 0;
  }
  entries(): MapIterator<[string, V]> {
    return new ChunkIterator(this.#chunks, (c, i) => [c.keys[i]!, c.vals[i]!] as [string, V]);
  }
  keys(): MapIterator<string> {
    return new ChunkIterator(this.#chunks, (c, i) => c.keys[i]!);
  }
  values(): MapIterator<V> {
    return new ChunkIterator(this.#chunks, (c, i) => c.vals[i]!);
  }
  [Symbol.iterator](): MapIterator<[string, V]> {
    return this.entries();
  }
  forEach(cb: (value: V, key: string, map: ReadonlyMap<string, V>) => void, thisArg?: unknown) {
    for (const c of this.#chunks)
      for (let i = 0; i < c.keys.length; i++) cb.call(thisArg, c.vals[i]!, c.keys[i]!, this);
  }
  get [Symbol.toStringTag](): string {
    return "NodeMap";
  }

  /** The chunks, for structural diffs and history accounting (read-only use). */
  get chunks(): readonly Chunk<V>[] {
    return this.#chunks;
  }

  /**
   * A new map with `writes` applied (a value, or DELETED to remove). Untouched chunks are
   * shared; writes that change nothing are skipped (and so are their chunks). A touched chunk
   * that overflows is split; one that falls below MIN is merged with a neighbour.
   */
  with(writes: ReadonlyMap<string, Write<V>>): NodeMap<V> {
    if (writes.size === 0) return this;
    const chunks = this.#chunks;
    const touched = new Map<number, Entry<Write<V>>[]>();
    let size = this.#size;
    for (const [k, v] of writes) {
      const n = keyNumber(k);
      const ci = this.#locate(n, k);
      const c = chunks[ci]!;
      const at = indexIn(c, n, k);
      if (v === DELETED) {
        if (at < 0) continue;
        size--;
      } else if (at < 0) size++;
      else if (c.vals[at] === v) continue; // an identical write is not a change
      let list = touched.get(ci);
      if (!list) touched.set(ci, (list = []));
      list.push([n, k, v]);
    }
    if (touched.size === 0) return this;
    const out: Chunk<V>[] = [];
    const rebuilt = new Set<Chunk<V>>();
    chunks.forEach((c, i) => {
      const list = touched.get(i);
      if (!list) return void out.push(c);
      for (const r of rebuild(c, list)) {
        out.push(r);
        rebuilt.add(r);
      }
    });
    // Merge rebuilt chunks below MIN with a neighbour (re-cut if the result is too large).
    for (let i = 0; i < out.length && out.length > 1; i++) {
      const c = out[i]!;
      if (!rebuilt.has(c) || c.keys.length >= CHUNK.MIN) continue;
      const j = i + 1 < out.length ? i + 1 : i - 1;
      const [a, b] = j > i ? [c, out[j]!] : [out[j]!, c];
      const parts = split([...a.nums, ...b.nums], [...a.keys, ...b.keys], [...a.vals, ...b.vals]);
      out.splice(Math.min(i, j), 2, ...parts);
      for (const p of parts) rebuilt.add(p);
      i = Math.max(-1, Math.min(i, j) - 1);
    }
    return new NodeMap(out, size);
  }
}

/**
 * A Draft's view of a node map: an overlay of writes over an immutable base. Construction is
 * O(1); the base is never mutated, so a failed transaction leaves it intact. `publish` builds
 * the successor NodeMap; `written` is every key set or deleted (for the transaction's log).
 */
export class NodeMapDraft<V> {
  readonly #base: ReadonlyMap<string, V>;
  readonly #writes = new Map<string, Write<V>>();
  #size: number;
  #published = false;

  constructor(base: ReadonlyMap<string, V>) {
    this.#base = base;
    this.#size = base.size;
  }
  get size(): number {
    return this.#size;
  }
  get(k: string): V | undefined {
    if (this.#writes.has(k)) {
      const v = this.#writes.get(k)!;
      return v === DELETED ? undefined : (v as V);
    }
    return this.#base.get(k);
  }
  has(k: string): boolean {
    return this.#writes.has(k) ? this.#writes.get(k) !== DELETED : this.#base.has(k);
  }
  set(k: string, v: V): this {
    this.#mutable();
    if (!this.has(k)) this.#size++;
    this.#writes.set(k, v);
    return this;
  }
  delete(k: string): boolean {
    this.#mutable();
    const had = this.has(k);
    if (had) this.#size--;
    this.#writes.set(k, DELETED); // logged even when absent: the log may be a superset
    return had;
  }
  *values(): IterableIterator<V> {
    for (const [k, v] of this.#base) if (!this.#writes.has(k)) yield v;
    for (const v of this.#writes.values()) if (v !== DELETED) yield v as V;
  }
  /** Every key set or deleted through this Draft. */
  get written(): Iterable<string> {
    return this.#writes.keys();
  }
  /** The successor map. A Draft publishes once; afterwards it rejects writes. */
  publish(): NodeMap<V> {
    this.#mutable();
    this.#published = true;
    return NodeMap.of(this.#base).with(this.#writes);
  }
  #mutable(): void {
    if (this.#published) throw new TypeError("a published Draft's node map is immutable");
  }
}

/**
 * Keys whose entries differ between two maps (identity; a present key holding `undefined`
 * differs from a missing key). Two NodeMaps are compared through the chunks they do not
 * share: O(chunks + entries of the unshared chunks). Anything else entry by entry, O(n).
 */
export function changedKeys<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>): Set<string> {
  const out = new Set<string>();
  if (a instanceof NodeMap && b instanceof NodeMap) {
    const inA = new Set<Chunk<V>>(a.chunks);
    const inB = new Set<Chunk<V>>(b.chunks);
    const candidates = new Set<string>();
    for (const c of a.chunks as Chunk<V>[])
      if (!inB.has(c)) c.keys.forEach((k) => candidates.add(k));
    for (const c of b.chunks as Chunk<V>[])
      if (!inA.has(c)) c.keys.forEach((k) => candidates.add(k));
    for (const k of candidates) if (a.get(k) !== b.get(k) || a.has(k) !== b.has(k)) out.add(k);
    return out;
  }
  for (const [k, v] of b) if (a.get(k) !== v || !a.has(k)) out.add(k);
  for (const k of a.keys()) if (!b.has(k)) out.add(k);
  return out;
}
