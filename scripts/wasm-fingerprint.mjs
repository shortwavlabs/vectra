#!/usr/bin/env node
// Functional fingerprint of the built WASM engine (packages/vector-engine-wasm/pkg): traces the
// procedural PNG fixtures in every mode and prints SHA-256 of each SVG and PDF. Comparing the
// output across hosts (macOS vs Linux) shows whether differently compiled WASM binaries behave
// identically. Runs in Node (not browser evidence). PNG decoding is a minimal RGBA8 reader for
// the repository's own fixtures.
// G-ENG adds the GeometryPacket route: per case the C3.0 block digest, packet-route SVG/PDF
// (`packetToSvg`/`packetToPdf`) and draw-list export (`exportDrawList*`, identity draw list)
// compared byte for byte with the direct route; with NATIVE_PACKETS_DIR (output of the native
// `packet_regression` example) the WASM blocks are compared with the native blocks.
// Usage: node scripts/wasm-fingerprint.mjs [out.json]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const {
  initSync,
  vectorize,
  sceneToPdf,
  vectorizePacket,
  PacketSet,
  packetToSvg,
  packetToPdf,
  exportDrawListSvg,
  exportDrawListPdf,
} = await import(join(root, "packages/vector-engine-wasm/pkg/vector_engine_wasm.js"));
initSync({
  module: readFileSync(join(root, "packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm")),
});

function decodePng(buf) {
  let pos = 8;
  let width = 0,
    height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
        throw new Error("only RGBA8 non-interlaced PNG");
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + x] = (v + pred) & 255;
    }
  }
  return { width, height, rgba: out };
}

const MODES = {
  bw: { mode: "bw" },
  color: { mode: "color" },
  mosaic: { mode: "color", compositing: "mosaic" },
  limited: { mode: "limited", colors: 6 },
  halftone: { mode: "halftone" },
};
// P0-R-GEO precision fitting, reported as a separate digest so the 65-case digest above stays
// comparable with earlier runs.
const PRECISION_MODES = {
  "bw-precision": { mode: "bw", fit: { mode: "precision" } },
  "color-precision": { mode: "color", fit: { mode: "precision" } },
};
// Optional: directory of native `export_samples` output to compare precision SVGs byte-for-byte.
const nativeDir = process.env.NATIVE_SAMPLES_DIR;
const nativePacketsDir = process.env.NATIVE_PACKETS_DIR;
const packetRows = {};
const packetMismatch = [];
let packetCompared = 0;
const PDF_OPTS = JSON.stringify({ width: 150, unit: "mm" });

/** Packet route for one case; returns the block digest and records any export mismatch. */
function packetRoute(key, img, request, directSvg, directPdf) {
  const p = vectorizePacket(img.rgba, img.width, img.height, request);
  const block = p.blockBytes();
  const manifest = JSON.parse(p.manifestJson);
  const arrays = [
    p.takeVerbs(),
    p.takeCoords(),
    p.takeVerbOffsets(),
    p.takeCoordOffsets(),
    p.takeStyleIndex(),
    p.takeGroupIndex(),
  ];
  const [, , , , styleIndex, groupIndex] = arrays;
  const drawList = {
    width: manifest.width,
    height: manifest.height,
    runs: manifest.groups.map((g) => ({ id: g.id, clip: g.clip })),
    items: Array.from(styleIndex, (si, i) => {
      const s = manifest.styles[si];
      return {
        chunk: 0,
        pathIndex: i,
        transform: [1, 0, 0, 1, 0, 0],
        fill: s.fill,
        paletteId: s.paletteId,
        stroke: s.stroke,
        evenOdd: s.evenOdd,
        groupRun: groupIndex[i],
      };
    }),
  };
  const set = new PacketSet();
  set.add(p.manifestJson, ...arrays);
  const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  const checks = {
    packetSvg: packetToSvg(p.sceneMetaJson, set) === directSvg,
    packetPdf: same(packetToPdf(p.sceneMetaJson, PDF_OPTS, set), directPdf),
    drawListSvg: exportDrawListSvg(JSON.stringify(drawList), p.sceneMetaJson, set) === directSvg,
    drawListPdf: same(
      exportDrawListPdf(JSON.stringify(drawList), p.sceneMetaJson, PDF_OPTS, set),
      directPdf,
    ),
  };
  for (const [k, ok] of Object.entries(checks)) if (!ok) packetMismatch.push(`${key}/${k}`);
  if (nativePacketsDir) {
    const native = readFileSync(join(nativePacketsDir, `${key.replace("/", "-")}.packet.bin`));
    packetCompared += 1;
    if (!same(native, block)) packetMismatch.push(`${key}/native-block`);
  }
  set.free();
  p.free();
  return sha(block);
}
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const manifest = JSON.parse(readFileSync(join(root, "tests/fixtures/MANIFEST.json"), "utf8"));
const rows = {};
const precisionRows = {};
let nativeCompared = 0;
const nativeMismatch = [];
for (const f of manifest.filter((m) => m.file.startsWith("procedural/"))) {
  const img = decodePng(readFileSync(join(root, "tests/fixtures", f.file)));
  for (const [name, settings] of Object.entries(PRECISION_MODES)) {
    const r = vectorize(
      img.rgba,
      img.width,
      img.height,
      JSON.stringify({ presetVersion: 1, seed: 1, settings }),
    );
    const pdf = sceneToPdf(r.scene, JSON.stringify({ width: 150, unit: "mm" }));
    precisionRows[`${f.id}/${name}`] = { svg: sha(r.svg), pdf: sha(pdf), scene: sha(r.scene) };
    if (nativeDir) {
      const nativeSvg = readFileSync(join(nativeDir, `${f.id}-${name}.svg`), "utf8");
      nativeCompared += 1;
      if (nativeSvg !== r.svg) nativeMismatch.push(`${f.id}/${name}`);
    }
    r.free();
  }
  for (const [name, settings] of Object.entries(MODES)) {
    const r = vectorize(
      img.rgba,
      img.width,
      img.height,
      JSON.stringify({ presetVersion: 1, seed: 1, settings }),
    );
    const pdf = sceneToPdf(r.scene, JSON.stringify({ width: 150, unit: "mm" }));
    rows[`${f.id}/${name}`] = { svg: sha(r.svg), pdf: sha(pdf), scene: sha(r.scene) };
    packetRows[`${f.id}/${name}`] = packetRoute(
      `${f.id}/${name}`,
      img,
      JSON.stringify({ presetVersion: 1, seed: 1, settings }),
      r.svg,
      pdf,
    );
    r.free();
  }
}
const wasm = createHash("sha256")
  .update(readFileSync(join(root, "packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm")))
  .digest("hex");
const out = JSON.stringify(
  { wasmSha256: wasm, cases: rows, precisionCases: precisionRows, packetBlocks: packetRows },
  null,
  2,
);
if (process.argv[2]) writeFileSync(process.argv[2], out + "\n");
const all = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const prec = createHash("sha256").update(JSON.stringify(precisionRows)).digest("hex");
console.log(`wasm ${wasm.slice(0, 16)}… ${Object.keys(rows).length} cases, output digest ${all}`);
console.log(`precision: ${Object.keys(precisionRows).length} cases, output digest ${prec}`);
if (nativeDir) {
  console.log(
    `native vs WASM precision SVG: ${nativeCompared - nativeMismatch.length}/${nativeCompared} identical`,
  );
  if (nativeMismatch.length) {
    console.log(`  differ: ${nativeMismatch.join(", ")}`);
    process.exitCode = 1;
  }
}
console.log(
  `packet route: ${Object.keys(packetRows).length} cases, block digest ${createHash("sha256").update(JSON.stringify(packetRows)).digest("hex")}; ` +
    `packet/draw-list SVG+PDF mismatches: ${packetMismatch.filter((m) => !m.endsWith("native-block")).length}` +
    (nativePacketsDir
      ? `; native vs WASM blocks: ${packetCompared - packetMismatch.filter((m) => m.endsWith("native-block")).length}/${packetCompared} identical`
      : ""),
);
if (packetMismatch.length) {
  console.log(`  differ: ${packetMismatch.join(", ")}`);
  process.exitCode = 1;
}
