// R01 transport benchmark (Node 24, single thread). Each (scene, mode) runs in a fresh process
// with --expose-gc so resident/peak memory is not polluted by the other representation.
//   encode : parse scene JSON, JS-side encode to GeometryPacket, write .bin (not the production
//            encode path: production would build the arrays in Rust), deflate sizes.
//   json   : bytes -> TextDecoder string (= wasm-bindgen getStringFromWasm0) -> JSON.parse.
//   packet : .bin bytes -> typed views (zero-copy) -> validatePacket (bounds + subpaths derived).
// Usage: node experiments/rfc-002-review/bench/transport-node.mjs > out.json
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { encodeScene, packetBytes, validatePacket } from "./packet.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const REPS = 6; // 1 cold + 5 warm
const binDir = `${root}tests/output/rfc-002-review/packets/`;

export const SCENES = [
  ["real", "concert-small-venue-bw"], ["real", "concert-small-venue-1280-halftone"],
  ["real", "architecture-street-bw"], ["real", "architecture-street-limited"],
  ["real", "portrait-large-color"], ["real", "portrait-face-limited"],
  ["real", "architecture-street-halftone"],
  ["synth", "synthetic-many-10k"], ["synth", "synthetic-many-100k"], ["synth", "synthetic-many-250k"],
  ["synth", "synthetic-many-500k"], ["synth", "synthetic-many-1m"],
];
const scenePath = (kind, name) =>
  ({ real: "tests/output/regression-a4cf172/", synth: "tests/output/rfc-002-review/scenes/", native: "tests/output/native/" })[kind].replace(/^/, root) + `${name}.scene.json`;

const mem = () => {
  const m = process.memoryUsage();
  return { heapUsed: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers, rss: m.rss };
};
const stats = (xs) => {
  const warm = xs.slice(1).sort((a, b) => a - b);
  return { cold: +xs[0].toFixed(2), p50: +warm[warm.length >> 1].toFixed(2), max: +warm.at(-1).toFixed(2) };
};
const time = (fn) => {
  const t = performance.now();
  const r = fn();
  return [performance.now() - t, r];
};

function child(mode, kind, name) {
  const file = scenePath(kind, name);
  const out = { mode, name };
  if (mode === "encode") {
    const scene = JSON.parse(readFileSync(file, "utf8"));
    const enc = [];
    let p;
    for (let i = 0; i < REPS; i++) {
      const [t, r] = time(() => encodeScene(scene));
      enc.push(t);
      p = r;
    }
    const parts = [p.verbs, p.coords, p.verbOffsets, p.coordOffsets, p.styleIndex, p.groupIndex];
    const layout = [];
    let off = 0;
    for (const a of parts) {
      off = Math.ceil(off / 8) * 8;
      layout.push(off);
      off += a.byteLength;
    }
    const bin = new Uint8Array(off);
    parts.forEach((a, i) => bin.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), layout[i]));
    mkdirSync(binDir, { recursive: true });
    writeFileSync(`${binDir}${name}.bin`, bin);
    writeFileSync(`${binDir}${name}.manifest.json`, JSON.stringify({ ...p.manifest, layout }));
    const json = readFileSync(file);
    Object.assign(out, {
      encodeMs: stats(enc), packetBytes: packetBytes(p), binBytes: bin.byteLength, jsonBytes: json.byteLength,
      jsonDeflate: deflateSync(json).byteLength, binDeflate: deflateSync(bin).byteLength,
      manifestBytes: JSON.stringify(p.manifest).length,
      paths: p.manifest.pathCount, verbs: p.manifest.verbCount, coords: p.manifest.coordCount,
    });
  } else if (mode === "json") {
    const bytes = readFileSync(file);
    globalThis.gc();
    const m0 = mem();
    const dec = [], parse = [], clone = [];
    let scene, str;
    for (let i = 0; i < REPS; i++) {
      scene = str = undefined;
      globalThis.gc();
      [dec[i], str] = time(() => new TextDecoder().decode(bytes));
      [clone[i]] = time(() => structuredClone(str));
      [parse[i], scene] = time(() => JSON.parse(str));
    }
    str = undefined;
    globalThis.gc();
    const m1 = mem();
    Object.assign(out, {
      decodeMs: stats(dec), cloneMs: stats(clone), parseMs: stats(parse),
      residentHeap: m1.heapUsed - m0.heapUsed, residentRss: m1.rss - m0.rss, paths: scene.groups.length,
    });
  } else {
    const man = JSON.parse(readFileSync(`${binDir}${name}.manifest.json`, "utf8"));
    const file = readFileSync(`${binDir}${name}.bin`);
    globalThis.gc();
    const m0 = mem();
    const load = [], val = [], clone = [], slice = [];
    let v, p;
    for (let i = 0; i < REPS; i++) {
      p = v = undefined;
      globalThis.gc();
      [load[i], p] = time(() => {
        const buf = new Uint8Array(file).buffer; // one copy, as a received/loaded ArrayBuffer
        const [a, b, c, d, e, f] = man.layout;
        const { pathCount: n, verbCount, coordCount } = man;
        return {
          manifest: man,
          verbs: new Uint8Array(buf, a, verbCount), coords: new Float64Array(buf, b, coordCount),
          verbOffsets: new Uint32Array(buf, c, n + 1), coordOffsets: new Uint32Array(buf, d, n + 1),
          styleIndex: new Uint32Array(buf, e, n), groupIndex: new Uint32Array(buf, f, n),
        };
      });
      // Equivalent of wasm-bindgen's Vec<f64> return: Float64Array view over linear memory .slice().
      [slice[i]] = time(() => p.coords.slice());
      [clone[i]] = time(() => structuredClone(p.coords.buffer));
      [val[i], v] = time(() => validatePacket(p));
    }
    globalThis.gc();
    const m1 = mem();
    Object.assign(out, {
      loadMs: stats(load), wasmCopyOutMs: stats(slice), cloneNoTransferMs: stats(clone), validateMs: stats(val),
      anchors: v.anchors, subpaths: v.subStart.length,
      residentArrayBuffers: m1.arrayBuffers - m0.arrayBuffers, residentHeap: m1.heapUsed - m0.heapUsed,
      derivedBytes: v.bounds.byteLength + v.subStart.byteLength,
    });
  }
  process.stdout.write(JSON.stringify(out));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (!isMain) {
  // Imported for SCENES only (run-transport.mjs): no side effects.
} else if (process.argv[2] === "--child") child(process.argv[3], process.argv[4], process.argv[5]);
else if (process.argv[2] === "--encode") {
  // Encode extra scenes (renderer workloads): --encode kind:name kind:name ...
  for (const spec of process.argv.slice(3)) {
    const [kind, name] = spec.split(":");
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--child", "encode", kind, name]);
    console.error("encoded", spec);
  }
}
else {
  const results = [];
  for (const [kind, name] of SCENES) {
    const row = { kind, name };
    for (const mode of ["encode", "json", "packet"]) {
      const r = JSON.parse(execFileSync(process.execPath, ["--expose-gc", "--max-old-space-size=8192",
        fileURLToPath(import.meta.url), "--child", mode, kind, name], { maxBuffer: 1 << 24 }).toString());
      row[mode] = r;
    }
    results.push(row);
    console.error(`${name}: json ${row.encode.jsonBytes} B, packet ${row.encode.binBytes} B, parse p50 ${row.json.parseMs.p50} ms, validate p50 ${row.packet.validateMs.p50} ms`);
  }
  console.log(JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, reps: REPS, results }, null, 1));
}
