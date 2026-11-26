#!/usr/bin/env node
// G-BRAND evidence (headless Chromium): application screenshots from a running production build,
// header alignment measurements, and the brand contact sheet. Run after `pnpm run build` and
// `node branding/generate.mjs`, with a preview server of your own:
//   pnpm exec vp preview --host 127.0.0.1 --port 4195 --strictPort &
//   BASE=http://127.0.0.1:4195 node docs/research/g-brand/evidence.mjs
// Writes the full set to tests/output/g-brand/evidence (ignored by git); representative files are
// copied into docs/research/g-brand by hand.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "../../..");
const out = join(root, "tests/output/g-brand/evidence");
mkdirSync(out, { recursive: true });
const BASE = process.env.BASE ?? "http://127.0.0.1:4195";
const browser = await chromium.launch();

// 1. The workspace header at five desktop sizes: mark centred on the wordmark, decorative.
const SIZES = [
  [1024, 640],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
];
const header = [];
for (const [width, height] of SIZES) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${BASE}/workspace.html`);
  await page.getByText("Offline ready").waitFor({ timeout: 30_000 });
  await page.mouse.move(width / 2, height / 2);
  const top = page.getByRole("banner");
  const mark = top.locator('svg[viewBox="0 13 453 343"]');
  const word = top.getByText("vectra", { exact: true });
  const [m, w, bar] = [await mark.boundingBox(), await word.boundingBox(), await top.boundingBox()];
  header.push({
    viewport: `${width}x${height}`,
    mark: m,
    wordmark: w,
    bar,
    centreOffsetPx: +(m.y + m.height / 2 - (w.y + w.height / 2)).toFixed(3),
    markCentreInBarPx: +(m.y + m.height / 2 - (bar.y + bar.height / 2)).toFixed(3),
    gapPx: +(w.x - (m.x + m.width)).toFixed(3),
    ariaHidden: await mark.getAttribute("aria-hidden"),
    bannerAccessibleText: (await top.locator(":scope > div").first().innerText()).trim(),
    favicons: await page.$$eval(
      "link[rel~=icon], link[rel=apple-touch-icon], link[rel=manifest]",
      (ls) => ls.map((l) => `${l.rel} ${l.getAttribute("href")}`),
    ),
  });
  await page.screenshot({ path: join(out, `workspace-${width}x${height}.png`) });
  await page.screenshot({
    path: join(out, `header-${width}x${height}.png`),
    clip: { x: 0, y: 0, width: Math.min(width, 640), height: 44 },
  });
  await page.close();
}
// A 3× close-up of the wordmark (the mark's detail at its real size, magnified by the device).
{
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 3,
  });
  await page.goto(`${BASE}/workspace.html`);
  await page.getByText("Offline ready").waitFor({ timeout: 30_000 });
  await page.screenshot({
    path: join(out, "header-1366x768@3x.png"),
    clip: { x: 0, y: 0, width: 260, height: 44 },
  });
  await page.close();
}
// The landing page (the P0 workbench at /): unchanged apart from its icons and manifest.
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${BASE}/`);
  await page.getByTestId("offline-ready").getByText("Offline-ready.").waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(out, "landing-1366x768.png") });
  await page.close();
}
writeFileSync(join(out, "header-alignment.json"), JSON.stringify(header, null, 2) + "\n");

// 2. The contact sheet: every variant on light and dark, the social kit, the icons and the
// small-size checks (pixel-exact upscales), from the committed files.
const uri = (p) => {
  const type = p.endsWith(".svg") ? "image/svg+xml" : "image/png";
  return `data:${type};base64,${readFileSync(join(root, p)).toString("base64")}`;
};
const img = (p, w, extra = "") => `<img src="${uri(p)}" width="${w}" ${extra}>`;
const cell = (label, body, bg = "#fff", fg = "#191a1c") =>
  `<figure style="background:${bg};color:${fg}"><div class="art">${body}</div><figcaption>${label}</figcaption></figure>`;
const masters = [
  ["vectra-symbol.svg", "charcoal + lime (canonical)"],
  ["vectra-symbol-ivory.svg", "ivory + lime"],
  ["vectra-symbol-mono-charcoal.svg", "mono charcoal (solid)"],
  ["vectra-symbol-mono-ivory.svg", "mono ivory (solid)"],
  ["vectra-symbol-tonal-charcoal.svg", "tonal charcoal (screen tint)"],
  ["vectra-symbol-tonal-ivory.svg", "tonal ivory (screen tint)"],
];
const LIGHT = ["#ffffff", "#191a1c"];
const DARK = ["#191a1c", "#eeeef0"];
const PAPER = ["#eee8d8", "#191a1c"];
const checks = "tests/output/g-brand/checks";
const px = (p, s, k, extra = "") => img(p, s * k, `class="px" ${extra}`);
const tab = (bg, fg, icon) =>
  `<div class="tab" style="background:${bg};color:${fg}">${img(icon, 16)}<span>Vectra</span></div>`;
const sections = [
  [
    "Masters: colour, solid mono and tonal (colour substitution only) on light, ivory paper and dark",
    masters
      .flatMap(([f, label]) =>
        [LIGHT, PAPER, DARK].map(([bg, fg]) =>
          cell(`${label} on ${bg}`, img(`branding/${f}`, 180), bg, fg),
        ),
      )
      .join(""),
  ],
  [
    "Social kit (scaled to fit; dashed: YouTube 1546×423 safe area, X avatar zone)",
    [
      cell("profile-1024 (shown 256)", img("branding/social/profile-1024.png", 256)),
      cell(
        "profile-1024, circular crop",
        img("branding/social/profile-1024.png", 256, 'style="border-radius:50%"'),
      ),
      cell("profile-512", img("branding/social/profile-512.png", 256)),
      cell(
        "x-banner-1500x500 (shown 600; bottom-left: avatar overlap)",
        `<div class="ov">${img("branding/social/x-banner-1500x500.png", 600)}<i style="left:4%;bottom:-20%;width:21%;height:60%;border-radius:50%"></i></div>`,
      ),
      cell(
        "github-social-1280x640 (shown 512)",
        img("branding/social/github-social-1280x640.png", 512),
      ),
      cell(
        "youtube-banner-2560x1440 (shown 640)",
        `<div class="ov">${img("branding/social/youtube-banner-2560x1440.png", 640)}<i style="left:${(507 / 2560) * 100}%;top:${(508.5 / 1440) * 100}%;width:${(1546 / 2560) * 100}%;height:${(423 / 1440) * 100}%"></i></div>`,
      ),
    ].join(""),
  ],
  [
    "Profile picture at avatar sizes: 1×, circular crop, and 4× pixel-exact",
    [32, 48, 64]
      .map((s) =>
        cell(
          `profile at ${s} px`,
          `${img(`${checks}/profile-${s}.png`, s)} ${img(`${checks}/profile-${s}.png`, s, 'style="border-radius:50%"')} ${px(`${checks}/profile-${s}.png`, s, 4)} ${px(`${checks}/profile-${s}.png`, s, 4, 'style="border-radius:50%"')}`,
        ),
      )
      .join(""),
  ],
  [
    "Favicon (shipped tile): simulated tab strips at 1×, then 8× pixel-exact; bare symbol and handle omission for comparison",
    [
      cell(
        "simulated tabs, light and dark (favicon.svg at 16 CSS px)",
        `${tab("#ffffff", "#191a1c", "branding/web/favicon.svg")}${tab("#dee1e6", "#191a1c", "branding/web/favicon.svg")}${tab("#35363a", "#eeeef0", "branding/web/favicon.svg")}${tab("#202124", "#eeeef0", "branding/web/favicon.svg")}`,
      ),
      cell("favicon-16.png ×8", px("branding/web/favicon-16.png", 16, 8)),
      cell("favicon-32.png ×4", px("branding/web/favicon-32.png", 32, 4)),
      cell("check: tile without handles, 16 ×8", px(`${checks}/favicon-no-handles-16.png`, 16, 8)),
      cell(
        "check: bare canonical 16 ×8 on light",
        px(`${checks}/vectra-symbol-bare-16.png`, 16, 8),
        ...LIGHT,
      ),
      cell(
        "check: bare canonical 16 ×8 on dark",
        px(`${checks}/vectra-symbol-bare-16.png`, 16, 8),
        ...DARK,
      ),
      cell(
        "check: bare ivory 16 ×8 on light",
        px(`${checks}/vectra-symbol-ivory-bare-16.png`, 16, 8),
        ...LIGHT,
      ),
      cell(
        "check: bare ivory 32 ×4 on dark",
        px(`${checks}/vectra-symbol-ivory-bare-32.png`, 32, 4),
        ...DARK,
      ),
    ].join(""),
  ],
  [
    "App icons (dashed: maskable 80 % safe zone)",
    [
      cell("apple-touch-icon 180", img("branding/web/apple-touch-icon.png", 180)),
      cell(
        "apple-touch-icon, iOS-style corners",
        img("branding/web/apple-touch-icon.png", 180, 'style="border-radius:22%"'),
      ),
      cell("icon-192", img("branding/web/icon-192.png", 192)),
      cell("icon-512 (shown 256)", img("branding/web/icon-512.png", 256)),
      cell(
        "icon-maskable-512 (shown 256)",
        `<div class="ov">${img("branding/web/icon-maskable-512.png", 256)}<i style="left:10%;top:10%;width:80%;height:80%;border-radius:50%"></i></div>`,
      ),
      cell(
        "maskable, circle mask",
        img("branding/web/icon-maskable-512.png", 256, 'style="border-radius:50%"'),
      ),
    ].join(""),
  ],
];
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#d9d9d9;font:12px/1.4 system-ui,sans-serif;color:#191a1c;width:1952px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 8px}p{margin:0}
.grid{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}
figure{margin:0;padding:12px;border-radius:4px}figcaption{margin-top:6px}
.art{display:flex;gap:10px;align-items:center;flex-wrap:wrap;min-height:40px}
img{display:block}.px{image-rendering:pixelated}
.ov{position:relative}.ov i{position:absolute;border:2px dashed #ff4f4f;box-sizing:border-box}
.tab{display:flex;gap:8px;align-items:center;height:32px;padding:0 12px;border-radius:8px 8px 0 0;width:150px}
</style><h1>Vectra brand contact sheet (G-BRAND)</h1>
<p>Generated by docs/research/g-brand/evidence.mjs from the committed masters and branding/generate.mjs outputs. Captions are evidence labels, not brand typography.</p>
${sections.map(([h, body]) => `<h2>${h}</h2><div class="grid">${body}</div>`).join("")}`;
const sheet = await browser.newPage({ viewport: { width: 2000, height: 800 } });
await sheet.setContent(html);
await sheet.screenshot({ path: join(out, "contact-sheet.png"), fullPage: true });
await browser.close();
console.log(
  JSON.stringify(
    header.map((h) => [h.viewport, h.centreOffsetPx, h.markCentreInBarPx, h.gapPx, h.ariaHidden]),
  ),
);
console.log(`evidence written to ${out}`);
