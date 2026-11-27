// G-PRJ-R: persistence limits (TD-PERF-009, the C7 64 MiB document-section cap). Research only.
//   node --expose-gc scripts/g-prj/persistence-limits.mjs [--only a,b] [--reps 3] [--out f.json]
//   node scripts/g-prj/persistence-limits.mjs --peak <save|load> <workload>   (child mode)
// Per workload: canonical document JSON size and composition (nodes, styles, palette,
// provenance), the lossless compact encoding (scripts/g-prj/compact-document.mjs) and its
// round trip, deflate-raw sizes, geometry and source payloads, `.vectra` container size with
// codec none and deflate-raw, save and restore times, worker copy cost, and peak RSS during
// save and load (a fresh child process per measurement: maxRSS after − maxRSS before).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { GeometryStore } from "../../src/document/geometry-store.ts";
import { createDocument } from "../../src/document/model.ts";
import { DocumentSession } from "../../src/document/session.ts";
import { buildWorkload } from "../../src/document/testing/bench-workload.ts";
import { TEST_PROVENANCE } from "../../src/document/testing/provenance.ts";
import { syntheticPacket } from "../../src/document/testing/synthetic.ts";
import { canonicalJson, canonicalJsonBytes } from "../../src/persistence/canonical-json.ts";
import { CONTAINER_LIMITS, loadContainer, saveContainer } from "../../src/persistence/container.ts";
import { documentJson } from "../../src/persistence/document-json.ts";
import { decodeCompact, encodeCompact } from "./compact-document.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const REPS = Number(arg("--reps", "3"));
const MB = 2 ** 20;
const now = () => performance.now();
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const gc = globalThis.gc ?? (() => {});

const bigProvenance = (n) => ({
  ...TEST_PROVENANCE,
  originalScene: {
    ...TEST_PROVENANCE.originalScene,
    palette: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, color: (i * 2654435761) >>> 0 })),
  },
});
const fromFile = (f) => () =>
  loadContainer(new Uint8Array(readFileSync(`tests/output/g-r1/workloads/${f}.vectra`)), {});
const single = (packet, provenance = TEST_PROVENANCE) => {
  const s = new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: "g-prj", width: 1000, height: 1000 }),
  });
  s.dispatch({ type: "commitTrace", provenance, packet });
  return s;
};
/** name → [description, async builder returning a DocumentSession] */
const WORKLOADS = {
  small: [
    "ordinary small artwork: the renderer fixture edited-styles-visibility (a traced and edited document)",
    () =>
      loadContainer(
        Uint8Array.from(
          Buffer.from(
            readFileSync(
              "tests/output/renderer-fixtures/edited-styles-visibility.vectra.b64",
              "utf8",
            ),
            "base64",
          ),
        ),
        {},
      ),
  ],
  "bark-1224": ["real photographic trace (G-R1 registered, 270k anchors)", fromFile("bark-1224")],
  "bark-2350": ["real photographic trace (G-R1 registered, 812k anchors)", fromFile("bark-2350")],
  halftone: [
    "halftone trace (G-R1 registered, 977k anchors in one path)",
    fromFile("architecture-street-halftone"),
  ],
  "palette-provenance": [
    "20k paths with 20k styles and a 30k-entry provenance palette",
    () =>
      single(
        syntheticPacket({ paths: 20000, anchorsPerPath: 4, groups: 4, styles: 20000, seed: 3 }),
        bigProvenance(30000),
      ),
  ],
  "interactive-43k": [
    "interactive target: 43k paths, 264k anchors (bench-workload)",
    () => buildWorkload(43000).session,
  ],
  "synthetic-250k": [
    "interactive target: 42k paths, 250k anchors (G-R1 registered)",
    fromFile("synthetic-many-250k"),
  ],
  w756k: ["250k paths, 756k anchors (bench-workload)", () => buildWorkload(250000).session],
  w996k: [
    "330k paths, 996k anchors (bench-workload, designated stress)",
    () => buildWorkload(330000).session,
  ],
  "limit-500k": [
    "near the limits: 500k paths × 2 anchors = 1M anchors (the anchor cap)",
    () => single(syntheticPacket({ paths: 500000, anchorsPerPath: 2, groups: 8, seed: 9 })),
  ],
};

const docOf = (s) => documentJson(s.state, s.nextId, s.store.nextChunkId);

const CONTAINERS = "tests/output/g-prj/containers";
/**
 * Peak RSS of one save or load, in a fresh process that starts from the saved container on
 * disk (written by the parent). `peakMiB` = max RSS after the operation − RSS just before it.
 * maxRSS is a high-water mark: if the operation never exceeded the process's earlier peak
 * (reading the file, or for a save, loading the session first), the value is a lower bound
 * and `exceededEarlierPeak` is false.
 */
async function peakChild(mode, name) {
  const file = new Uint8Array(readFileSync(`${CONTAINERS}/${name}.vectra`));
  let session = mode === "save" ? await loadContainer(new Uint8Array(file), {}) : null;
  gc();
  const rssBefore = process.memoryUsage().rss;
  const maxBefore = process.resourceUsage().maxRSS * 1024;
  if (mode === "save") await saveContainer(session, { codec: "deflate-raw" });
  else session = await loadContainer(file, {});
  const maxAfter = process.resourceUsage().maxRSS * 1024;
  return {
    mode,
    name,
    ok: !!session,
    peakMiB: +((maxAfter - rssBefore) / 2 ** 20).toFixed(1),
    exceededEarlierPeak: maxAfter > maxBefore,
  };
}

if (process.argv.includes("--peak")) {
  const i = process.argv.indexOf("--peak");
  const r = await peakChild(process.argv[i + 1], process.argv[i + 2]);
  console.log(JSON.stringify(r));
  process.exit(0);
}

async function measure(name) {
  const [description, build] = WORKLOADS[name];
  const s = await build();
  const doc = docOf(s);
  // Composition of the canonical document section.
  const part = (v) => canonicalJsonBytes(v).length;
  let provenance = 0;
  for (const n of s.state.nodesById.values())
    if (n.traceProvenance) provenance += part(n.traceProvenance);
  const t0 = now();
  const v0 = canonicalJsonBytes(doc);
  const v0Ms = now() - t0;
  const compact = encodeCompact(doc);
  const t1 = now();
  const v1 = canonicalJsonBytes(compact);
  const v1Ms = now() - t1;
  const lossless =
    canonicalJson(decodeCompact(JSON.parse(new TextDecoder().decode(v1)))) === canonicalJson(doc);
  const chunkIds = [...(s.derivedOf(s.state)?.chunks.keys() ?? [])];
  const geometry = chunkIds.reduce((a, id) => a + s.store.encodeRecord(id).length, 0);
  const sources = [...s.state.sourceAssetsById.values()].reduce(
    (a, x) => a + (x.embedded ? (s.sourceBytes(x.id)?.length ?? 0) : 0),
    0,
  );
  const row = {
    name,
    description,
    nodes: s.state.nodesById.size,
    paths: [...s.state.nodesById.values()].filter((n) => n.kind === "path").length,
    anchors: s.getSnapshot().anchors,
    styles: s.state.stylesById.size,
    palette: s.state.paletteById.size,
    document: {
      canonicalBytes: v0.length,
      overCap: v0.length > CONTAINER_LIMITS.maxDocumentBytes,
      composition: {
        nodesExcludingProvenance: part(doc.nodesById) - provenance,
        provenance,
        styles: part(doc.stylesById),
        palette: part(doc.paletteById),
        sourceAssetRecords: part(doc.sourceAssetsById),
      },
      bytesPerPath: +(v0.length / Math.max(1, s.state.nodesById.size)).toFixed(1),
      serializeMs: +v0Ms.toFixed(1),
      deflateRawBytes: deflateRawSync(v0).length,
      compact: {
        bytes: v1.length,
        ratio: +(v1.length / v0.length).toFixed(3),
        overCap: v1.length > CONTAINER_LIMITS.maxDocumentBytes,
        serializeMs: +v1Ms.toFixed(1),
        deflateRawBytes: deflateRawSync(v1).length,
        lossless,
      },
    },
    geometryBytes: geometry,
    sourceBytes: sources,
  };
  // Containers: real saves where the C7 limits allow them.
  for (const codec of ["none", "deflate-raw"]) {
    const times = [];
    let bytes = null;
    let refused = null;
    for (let r = 0; r < REPS && !refused; r++) {
      gc();
      const t = now();
      try {
        bytes = await saveContainer(s, { codec });
      } catch (e) {
        refused = String(e.message ?? e);
      }
      times.push(now() - t);
    }
    const c = (row[codec === "none" ? "containerNone" : "containerDeflate"] = refused
      ? { refused }
      : { bytes: bytes.length, saveMs: +med(times).toFixed(1) });
    if (!refused) {
      const lt = [];
      for (let r = 0; r < REPS; r++) {
        const copy = new Uint8Array(bytes);
        gc();
        const t = now();
        await loadContainer(copy, {});
        lt.push(now() - t);
      }
      c.loadMs = +med(lt).toFixed(1);
      // Worker hand-off: a structured copy of the bytes (a transfer is O(1)).
      const t = now();
      structuredClone(bytes);
      c.structuredCopyMs = +(now() - t).toFixed(1);
    }
  }
  // Peak RSS during save and load, each in a fresh process from the saved container.
  row.peakRssMiB = {};
  const saveable = !row.containerDeflate.refused;
  if (saveable) {
    mkdirSync(CONTAINERS, { recursive: true });
    writeFileSync(`${CONTAINERS}/${name}.vectra`, await saveContainer(s, { codec: "deflate-raw" }));
  } else row.peakRssMiB.note = "not saveable under C7";
  for (const mode of saveable ? ["save", "load"] : []) {
    const r = spawnSync(
      process.execPath,
      ["--expose-gc", "scripts/g-prj/persistence-limits.mjs", "--peak", mode, name],
      {
        encoding: "utf8",
        maxBuffer: 1 << 24,
      },
    );
    try {
      const j = JSON.parse(r.stdout.trim().split("\n").pop());
      row.peakRssMiB[mode] = j.exceededEarlierPeak ? j.peakMiB : `≥ ${j.peakMiB} (lower bound)`;
    } catch {
      row.peakRssMiB[mode] = `error: ${r.stderr.slice(0, 200)}`;
    }
  }
  return row;
}

const ONLY = arg("--only", null)?.split(",");
const result = {
  script: "scripts/g-prj/persistence-limits.mjs",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  node: process.version,
  cpu: cpus()[0]?.model,
  totalMemGiB: +(totalmem() / 2 ** 30).toFixed(1),
  limits: CONTAINER_LIMITS,
  reps: REPS,
  loadavgStart: loadavg(),
  workloads: [],
};
for (const name of Object.keys(WORKLOADS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const row = await measure(name);
  result.workloads.push(row);
  const d = row.document;
  console.error(
    `${name}: doc ${(d.canonicalBytes / MB).toFixed(2)} MiB${d.overCap ? " (OVER CAP)" : ""}, compact ${(d.compact.bytes / MB).toFixed(2)} MiB (${d.compact.ratio}${d.compact.lossless ? ", lossless" : ", NOT LOSSLESS"}), ` +
      `geometry ${(row.geometryBytes / MB).toFixed(2)} MiB; save/load ${row.containerDeflate.saveMs ?? "-"}/${row.containerDeflate.loadMs ?? row.containerDeflate.refused ?? "-"} ms; peak ${JSON.stringify(row.peakRssMiB)}`,
  );
}
result.loadavgEnd = loadavg();
const json = JSON.stringify(result, null, 2);
const OUT = arg("--out", null);
if (OUT) writeFileSync(OUT, json + "\n");
else console.log(json);
