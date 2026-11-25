// G-R1 performance workloads as `.vectra` documents (Node 24, type stripping):
//   node tests/browser/renderer/make-workloads.ts [out-dir]
// Each input is a registered scene, verified against its recorded SHA-256 before use:
// - synthetic-many-250k: the RFC-002 interactive target (≈250k anchors, ≈40k paths; holes,
//   translucency, palette references). docs/research/rfc-002-review/artifacts/workloads.sha256;
//   regenerate with experiments/rfc-002-review/bench/gen-scenes.mjs.
// - architecture-street-halftone: the 977k-anchor single compound path (195k subpaths), from the
//   frozen regression corpus (tests/output/regression-a4cf172, a4cf172.sha256).
// - bark-1224 and bark-2350: the G-JOB registered colour workloads (tests/output/g-job-workloads,
//   hashes in the G-R0 report), traced here with the Full Colour defaults (identical to the app:
//   269,996 anchors / 16,056 paths and 812,003 / 43,621).
// Inputs are local (gitignored); a missing or mismatching input is an error, never a substitute.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as wasm from "../../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";
import { GeometryStore } from "../../../src/document/geometry-store.ts";
import { createDocument } from "../../../src/document/model.ts";
import { DocumentSession } from "../../../src/document/session.ts";
import { sceneProvenance } from "../../../src/document/testing/provenance.ts";
import { saveContainer } from "../../../src/persistence/container.ts";
import {
  type SceneMetaJson,
  traceProvenanceFromSceneMeta,
} from "../../../src/document/provenance.ts";
import { DEFAULT_SETTINGS, makeRequest } from "../../../src/presets/defaults.ts";
import { documentFromScene, type EngineWasm } from "../../unit/p1a-export-pipeline.ts";
import { decodePng } from "./compare.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const out = resolve(process.argv[2] ?? join(ROOT, "tests/output/g-r1/workloads"));
mkdirSync(out, { recursive: true });
wasm.initSync({
  module: readFileSync(join(ROOT, "packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm")),
});
const w = wasm as unknown as EngineWasm;

const WORKLOADS: {
  name: string;
  scene?: string;
  image?: string;
  sha256: string;
  synthetic?: true;
}[] = [
  {
    name: "synthetic-many-250k",
    scene: "tests/output/rfc-002-review/scenes/synthetic-many-250k.scene.json",
    sha256: "46280a24968b63f4f8ce3729b46212d7642911076d153bd113be5a56a4981b3c",
    synthetic: true,
  },
  {
    name: "architecture-street-halftone",
    scene: "tests/output/regression-a4cf172/architecture-street-halftone.scene.json",
    sha256: "482181c827c32c7a6fb6969bbe515beea8e34fca4e7a72fa5b5888c0d68d4e2b",
  },
  {
    name: "bark-1224",
    image: "tests/output/g-job-workloads/bark-1224.png",
    sha256: "a4629ed39b6f1d675f68c156f52cc13d59caa3b1015e8b376a99ee8c79d770f5",
  },
  {
    name: "bark-2350",
    image: "tests/output/g-job-workloads/bark-2350.png",
    sha256: "daa939de69169ce5b6fb9ab32dfa9e305452154640bfed47a73ae928d6d4ec72",
  },
];

function synthetic(text: string): DocumentSession {
  const scene = JSON.parse(text);
  const p = w.sceneToPacket(text);
  const packet = {
    manifest: JSON.parse(p.manifestJson),
    verbs: p.takeVerbs(),
    coords: p.takeCoords(),
    verbOffsets: p.takeVerbOffsets(),
    coordOffsets: p.takeCoordOffsets(),
    styleIndex: p.takeStyleIndex(),
    groupIndex: p.takeGroupIndex(),
  };
  p.free();
  const s = new DocumentSession(new GeometryStore(), {
    state: createDocument({ width: scene.width, height: scene.height }),
  });
  // The registered synthetic scene records `params: {}`; provenance needs a mode. Metadata only:
  // the geometry is the registered scene's (recorded in the manifest as `provenanceMode`).
  const meta = { ...scene, metadata: { ...scene.metadata, params: { mode: "color" } } };
  const { chunkId: _c, ...prov } = { ...sceneProvenance(meta), chunkId: "" };
  s.dispatch({ type: "commitTrace", packet, provenance: prov });
  return s;
}

const manifest: Record<string, unknown> = {};
/** A Full Colour trace of an image, committed as the app does (packet + trace provenance). */
function traced(png: Buffer, digest: string): DocumentSession {
  const img = decodePng(png);
  const rgba = new Uint8Array(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) {
    rgba[4 * i] = img.px[3 * i]!;
    rgba[4 * i + 1] = img.px[3 * i + 1]!;
    rgba[4 * i + 2] = img.px[3 * i + 2]!;
    rgba[4 * i + 3] = 255;
  }
  const request = makeRequest(DEFAULT_SETTINGS.color, 50_000_000);
  const p = wasm.vectorizePacket(rgba, img.w, img.h, JSON.stringify(request));
  const manifest = JSON.parse(p.manifestJson);
  const meta = JSON.parse(p.sceneMetaJson) as SceneMetaJson;
  const packet = {
    manifest,
    verbs: p.takeVerbs(),
    coords: p.takeCoords(),
    verbOffsets: p.takeVerbOffsets(),
    coordOffsets: p.takeCoordOffsets(),
    styleIndex: p.takeStyleIndex(),
    groupIndex: p.takeGroupIndex(),
  };
  p.free();
  const s = new DocumentSession(new GeometryStore(), {
    state: createDocument({ width: manifest.width, height: manifest.height }),
  });
  s.dispatch({
    type: "commitTrace",
    packet,
    provenance: traceProvenanceFromSceneMeta({
      sceneMeta: meta,
      width: manifest.width,
      height: manifest.height,
      traceRequest: request as unknown as Parameters<
        typeof traceProvenanceFromSceneMeta
      >[0]["traceRequest"],
      source: { digest, width: img.w, height: img.h },
      decodePolicy: "browser-canvas-v1",
      precisionFitVersion: null,
    }),
    name: "trace",
  });
  return s;
}

for (const wl of WORKLOADS) {
  const path = join(ROOT, (wl.scene ?? wl.image)!);
  if (!existsSync(path)) throw new Error(`missing registered input ${wl.scene ?? wl.image}`);
  const raw = readFileSync(path);
  const text = raw.toString("utf8");
  const sha = createHash("sha256").update(raw).digest("hex");
  if (sha !== wl.sha256) throw new Error(`${wl.name}: SHA-256 ${sha} ≠ registered ${wl.sha256}`);
  // A real trace keeps its trace provenance; the synthetic scene gets the test provenance
  // (its metadata is not a trace request), exactly as the renderer fixtures do.
  const s = wl.image
    ? traced(raw, sha)
    : wl.synthetic
      ? synthetic(text)
      : documentFromScene(w, text);
  let paths = 0;
  let anchors = 0;
  let subpaths = 0;
  for (const n of s.state.nodesById.values())
    if (n.kind === "path") {
      const d = s.store.derived(n.geometry.chunkId);
      paths++;
      anchors += d.pathAnchors(n.geometry.pathIndex);
    }
  for (const id of new Set(
    [...s.state.nodesById.values()].flatMap((n) => (n.kind === "path" ? [n.geometry.chunkId] : [])),
  ))
    subpaths += s.store.derived(id).subpathCount;
  const bytes = await saveContainer(s, { codec: "deflate-raw" });
  writeFileSync(join(out, `${wl.name}.vectra`), bytes);
  manifest[wl.name] = {
    input: wl.scene ?? wl.image,
    inputSha256: sha,
    containerSha256: createHash("sha256").update(bytes).digest("hex"),
    containerBytes: bytes.byteLength,
    width: s.state.artboard.width,
    height: s.state.artboard.height,
    paths,
    anchors,
    subpaths,
    ...(wl.image ? { trace: "Full Colour defaults (DEFAULT_SETTINGS.color), seed 1" } : {}),
    ...(wl.synthetic ? { provenanceMode: "color (metadata only; scene params are empty)" } : {}),
  };
}
writeFileSync(join(out, "workloads.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
