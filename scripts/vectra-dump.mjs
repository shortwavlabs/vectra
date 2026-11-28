#!/usr/bin/env node
// vectra-dump: inspect a .vectra container (C7). Prints the header, every section (codec, sizes,
// SHA-256 and whether it verifies), the manifest, a document summary and per-chunk packet
// summaries read straight from each C3.0 geometry record. Read-only; never modifies the file.
//
// Usage: node scripts/vectra-dump.mjs <file.vectra> [--json]
// Needs Node 24 (TypeScript type stripping): it reuses the container's own header and section
// readers, so the dump and the loader cannot disagree about the layout.
import { readFileSync } from "node:fs";
import { ContainerError, readHeader, readSection } from "../src/persistence/container.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/vectra-dump.mjs <file.vectra> [--json]");
  process.exit(2);
}
const bytes = new Uint8Array(readFileSync(file));
const utf8 = new TextDecoder("utf-8", { fatal: true });
const align8 = (x) => x + ((8 - (x % 8)) % 8);

function packetSummary(record) {
  if (record.length < 4) return { error: "record shorter than 4 bytes" };
  const Lm = new DataView(record.buffer, record.byteOffset, record.byteLength).getUint32(0, true);
  if (4 + Lm > record.length) return { error: `manifest length ${Lm} beyond record` };
  const m = JSON.parse(utf8.decode(record.subarray(4, 4 + Lm)));
  const P = m.pathCount;
  const len = [m.verbCount, 8 * m.coordCount, 4 * (P + 1), 4 * (P + 1), 4 * P, 4 * P];
  let o = 0;
  for (let k = 0; k < 6; k++) o = k < 5 ? align8(o + len[k]) : o + len[k];
  const B = align8(o);
  const verbs = record.subarray(align8(4 + Lm), align8(4 + Lm) + m.verbCount);
  let anchors = 0;
  let subpaths = 0;
  for (const v of verbs) {
    if (v !== 3) anchors++;
    if (v === 0) subpaths++;
  }
  return {
    packetVersion: m.packetVersion,
    width: m.width,
    height: m.height,
    pathCount: P,
    verbCount: m.verbCount,
    coordCount: m.coordCount,
    anchors,
    subpaths,
    styles: m.styles.length,
    groups: m.groups.map((g) =>
      g.clip ? `${g.id} (clip ${g.clip.x},${g.clip.y} ${g.clip.width}x${g.clip.height})` : g.id,
    ),
    manifestBytes: Lm,
    blockBytes: B,
    recordBytes: align8(4 + Lm) + B,
    recordLengthOk: align8(4 + Lm) + B === record.length,
    inMemoryBytes: m.verbCount + 8 * m.coordCount + 16 * P + 8,
  };
}

/** documentSchemaVersion 2 (C10 r2) omits `kind` and `id`: the key and its prefix imply them. */
const KIND_OF_PREFIX = { lay: "layer", grp: "group", pth: "path", src: "source" };
function documentSummary(doc) {
  const kinds = {};
  for (const [k, n] of Object.entries(doc.nodesById)) {
    const kind = n.kind ?? KIND_OF_PREFIX[k.slice(0, 3)] ?? "unknown";
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  return {
    documentSchemaVersion: doc.documentSchemaVersion,
    documentId: doc.documentId,
    nextId: doc.nextId,
    nextChunkId: doc.nextChunkId,
    artboard: doc.artboard,
    roots: doc.orderedRootIds,
    nodes: kinds,
    styles: Object.keys(doc.stylesById).length,
    palette: Object.entries(doc.paletteById).map(
      ([id, p]) => `${id} ${p.name} #${(p.color >>> 0).toString(16).padStart(8, "0")}`,
    ),
    sourceAssets: Object.entries(doc.sourceAssetsById).map(
      ([id, a]) => `${id} ${a.mime} ${a.width}x${a.height} embedded=${a.embedded}`,
    ),
  };
}

const out = { file, fileBytes: bytes.length };
try {
  const h = readHeader(bytes);
  out.header = {
    formatVersion: h.formatVersion,
    headerBytes: h.dataStart - 12,
    sections: h.sections.length,
  };
  out.sections = [];
  for (const s of h.sections) {
    const entry = { ...s };
    try {
      const data = await readSection(bytes, h, s);
      entry.sha256Verified = true;
      if (s.kind === "manifest") out.manifest = JSON.parse(utf8.decode(data));
      else if (s.kind === "document") out.document = documentSummary(JSON.parse(utf8.decode(data)));
      else if (s.kind === "geometry") entry.packet = packetSummary(data);
    } catch (e) {
      entry.sha256Verified = false;
      entry.error = e instanceof ContainerError ? `${e.code}: ${e.message}` : String(e);
    }
    out.sections.push(entry);
  }
} catch (e) {
  out.error = e instanceof ContainerError ? `${e.code}: ${e.message}` : String(e);
}

if (args.includes("--json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`${out.file}: ${out.fileBytes} bytes`);
  if (out.header)
    console.log(
      `header: formatVersion ${out.header.formatVersion}, ${out.header.headerBytes} bytes, ${out.header.sections} sections`,
    );
  for (const s of out.sections ?? []) {
    console.log(
      `  [${s.kind}] ${s.id} codec=${s.codec} offset=${s.offset} length=${s.length} uncompressed=${s.uncompressedLength}` +
        ` sha256=${s.sha256} ${s.sha256Verified ? "OK" : `FAIL (${s.error})`}`,
    );
    if (s.packet) console.log(`      packet: ${JSON.stringify(s.packet)}`);
  }
  if (out.manifest) console.log(`manifest: ${JSON.stringify(out.manifest)}`);
  if (out.document) console.log(`document: ${JSON.stringify(out.document, null, 2)}`);
  if (out.error) console.log(`error: ${out.error}`);
}
process.exit(out.error || out.sections?.some((s) => !s.sha256Verified) ? 1 : 0);
