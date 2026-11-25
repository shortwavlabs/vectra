// Regenerates the codec-`none` container golden used by src/persistence/container.test.ts.
// Usage: node docs/research/g-doc/bench/make-golden.mjs [--check]
// The golden is a committed artefact: regenerate only for an intentional format change, and
// record why in the G-DOC report.
import { readFileSync, writeFileSync } from "node:fs";
import { GeometryStore } from "../../../../src/document/geometry-store.ts";
import { createDocument } from "../../../../src/document/model.ts";
import { DocumentSession } from "../../../../src/document/session.ts";
import { encodeScene } from "../../../../src/document/testing/synthetic.ts";
import { sceneProvenance } from "../../../../src/document/testing/provenance.ts";
import { saveContainer } from "../../../../src/persistence/container.ts";

const root = new URL("../../../../", import.meta.url);
const scene = JSON.parse(
  readFileSync(new URL("src/document/testing/fixtures/circle-bw.scene.json.raw", root), "utf8"),
);
const session = new DocumentSession(new GeometryStore(), {
  state: createDocument({ documentId: "golden-circle-bw", width: 256, height: 256 }),
});
session.dispatch({
  type: "commitTrace",
  packet: encodeScene(scene),
  provenance: sceneProvenance(scene, "circle-bw"),
  name: "circle-bw",
});
const bytes = await saveContainer(session, { codec: "none" });
const b64 = Buffer.from(bytes).toString("base64") + "\n";
const out = new URL("src/persistence/golden/circle-bw.none.vectra.b64", root);
if (process.argv.includes("--check")) {
  const same = readFileSync(out, "utf8") === b64;
  console.log(same ? "golden matches" : "golden DIFFERS");
  process.exit(same ? 0 : 1);
}
writeFileSync(out, b64);
writeFileSync(new URL("docs/research/g-doc/artifacts/circle-bw.none.vectra", root), bytes);
console.log(`wrote ${bytes.length} bytes`);
