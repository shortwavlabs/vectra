// R-COLOR-02: runs the moxcms wasm32 build in Node and compares it bit for bit with the native
// outputs written by `cmm_compare compare` (moxcms-native.json). Also reports WASM size.
// Usage: node experiments/r-color/wasm-check.mjs <moxcms-native.json> [more native json ...]
import { readFileSync } from "node:fs";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import { performance } from "node:perf_hooks";

const WASM = "experiments/r-color/cmm/target/wasm32-unknown-unknown/release/r_color_cmm.wasm";
const P = "/System/Library/ColorSync/Profiles";
const profiles = {
  srgb: readFileSync(`${P}/sRGB Profile.icc`),
  cmyk: readFileSync(`${P}/Generic CMYK Profile.icc`),
  p3: readFileSync(`${P}/Display P3.icc`),
  adobe: readFileSync(`${P}/AdobeRGB1998.icc`),
};
const bytes = readFileSync(WASM);
const { instance } = await WebAssembly.instantiate(bytes, {});
const x = instance.exports;
const put = (u8) => {
  const p = x.rc_alloc(u8.length);
  new Uint8Array(x.memory.buffer, p, u8.length).set(u8);
  return p;
};
const ptrs = Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, [put(v), v.length]]));

function run(dst, channels, intent, flags, rgb) {
  const n = rgb.length / 3;
  const pin = put(rgb);
  const pout = x.rc_alloc(n * channels * 4);
  const [sp, sl] = ptrs.srgb;
  const [dp, dl] = ptrs[dst];
  const rc = x.rc_convert(sp, sl, dp, dl, channels, intent, flags, pin, n, pout);
  if (rc !== 0) throw new Error(`rc_convert ${dst} failed`);
  return new Float32Array(x.memory.buffer.slice(pout, pout + n * channels * 4));
}

const intents = { perceptual: 0, relative: 1, saturation: 2, absolute: 3 };
const report = {
  wasm: {
    file: WASM,
    rawBytes: bytes.length,
    gzip9Bytes: gzipSync(bytes, { level: 9 }).length,
    brotli11Bytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
      .length,
  },
  comparisons: [],
};
for (const file of process.argv.slice(2)) {
  const native = JSON.parse(readFileSync(file, "utf8"));
  const rgb = Uint8Array.from(native.inputRgb);
  for (const [key, want] of Object.entries(native)) {
    if (key === "inputRgb" || key === "simd") continue;
    const m = /^(cmyk|p3|adobe)-(f32|u8|u16)-(\w+)$/.exec(key);
    if (!m) continue;
    const [, dst, mode, intent] = m;
    const ch = dst === "cmyk" ? 4 : 3;
    const got = run(dst, ch, intents[intent], { f32: 0, u8: 3, u16: 5 }[mode], rgb);
    let equal = 0;
    let maxAbs = 0;
    for (let i = 0; i < got.length; i++) {
      const w = mode !== "f32" ? want[i] : new Float32Array(new Uint32Array([parseInt(want[i], 16)]).buffer)[0];
      if (Object.is(got[i], w)) equal++;
      maxAbs = Math.max(maxAbs, Math.abs(got[i] - w));
    }
    report.comparisons.push({ native: file, nativeSimd: native.simd, key, values: got.length, bitIdentical: equal, maxAbsDiff: maxAbs });
  }
}
// Throughput: 1,048,576 px sRGB -> CMYK f32 (one transform build + conversion).
const rgbBig = new Uint8Array((1 << 20) * 3);
for (let i = 0; i < rgbBig.length; i++) rgbBig[i] = (i * 2654435761) >>> 24;
const t0 = performance.now();
run("cmyk", 4, 1, 0, rgbBig);
report.throughput = { pixels: 1 << 20, conversion: "sRGB->CMYK f32 relative", ms: Math.round(performance.now() - t0) };
report.wasmMemoryBytesAfter = x.memory.buffer.byteLength;
console.log(JSON.stringify(report, null, 2));
