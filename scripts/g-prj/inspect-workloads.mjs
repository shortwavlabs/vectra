// G-PRJ-R: composition of the registered G-R1 workloads' document sections (read-only).
//   node scripts/g-prj/inspect-workloads.mjs
import { readFileSync } from "node:fs";
import { loadContainer } from "../../src/persistence/container.ts";
import { canonicalJsonBytes } from "../../src/persistence/canonical-json.ts";
import { documentJson } from "../../src/persistence/document-json.ts";

for (const f of ["bark-1224", "bark-2350", "architecture-street-halftone", "synthetic-many-250k"]) {
  const bytes = readFileSync(`tests/output/g-r1/workloads/${f}.vectra`);
  const s = await loadContainer(new Uint8Array(bytes), {});
  const j = documentJson(s.state, s.nextId, s.store.nextChunkId);
  const kinds = {};
  for (const n of s.state.nodesById.values()) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
  const doc = canonicalJsonBytes(j).length;
  const paths = [...s.state.nodesById.values()].filter((n) => n.kind === "path");
  const p = paths[Math.floor(paths.length / 2)];
  const layers = [...s.state.nodesById.values()].filter((n) => n.kind === "layer");
  const prov = layers.reduce(
    (a, l) => a + (l.traceProvenance ? canonicalJsonBytes(l.traceProvenance).length : 0),
    0,
  );
  const count = (f) => paths.filter(f).length;
  console.log(
    JSON.stringify({
      workload: f,
      fileBytes: bytes.length,
      documentBytes: doc,
      bytesPerNode: Math.round(doc / s.state.nodesById.size),
      kinds,
      styles: s.state.stylesById.size,
      palette: s.state.paletteById.size,
      provenanceBytes: prov,
      anchors: s.getSnapshot().anchors,
      pathDefaults: {
        visible: count((n) => n.visible),
        unlocked: count((n) => !n.locked),
        identity: count((n) => n.localTransform.join() === "1,0,0,1,0,0"),
        nonzero: count((n) => n.fillRule === "nonzero"),
        emptyName: count((n) => n.name === ""),
      },
      samplePath: j.nodesById[p.id],
    }),
  );
}
