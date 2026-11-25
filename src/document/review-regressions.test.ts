// Regression tests for the independent G-DOC review (P1-A corrective review, AM-1). Each test
// reproduced its finding before the fix.
import { describe, expect, test } from "vite-plus/test";
import { loadContainer, saveContainer } from "../persistence/container.ts";
import { evaluate } from "./evaluate.ts";
import type { DocNode, LayerNode, PathNode } from "./model.ts";
import { DocumentSession } from "./session.ts";
import { GeometryStore } from "./geometry-store.ts";
import { createDocument } from "./model.ts";
import { testPacketPort } from "./testing/packet-adapter.ts";
import { encodeScene, syntheticPacket } from "./testing/synthetic.ts";
import { emptySession, errorCode, fixtureSession, TEST_PROVENANCE } from "./testing/helpers.ts";

const port = testPacketPort;
const png = (w: number, h: number, size = 64) => {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b.set([0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54], 33);
  return b;
};
const trace = (s: DocumentSession) =>
  s.dispatch({
    type: "commitTrace",
    provenance: TEST_PROVENANCE,
    packet: syntheticPacket({ paths: 2, anchorsPerPath: 3 }),
  });

describe("G-DOC review regressions", () => {
  test("1: a throwing subscriber cannot break dispatch atomicity or lose source bytes", async () => {
    const errors: unknown[] = [];
    const store = new GeometryStore(port);
    const s = new DocumentSession(store, {
      state: createDocument({ documentId: "d", width: 256, height: 256 }),
      onListenerError: (e) => errors.push(e),
    });
    s.subscribe(() => {
      throw new Error("listener bug");
    });
    expect(() => trace(s)).not.toThrow();
    expect(s.getSnapshot().canUndo).toBe(true);
    const id = await s.attachSource(png(64, 64), { embedded: true });
    expect(id).toMatch(/^src_/);
    const asset = [...s.state.sourceAssetsById.keys()][0]!;
    expect(s.sourceBytes(asset)).toBeDefined();
    await expect(saveContainer(s, { codec: "none" })).resolves.toBeInstanceOf(Uint8Array);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  test("2: session source bytes are never aliased", async () => {
    const s = emptySession();
    await s.attachSource(png(64, 64), { embedded: true });
    const asset = [...s.state.sourceAssetsById.keys()][0]!;
    s.sourceBytes(asset)![40] = 0x7f;
    const b = s.sourceBytes(asset)!;
    structuredClone(b.buffer, { transfer: [b.buffer] });
    const bytes = await saveContainer(s, { codec: "none" });
    await expect(loadContainer(bytes, { port })).resolves.toBeInstanceOf(DocumentSession);
  });

  test("3: committed state, history states, derived data and evaluation output are immutable", async () => {
    const s = fixtureSession(["circle-bw"]);
    const node = [...s.state.nodesById.values()][0] as DocNode;
    expect(Object.isFrozen(node)).toBe(true);
    expect(() => (s.state.nodesById as Map<string, DocNode>).set("pth_999", node)).toThrow();
    expect(() => (s.state.nodesById as Map<string, DocNode>).delete(node.id)).toThrow();
    // Stroke objects in the draw list are copies, never the committed style.
    const withStroke = emptySession();
    withStroke.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: encodeScene({
        version: 1,
        width: 10,
        height: 10,
        background: null,
        palette: [],
        metadata: {},
        groups: [
          {
            id: "g",
            clip: null,
            paths: [
              {
                fill: null,
                stroke: { color: "#000000", width: 2 },
                fillRule: "nonzero",
                verbs: "ML",
                coords: [0, 0, 5, 5],
              },
            ],
          },
        ],
      }),
    });
    const st = evaluate(withStroke.state).drawList[0]!.stroke!;
    expect(st).toBeDefined();
    try {
      (st as { width: number }).width = 5000;
    } catch {
      // a frozen copy is also acceptable
    }
    expect([...withStroke.state.stylesById.values()][0]!.stroke!.width).toBe(2);
    const derived = s.derivedOf(s.state)!;
    (derived.chunks as Map<string, number>).clear();
    const saved = await saveContainer(s, { codec: "none" });
    await expect(loadContainer(saved, { port })).resolves.toBeInstanceOf(DocumentSession);
  });

  test("4: the history budget counts history-only source bytes", async () => {
    const s = emptySession({ history: { maxEntries: 100, maxBytes: 4000 } });
    const id = await s.attachSource(png(64, 64, 8192), { embedded: true });
    expect(errorCode(() => s.dispatch({ type: "delete", ids: [id] }))).toBe("history_budget");
    expect(s.state.orderedRootIds).toContain(id);
  });

  test("5: the chunk counter can never pass what the container accepts", () => {
    const store = new GeometryStore(port, { nextChunkId: 999_999_999_999_999 });
    store.commit(syntheticPacket({ paths: 1, anchorsPerPath: 2 }));
    expect(errorCode(() => store.commit(syntheticPacket({ paths: 1, anchorsPerPath: 2 })))).toBe(
      "invariant",
    );
    expect(() => new GeometryStore(port, { nextChunkId: 1_000_000_000_000_001 })).toThrow();
  });

  test("7: a composed transform that overflows is rejected with invalid_transform", () => {
    const s = fixtureSession(["circle-bw"]);
    const layer = s.state.nodesById.get(s.state.orderedRootIds[0]!) as LayerNode;
    let parent = layer.orderedChildIds[0]!;
    const codes: string[] = [];
    for (let i = 0; i < 40; i++) {
      codes.push(
        errorCode(() =>
          s.dispatch({ type: "setTransform", id: parent, matrix: [1e9, 0, 0, 1e9, 0, 0] }),
        ),
      );
      if (codes.at(-1) !== "ok") break;
      const before = new Set(s.state.nodesById.keys());
      s.dispatch({ type: "group", ids: [parent] });
      parent = [...s.state.nodesById.keys()].find((k) => !before.has(k))!;
    }
    expect(codes.at(-1)).toBe("invalid_transform");
    for (const it of evaluate(s.state).drawList)
      expect(it.transform.every(Number.isFinite)).toBe(true);
  });

  test("8: undo/redo-triggered eviction frees source bytes", async () => {
    const SRC = 3000;
    const probe = emptySession();
    probe.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: syntheticPacket({ paths: 4, anchorsPerPath: 6 }),
    });
    const K = probe.store.cost("chk_1");
    const s = emptySession({ history: { maxEntries: 100, maxBytes: SRC + K - 1 } });
    const src = await s.attachSource(png(256, 256, SRC), { embedded: true });
    const asset = [...s.state.sourceAssetsById.keys()][0]!;
    s.dispatch({ type: "delete", ids: [src] });
    s.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: syntheticPacket({ paths: 4, anchorsPerPath: 6 }),
    });
    s.undo(); // the chunk becomes history-only, the budget evicts the source's last owner
    const referencing = [...s.historyStates().past, s.state, ...s.historyStates().future].filter(
      (st) => st.sourceAssetsById.has(asset),
    );
    expect(referencing.length).toBe(0);
    expect(s.sourceBytes(asset)).toBeUndefined();
  });

  test("9: attach caps, rotate90 turns, and spoofed views are typed errors", async () => {
    const s = emptySession();
    await expect(
      s.attachSource(png(64, 64, 21 * 2 ** 20), { embedded: true }),
    ).rejects.toMatchObject({ code: "invalid_argument" });
    const path = () =>
      [...s.state.nodesById.values()].find((n): n is PathNode => n.kind === "path")!.id;
    trace(s);
    for (const turns of [0, 4, -1, "1"])
      expect(
        errorCode(() => s.dispatch({ type: "rotate90", ids: [path()], turns: turns as 1 })),
      ).toBe("invalid_argument");
    class Spoof extends Uint8Array {
      override get byteOffset() {
        return 0;
      }
      override get buffer() {
        return new ArrayBuffer(this.length) as unknown as ArrayBuffer;
      }
    }
    const p = syntheticPacket({ paths: 1, anchorsPerPath: 2 });
    const spoofed = {
      ...p,
      verbs: new Spoof(new ArrayBuffer(p.verbs.length + 8), 8, p.verbs.length),
    };
    expect(errorCode(() => new GeometryStore(port).commit(spoofed))).toBe("ownership");
  });
});

describe("missing sources and digest-verified relinking (RFC §14)", () => {
  test("a reopened non-embedded source can be relinked only with matching bytes", async () => {
    const s = emptySession();
    const bytes = png(64, 64, 128);
    await s.attachSource(bytes, { embedded: false });
    const asset = [...s.state.sourceAssetsById.keys()][0]!;
    const reopened = await loadContainer(await saveContainer(s, { codec: "none" }), { port });
    expect(reopened.missingSources()).toEqual([asset]);
    const wrong = png(64, 64, 128);
    wrong[100] = 1;
    await expect(reopened.relinkSource(asset, wrong)).rejects.toMatchObject({
      code: "invalid_argument",
    });
    await expect(reopened.relinkSource(asset, png(32, 64, 128))).rejects.toMatchObject({
      code: "invalid_argument",
    });
    const rev = reopened.getSnapshot().revision;
    await reopened.relinkSource(asset, bytes);
    expect(reopened.missingSources()).toEqual([]);
    expect(reopened.getSnapshot().revision).toBe(rev);
    expect(reopened.sourceBytes(asset)).toEqual(bytes);
  });
});
