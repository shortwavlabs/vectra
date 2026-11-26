// G-DOC-R stage D: NodeMap and NodeMapDraft against a reference Map, chunk boundaries,
// structural sharing, immutability, `undefined` values and deterministic order.
import { describe, expect, test } from "vite-plus/test";
import { CHUNK, changedKeys, DELETED, keyNumber, NodeMap, NodeMapDraft } from "./node-map.ts";
import { rng } from "./testing/synthetic.ts";

type V = { v: number } | undefined;
const cmp = (a: string, b: string) => {
  const x = keyNumber(a);
  const y = keyNumber(b);
  return x !== y ? (x < y ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0;
};
/** Every observable of `m` equals the reference map `ref` (bulk comparisons). */
function same(m: NodeMap<V>, ref: Map<string, V>, probes: readonly string[] = []) {
  expect(m.size).toBe(ref.size);
  expect([...m.keys()]).toEqual([...ref.keys()].sort(cmp));
  const all = [...new Set([...ref.keys(), ...probes])];
  expect(all.map((k) => [m.has(k), m.get(k)])).toEqual(all.map((k) => [ref.has(k), ref.get(k)]));
  // Chunk invariants: none above MAX; none below MIN (or empty) unless it is the only chunk.
  const sizes = m.chunks.map((c) => c.keys.length);
  expect(sizes.every((n) => n <= CHUNK.MAX)).toBe(true);
  if (sizes.length > 1) expect(sizes.every((n) => n >= CHUNK.MIN)).toBe(true);
}
const KEY_POOL = (r: ReturnType<typeof rng>) =>
  r.pick([
    () => `pth_${r.int(3000)}`,
    () => `grp_${r.int(3000)}`, // shares numbers with pth_* (ties broken by the string)
    () => `pth_0${r.int(50)}`, // leading zero: same number as pth_N
    () => r.pick(["", "x", "pth_", "pth_1x", "lay_9999999999999999", "αβ_1", "pth-12"]),
  ])();

describe("NodeMap", () => {
  test("keyNumber: ID numbers, else +Infinity", () => {
    expect(keyNumber("pth_12")).toBe(12);
    expect(keyNumber("grp_012")).toBe(12);
    expect(keyNumber("lay_999999999999999")).toBe(999_999_999_999_999);
    for (const k of ["", "pth_", "pth_1x", "pth-12", "lay_9999999999999999", "ab_1"])
      expect(keyNumber(k)).toBe(Infinity);
  });

  test("random edits match a reference Map, with undefined values, ties and odd keys", () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = rng(seed);
      let m = NodeMap.empty<V>();
      const ref = new Map<string, V>();
      const probes = new Set<string>();
      for (let step = 0; step < 120; step++) {
        const writes = new Map<string, V | typeof DELETED>();
        const n = r.pick([1, 3, 40, 400, 2500]);
        for (let i = 0; i < n; i++) {
          const k = KEY_POOL(r);
          probes.add(k);
          writes.set(k, r.bool(0.35) ? DELETED : r.bool(0.1) ? undefined : { v: r.int(1e6) });
        }
        const before = [...m.entries()];
        const next = m.with(writes);
        expect([...m.entries()]).toEqual(before); // the base is never changed
        for (const [k, v] of writes)
          if (v === DELETED) ref.delete(k);
          else ref.set(k, v);
        same(next, ref, [...probes]);
        m = next;
      }
    }
  });

  test("chunks split above MAX and merge below MIN at the boundaries", () => {
    const put = (m: NodeMap<V>, from: number, to: number) =>
      m.with(new Map(Array.from({ length: to - from }, (_, i) => [`pth_${from + i}`, { v: i }])));
    const del = (m: NodeMap<V>, ids: number[]) =>
      m.with(new Map(ids.map((i) => [`pth_${i}`, DELETED] as const)));
    const ref = (ids: number[]) => new Map(ids.map((i) => [`pth_${i}`, undefined as V]));
    let m = put(NodeMap.empty(), 0, CHUNK.MAX);
    expect(m.chunks.length).toBe(1); // exactly MAX: one chunk
    m = put(m, CHUNK.MAX, CHUNK.MAX + 1);
    expect(m.chunks.length).toBe(2); // MAX + 1: split
    m = put(m, CHUNK.MAX + 1, 20_000);
    expect(m.size).toBe(20_000);
    // Delete most of one chunk: it merges with a neighbour; then empty a region entirely.
    const first = m.chunks[3]!.keys.map((k) => keyNumber(k));
    m = del(m, first.slice(0, first.length - CHUNK.MIN + 1));
    m = del(
      m,
      Array.from({ length: 5000 }, (_, i) => 6000 + i),
    );
    const kept = Array.from({ length: 20_000 }, (_, i) => i).filter(
      (i) =>
        !(i >= 6000 && i < 11_000) && !first.slice(0, first.length - CHUNK.MIN + 1).includes(i),
    );
    expect([...m.keys()]).toEqual(kept.map((i) => `pth_${i}`));
    same(m, new Map(kept.map((i) => [`pth_${i}`, m.get(`pth_${i}`)])), [
      "pth_6000",
      "pth_19999",
      "pth_20000",
    ]);
    // Delete everything: one empty chunk remains.
    m = del(m, kept);
    expect(m.size).toBe(0);
    expect(m.chunks.length).toBe(1);
    same(m, ref([]), ["pth_1"]);
  });

  test("structural sharing: untouched chunks are shared; no-op writes return the same map", () => {
    const m = NodeMap.from(
      Array.from({ length: 50_000 }, (_, i) => [`pth_${i}`, { v: i }] as const),
    );
    const one = m.with(new Map([["pth_25000", { v: -1 }]]));
    const changed = one.chunks.filter((c, i) => c !== m.chunks[i]);
    expect(one.chunks.length).toBe(m.chunks.length);
    expect(changed.length).toBe(1);
    expect(changed[0]!.keys).toBe(m.chunks[one.chunks.indexOf(changed[0]!)]!.keys); // keys shared
    const same1 = m.get("pth_7")!;
    expect(m.with(new Map([["pth_7", same1]]))).toBe(m); // identical value
    expect(m.with(new Map([["pth_999999", DELETED]]))).toBe(m); // delete of an absent key
    expect(m.with(new Map())).toBe(m);
    expect(m.get("pth_25000")).toEqual({ v: 25000 }); // the base is unchanged
  });

  test("a key holding undefined differs from a missing key", () => {
    const m = NodeMap.from<V>([["pth_1", undefined]]);
    expect(m.has("pth_1")).toBe(true);
    expect(m.get("pth_1")).toBeUndefined();
    expect(m.has("pth_2")).toBe(false);
    expect(m.size).toBe(1);
    expect(changedKeys(NodeMap.empty<V>(), m)).toEqual(new Set(["pth_1"]));
    expect(changedKeys(new Map<string, V>(), new Map([["pth_1", undefined]]))).toEqual(
      new Set(["pth_1"]),
    );
  });

  test("order depends on contents only: different histories iterate identically", () => {
    const r = rng(9);
    const final = new Map<string, V>();
    for (let i = 0; i < 6000; i++) final.set(KEY_POOL(r), { v: i });
    const a = NodeMap.from([...final]);
    // Build the same contents by inserting in reverse, in batches, with deletions on the way.
    let b = NodeMap.empty<V>();
    const keys = [...final.keys()].reverse();
    for (let i = 0; i < keys.length; i += 700)
      b = b.with(new Map(keys.slice(i, i + 700).map((k) => [k, { v: -1 }] as const)));
    b = b.with(new Map([...final].map(([k, v]) => [k, v] as const)));
    expect([...b.entries()]).toEqual([...a.entries()]);
    expect(b).toEqual(a); // vitest equality: same class, same sequence, no own fields
  });

  test("changedKeys equals a brute-force diff, sharing or not", () => {
    const r = rng(11);
    let m = NodeMap.from<V>(Array.from({ length: 8000 }, (_, i) => [`pth_${i}`, { v: i }]));
    for (let t = 0; t < 40; t++) {
      const writes = new Map<string, V | typeof DELETED>();
      for (let i = 0; i < r.pick([1, 10, 300]); i++)
        writes.set(KEY_POOL(r), r.bool(0.3) ? DELETED : r.bool(0.1) ? undefined : { v: t });
      const next = m.with(writes);
      const brute = new Set<string>();
      for (const [k, v] of next) if (m.get(k) !== v || !m.has(k)) brute.add(k);
      for (const k of m.keys()) if (!next.has(k)) brute.add(k);
      expect(changedKeys(m, next)).toEqual(brute);
      expect(changedKeys(new Map(m), new Map(next))).toEqual(brute);
      m = next;
    }
  });
});

describe("NodeMapDraft", () => {
  test("an overlay: reads see writes; the base is never mutated; publishes once", () => {
    const base = NodeMap.from<V>([
      ["pth_1", { v: 1 }],
      ["pth_2", { v: 2 }],
    ]);
    const d = new NodeMapDraft(base);
    d.set("pth_3", { v: 3 });
    d.set("pth_4", undefined);
    expect(d.delete("pth_1")).toBe(true);
    expect(d.delete("pth_9")).toBe(false); // absent: no size change
    d.delete("pth_2");
    d.set("pth_2", { v: 22 }); // deleted then re-set
    expect(d.size).toBe(3);
    expect(d.has("pth_1")).toBe(false);
    expect(d.has("pth_4")).toBe(true);
    expect(d.get("pth_4")).toBeUndefined();
    expect(d.get("pth_2")).toEqual({ v: 22 });
    expect([...d.values()].length).toBe(3);
    expect(new Set(d.written)).toEqual(new Set(["pth_1", "pth_2", "pth_3", "pth_4", "pth_9"]));
    expect([...base.entries()]).toEqual([
      ["pth_1", { v: 1 }],
      ["pth_2", { v: 2 }],
    ]);
    const m = d.publish();
    expect([...m.entries()]).toEqual([
      ["pth_2", { v: 22 }],
      ["pth_3", { v: 3 }],
      ["pth_4", undefined],
    ]);
    expect(() => d.set("pth_5", { v: 5 })).toThrow(TypeError);
    expect(() => d.publish()).toThrow(TypeError);
  });

  test("a plain Map base is converted on publish; an abandoned Draft changes nothing", () => {
    const plain = new Map<string, V>([["pth_1", { v: 1 }]]);
    const d = new NodeMapDraft(plain);
    d.set("pth_1", { v: 9 });
    expect(plain.get("pth_1")).toEqual({ v: 1 });
    const m = d.publish();
    expect(m).toBeInstanceOf(NodeMap);
    expect(m.get("pth_1")).toEqual({ v: 9 });
  });
});
