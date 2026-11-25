// Breaks a structural dispatch down (diagnostic; not gated): the whole dispatch, the
// whole-state invariant pass alone and the node-map copy alone, at the RFC §8.8 interactive
// target by default.  node docs/research/g-doc/bench/dispatch-profile.mjs [paths] [anchorsPerPath]
import { loadavg } from "node:os";
import { TEST_PROVENANCE } from "../../../../src/document/testing/provenance.ts";
import { GeometryStore } from "../../../../src/document/geometry-store.ts";
import { DEFAULT_DOC_LIMITS, validateState } from "../../../../src/document/invariants.ts";
import { createDocument, SealedMap } from "../../../../src/document/model.ts";
import { DocumentSession } from "../../../../src/document/session.ts";
import { syntheticPacket } from "../../../../src/document/testing/synthetic.ts";

const paths = Number(process.argv[2] ?? 41_666);
const anchorsPerPath = Number(process.argv[3] ?? 6);
const REPS = 30;
const store = new GeometryStore();
const session = new DocumentSession(store, {
  state: createDocument({ documentId: "bench", width: 1000, height: 1000 }),
});
session.dispatch({
  type: "commitTrace",
  provenance: TEST_PROVENANCE,
  packet: syntheticPacket({ paths, anchorsPerPath, groups: 8, seed: 42 }),
});
const layer = session.state.orderedRootIds[0];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const time = (f) => {
  const xs = [];
  for (let r = 0; r < REPS + 1; r++) {
    const t = performance.now();
    f(r);
    if (r > 0) xs.push(performance.now() - t); // first rep is warm-up
  }
  return +median(xs).toFixed(3);
};
const dispatchMs = time((r) =>
  session.dispatch({ type: "setTransform", id: layer, matrix: [1, 0, 0, 1, r, 0] }),
);
const validateStateMs = time(() => validateState(session.state, store, DEFAULT_DOC_LIMITS));
const nodeMapCopyMs = time(() => new SealedMap(session.state.nodesById));
console.log(
  JSON.stringify(
    {
      node: process.version,
      loadavg: loadavg().map((x) => +x.toFixed(2)),
      paths,
      anchorsPerPath,
      nodes: session.state.nodesById.size,
      reps: REPS,
      medianMs: {
        dispatch: dispatchMs,
        validateState: validateStateMs,
        nodeMapCopy: nodeMapCopyMs,
        rest: +(dispatchMs - validateStateMs - nodeMapCopyMs).toFixed(3),
      },
      validateShare: +(validateStateMs / dispatchMs).toFixed(2),
    },
    null,
    2,
  ),
);
