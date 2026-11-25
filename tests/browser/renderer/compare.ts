// Pixel comparison against the independent reference rasterizer (resvg/tiny-skia via the
// `render_compare` example; no browser involved), as in the R02 renderer evaluation
// (experiments/rfc-002-review/bench/compare-renders.mjs): differences inside the reference's
// edge band (3×3 range > 24, dilated by 1 px) are antialiasing; interior pixels differing by
// more than 48 in any channel are geometry errors.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

export interface Rgb {
  w: number;
  h: number;
  px: Uint8Array; // RGB, row-major
}

export function decodePng(buf: Buffer): Rgb {
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9]!;
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNG");
    } else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`PNG colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(w * h * 3);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!;
      line[i] = (line[i]! + pred) & 255;
    }
    for (let x = 0; x < w; x++) {
      const al = bpp === 4 ? line[x * 4 + 3]! / 255 : 1;
      for (let k = 0; k < 3; k++)
        px[(y * w + x) * 3 + k] = Math.round(line[x * bpp + k]! * al + 255 * (1 - al));
    }
    prev = line;
  }
  return { w, h, px };
}

function readPpm(buf: Buffer): Rgb {
  const head = buf.toString("latin1", 0, 64).split(/\s+/);
  const w = Number(head[1]);
  const h = Number(head[2]);
  return { w, h, px: new Uint8Array(buf.subarray(buf.length - w * h * 3)) };
}

const TOOL = join(import.meta.dirname, "../../../target/release/examples/render_compare");

/** resvg render of `svgPath` at w×h over white. */
export function resvgReference(svgPath: string, w: number, h: number): Rgb {
  const dir = mkdtempSync(join(tmpdir(), "vectra-resvg-"));
  try {
    const dummy = join(dir, "size.ppm");
    writeFileSync(
      dummy,
      Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), Buffer.alloc(w * h * 3, 255)]),
    );
    const outPpm = join(dir, "ref.ppm");
    execFileSync(TOOL, [svgPath, dummy, outPpm], { stdio: "pipe" });
    return readPpm(readFileSync(outPpm));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface Comparison {
  pixels: number;
  geometryErrors: number;
  aaBand: number;
  pctOver32: number;
  maxDiff: number;
}

export function compare(ref: Rgb, test: Rgb): Comparison {
  if (ref.w !== test.w || ref.h !== test.h)
    throw new Error(`size mismatch: reference ${ref.w}×${ref.h}, render ${test.w}×${test.h}`);
  const { w, h } = ref;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Per-channel range over the 3×3 neighbourhood; the largest channel range decides.
      let range = 0;
      for (let k = 0; k < 3; k++) {
        let lo = 255;
        let hi = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const X = Math.min(w - 1, Math.max(0, x + dx));
            const Y = Math.min(h - 1, Math.max(0, y + dy));
            const v = ref.px[(Y * w + X) * 3 + k]!;
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        range = Math.max(range, hi - lo);
      }
      if (range > 24) edge[y * w + x] = 1;
    }
  const band = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!edge[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx;
          const Y = y + dy;
          if (X >= 0 && Y >= 0 && X < w && Y < h) band[Y * w + X] = 1;
        }
    }
  let geometryErrors = 0;
  let over32 = 0;
  let maxDiff = 0;
  let aaBand = 0;
  for (let i = 0; i < w * h; i++) {
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(ref.px[i * 3 + k]! - test.px[i * 3 + k]!));
    maxDiff = Math.max(maxDiff, d);
    if (d > 32) over32++;
    if (band[i]) aaBand++;
    else if (d > 48) geometryErrors++;
  }
  return {
    pixels: w * h,
    geometryErrors,
    aaBand,
    pctOver32: +((100 * over32) / (w * h)).toFixed(3),
    maxDiff,
  };
}
