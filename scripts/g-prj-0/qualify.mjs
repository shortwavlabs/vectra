// G-PRJ-0 qualification: large-project round trips, v1 → v2 migration, the exact 64 MiB boundary,
// refusal of the first transaction past each real C7 limit, sizes, times and memory.
//   node --expose-gc scripts/g-prj-0/qualify.mjs [--only a,b] [--reps 3] [--out file.json]
//   node --expose-gc scripts/g-prj-0/qualify.mjs --peak <save|load> <name>   (child mode)
// Workloads are the G-PRJ-R set (persistence limits §2). Real photographic traces are the
// registered G-R1 v1 containers (tests/output/g-r1/workloads, licensed sources); no concert-*
// input is read. Containers written here go to tests/output/g-prj-0/containers.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { GeometryStore } from "../../src/document/geometry-store.ts";
import { createDocument, DocumentError } from "../../src/document/model.ts";
import { DocumentSession, sha256Hex } from "../../src/document/session.ts";
import { buildWorkload } from "../../src/document/testing/bench-workload.ts";
import { documentJsonV1 } from "../../src/document/testing/document-json-v1.ts";
import { tinyPng } from "../../src/document/testing/persistable-differential.ts";
import { TEST_PROVENANCE } from "../../src/document/testing/provenance.ts";
import { syntheticPacket } from "../../src/document/testing/synthetic.ts";
import { canonicalJsonBytes } from "../../src/persistence/canonical-json.ts";
import {
  CONTAINER_LIMITS,
  loadContainer,
  readHeader,
  readSection,
  saveContainer,
} from "../../src/persistence/container.ts";
import { bodyOf } from "../../src/persistence/persistable.ts";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const REPS = Number(arg("--reps", "3"));
const ONLY = arg("--only", null)?.split(",");
const OUT = arg("--out", null);
const MiB = 2 ** 20;
const now = () => performance.now();
const med = (xs) => +[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(1);
const gc = globalThis.gc ?? (() => {});
const CONTAINERS = "tests/output/g-prj-0/containers";
const G_R1 = "tests/output/g-r1/workloads";
mkdirSync(CONTAINERS, { recursive: true });

const conditions = () => {
  const ps = execFileSync("ps", ["-Ao", "pcpu,comm", "-r"], { encoding: "utf8" })
    .trim()
    .split("\n");
  return {
    loadavg: loadavg().map((x) => +x.toFixed(2)),
    top: ps.slice(1, 6).map((l) => l.trim().replace(/^(\S+)\s+.*\/(.*)$/, "$1 $2")),
    ngspice: ps.filter((l) => /ngspice/.test(l)).length,
  };
};
const bigProvenance = (n) => ({
  ...TEST_PROVENANCE,
  originalScene: {
    ...TEST_PROVENANCE.originalScene,
    palette: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, color: (i * 2654435761) >>> 0 })),
  },
});
const single = (packet, provenance = TEST_PROVENANCE) => {
  const s = new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: "g-prj-0", width: 1000, height: 1000 }),
  });
  s.dispatch({ type: "commitTrace", provenance, packet });
  return s;
};
const v1File = (name) => new Uint8Array(readFileSync(`${G_R1}/${name}.vectra`));

/** name → { what, build(): Promise<{ session, v1?: Uint8Array }> } */
const WORKLOADS = {
  "v1-golden": {
    what: "the historical v1 golden container (circle-bw), read and migrated",
    build: async () => {
      const v1 = Uint8Array.from(
        Buffer.from(
          readFileSync("src/persistence/golden/circle-bw.none.vectra.b64", "utf8").trim(),
          "base64",
        ),
      );
      return { session: await loadContainer(v1, {}), v1 };
    },
  },
  "bark-1224": {
    what: "real photographic trace, registered G-R1 v1 container (270k anchors)",
    build: async () => ({
      session: await loadContainer(v1File("bark-1224"), {}),
      v1: v1File("bark-1224"),
    }),
  },
  "bark-2350": {
    what: "real photographic trace, registered G-R1 v1 container (812k anchors)",
    build: async () => ({
      session: await loadContainer(v1File("bark-2350"), {}),
      v1: v1File("bark-2350"),
    }),
  },
  halftone: {
    what: "halftone trace, registered G-R1 v1 container (977k anchors in one path)",
    build: async () => ({
      session: await loadContainer(v1File("architecture-street-halftone"), {}),
      v1: v1File("architecture-street-halftone"),
    }),
  },
  "synthetic-250k": {
    what: "interactive target, registered G-R1 v1 container (42k paths, 250k anchors)",
    build: async () => ({
      session: await loadContainer(v1File("synthetic-many-250k"), {}),
      v1: v1File("synthetic-many-250k"),
    }),
  },
  "interactive-43k": {
    what: "interactive target: 43k paths, 264k anchors (bench-workload)",
    build: async () => ({ session: buildWorkload(43000).session }),
  },
  "palette-provenance": {
    what: "20k paths, 20k styles, a 30k-entry provenance palette",
    build: async () => ({
      session: single(
        syntheticPacket({ paths: 20000, anchorsPerPath: 4, groups: 4, styles: 20000, seed: 3 }),
        bigProvenance(30000),
      ),
    }),
  },
  "embedded-sources": {
    what: "a traced document with three embedded sources: 1 MiB, 5 MiB and 20 MiB (the cap)",
    build: async () => {
      const s = single(syntheticPacket({ paths: 2000, anchorsPerPath: 4, groups: 2, seed: 5 }));
      for (const [i, n] of [MiB, 5 * MiB, CONTAINER_LIMITS.maxSourceBytes].entries())
        await s.attachSource(tinyPng(640 + i, 480, n, i), { embedded: true });
      await s.attachSource(tinyPng(32, 32, 4096, 9), { embedded: false });
      return { session: s };
    },
  },
  w756k: {
    what: "250k paths, 756k anchors (bench-workload)",
    build: async () => ({ session: buildWorkload(250000).session }),
  },
  w996k: {
    what: "330k paths, 996k anchors (bench-workload; the designated stress workload)",
    build: async () => ({ session: buildWorkload(330000).session }),
  },
  "open-50k": {
    what: "TD-PERF-009 workload: 50k paths × 4 anchors (P1-A open measurement)",
    build: async () => ({
      session: single(syntheticPacket({ paths: 50000, anchorsPerPath: 4, groups: 8, seed: 21 })),
    }),
  },
  "open-250k-1m": {
    what: "TD-PERF-009 workload: 250k paths × 4 anchors = 1M anchors (P1-A open measurement)",
    build: async () => ({
      session: single(syntheticPacket({ paths: 250000, anchorsPerPath: 4, groups: 8, seed: 22 })),
    }),
  },
  "limit-500k": {
    what: "500k paths × 2 anchors = 1M anchors (exactly the anchor cap)",
    build: async () => ({
      session: single(syntheticPacket({ paths: 500000, anchorsPerPath: 2, groups: 8, seed: 9 })),
    }),
  },
};

const hash = async (bytes) => (await sha256Hex(bytes)).slice(0, 16);
const v1Bytes = (s) => canonicalJsonBytes(documentJsonV1(s.state, s.nextId, s.store.nextChunkId));
const time = async (f) => {
  const t = now();
  const v = await f();
  return [now() - t, v];
};

/** Peak RSS of one save or load in a fresh process started from the v2 container on disk. */
async function peakChild(mode, name) {
  const file = new Uint8Array(readFileSync(`${CONTAINERS}/${name}.vectra`));
  let session = mode === "save" ? await loadContainer(new Uint8Array(file), {}) : null;
  gc();
  const rssBefore = process.memoryUsage().rss;
  const maxBefore = process.resourceUsage().maxRSS * 1024;
  if (mode === "save") await saveContainer(session, { codec: "deflate-raw" });
  else session = await loadContainer(file, {});
  const maxAfter = process.resourceUsage().maxRSS * 1024;
  console.log(
    JSON.stringify({
      peakMiB: +((maxAfter - rssBefore) / MiB).toFixed(1),
      exceededEarlierPeak: maxAfter > maxBefore,
      nodes: session.state.nodesById.size,
    }),
  );
}
if (process.argv[2] === "--peak") {
  await peakChild(process.argv[3], process.argv[4]);
  process.exit(0);
}
const peak = (mode, name) => {
  const r = spawnSync(
    process.execPath,
    ["--expose-gc", import.meta.filename, "--peak", mode, name],
    {
      encoding: "utf8",
      maxBuffer: 1 << 20,
    },
  );
  if (r.status !== 0) return { error: r.stderr.slice(-400) };
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
};

async function qualify(name, w) {
  console.error(`${name}: building`);
  const { session, v1 } = await w.build();
  const s = session;
  const info = s.persistInfo();
  const v1doc = v1Bytes(s);
  const [bodyMs] = await time(() => bodyOf(s.state));
  const row = {
    what: w.what,
    nodes: s.state.nodesById.size,
    styles: s.state.stylesById.size,
    palette: s.state.paletteById.size,
    anchors: s.getSnapshot().anchors,
    v1DocumentBytes: v1doc.length,
    v2DocumentBytes: info.documentBytes,
    ratio: +(info.documentBytes / v1doc.length).toFixed(4),
    documentBound: info.documentBound,
    documentHeadroomBytes: CONTAINER_LIMITS.maxDocumentBytes - info.documentBound,
    documentUseOfCap: +(info.documentBound / CONTAINER_LIMITS.maxDocumentBytes).toFixed(4),
    sections: info.sections,
    geometryBytes: info.geometryBytes,
    sourceBytes: info.sourceBytes,
    totalBytes: info.totalBytes,
    bodyOfMs: +bodyMs.toFixed(1),
    v1MigrationChecked: !!v1,
  };
  // Save (both codecs) and load, medians.
  const dirtyBefore = s.getSnapshot().dirty;
  const saves = { none: [], "deflate-raw": [] };
  let bytes = {};
  for (let r = 0; r < REPS; r++)
    for (const codec of ["none", "deflate-raw"]) {
      gc();
      const [ms, b] = await time(() => saveContainer(s, { codec }));
      saves[codec].push(ms);
      bytes[codec] = b;
    }
  const loads = { none: [], "deflate-raw": [] };
  let loaded;
  for (let r = 0; r < REPS; r++)
    for (const codec of ["none", "deflate-raw"]) {
      gc();
      const [ms, l] = await time(() => loadContainer(bytes[codec], {}));
      loads[codec].push(ms);
      loaded = l;
    }
  writeFileSync(`${CONTAINERS}/${name}.vectra`, bytes["deflate-raw"]);
  Object.assign(row, {
    saveNoneMs: med(saves.none),
    saveDeflateMs: med(saves["deflate-raw"]),
    loadNoneMs: med(loads.none),
    loadDeflateMs: med(loads["deflate-raw"]),
    containerNoneBytes: bytes.none.length,
    containerDeflateBytes: bytes["deflate-raw"].length,
  });
  // Round-trip equivalence, checked through independent paths.
  const checks = {};
  const resaved = await saveContainer(loaded, { codec: "none" });
  checks.resaveByteIdentical = Buffer.compare(Buffer.from(resaved), Buffer.from(bytes.none)) === 0;
  checks.v1EncodingEqual = (await hash(v1Bytes(loaded))) === (await hash(v1doc));
  checks.persistInfoEqual = JSON.stringify(loaded.persistInfo()) === JSON.stringify(info);
  checks.geometryRecordsEqual = (() => {
    const a = [...s.derivedOf(s.state).chunks.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    const b = [...loaded.derivedOf(loaded.state).chunks.keys()].sort((x, y) =>
      x < y ? -1 : x > y ? 1 : 0,
    );
    if (a.join() !== b.join()) return false;
    return a.every(
      (id) =>
        Buffer.compare(
          Buffer.from(s.store.encodeRecord(id)),
          Buffer.from(loaded.store.encodeRecord(id)),
        ) === 0,
    );
  })();
  checks.sourcesEqual = [...s.state.sourceAssetsById.values()]
    .filter((a) => a.embedded)
    .every(
      (a) =>
        Buffer.compare(Buffer.from(s.sourceBytes(a.id)), Buffer.from(loaded.sourceBytes(a.id))) ===
        0,
    );
  checks.cleanAfterLoad = loaded.getSnapshot().dirty === false;
  // AM-3.4, checked on a dirty session (a loaded session starts clean, which would prove
  // nothing): edit, serialize, and the session must still be dirty; then undo the edit.
  {
    const id = [...s.state.nodesById.keys()][0];
    s.dispatch({ type: "rename", id, name: "dirty-check" });
    await saveContainer(s, { codec: "none" });
    const dirtyAfterSave = s.getSnapshot().dirty;
    s.undo(); // back to the measured state: clean if loaded, dirty if built by commands
    checks.serializationDidNotMarkSaved =
      dirtyAfterSave === true && s.getSnapshot().dirty === dirtyBefore;
  }
  if (v1) {
    // Independent migration check: the original v1 file's document section equals the v1
    // encoding of the document reloaded from the v2 file.
    const h = readHeader(v1);
    const docSection = await readSection(v1, h, h.sections[1]);
    checks.v1FileDocumentReproducedFromV2 =
      (await hash(docSection)) === (await hash(v1Bytes(loaded)));
  }
  row.checks = checks;
  row.allChecksPass = Object.values(checks).every(Boolean);
  if (["w756k", "w996k", "limit-500k", "bark-2350"].includes(name)) {
    row.peakSave = peak("save", name);
    row.peakLoad = peak("load", name);
  }
  console.error(
    `${name}: ${JSON.stringify({ ratio: row.ratio, use: row.documentUseOfCap, ok: row.allChecksPass })}`,
  );
  return row;
}

/** The exact 64 MiB boundary: fill limit-500k with 256-character names until the document
 *  bound equals the cap to the byte, refuse one more byte, then save and reload it. */
async function boundary() {
  const L = CONTAINER_LIMITS.maxDocumentBytes;
  const s = single(syntheticPacket({ paths: 500000, anchorsPerPath: 2, groups: 8, seed: 9 }));
  const unnamed = [...s.state.nodesById.values()].filter((n) => n.kind === "path").map((n) => n.id);
  let next = 0;
  const gap = () => L - s.persistInfo().documentBound;
  const startGap = gap();
  const name = (k) => "n".repeat(k);
  // Bulk: +266 bytes per rename (`,"name":"<256>"`), in transactions of 10,000.
  while (gap() >= 266 + 11 + 266) {
    const k = Math.min(10_000, Math.floor((gap() - 11 - 266) / 266));
    const cmds = [];
    for (let i = 0; i < k; i++) cmds.push({ type: "rename", id: unnamed[next++], name: name(256) });
    s.dispatch(cmds);
  }
  while (gap() > 266 + 10) s.dispatch({ type: "rename", id: unnamed[next++], name: name(256) });
  if (gap() > 266) s.dispatch({ type: "rename", id: unnamed[next++], name: name(gap() - 21) });
  s.dispatch({ type: "rename", id: unnamed[next++], name: name(gap() - 10) });
  const atCap = s.persistInfo();
  const before = { state: s.state, revision: s.getSnapshot().revision, nextId: s.nextId };
  let refused = null;
  try {
    s.dispatch({ type: "rename", id: unnamed[next], name: "x" });
  } catch (e) {
    if (!(e instanceof DocumentError)) throw e;
    refused = { code: e.code, message: e.message };
  }
  const unchanged =
    s.state === before.state &&
    s.getSnapshot().revision === before.revision &&
    s.nextId === before.nextId;
  const bytes = await saveContainer(s, { codec: "deflate-raw" });
  const loaded = await loadContainer(bytes, {});
  const h = readHeader(bytes);
  writeFileSync(`${CONTAINERS}/boundary-64mib.vectra`, bytes);
  return {
    what: "limit-500k filled with 256-character names to the exact document-section cap",
    startGap,
    renames: next,
    documentBound: atCap.documentBound,
    exactlyAtCap: atCap.documentBound === L,
    actualDocumentBytes: atCap.documentBytes,
    savedDocumentSectionBytes: h.sections[1].uncompressedLength,
    reservedMarkBytesUnused: atCap.documentBound - atCap.documentBytes,
    oneByteMoreRefused: refused,
    refusalLeftSessionUnchanged: unchanged,
    reloads: loaded.state.nodesById.size === s.state.nodesById.size,
    roundTripV1EncodingEqual: (await hash(v1Bytes(loaded))) === (await hash(v1Bytes(s))),
  };
}

/** The real section limit (4,096): 4,094 chunks fit; the 4,095th trace commit is refused. */
function sectionLimit() {
  const s = new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: "sections", width: 100, height: 100 }),
    history: { maxEntries: 2, maxBytes: 128 * MiB },
  });
  const t = now();
  let commits = 0;
  let refused = null;
  for (;;) {
    try {
      s.dispatch({
        type: "commitTrace",
        provenance: TEST_PROVENANCE,
        packet: syntheticPacket({ paths: 1, anchorsPerPath: 2, seed: commits + 1 }),
      });
      commits++;
    } catch (e) {
      if (!(e instanceof DocumentError)) throw e;
      refused = { code: e.code, message: e.message, sections: s.persistInfo().sections };
      break;
    }
  }
  return { commitsAccepted: commits, refused, ms: +(now() - t).toFixed(0) };
}

/** The real session budget (512 MiB): embedded 20 MiB sources until the first is refused. */
async function budgetLimit() {
  const s = single(syntheticPacket({ paths: 100, anchorsPerPath: 4, seed: 11 }));
  let attached = 0;
  let refused = null;
  for (;;) {
    try {
      await s.attachSource(tinyPng(800, 600, CONTAINER_LIMITS.maxSourceBytes, attached), {
        embedded: true,
      });
      attached++;
    } catch (e) {
      if (!(e instanceof DocumentError)) throw e;
      refused = { code: e.code, message: e.message };
      break;
    }
  }
  const info = s.persistInfo();
  const bytes = await saveContainer(s, { codec: "none" });
  const loaded = await loadContainer(bytes, {});
  return {
    sourcesAccepted: attached,
    refused,
    totalBound: info.totalBound,
    budget: CONTAINER_LIMITS.sessionBudget,
    savedAndReloaded: loaded.state.sourceAssetsById.size === attached,
  };
}

/** Accounting cost of one large trace commit (the 330k-path commit of w996k). */
function largeCommit() {
  const s = new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: "commit", width: 1000, height: 1000 }),
  });
  const packet = syntheticPacket({ paths: 330000, anchorsPerPath: 3, groups: 8, seed: 42 });
  gc();
  const t = now();
  s.dispatch({ type: "commitTrace", provenance: TEST_PROVENANCE, packet });
  return {
    paths: 330000,
    dispatchMs: +(now() - t).toFixed(1),
    persistMs: +s.lastPersistMs.toFixed(1),
  };
}

const result = {
  script: "scripts/g-prj-0/qualify.mjs",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  trackedChanges:
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }) !==
    "",
  node: process.version,
  cpu: cpus()[0]?.model,
  totalMemGiB: +(totalmem() / 2 ** 30).toFixed(1),
  reps: REPS,
  conditionsStart: conditions(),
  workloads: {},
};
for (const [name, w] of Object.entries(WORKLOADS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  if (w.build.toString().includes("v1File") && !existsSync(G_R1)) {
    result.workloads[name] = { skipped: `${G_R1} not present` };
    continue;
  }
  result.workloads[name] = await qualify(name, w);
}
if (!ONLY || ONLY.includes("boundary")) result.boundary = await boundary();
if (!ONLY || ONLY.includes("sections")) result.sectionLimit = sectionLimit();
if (!ONLY || ONLY.includes("budget")) result.budgetLimit = await budgetLimit();
if (!ONLY || ONLY.includes("commit")) result.largeCommit = largeCommit();
result.conditionsEnd = conditions();
const json = JSON.stringify(result, null, 2);
if (OUT) writeFileSync(OUT, json + "\n");
else console.log(json);
