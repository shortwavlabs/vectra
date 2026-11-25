import { describe, expect, test } from "vite-plus/test";
import { canonicalJsonBytes } from "../persistence/canonical-json.ts";
import {
  copyDiagnostics,
  copyIncoming,
  GeometryStore,
  type OwnerKind,
  startupCheck,
} from "./geometry-store.ts";
import { DocumentError } from "./model.ts";
import { DEFAULT_PACKET_LIMITS, type IncomingPacket, SECTION_KEYS } from "./packet-port.ts";
import { FIXTURE_SCENES, fixturePacket } from "./testing/fixtures.ts";
import { testPacketPort } from "./testing/packet-adapter.ts";
import { syntheticPacket } from "./testing/synthetic.ts";

const newStore = () => new GeometryStore(testPacketPort);
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DocumentError ? e.code : `untyped:${String(e)}`;
  }
  return "ok";
};
const storeState = (s: GeometryStore) => ({
  ids: s.chunkIds(),
  next: s.nextChunkId,
  bytes: s.bytes(),
});

/** Walks every own and inherited property; returns the path of any buffer exposure. */
function findBufferExposure(
  root: unknown,
  label = "root",
  seen = new Set<unknown>(),
): string | null {
  const isBuffer = (v: unknown) =>
    v instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== "undefined" && v instanceof SharedArrayBuffer) ||
    ArrayBuffer.isView(v);
  if (isBuffer(root)) return label;
  if ((typeof root !== "object" && typeof root !== "function") || root === null || seen.has(root))
    return null;
  seen.add(root);
  for (let o: object | null = root as object; o; o = Object.getPrototypeOf(o)) {
    for (const key of Reflect.ownKeys(o)) {
      const desc = Object.getOwnPropertyDescriptor(o, key);
      if (!desc || !("value" in desc)) continue;
      const hit = findBufferExposure(desc.value, `${label}.${String(key)}`, seen);
      if (hit) return hit;
    }
  }
  return null;
}

describe("GeometryStore commit (C2 rules 1–4)", () => {
  test("aliases are detached after commit; writes through them leave view reads unchanged", () => {
    const s = newStore();
    const p = fixturePacket("circle-bw");
    const expected = Array.from(p.coords);
    const alias = new Float64Array(p.coords.buffer);
    const dv = new DataView(p.verbs.buffer);
    const id = s.commit(p);
    for (const k of SECTION_KEYS) expect(p[k].byteLength, k).toBe(0);
    expect(alias.byteLength).toBe(0);
    expect((dv.buffer as ArrayBuffer & { detached?: boolean }).detached).toBe(true);
    expect(() => dv.getUint8(0)).toThrow(TypeError); // a DataView alias can no longer read
    alias[0] = 12345;
    p.coords[1] = 54321;
    const v = s.view(id);
    expect(Array.from({ length: v.coordCount }, (_, i) => v.coord(i))).toEqual(expected);
  });

  test("validate–mutate–commit stores only the moved bytes and re-validates them", () => {
    const s = newStore();
    const p = fixturePacket("circle-bw");
    expect(testPacketPort.validate(p.manifest, p, DEFAULT_PACKET_LIMITS).ok).toBe(true);
    p.coords[3] = 77.25; // still valid
    const id = s.commit(p);
    expect(s.view(id).coord(3)).toBe(77.25);
    const q = fixturePacket("circle-bw");
    expect(testPacketPort.validate(q.manifest, q, DEFAULT_PACKET_LIMITS).ok).toBe(true);
    q.coords[3] = NaN; // mutation after an earlier validation
    const before = storeState(s);
    expect(codeOf(() => s.commit(q))).toBe("coord");
    expect(storeState(s)).toEqual(before);
    expect(q.coords.byteLength).toBe(0); // consumed even though commit failed
  });

  const violations: [string, (p: IncomingPacket) => void][] = [
    ["offset view", (p) => (p.coords = new Float64Array(p.coords.length + 1).subarray(1))],
    [
      "two sections sharing one buffer",
      (p) => {
        const buf = new ArrayBuffer(p.styleIndex.byteLength * 2);
        p.styleIndex = new Uint32Array(buf, 0, p.styleIndex.length);
        p.groupIndex = new Uint32Array(buf, p.styleIndex.byteLength, p.groupIndex.length);
      },
    ],
    ["same buffer reused for two sections", (p) => (p.groupIndex = p.styleIndex)],
    [
      "SharedArrayBuffer",
      (p) => {
        const c = new Float64Array(new SharedArrayBuffer(p.coords.byteLength));
        c.set(p.coords);
        p.coords = c as unknown as Float64Array;
      },
    ],
    [
      "resizable ArrayBuffer",
      (p) => {
        const Ctor = ArrayBuffer as unknown as new (
          n: number,
          o: { maxByteLength: number },
        ) => ArrayBuffer;
        const c = new Float64Array(
          new Ctor(p.coords.byteLength, { maxByteLength: p.coords.byteLength * 2 }),
        );
        c.set(p.coords);
        p.coords = c;
      },
    ],
    ["detached", (p) => void structuredClone(p.verbs.buffer, { transfer: [p.verbs.buffer] })],
    ["plain array", (p) => (p.verbs = Array.from(p.verbs) as unknown as Uint8Array)],
  ];
  for (const [name, mutate] of violations)
    test(`rule-1 violation → ownership, store unchanged: ${name}`, () => {
      const s = newStore();
      s.commit(fixturePacket("adjacent_colors-color"));
      const before = storeState(s);
      const p = fixturePacket("circle-bw");
      mutate(p);
      expect(codeOf(() => s.commit(p))).toBe("ownership");
      expect(storeState(s)).toEqual(before);
    });

  test("invalid packets → their C3 code, store unchanged", () => {
    const s = newStore();
    const p = fixturePacket("circle-bw");
    p.coords = new Float32Array(p.coords) as unknown as Float64Array;
    expect(codeOf(() => s.commit(p))).toBe("type");
    const q = fixturePacket("circle-bw");
    q.verbs[0] = 9;
    expect(codeOf(() => s.commit(q))).toBe("opcode");
    expect(s.chunkIds()).toEqual([]);
    expect(s.nextChunkId).toBe(1);
  });

  test("chunk IDs are monotonic and never reused, including after free", () => {
    const s = newStore();
    const a = s.commit(fixturePacket("circle-bw"));
    s.settle(); // unowned → freed
    expect(s.has(a)).toBe(false);
    const b = s.commit(fixturePacket("circle-bw"));
    expect([a, b]).toEqual(["chk_1", "chk_2"]);
  });

  test("commit timing is recorded per step (C9)", () => {
    const s = newStore();
    s.commit(fixturePacket("thin_strokes-halftone"));
    const t = s.lastCommitTiming!;
    for (const v of [t.moveMs, t.validateMs, t.publishMs]) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("GeometryStore access and copy-out (C2 rules 5–7)", () => {
  test("runtime property walk finds no buffer exposure in views, derived views or results", () => {
    const s = newStore();
    const id = s.commit(fixturePacket("thin_strokes-halftone"));
    const v = s.view(id);
    const d = s.derived(id);
    expect(Object.isFrozen(v) && Object.isFrozen(d) && Object.isFrozen(v.manifest)).toBe(true);
    expect(findBufferExposure(v, "view")).toBeNull();
    expect(findBufferExposure(d, "derived")).toBeNull();
    const results: unknown[] = [];
    for (const key of Reflect.ownKeys(v)) {
      const f = (v as unknown as Record<PropertyKey, unknown>)[key];
      if (typeof f === "function") results.push(key === "commands" ? [...v.commands(0)] : f(0));
    }
    for (const key of Reflect.ownKeys(d)) {
      const f = (d as unknown as Record<PropertyKey, unknown>)[key];
      if (typeof f === "function") results.push(f(0));
    }
    expect(findBufferExposure(results, "results")).toBeNull();
    expect(findBufferExposure(s, "store")).toBeNull();
  });

  test("jobCopy/renderCopy return fresh buffers; committed buffers survive N jobs and terminations", async () => {
    const s = newStore();
    const ids = [...FIXTURE_SCENES.keys()].map((n) => s.commit(fixturePacket(n)));
    for (const id of ids) s.retain(id, { kind: "document" });
    const snapshot = ids.map((id) => [...s.view(id).commands(0)]);
    for (let n = 0; n < 25; n++) {
      const copy = n % 2 ? s.jobCopy(ids) : s.renderCopy(ids);
      expect(copy.transfer.length).toBe(6 * ids.length);
      copy.packets[0]!.coords[0] = -1; // writes to a copy never reach the store
      if (n % 3 === 0) {
        // Simulated worker post + termination: transfer the copy, then drop it.
        const { port1, port2 } = new MessageChannel();
        port1.postMessage(copy.packets, copy.transfer);
        port1.close();
        port2.close();
      } else structuredClone(copy.packets, { transfer: copy.transfer });
      expect(copy.packets[0]!.coords.byteLength).toBe(0);
      expect(s.checkIntegrity()).toBe(true);
    }
    expect(ids.map((id) => [...s.view(id).commands(0)])).toEqual(snapshot);
    expect(s.stats).toEqual({ commits: ids.length, jobCopies: 12, renderCopies: 13 });
  });

  test("copyIncoming makes non-exclusive inputs committable and is counted", () => {
    const s = newStore();
    const p = fixturePacket("circle-bw");
    p.coords = new Float64Array([0, ...p.coords]).subarray(1);
    const before = { ...copyDiagnostics };
    const copy = copyIncoming(p);
    expect(copyDiagnostics.defensiveCopies).toBe(before.defensiveCopies + 1);
    expect(copyDiagnostics.bytes - before.bytes).toBe(
      SECTION_KEYS.reduce((n, k) => n + p[k].byteLength, 0),
    );
    expect(codeOf(() => s.commit(copy))).toBe("ok");
    expect(p.coords.byteLength).toBeGreaterThan(0); // the original is untouched
  });

  test("encodeRecord round-trips through the port codec", () => {
    const s = newStore();
    const id = s.commit(fixturePacket("adjacent_colors-mosaic"));
    const rec = s.encodeRecord(id);
    const d = testPacketPort.decodeRecord(rec, DEFAULT_PACKET_LIMITS);
    if (!d.ok) throw new Error(d.message);
    const id2 = s.commit(d.packet);
    expect(s.encodeRecord(id2)).toEqual(rec);
  });
});

describe("GeometryStore lifetime and accounting (C2 rules 8, 11; C3.2)", () => {
  test("refcounts per owner kind; freed exactly at the settle after the last release", () => {
    const s = newStore();
    const id = s.commit(fixturePacket("circle-bw"));
    const kinds: OwnerKind[] = ["document", "history", "snapshot", "job", "history"];
    for (const kind of kinds) s.retain(id, { kind });
    expect(s.ownerCounts(id)).toEqual({ document: 1, snapshot: 1, job: 1, history: 2 });
    for (const kind of kinds) {
      expect(s.settle()).toEqual([]);
      expect(s.has(id)).toBe(true);
      s.release(id, { kind });
    }
    const view = s.view(id);
    expect(s.settle()).toEqual([id]);
    expect(s.has(id)).toBe(false);
    expect(codeOf(() => view.coord(0))).toBe("unknown_chunk");
    expect(s.bytes().total).toBe(0);
  });

  test("release below zero is an error", () => {
    const s = newStore();
    const id = s.commit(fixturePacket("circle-bw"));
    expect(codeOf(() => s.release(id, { kind: "job" }))).toBe("invariant");
  });

  test("bytes() is the exact C3.2 chunk cost, attributed once by precedence; Σ byOwnerKind = total", () => {
    const s = newStore();
    const costs: number[] = [];
    const ids = [...FIXTURE_SCENES.keys()].map((n) => {
      const p = fixturePacket(n);
      const m = p.manifest;
      const r = testPacketPort.validate(m, p, DEFAULT_PACKET_LIMITS);
      if (!r.ok) throw new Error(r.message);
      const mMem = m.verbCount + 8 * m.coordCount + 16 * m.pathCount + 8;
      expect(mMem).toBe(SECTION_KEYS.reduce((t, k) => t + p[k].byteLength, 0));
      costs.push(
        mMem + canonicalJsonBytes(m).length + 36 * m.pathCount + 4 * r.derived.subpathStart.length,
      );
      return s.commit(p);
    });
    ids.forEach((id, i) => expect(s.cost(id)).toBe(costs[i]));
    const owners: OwnerKind[][] = [
      ["history"],
      ["job", "history"],
      ["snapshot", "job"],
      ["document", "history"],
      ["document"],
      ["history", "history"],
      ["snapshot"],
    ];
    ids.forEach((id, i) => owners[i]!.forEach((kind) => s.retain(id, { kind })));
    const b = s.bytes();
    const c = (i: number) => costs[i]!;
    expect(b.byOwnerKind).toEqual({
      document: c(3) + c(4),
      snapshot: c(2) + c(6),
      job: c(1),
      history: c(0) + c(5),
    });
    expect(Object.values(b.byOwnerKind).reduce((x, y) => x + y)).toBe(b.total);
    expect(b.total).toBe(costs.reduce((x, y) => x + y));
  });

  test("startup check passes on this host (little-endian, detaching transfer)", () => {
    expect(startupCheck()).toEqual({ ok: true, littleEndian: true, detachingTransfer: true });
  });

  test("empty packet (pathCount 0) is valid", () => {
    const s = newStore();
    const p = syntheticPacket({ paths: 1, anchorsPerPath: 2 });
    const empty: IncomingPacket = {
      manifest: { ...p.manifest, pathCount: 0, verbCount: 0, coordCount: 0, groups: [] },
      verbs: new Uint8Array(0),
      coords: new Float64Array(0),
      verbOffsets: new Uint32Array(1),
      coordOffsets: new Uint32Array(1),
      styleIndex: new Uint32Array(0),
      groupIndex: new Uint32Array(0),
    };
    const id = s.commit(empty);
    expect(s.derived(id).anchors).toBe(0);
  });
});

describe("GeometryStore commit hardening", () => {
  test("each section is read once: a getter cannot swap in a different view after the check", () => {
    const s = newStore();
    const p = fixturePacket("circle-bw");
    const whole = p.coords;
    const offset = new Float64Array(whole.length + 1).subarray(1);
    let reads = 0;
    const tricky = { ...p } as Record<string, unknown>;
    Object.defineProperty(tricky, "coords", { get: () => (reads++ === 0 ? whole : offset) });
    const id = s.commit(tricky as unknown as IncomingPacket);
    expect(reads).toBe(1);
    expect(s.view(id).coordCount).toBe(p.manifest.coordCount);
    expect(whole.byteLength).toBe(0); // the checked view is the one that was moved
    expect(offset.byteLength).toBeGreaterThan(0);
  });
});
