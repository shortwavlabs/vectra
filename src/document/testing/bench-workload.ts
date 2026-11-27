// TEST-ONLY benchmark workload (TD-PERF-007 investigation; G-DOC-R). Node-importable.
// One traced layer of `paths` paths in 8 groups, a 1,000-path "replace" layer, and a pre-made
// group of 10 paths; then one factory per measured transaction type.
import type { Command } from "../commands.ts";
import { GeometryStore } from "../geometry-store.ts";
import { type ContainerNode, createDocument, type NodeId } from "../model.ts";
import { DocumentSession, type SessionOptions } from "../session.ts";
import { TEST_PROVENANCE } from "./provenance.ts";
import { syntheticPacket } from "./synthetic.ts";

export function buildWorkload(paths: number, options: Partial<SessionOptions> = {}) {
  const anchorsPerPath = paths >= 100_000 ? 3 : 6; // 250k × 3 = 750k: room under the 1M cap
  const replacePaths = Math.min(1000, Math.round(paths / 10));
  const store = new GeometryStore();
  const session = new DocumentSession(store, {
    state: createDocument({ documentId: "td-perf-007", width: 1000, height: 1000 }),
    ...options,
  });
  const mainPacket = () => syntheticPacket({ paths, anchorsPerPath, groups: 8, seed: 42 });
  session.dispatch({
    type: "commitTrace",
    provenance: TEST_PROVENANCE,
    packet: mainPacket(),
    name: "main",
  });
  const main = session.state.orderedRootIds[0]!;
  const replacePacket = () =>
    syntheticPacket({ paths: replacePaths, anchorsPerPath: 6, groups: 1, seed: 7 });
  session.dispatch({
    type: "commitTrace",
    provenance: TEST_PROVENANCE,
    packet: replacePacket(),
    name: "replace",
  });
  const replaceLayer = session.state.orderedRootIds[1]!;
  const s0 = session.state;
  const children = (id: NodeId) => (s0.nodesById.get(id) as ContainerNode).orderedChildIds;
  const groups = children(main);
  const kids = (g: number) => children(groups[g]!);
  // A pre-made group of 10 paths (in g0) for `ungroup`.
  const preIds = kids(0).slice(10, 20);
  session.dispatch({ type: "group", ids: preIds, name: "pre" });
  const s = session.state;
  const ungroupId = (s.nodesById.get(groups[0]!) as ContainerNode).orderedChildIds.find(
    (id) => s.nodesById.get(id)!.kind === "group",
  )!;
  const allPaths = groups.flatMap((_, g) => kids(g)).filter((id) => s.nodesById.has(id));
  const step = Math.max(1, Math.floor(allPaths.length / 1000));
  const many = allPaths.filter((_, i) => i % step === 0).slice(0, 1000);
  const pA = kids(3)[5]!;
  const pC = kids(5)[7]!;
  const cmds: Record<string, () => Command> = {
    setFill1: () => ({ type: "setFill", ids: [pA], fill: { color: 0x336699ff } }),
    setFillMany: () => ({ type: "setFill", ids: many, fill: { color: 0x993366ff } }),
    setVisible: () => ({ type: "setVisible", ids: [pA], visible: false }),
    rename: () => ({ type: "rename", id: pA, name: "renamed" }),
    reorder: () => ({ type: "reorder", id: kids(2)[9]!, index: 0 }),
    applyTransformPath: () => ({ type: "applyTransform", ids: [pA], matrix: [1, 0, 0, 1, 3, 4] }),
    applyTransformLayer: () => ({
      type: "applyTransform",
      ids: [main],
      matrix: [1, 0, 0, 1, 3, 4],
    }),
    group: () => ({ type: "group", ids: kids(1).slice(20, 30), name: "g" }),
    ungroup: () => ({ type: "ungroup", id: ungroupId }),
    delete: () => ({ type: "delete", ids: [pC] }),
    duplicate: () => ({ type: "duplicate", ids: [pC] }),
    commitTrace: () => ({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: replacePacket(),
      replaceLayerId: replaceLayer,
    }),
  };
  const kinds = { path: 0, group: 0, layer: 0, source: 0 };
  for (const n of s.nodesById.values()) kinds[n.kind]++;
  /** The build's own commands, with fresh packets: replayed in order on an empty document of
   *  the same size, they rebuild this workload with the same IDs (browser dispatch spec). */
  const setup = (): Command[] => [
    { type: "commitTrace", provenance: TEST_PROVENANCE, packet: mainPacket(), name: "main" },
    { type: "commitTrace", provenance: TEST_PROVENANCE, packet: replacePacket(), name: "replace" },
    { type: "group", ids: preIds, name: "pre" },
  ];
  return {
    session,
    store,
    cmds,
    setup,
    info: {
      paths,
      anchorsPerPath,
      pathsPerGroup: paths / 8,
      replaceLayerPaths: replacePaths,
      setFillManyPaths: many.length,
      nodes: s.nodesById.size,
      nodeKinds: kinds,
      anchors: session.getSnapshot().anchors,
    },
  };
}
