// G-PRJ-0 (AM-3.3): exact persistable-size accounting and its transactional enforcement over the
// complete container. Boundary tests use small limits on purpose: the rule is the same at 64 MiB
// (the large-workload qualification runs the real limits, scripts/g-prj-0/).
import { describe, expect, test } from "vite-plus/test";
import { GeometryStore } from "../document/geometry-store.ts";
import { DEFAULT_DOC_LIMITS } from "../document/invariants.ts";
import { createDocument, DocumentError, type DocState } from "../document/model.ts";
import { DocumentSession } from "../document/session.ts";
import { fixtureSession } from "../document/testing/helpers.ts";
import {
  oracleSizes,
  runPersistDifferential,
  tinyPng,
} from "../document/testing/persistable-differential.ts";
import { TEST_PROVENANCE } from "../document/testing/provenance.ts";
import { syntheticPacket } from "../document/testing/synthetic.ts";
import { loadContainer, readHeader, saveContainer } from "./container.ts";
import { DEFAULT_PERSIST_LIMITS, MARK_DIGITS } from "./persistable.ts";

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof DocumentError ? e.code : `untyped:${String(e)}`;
  }
  return "ok";
};
/** The session's accounting equals the full serialization oracle. */
const agrees = (s: DocumentSession) => {
  const info = s.persistInfo();
  const want = oracleSizes(s);
  expect({
    documentBytes: info.documentBytes,
    body: info.body,
    geometryBytes: info.geometryBytes,
    sourceBytes: info.sourceBytes,
    sections: info.sections,
    totalBytes: info.totalBytes,
  }).toEqual(want);
};
/** A path with the default (omitted) name: renaming it to k ASCII characters adds 10 + k bytes. */
const unnamedPath = (s: DocumentSession) =>
  [...s.state.nodesById.values()].find((n) => n.kind === "path" && n.name === "")!.id;
/** Everything a rejected transaction must leave unchanged. */
const frozen = (s: DocumentSession) => ({
  state: s.state,
  revision: s.getSnapshot().revision,
  nextId: s.nextId,
  chunks: s.store.chunkIds().sort().join(),
});

describe("persistInfo: exact sizes of the container the current state would write", () => {
  test("agrees with a real codec-none container", async () => {
    const s = fixtureSession(["circle-bw", "nested_rings-bw"]);
    await s.attachSource(tinyPng(8, 8, 300, 1), { embedded: true });
    await s.attachSource(tinyPng(9, 9, 500, 2), { embedded: true });
    await s.attachSource(tinyPng(7, 7, 100, 3), { embedded: false });
    agrees(s);
    const info = s.persistInfo();
    const bytes = await saveContainer(s, { codec: "none" });
    const h = readHeader(bytes);
    expect(h.sections).toHaveLength(info.sections);
    expect(h.sections[1]!.uncompressedLength).toBe(info.documentBytes);
    expect(h.sections.reduce((t, x) => t + x.uncompressedLength, 0)).toBe(info.totalBytes);
    expect(info.documentBound).toBe(info.body + 2 * MARK_DIGITS);
  });

  test("high-water marks: digit rollovers and chunk ids advanced by failed transactions", () => {
    const s = new DocumentSession(new GeometryStore(), {
      state: createDocument({ documentId: "marks", width: 64, height: 64 }),
      nextId: 9,
      limits: { ...DEFAULT_DOC_LIMITS, maxAnchors: 20 },
    });
    const packet = (paths: number) => syntheticPacket({ paths, anchorsPerPath: 3 });
    s.dispatch({ type: "commitTrace", provenance: TEST_PROVENANCE, packet: packet(3) });
    agrees(s); // nextId crossed 9 → 10 inside the transaction
    // A commit refused after the store took the chunk (here by the anchor cap) advances
    // nextChunkId (C1 allows gaps) without changing the state.
    const state = s.state;
    for (let i = 0; i < 12; i++)
      expect(
        code(() =>
          s.dispatch({ type: "commitTrace", provenance: TEST_PROVENANCE, packet: packet(10) }),
        ),
      ).toBe("budget");
    expect(s.state).toBe(state);
    expect(s.store.nextChunkId).toBeGreaterThanOrEqual(10); // 9 → 10: one more digit
    agrees(s);
  });
});

describe("transactional enforcement: the first transaction past any limit is refused, atomically", () => {
  test("document section: exactly at the limit is accepted, one byte more is refused", () => {
    const s = fixtureSession(["circle-bw"]);
    const id = unnamedPath(s);
    // Renaming from "" to a k-character ASCII name adds `"name":"…",` = 10 + k bytes.
    const before = s.persistInfo().documentBound;
    s.setPersistLimits({ ...DEFAULT_PERSIST_LIMITS, maxDocumentBytes: before + 10 + 5 });
    const at = frozen(s);
    expect(code(() => s.dispatch({ type: "rename", id, name: "abcdef" }))).toBe("persist_limit");
    expect(frozen(s)).toEqual(at);
    s.dispatch({ type: "rename", id, name: "abcde" });
    expect(s.persistInfo().documentBound).toBe(before + 15);
    agrees(s);
  });

  test("the reserved mark width keeps every reachable state persistable after undo", async () => {
    const s = fixtureSession(["circle-bw"]);
    const id = unnamedPath(s);
    s.setPersistLimits({
      ...DEFAULT_PERSIST_LIMITS,
      maxDocumentBytes: s.persistInfo().documentBound + 15,
    });
    s.dispatch({ type: "rename", id, name: "abcde" }); // exactly at the limit
    const boundary = s.state;
    s.setPersistLimits({ ...DEFAULT_PERSIST_LIMITS });
    const layer = s.state.orderedRootIds[0]!;
    const digitsBefore = String(s.nextId).length;
    for (let i = 0; i < 40; i++) s.dispatch({ type: "duplicate", ids: [layer] }); // grows nextId
    expect(String(s.nextId).length).toBeGreaterThan(digitsBefore);
    while (s.state !== boundary && s.undo());
    expect(s.state).toBe(boundary);
    // The marks have more digits now, yet the boundary state is still within its limit.
    expect(s.persistInfo().documentBytes).toBeLessThanOrEqual(s.persistInfo().documentBound);
    agrees(s);
    expect(
      (await loadContainer(await saveContainer(s, { codec: "none" }), {})).state.nodesById.size,
    ).toBe(boundary.nodesById.size);
  });

  test("section count: 4,096 by default; the first chunk past the limit is refused", () => {
    const s = fixtureSession(["circle-bw"]);
    const sections = s.persistInfo().sections;
    s.setPersistLimits({ ...DEFAULT_PERSIST_LIMITS, maxSections: sections + 1 });
    s.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: syntheticPacket({ paths: 2, anchorsPerPath: 3 }),
    });
    const at = frozen(s);
    expect(
      code(() =>
        s.dispatch({
          type: "commitTrace",
          provenance: TEST_PROVENANCE,
          packet: syntheticPacket({ paths: 2, anchorsPerPath: 3 }),
        }),
      ),
    ).toBe("persist_limit");
    expect(frozen(s)).toEqual(at);
    expect(DEFAULT_PERSIST_LIMITS.maxSections).toBe(4096);
  });

  test("total declared bytes (session budget): the boundary is exact", () => {
    const s = fixtureSession(["circle-bw"]);
    const packet = () => syntheticPacket({ paths: 4, anchorsPerPath: 3, seed: 7 });
    // Measure the transaction's growth once, on a twin session.
    const twin = fixtureSession(["circle-bw"]);
    const t0 = twin.persistInfo().totalBound;
    twin.dispatch({ type: "commitTrace", provenance: TEST_PROVENANCE, packet: packet() });
    const growth = twin.persistInfo().totalBound - t0;
    const t1 = s.persistInfo().totalBound;
    s.setPersistLimits({ ...DEFAULT_PERSIST_LIMITS, sessionBudget: t1 + growth - 1 });
    const at = frozen(s);
    expect(
      code(() =>
        s.dispatch({ type: "commitTrace", provenance: TEST_PROVENANCE, packet: packet() }),
      ),
    ).toBe("persist_limit");
    expect(frozen(s)).toEqual(at);
    s.setPersistLimits({ ...DEFAULT_PERSIST_LIMITS, sessionBudget: t1 + growth });
    s.dispatch({ type: "commitTrace", provenance: TEST_PROVENANCE, packet: packet() });
    expect(s.persistInfo().totalBound).toBe(t1 + growth);
    agrees(s);
  });

  test("embedded sources: bytes are required and capped; non-embedded sources cost nothing", async () => {
    const s = fixtureSession(["circle-bw"]);
    const at = frozen(s);
    // A raw command can declare an embedded asset the session holds no bytes for.
    expect(
      code(() =>
        s.dispatch({
          type: "attachSource",
          asset: {
            digest: "ab".repeat(32),
            mime: "image/png",
            width: 4,
            height: 4,
            embedded: true,
            decodePolicy: "external",
          },
        }),
      ),
    ).toBe("persist_limit");
    expect(frozen(s)).toEqual(at);
    const before = s.persistInfo();
    await s.attachSource(tinyPng(4, 4, 2000), { embedded: false });
    expect(s.persistInfo().sourceBytes).toBe(before.sourceBytes);
    s.setPersistLimits({ ...DEFAULT_PERSIST_LIMITS, maxSourceBytes: 1000 });
    await expect(s.attachSource(tinyPng(4, 4, 1001), { embedded: true })).rejects.toThrow();
    await s.attachSource(tinyPng(4, 4, 1000), { embedded: true });
    agrees(s);
  });

  test("a session cannot be built over its limits, and limits cannot be set below its state", () => {
    const s = fixtureSession(["circle-bw"]);
    const state: DocState = s.state;
    const tight = {
      ...DEFAULT_PERSIST_LIMITS,
      maxDocumentBytes: s.persistInfo().documentBound - 1,
    };
    expect(code(() => new DocumentSession(s.store, { state, persistLimits: tight }))).toBe(
      "persist_limit",
    );
    expect(code(() => s.setPersistLimits(tight))).toBe("persist_limit");
  });

  test("limits are validated and never exceed C7's (review finding 1 and nit 6)", () => {
    const s = fixtureSession(["circle-bw"]);
    for (const bad of [
      { maxSections: 5000 }, // looser than C7: a state the save would refuse
      { sessionBudget: DEFAULT_PERSIST_LIMITS.sessionBudget + 1 },
      { maxDocumentBytes: Number.NaN },
      { maxDocumentBytes: undefined as unknown as number },
      { maxSourceBytes: 0 },
      { maxGeometryBytes: 1.5 },
    ]) {
      const limits = { ...DEFAULT_PERSIST_LIMITS, ...bad };
      expect(
        code(() => s.setPersistLimits(limits)),
        JSON.stringify(bad),
      ).toBe("invalid_argument");
      expect(
        code(() => new DocumentSession(s.store, { state: s.state, persistLimits: limits })),
      ).toBe("invalid_argument");
    }
  });

  test("the loader never hands over a session with a budget above C7's", async () => {
    const s = fixtureSession(["circle-bw"]);
    const loaded = await loadContainer(await saveContainer(s, { codec: "none" }), {
      sessionBudget: 4 * DEFAULT_PERSIST_LIMITS.sessionBudget,
    });
    expect(loaded.persistLimits.sessionBudget).toBe(DEFAULT_PERSIST_LIMITS.sessionBudget);
  });

  test("provenance that canonical JSON cannot write is refused with a typed error (review 2)", () => {
    const s = fixtureSession(["circle-bw"]);
    const at = frozen(s);
    const bad = {
      ...TEST_PROVENANCE,
      originalScene: {
        ...TEST_PROVENANCE.originalScene,
        metadata: { ...TEST_PROVENANCE.originalScene.metadata, params: { pitch: Number.NaN } },
      },
    };
    expect(
      code(() =>
        s.dispatch({
          type: "commitTrace",
          provenance: bad,
          packet: syntheticPacket({ paths: 2, anchorsPerPath: 3 }),
        }),
      ),
    ).toBe("invariant");
    expect(frozen(s)).toEqual(at);
  });

  test("refused transactions are not counted as validated (review nit 5)", () => {
    const s = fixtureSession(["circle-bw"]);
    const id = unnamedPath(s);
    s.setPersistLimits({
      ...DEFAULT_PERSIST_LIMITS,
      maxDocumentBytes: s.persistInfo().documentBound,
    });
    const v = s.validations;
    expect(code(() => s.dispatch({ type: "rename", id, name: "x" }))).toBe("persist_limit");
    expect(s.validations).toEqual(v);
  });

  test("limits cannot be tightened below a state reachable by undo or redo", () => {
    const s = fixtureSession(["circle-bw"]);
    const big = s.persistInfo().documentBound;
    s.dispatch({ type: "delete", ids: [s.state.orderedRootIds[0]!] }); // smaller current state
    expect(s.persistInfo().documentBound).toBeLessThan(big);
    const tight = { ...DEFAULT_PERSIST_LIMITS, maxDocumentBytes: big - 1 };
    expect(code(() => s.setPersistLimits(tight))).toBe("persist_limit"); // undo would reach `big`
    s.undo();
    expect(code(() => s.setPersistLimits(tight))).toBe("persist_limit"); // redo would reach it too
  });

  test("the error names the limit, the size and the cap", () => {
    const s = fixtureSession(["circle-bw"]);
    const id = unnamedPath(s);
    s.setPersistLimits({
      ...DEFAULT_PERSIST_LIMITS,
      maxDocumentBytes: s.persistInfo().documentBound,
    });
    try {
      s.dispatch({ type: "rename", id, name: "x" });
      throw new Error("not refused");
    } catch (e) {
      expect((e as Error).message).toMatch(/document section/);
      expect((e as Error).message).toMatch(/cap/);
    }
  });
});

describe("differential: incremental accounting against full serialization", () => {
  test("10,000 randomized transactions: exact agreement, limits held, rejections atomic", async () => {
    const save = async (s: DocumentSession) => {
      const h = readHeader(await saveContainer(s, { codec: "none" }));
      return {
        total: h.sections.reduce((t, x) => t + x.uncompressedLength, 0),
        sections: h.sections.length,
        document: h.sections[1]!.uncompressedLength,
      };
    };
    const sum = await runPersistDifferential({
      seed: 2026,
      transactions: 10_000,
      saveEvery: 97,
      save,
    });
    expect(sum.disagreements).toEqual([]);
    expect(sum.checks).toBeGreaterThan(9_000);
    expect(sum.accepted).toBeGreaterThan(3_000);
    expect(sum.rejectedByCode.persist_limit ?? 0).toBeGreaterThan(50);
    expect(sum.undos).toBeGreaterThan(500);
    expect(sum.redos).toBeGreaterThan(100);
    expect(sum.coalesced).toBeGreaterThan(100);
    expect(sum.branches).toBeGreaterThan(100);
    expect(sum.withoutHistory).toBeGreaterThan(20);
  }, 180_000);
});
