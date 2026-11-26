#!/usr/bin/env node
// G-BRAND: regenerates every derived brand file from the canonical master, deterministically.
//   node branding/generate.mjs        (from anywhere; needs the Rust toolchain for resvg)
// A re-run on the same machine is byte-identical: `git status --porcelain branding public`
// stays empty.
// - The five derived masters (three colour, two tonal) are the canonical file with its two
//   colours substituted, nothing else (same bytes once each #rrggbb is masked).
// - Every composition (favicon, icons, social) places a master's own markup, verbatim, in a
//   nested <svg> with the master's viewBox: coordinates are never retyped or rewritten.
// - Rasters come from branding/rasterize (resvg 0.50.0), which refuses a non-uniform scale and
//   reports each output's size and non-transparent bounding box; both are checked here.
// - Banner text: HarfBuzz hb-view (15.x) shapes it with only the vendored Inter files and writes
//   glyph outlines, placed here as paths: no <text> and no font in any output.
// - Small-size checks (evidence only) go to tests/output/g-brand/checks (ignored by git).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const b = (p) => join("branding", p);
const TMP = "tests/output/g-brand/svg";
const CHECKS = "tests/output/g-brand/checks";
for (const d of ["png", "social", "web", TMP, CHECKS].map((d) =>
  join(root, d.startsWith("tests") ? d : b(d)),
))
  mkdirSync(d, { recursive: true });
const read = (p) => readFileSync(join(root, p), "utf8");
const write = (p, data) => writeFileSync(join(root, p), data);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

// The approved symbol, byte-for-byte as supplied (1,004 bytes).
const CANONICAL_SHA256 = "fad9ae97a0a82349647f25b03283814c13700055f9a5da3c2521547333d7881a";
const canonical = read(b("vectra-symbol.svg"));
if (sha256(canonical) !== CANONICAL_SHA256)
  throw new Error("vectra-symbol.svg is not the approved master");

const CHARCOAL = "#191a1c";
const LIME = "#b9e87b";
const IVORY = "#eee8d8";
const VIEWBOX = [0, 13, 453, 343];
// The visible geometry is the viewBox inset by 16 units on every side (anchor strokes included),
// so its centre is the viewBox centre.
const GEOMETRY = { w: 421, h: 311 };

// 1. Masters: colour substitution only.
const masters = {
  "vectra-symbol.svg": canonical, // charcoal + lime, light backgrounds
  "vectra-symbol-ivory.svg": { [CHARCOAL]: IVORY, [LIME]: LIME }, // ivory + lime, dark backgrounds
  "vectra-symbol-mono-charcoal.svg": { [CHARCOAL]: CHARCOAL, [LIME]: CHARCOAL },
  "vectra-symbol-mono-ivory.svg": { [CHARCOAL]: IVORY, [LIME]: IVORY },
  // Tonal (approved at closure): one ink plus its 50 % RGB screen tint for the lime parts, so the
  // ribbon's two paths and the anchors stay distinct. Screen tints, not print-qualified separations.
  "vectra-symbol-tonal-charcoal.svg": { [CHARCOAL]: CHARCOAL, [LIME]: "#8c8d8e" }, // charcoal 50 % on white
  "vectra-symbol-tonal-ivory.svg": { [CHARCOAL]: IVORY, [LIME]: "#84817a" }, // ivory 50 % on charcoal
};
const masked = (svg) => svg.replace(/#[0-9a-f]{6}/g, "#------");
for (const [name, map] of Object.entries(masters)) {
  if (typeof map === "string") continue;
  masters[name] = canonical.replace(/#191a1c|#b9e87b/g, (c) => map[c]);
  write(b(name), masters[name]);
}
for (const [name, svg] of Object.entries(masters)) {
  if (masked(svg) !== masked(canonical)) throw new Error(`${name}: differs beyond its colours`);
  if (/<image|<text|<style|<font|@font-face|data:|href=/i.test(svg))
    throw new Error(`${name}: not vector-only`);
}

// 2. Compositions: a master (a name, or SVG text) placed, unchanged, at a given geometry width
// and centred.
const num = (n) => String(Math.round(n * 1000) / 1000);
const inner = (svg) =>
  svg
    .slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"))
    .replace(/\n\s*<title[^>]*>[^<]*<\/title>/, "");
const placements = {};
// The geometry's centre is (cx, cy); `extra` markup (banner text) follows the symbol, and its
// `ink` boxes join the placement that the safe-area checks read.
function compose(
  name,
  { w, h, master, geometryWidth, bg, radius = 0, cx = w / 2, cy = h / 2, extra = "", ink = [] },
) {
  const s = geometryWidth / GEOMETRY.w;
  const [bw, bh] = [VIEWBOX[2] * s, VIEWBOX[3] * s];
  const [x, y] = [cx - bw / 2, cy - bh / 2];
  const gw = GEOMETRY.w * s;
  const gh = GEOMETRY.h * s;
  const box = { x0: cx - gw / 2, y0: cy - gh / 2, x1: cx + gw / 2, y1: cy + gh / 2 };
  for (const k of ink)
    Object.assign(box, {
      x0: Math.min(box.x0, k.x0),
      y0: Math.min(box.y0, k.y0),
      x1: Math.max(box.x1, k.x1),
      y1: Math.max(box.y1, k.y1),
    });
  placements[name] = { w, h, ...box };
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    (bg
      ? `  <rect width="${w}" height="${h}"${radius ? ` rx="${num(radius)}"` : ""} fill="${bg}"/>\n`
      : "") +
    `  <svg x="${num(x)}" y="${num(y)}" width="${num(bw)}" height="${num(bh)}" viewBox="${VIEWBOX.join(" ")}">` +
    `${inner(masters[master] ?? master)}</svg>\n${extra}</svg>\n`;
  const path = join(TMP, `${name}.svg`);
  write(path, svg);
  return path;
}

// Badge: ivory + lime on charcoal, full bleed. The geometry is 58 % of the side, so its diagonal
// stays inside a circular crop (72 % of the radius) and the maskable 80 % safe zone.
const badge = (name, side) =>
  compose(name, {
    w: side,
    h: side,
    master: "vectra-symbol-ivory.svg",
    geometryWidth: 0.58 * side,
    bg: CHARCOAL,
  });
// Tile: the same on a rounded charcoal square, as large as small sizes need (favicon, "any" icons).
const tile = (name, side, master = "vectra-symbol-ivory.svg") =>
  compose(name, {
    w: side,
    h: side,
    master,
    geometryWidth: 0.84 * side,
    bg: CHARCOAL,
    radius: 0.1875 * side,
  });
// Banner text. The vendored fonts (branding/fonts/SOURCE.md) are checked byte for byte; hb-view
// must be HarfBuzz 15.x and give identical output twice.
const FONTS = {
  "Inter-Regular.ttf": "40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82",
  "Inter-SemiBold.ttf": "78a843fade9d4612a5567302fb595b56976eb5fcebf4fea5a5912d638bafcde3",
};
for (const [f, hash] of Object.entries(FONTS))
  if (sha256(readFileSync(join(root, b(`fonts/${f}`)))) !== hash)
    throw new Error(`branding/fonts/${f} is not the approved Inter 4.1 file`);
let HARFBUZZ;
try {
  const v = execFileSync("hb-view", ["--version"], { encoding: "utf8" });
  HARFBUZZ = /hb-view \(HarfBuzz\) (\d+\.\d+\.\d+)/.exec(v)?.[1];
} catch (e) {
  throw new Error(`hb-view (HarfBuzz 15.x) is required for the banners: ${e.message}`);
}
if (HARFBUZZ?.split(".")[0] !== "15")
  throw new Error(`hb-view: HarfBuzz 15.x required, found ${HARFBUZZ ?? "an unknown version"}`);

/** `text` shaped in `font`: glyph outlines (em = 1000 units, baseline y = 0) and the ink box. */
function shape(font, text) {
  const args = [
    `--font-file=${b(`fonts/${font}`)}`,
    "--font-size=1000",
    "--margin=0",
    "--background=none",
    "--output-format=svg",
    `--text=${text}`,
  ];
  const run = () => execFileSync("hb-view", args, { cwd: root, encoding: "utf8" });
  const svg = run();
  if (run() !== svg) throw new Error(`hb-view: output for "${text}" is not deterministic`);
  const outline = Object.fromEntries(
    [...svg.matchAll(/<g id="([^"]+)">\s*(?:<path d="([^"]*)"\/>)?\s*<\/g>/g)].map(([, id, d]) => [
      id,
      d ?? "",
    ]),
  );
  const uses = [...svg.matchAll(/<use xlink:href="#([^"]+)" x="([^"]+)" y="([^"]+)"\/>/g)];
  if (uses.length !== [...text].length || uses.some((u) => u[3] !== uses[0][3]))
    throw new Error(`hb-view: expected one glyph per character on one baseline for "${text}"`);
  const glyphs = uses.map(([, id, x]) => ({ d: outline[id], x: Number(x) }));
  const ink = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const g of glyphs) {
    const n = g.d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)?.map(Number) ?? [];
    for (let i = 0; i < n.length; i += 2)
      Object.assign(ink, {
        x0: Math.min(ink.x0, g.x + n[i]),
        y0: Math.min(ink.y0, n[i + 1]),
        x1: Math.max(ink.x1, g.x + n[i]),
        y1: Math.max(ink.y1, n[i + 1]),
      });
  }
  return { glyphs: glyphs.filter((g) => g.d), ink };
}
const WORDMARK = shape("Inter-SemiBold.ttf", "vectra");
const TAGLINE = shape("Inter-Regular.ttf", "From pixels to paths.");
const scale = (k) => String(Math.round(k * 1e6) / 1e6);
/** Outlines at `size` px, ink starting at x, baseline at y; the last glyph may take `lastFill`. */
function typeset({ glyphs, ink }, size, x, y, fill, lastFill = fill) {
  const k = size / 1000;
  const markup = glyphs
    .map(
      (g, i) =>
        `  <path fill="${i === glyphs.length - 1 ? lastFill : fill}" transform="translate(${num(x + (g.x - ink.x0) * k)} ${num(y)}) scale(${scale(k)})" d="${g.d}"/>\n`,
    )
    .join("");
  const box = { x0: x, y0: y + ink.y0 * k, x1: x + (ink.x1 - ink.x0) * k, y1: y + ink.y1 * k };
  return { markup, box };
}
// Banner: a horizontal lockup centred at (cx, h/2): the ivory + lime symbol (geometry H px high),
// then "vectra" (Inter SemiBold) over "From pixels to paths." (Inter Regular), ivory, with the
// tagline's full stop in lime. Sizes are fractions of H. Optical alignment: the span from the
// wordmark's ink top to the tagline's baseline is centred on the symbol (descenders hang).
function banner(name, w, h, H, cx = w / 2) {
  const gw = (H * GEOMETRY.w) / GEOMETRY.h;
  const [wordSize, tagSize, gap, lead] = [0.54 * H, 0.168 * H, 0.26 * H, 0.36 * H];
  const width = (t, size) => ((t.ink.x1 - t.ink.x0) * size) / 1000;
  const left = cx - (gw + gap + Math.max(width(WORDMARK, wordSize), width(TAGLINE, tagSize))) / 2;
  const ascent = (-WORDMARK.ink.y0 * wordSize) / 1000;
  const baseline = h / 2 - (ascent + lead) / 2 + ascent;
  const word = typeset(WORDMARK, wordSize, left + gw + gap, baseline, IVORY);
  const tag = typeset(TAGLINE, tagSize, left + gw + gap, baseline + lead, IVORY, LIME);
  const svg = read(
    compose(name, {
      w,
      h,
      master: "vectra-symbol-ivory.svg",
      geometryWidth: gw,
      bg: CHARCOAL,
      cx: left + gw / 2,
      extra:
        `  <!-- Text: Inter 4.1 (SIL OFL 1.1) shaped by HarfBuzz hb-view ${HARFBUZZ}, as outlines. -->\n` +
        word.markup +
        tag.markup,
      ink: [word.box, tag.box],
    }),
  );
  if (/<text|<image|<style|@font-face|font-family|data:/i.test(svg))
    throw new Error(`${name}: banner SVG must be paths only`);
  const out = b(`social/${name}-${w}x${h}.svg`);
  write(out, svg);
  return out;
}

// 3. Raster jobs: [svg, png, w, h].
const jobs = [];
for (const name of Object.keys(masters)) {
  const stem = name.replace(/\.svg$/, "");
  jobs.push([b(name), b(`png/${stem}-453x343.png`), 453, 343]);
  jobs.push([b(name), b(`png/${stem}-1812x1372.png`), 1812, 1372]);
}
jobs.push([badge("profile", 1024), b("social/profile-1024.png"), 1024, 1024]);
jobs.push([join(TMP, "profile.svg"), b("social/profile-512.png"), 512, 512]);
// Banners, by symbol geometry height: X 150, GitHub 210, YouTube 250 (59 % of its 423 px area).
jobs.push([banner("x-banner", 1500, 500, 150), b("social/x-banner-1500x500.png"), 1500, 500]);
jobs.push([
  banner("github-social", 1280, 640, 210),
  b("social/github-social-1280x640.png"),
  1280,
  640,
]);
jobs.push([
  banner("youtube-banner", 2560, 1440, 250),
  b("social/youtube-banner-2560x1440.png"),
  2560,
  1440,
]);

const favicon = tile("favicon", 512);
write(b("web/favicon.svg"), read(favicon));
for (const s of [16, 32]) jobs.push([b("web/favicon.svg"), b(`web/favicon-${s}.png`), s, s]);
for (const s of [192, 512]) jobs.push([b("web/favicon.svg"), b(`web/icon-${s}.png`), s, s]);
jobs.push([badge("apple-touch-icon", 180), b("web/apple-touch-icon.png"), 180, 180]);
jobs.push([badge("icon-maskable", 512), b("web/icon-maskable-512.png"), 512, 512]);

// Evidence only: the profile picture at avatar sizes, and the bare symbol at favicon sizes.
for (const s of [32, 48, 64])
  jobs.push([join(TMP, "profile.svg"), join(CHECKS, `profile-${s}.png`), s, s]);
for (const master of ["vectra-symbol.svg", "vectra-symbol-ivory.svg"]) {
  const stem = master.replace(/\.svg$/, "");
  const svg = compose(`${stem}-bare`, { w: 512, h: 512, master, geometryWidth: 0.94 * 512 });
  for (const s of [16, 32]) jobs.push([svg, join(CHECKS, `${stem}-bare-${s}.png`), s, s]);
}

// Evidence only: is an optical simplification by omission worth proposing at 16 px? The shipped
// tile without the control handles (no new coordinates), for comparison in the contact sheet.
const noHandles = masters["vectra-symbol-ivory.svg"].replace(
  /\n\s*<g id="control-handles"[\s\S]*?<\/g>/,
  "",
);
if (noHandles.includes("control-handles")) throw new Error("control handles not removed");
for (const s of [16, 32])
  jobs.push([
    tile("favicon-no-handles", 512, noHandles),
    join(CHECKS, `favicon-no-handles-${s}.png`),
    s,
    s,
  ]);

const out = execFileSync(
  "cargo",
  ["run", "--quiet", "--release", "--locked", "--manifest-path", b("rasterize/Cargo.toml")],
  { cwd: root, input: jobs.map((j) => j.join(" ")).join("\n") + "\n", encoding: "utf8" },
);
const reports = Object.fromEntries(
  out
    .trim()
    .split("\n")
    .map((l) => {
      const [path, size, , ...bbox] = l.split(" ");
      return [path, { size, bbox: bbox.map(Number) }];
    }),
);

// 4. Checks: exact sizes; transparent symbol exports keep the viewBox margin on every side
// (nothing clipped, nothing stretched); every composition's geometry lies inside its canvas.
const errors = [];
for (const [, png, w, h] of jobs) {
  const r = reports[png];
  if (r?.size !== `${w}x${h}`) errors.push(`${png}: ${r?.size} != ${w}x${h}`);
  const m = /-(\d+)x(\d+)\.png$/.exec(png);
  if (png.startsWith(b("png/")) && m) {
    const k = Number(m[1]) / VIEWBOX[2];
    const want = [16 * k, 16 * k, (16 + GEOMETRY.w) * k, (16 + GEOMETRY.h) * k];
    if (r.bbox.some((v, i) => Math.abs(v - want[i]) > 1))
      errors.push(`${png}: bbox ${r.bbox.join(" ")} != ${want.join(" ")} (±1 px)`);
  }
}
for (const [name, p] of Object.entries(placements))
  if (p.x0 < 0 || p.y0 < 0 || p.x1 > p.w || p.y1 > p.h)
    errors.push(`${name}: geometry outside the canvas`);
// Circular crops (profile, maskable): the geometry's corners stay inside 80 % of the side.
for (const name of ["profile", "icon-maskable", "apple-touch-icon"]) {
  const p = placements[name];
  if (Math.hypot(p.x1 - p.x0, p.y1 - p.y0) / 2 > 0.4 * p.w)
    errors.push(`${name}: outside the 80 % safe zone`);
}
// Banner safe areas, [x0, y0, x1, y1] in banner pixels: the content lies inside `inside` and
// clear of `avoid`.
// - X: the profile picture covers the bottom left (taken as x < 27 %, y > 60 %); 40 px margin.
// - GitHub: link previews crop the 2:1 preview to 1.91:1 (1222×640, centred); 40 px margin.
// - YouTube: the centred 1546×423 area is visible on every device.
const SAFE = {
  "x-banner": { inside: [40, 40, 1460, 460], avoid: [0, 300, 405, 500] },
  "github-social": { inside: [69, 40, 1211, 600] },
  "youtube-banner": { inside: [507, 508.5, 2053, 931.5] },
};
for (const [name, { inside, avoid }] of Object.entries(SAFE)) {
  const p = placements[name];
  if (p.x0 < inside[0] || p.y0 < inside[1] || p.x1 > inside[2] || p.y1 > inside[3])
    errors.push(`${name}: outside its safe area`);
  if (avoid && p.x0 < avoid[2] && p.x1 > avoid[0] && p.y0 < avoid[3] && p.y1 > avoid[1])
    errors.push(`${name}: under the avatar`);
  console.log(`${name}: lockup ${[p.x0, p.y0, p.x1, p.y1].map((v) => v.toFixed(1)).join(" ")}`);
}
if (errors.length) throw new Error("brand checks failed:\n  " + errors.join("\n  "));

// 5. favicon.ico: the 16 and 32 px PNGs, PNG-encoded ICO entries.
const entries = [16, 32].map((s) => ({
  s,
  png: readFileSync(join(root, b(`web/favicon-${s}.png`))),
}));
const head = Buffer.alloc(6 + 16 * entries.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(entries.length, 4);
let offset = head.length;
entries.forEach(({ s, png }, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e);
  head.writeUInt8(s, e + 1);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
write(b("web/favicon.ico"), Buffer.concat([head, ...entries.map((e) => e.png)]));

// 6. The shipped subset (public/ is precached by the service worker and hashed into the build ID).
for (const f of [
  "favicon.svg",
  "favicon.ico",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
])
  copyFileSync(join(root, b(`web/${f}`)), join(root, "public", f));

for (const [, png] of jobs)
  console.log(`${reports[png].size.padStart(9)}  ${png}  bbox ${reports[png].bbox.join(" ")}`);
console.log(
  `${jobs.length} rasters, ${Object.keys(masters).length - 1} derived masters, favicon.ico; banner text: Inter 4.1, HarfBuzz hb-view ${HARFBUZZ}; checks passed`,
);
