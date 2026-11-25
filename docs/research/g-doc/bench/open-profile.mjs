// Breaks loadContainer time down by phase for a 1M-anchor document (diagnostic; not gated).
//   node docs/research/g-doc/bench/open-profile.mjs [paths] [anchorsPerPath]
// Each phase calls the same functions loadContainer uses, in the same order.
import { TEST_PROVENANCE } from "../../../../src/document/testing/provenance.ts";
import { loadavg } from "node:os";
import { decodeRecord } from "../../../../src/document/packet-port.ts";
import { GeometryStore } from "../../../../src/document/geometry-store.ts";
import { createDocument } from "../../../../src/document/model.ts";
import { DEFAULT_PACKET_LIMITS } from "../../../../src/document/packet-port.ts";
import { DocumentSession } from "../../../../src/document/session.ts";
import { syntheticPacket } from "../../../../src/document/testing/synthetic.ts";
import { parseCanonicalJson } from "../../../../src/persistence/canonical-json.ts";
import { readHeader, readSection, saveContainer } from "../../../../src/persistence/container.ts";
import { parseDocumentJson } from "../../../../src/persistence/document-json.ts";

const paths = Number(process.argv[2] ?? 250_000);
const anchorsPerPath = Number(process.argv[3] ?? 4);
const session = new DocumentSession(new GeometryStore(), {
  state: createDocument({ documentId: "bench", width: 1000, height: 1000 }),
});
session.dispatch({
  type: "commitTrace",
  provenance: TEST_PROVENANCE,
  packet: syntheticPacket({ paths, anchorsPerPath, groups: 8, seed: 42 }),
});
const out = {
  node: process.version,
  loadavg: loadavg().map((x) => +x.toFixed(2)),
  paths,
  anchorsPerPath,
};
for (const codec of ["none", "deflate-raw"]) {
  const bytes = await saveContainer(session, { codec });
  const t = [performance.now()];
  const mark = () => t.push(performance.now());
  const h = readHeader(bytes);
  mark();
  const data = [];
  for (const s of h.sections) data.push(await readSection(bytes, h, s));
  mark();
  const doc = parseCanonicalJson(data[1]);
  if (!doc) throw new Error("document section is not canonical");
  mark();
  const parsed = parseDocumentJson(doc.value);
  mark();
  const store = new GeometryStore();
  for (let i = 2; i < h.sections.length; i++) {
    const r = decodeRecord(data[i], DEFAULT_PACKET_LIMITS);
    store.advanceChunkCounter(Number(h.sections[i].id.slice(4)));
    store.commit(r.packet);
  }
  store.advanceChunkCounter(parsed.nextChunkId);
  mark();
  new DocumentSession(store, { state: parsed.state, nextId: parsed.nextId }); // invariants
  mark();
  const names = [
    "header",
    "inflate+sha256",
    "strict JSON",
    "schema",
    "decode+commit",
    "session+invariants",
  ];
  out[codec] = {
    fileBytes: bytes.length,
    documentBytes: data[1].length,
    phasesMs: Object.fromEntries(names.map((n, i) => [n, +(t[i + 1] - t[i]).toFixed(1)])),
    totalMs: +(t.at(-1) - t[0]).toFixed(1),
  };
}
console.log(JSON.stringify(out, null, 2));
