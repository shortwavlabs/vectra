// Correctness of browser renders against an independent reference rasterizer (resvg/tiny-skia
// via the existing `render_compare` example; no browser involved). Distinguishes antialiasing
// differences (within the reference's edge band, dilated 1 px) from geometry errors (interior
// pixels that differ strongly). Usage:
//   node compare-renders.mjs > out.json   (reads tests/output/rfc-002-review/correctness/*.png)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync, crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const dir = `${root}tests/output/rfc-002-review/correctness/`;
const tool = `${root}target/release/examples/render_compare`;
const svgPath = (name) =>
  [`${root}tests/output/rfc-002-review/scenes/${name}.svg`, `${root}tests/output/native/${name}.svg`, `${root}tests/output/regression-a4cf172/${name}.svg`].find(existsSync);

export function decodePng(buf) {
  let p = 8, w, h, ct, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNG");
    } else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : null;
  if (!bpp) throw new Error(`colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 3);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) {
      // Composite over white if RGBA (screenshots are opaque; this is a safeguard).
      const al = bpp === 4 ? line[x * 4 + 3] / 255 : 1;
      for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = Math.round(line[x * bpp + k] * al + 255 * (1 - al));
    }
    prev = line;
  }
  return { w, h, rgb: out };
}

function encodePng(w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const refs = new Map();
function reference(name, w, h) {
  const key = `${name}@${w}x${h}`;
  if (refs.has(key)) return refs.get(key);
  const white = `${dir}white-${w}x${h}.ppm`, out = `${dir}ref-${name}-${w}x${h}.ppm`;
  writeFileSync(white, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), Buffer.alloc(w * h * 3, 255)]));
  execFileSync(tool, [svgPath(name), white, out]);
  const b = readFileSync(out);
  let i = 0, fields = [];
  while (fields.length < 4) {
    while (b[i] <= 32) i++;
    const s = i;
    while (b[i] > 32) i++;
    fields.push(b.toString("latin1", s, i));
  }
  const ref = { w, h, rgb: b.subarray(i + 1) };
  refs.set(key, ref);
  return ref;
}

export function compare(ref, cand) {
  const { w, h } = ref, R = ref.rgb, Cd = cand.rgb, n = w * h;
  const edge = new Uint8Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let lo = [255, 255, 255], hi = [0, 0, 0];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let k = 0; k < 3; k++) {
            const v = R[(yy * w + xx) * 3 + k];
            lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
          }
        }
      if (hi.some((v, k) => v - lo[k] > 24)) edge[y * w + x] = 1;
    }
  const band = new Uint8Array(n); // edge mask dilated by 1 px
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (edge[y * w + x]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) band[yy * w + xx] = 1;
      }
  let sum = 0, over32 = 0, geom = 0, bandPx = 0, maxInterior = 0;
  const vis = Buffer.alloc(n * 3, 255);
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let k = 0; k < 3; k++) {
      const v = Math.abs(R[i * 3 + k] - Cd[i * 3 + k]);
      sum += v;
      d = Math.max(d, v);
    }
    if (d > 32) over32++;
    if (band[i]) bandPx++;
    else {
      maxInterior = Math.max(maxInterior, d);
      if (d > 48) {
        geom++;
        vis[i * 3] = 255; vis[i * 3 + 1] = 0; vis[i * 3 + 2] = 0;
        continue;
      }
    }
    if (d > 32) { vis[i * 3] = 255; vis[i * 3 + 1] = 170; vis[i * 3 + 2] = 0; }
  }
  return { w, h, meanAbsDiff: +(sum / (n * 3)).toFixed(3), pctOver32: +((100 * over32) / n).toFixed(3),
    aaBandPct: +((100 * bandPx) / n).toFixed(2), geometryErrorPx: geom, maxInteriorDiff: maxInterior, vis };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const re = /^(chromium|firefox|webkit)-(canvas|svgdom|svgimg|webgl|offscreen)-(.+)-z([\d.]+)\.png$/;
  const rows = [];
  for (const f of readdirSync(dir).sort()) {
    const m = f.match(re);
    if (!m) continue;
    const cand = decodePng(readFileSync(dir + f));
    const ref = reference(m[3], cand.w, cand.h);
    const { vis, ...r } = compare(ref, cand);
    if (r.geometryErrorPx > 0) writeFileSync(`${dir}diff-${f}`, encodePng(cand.w, cand.h, vis));
    rows.push({ engine: m[1], renderer: m[2], scene: m[3], zoom: Number(m[4]), ...r });
    console.error(f, `geomErr ${r.geometryErrorPx}px  >32: ${r.pctOver32}%  mean ${r.meanAbsDiff}`);
  }
  console.log(JSON.stringify(rows, null, 1));
}
