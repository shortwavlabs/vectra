// G-PRJ-R design prototype captures (prototypes/g-prj/home, dev server only; never built).
//   node scripts/g-prj/capture-mockups.mjs [--only state,state] [--skip-body]
//   (--skip-body keeps the committed composites; set EMBED_PROVENANCE_WITH=<impeccable> when they
//   are recaptured so their origin is embedded again)
// 1. Workspace body (the composite under the prototype's top bar): serves dist/ with `vp preview`
//    (runs `pnpm run build` only if dist/ is missing), opens /workspace.html?debug=1, loads the
//    renderer fixture tests/output/renderer-fixtures/multi-layer.vectra.b64 through the debug-only
//    `loadContainer` hook, and writes the page minus its own 44 px top bar to
//    prototypes/g-prj/home/composite/workspace-<w>x<h>[@2x].png (h = viewport height - 44).
//    Every workspace-state capture is therefore a COMPOSITE: the proposed top bar over the real
//    workspace showing a different fixture (multi-layer), not the Great Wave named in the bar.
// 2. States: starts the dev server, opens each state with ?capture=1 (Chromium), waits for every
//    image, opens the menu or popover a state is about (clicks only; any synthetic key presses
//    must be at least 50 ms apart), and writes docs/research/g-prj/mockups/v2/<name>.png plus
//    NOTES.txt (command, commit, browser version, the list). Fails on a page error, a console
//    error or a broken image. Kills only the servers it started.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

const SIZES = [
  [1024, 640],
  [1280, 720],
  [1366, 768],
  [1920, 1080],
];
const NARROW = [390, 844]; // narrow viewport check, not a mobile qualification
const STATES = [
  "empty",
  "populated",
  "recovery",
  "recovery-other",
  "library",
  "storage",
  "workspace",
  "unsaved",
  "history-budget",
  "conflict",
  "save-failed",
  "download-saved",
  "workspace-recovery-kept",
];
/** What a state is about, opened before the shot (a closed menu proves nothing). */
const PREPARE = {
  library: (p) => p.getByRole("button", { name: "More actions for Ring study" }).click(),
  workspace: (p) => p.getByRole("button", { name: "File", exact: true }).click(),
  "workspace-recovery-kept": (p) => p.getByRole("button", { name: /review/i }).click(),
  "save-failed": (p) => p.getByRole("button", { name: /details/i }).click(),
  "download-saved": (p) => p.getByRole("button", { name: /did it save/i }).click(),
};
const lastSave = (p) => p.getByLabel("Open last save").click();
const lastSaveInDialog = (p) => p.getByRole("dialog").getByLabel("Open last save").click();
/** Evidence beyond the state × size grid: the swapped preview, flags, and 200 % zoom. */
const EXTRAS = [
  { state: "recovery", variant: "last", w: 1280, h: 720, prepare: lastSave },
  { state: "recovery-other", variant: "last", w: 1280, h: 720, prepare: lastSaveInDialog },
  { state: "storage", variant: "safari", w: 1280, h: 720, query: "&engine=safari" },
  { state: "populated", variant: "storage-full", w: 1280, h: 720, query: "&storage=full" },
  // 200 % zoom of a 1366 × 768 screen: 683 × 384 CSS px at deviceScaleFactor 2.
  { state: "workspace", w: 683, h: 384, dsf: 2 },
  { state: "save-failed", w: 683, h: 384, dsf: 2 },
  { state: "workspace-recovery-kept", w: 683, h: 384, dsf: 2 },
];
const BODY_DIR = "prototypes/g-prj/home/composite";
const OUT = "docs/research/g-prj/mockups/v2";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? "");
};
const only = arg("--only")?.split(",");
const skipBody = process.argv.includes("--skip-body");

async function freePort(from) {
  for (let port = from; port < from + 50; port++) {
    const ok = await new Promise((resolve) => {
      const s = createServer()
        .once("error", () => resolve(false))
        .listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new Error(`no free port from ${from}`);
}

/** Starts `pnpm exec vp <args>` in its own process group, so stopping it stops its children. */
async function serve(args, url) {
  const child = spawn("pnpm", ["exec", "vp", ...args], { stdio: "ignore", detached: true });
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  };
  // node:http, not fetch: fetch refuses 4190 (a "bad port" in the Fetch standard).
  const up = () =>
    new Promise((resolve) =>
      get(url, (r) => (r.resume(), resolve(r.statusCode === 200))).on("error", () =>
        resolve(false),
      ),
    );
  for (let i = 0; i < 150; i++) {
    if (await up()) return stop;
    await sleep(200);
  }
  stop();
  throw new Error(`server did not start: ${url}`);
}

function watch(page, label) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${label}: ${m.text()}`));
  return errors;
}

const browser = await chromium.launch();
const stops = [];
process.on("SIGINT", () => {
  for (const s of stops) s();
  process.exit(130);
});
try {
  if (!skipBody) {
    if (!existsSync("dist/workspace.html"))
      execFileSync("pnpm", ["run", "build"], { stdio: "inherit" });
    mkdirSync(BODY_DIR, { recursive: true });
    const port = await freePort(4190);
    const base = `http://127.0.0.1:${port}`;
    stops.push(
      await serve(["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], base),
    );
    const b64 = readFileSync(
      "tests/output/renderer-fixtures/multi-layer.vectra.b64",
      "utf8",
    ).trim();
    for (const [w, h, dsf = 1] of [...SIZES, [683, 384, 2]]) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        deviceScaleFactor: dsf,
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      const errors = watch(page, `workspace ${w}x${h}`);
      await page.goto(`${base}/workspace.html?debug=1`);
      await page.waitForFunction(() => "__vectra" in window);
      await page.evaluate((s) => window.__vectra.workspace.loadContainer(s), b64);
      await page.waitForSelector('[data-testid="canvas-state"][data-state="ready"]', {
        state: "attached",
      });
      await page.waitForTimeout(1000);
      if (errors.length) throw new Error(errors.join("\n"));
      const path = `${BODY_DIR}/workspace-${w}x${h - 44}${dsf === 2 ? "@2x" : ""}.png`;
      await page.screenshot({ path, clip: { x: 0, y: 44, width: w, height: h - 44 } });
      // Origin provenance, as for every prototype raster (EMBED_PROVENANCE_WITH=<impeccable>).
      if (process.env.EMBED_PROVENANCE_WITH)
        execFileSync(
          process.env.EMBED_PROVENANCE_WITH,
          [
            "embed-prompt",
            path,
            "--prompt",
            "Origin: not generated. Screenshot of the production Vectra workspace (dist/, vp preview, /workspace.html?debug=1) with the multi-layer renderer fixture (tests/output/renderer-fixtures/multi-layer.vectra.b64) loaded through the debug-only loadContainer hook, its own 44 px top bar cropped off; captured by scripts/g-prj/capture-mockups.mjs (Playwright Chromium). The workspace body of a COMPOSITE under the G-PRJ-R prototype's top bar: it shows a different fixture than the project named in that bar.",
          ],
          { stdio: ["ignore", "inherit", "inherit"] },
        );
      console.error(`wrote ${path}`);
      await ctx.close();
    }
    stops.pop()();
  }

  mkdirSync(OUT, { recursive: true });
  const port = await freePort(5210);
  const base = `http://127.0.0.1:${port}/prototypes/g-prj/home/index.html`;
  stops.push(
    await serve(["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], base),
  );
  /** @type {{ state: string, w: number, h: number, dsf?: number, variant?: string, query?: string, prepare?: (p: import("@playwright/test").Page) => Promise<void> }[]} */
  const jobs = [
    ...STATES.flatMap((state) => SIZES.map(([w, h]) => ({ state, w, h }))),
    { state: "recovery", w: NARROW[0], h: NARROW[1] },
    { state: "empty", w: NARROW[0], h: NARROW[1] },
    ...EXTRAS,
  ].filter((j) => !only || only.includes(j.state));
  const failures = [];
  const written = [];
  for (const { state, w, h, dsf = 1, variant, query = "", prepare } of jobs) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: dsf,
    });
    const page = await ctx.newPage();
    const name = `${state}${variant ? `-${variant}` : ""}-${w}x${h}${dsf === 2 ? "@2x" : ""}`;
    const errors = watch(page, name);
    await page.goto(`${base}?state=${state}&capture=1${query}`);
    await page.waitForSelector("header");
    await page.waitForFunction(() =>
      [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    );
    await (prepare ?? PREPARE[state])?.(page);
    await page.waitForTimeout(400);
    const broken = await page.evaluate(() =>
      [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src),
    );
    if (broken.length) errors.push(`${name}: broken images ${broken.join(", ")}`);
    const path = `${OUT}/${name}.png`;
    await page.screenshot({ path });
    console.error(`wrote ${path}`);
    written.push(`${name}.png`);
    failures.push(...errors);
    await ctx.close();
  }
  if (!only)
    writeFileSync(
      `${OUT}/NOTES.txt`,
      [
        "G-PRJ-R prototype captures (v2, after the Impeccable refinement).",
        `Command: node scripts/g-prj/capture-mockups.mjs`,
        `Date: ${new Date().toISOString()}`,
        `Commit: ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()} (working tree may differ)`,
        `Browser: Playwright Chromium ${browser.version()}`,
        "Data: project names, times, sizes and states are synthetic; thumbnails are licensed fixture traces,",
        "rendered as the artboard at its true aspect (scripts/g-prj/render-thumbs.mjs).",
        "SYNTHETIC picture: great-wave-recovered.webp, Great Wave's 'Recovered changes' preview, is the same",
        "Hokusai trace with one vector edit (palette fill #efe5ca replaced by #f0cfa8: the sky recoloured).",
        "Workspace states are COMPOSITES: the proposed top bar over a production-build screenshot of the",
        "real workspace showing a different fixture (the multi-layer renderer fixture), not Great Wave.",
        "@2x: 683 x 384 CSS px at deviceScaleFactor 2 (200 % zoom of a 1366 x 768 screen).",
        "",
        ...written,
        "",
      ].join("\n"),
    );
  if (failures.length) throw new Error(`capture errors:\n${failures.join("\n")}`);
} finally {
  for (const s of stops) s();
  await browser.close();
}
