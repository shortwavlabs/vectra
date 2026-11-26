// G-BRAND in real Safari (macOS; Safari > Develop > Allow Remote Automation):
//   pnpm run build && node tests/safari/brand.mjs [hold-seconds]
// 1. Favicon: the workspace and the workbench open in two tabs; their icons resolve to the built
//    assets, and the window is held for `hold-seconds` so Safari's own tab strip (outside
//    WebDriver screenshots) can be captured externally, for example with a window screenshot.
// 2. Offline recovery page: after the workspace is offline-ready, its shell is evicted from the
//    service-worker cache and the origin is made unreachable; a navigation must then get the
//    worker's static recovery page, carrying the canonical symbol. Its screenshot is saved.
// Results: tests/output/safari/brand.json and brand-recovery.png.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DIST, ROOT, serve } from "./support.mjs";
import { Safari } from "./webdriver.mjs";

const OUT = join(ROOT, "tests/output/safari");
const HOLD = Number(process.argv[2] ?? "0");
const report = { loadavgStart: loadavg(), checks: [] };
const ok = (label, pass, detail) => {
  report.checks.push({ label, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : `: ${JSON.stringify(detail)}`}`);
};
const site = await serve(DIST);
let s;
try {
  s = await Safari.open();
  report.safari = s.capabilities?.browserVersion;
  await s.setWindowRect(1280, 800);
  await s.navigate(`${site.origin}/workspace.html`);
  await s.waitFor(
    () => document.querySelector("[data-testid=offline-status]")?.dataset.state === "ready",
    { timeout: 60_000, label: "offline ready" },
  );
  report.page = await s.exec(() => ({
    visibility: document.visibilityState,
    title: document.title,
  }));
  // Every icon and the manifest the page declares resolve to built files, with real types.
  const links = await s.exec(() =>
    [
      ...document.querySelectorAll(
        'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]',
      ),
    ].map((l) => ({ rel: l.rel, href: l.href })),
  );
  const fetched = await s.execAsync(
    async (hrefs) => {
      const out = [];
      for (const h of hrefs) {
        const r = await fetch(h);
        out.push({ href: h, status: r.status, type: r.headers.get("content-type") });
      }
      return out;
    },
    links.map((l) => l.href),
  );
  ok(
    "favicon, Apple touch icon and manifest links resolve (200, real types)",
    links.length >= 4 &&
      fetched.every((f) => f.status === 200 && f.type && !/octet-stream|text\/html/.test(f.type)),
    fetched,
  );
  const symbol = readFileSync(join(ROOT, "branding/vectra-symbol.svg"), "utf8");
  // 1. Two tabs for the tab strip: the workspace and the workbench.
  // The handle order of GET /window/handles is not the tab order: keep the original handle and
  // use the one newTab returns.
  const original = await s.cmd("GET", "/window");
  const tab = await s.newTab();
  await s.switchTo(tab);
  await s.navigate(`${site.origin}/index.html`);
  await s.waitFor(() => document.readyState === "complete", { label: "workbench loaded" });
  await s.switchTo(original);
  report.tabs = { workspace: original, workbench: tab };
  if (HOLD > 0) {
    console.log(`HOLD ${HOLD}s: capture Safari's tab strip now`);
    await sleep(HOLD * 1000);
  }
  // 2. The recovery page: evict the workspace shell, take the origin down, navigate.
  const evicted = await s.execAsync(async () => {
    const key = (await caches.keys()).find((k) => k.startsWith("vectra-"));
    return (await caches.open(key)).delete(new URL("./workspace.html", location.href).href);
  });
  ok("workspace shell evicted from the service-worker cache", evicted, { evicted });
  site.down = true;
  await s.navigate(`${site.origin}/workspace.html`);
  await s.waitFor(() => Boolean(document.querySelector("[data-testid=sw-recovery]")), {
    timeout: 30_000,
    label: "recovery page",
  });
  const rec = await s.exec(() => {
    const b = document.querySelector("[data-testid=sw-recovery]");
    const svg = b.querySelector("svg");
    return {
      reason: b.dataset.reason,
      version: b.dataset.version,
      svgViewBox: svg?.getAttribute("viewBox") ?? null,
      svgPaths: svg ? svg.querySelectorAll("path").length : 0,
      text: b.innerText.slice(0, 200),
    };
  });
  ok(
    "offline recovery page served, with the canonical symbol",
    rec.reason === "offline" &&
      rec.svgViewBox === "0 13 453 343" &&
      rec.svgPaths >= 3 &&
      symbol.includes('viewBox="0 13 453 343"'),
    rec,
  );
  report.recovery = rec;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "brand-recovery.png"), await s.screenshot());
} catch (e) {
  ok("harness", false, String(e?.stack ?? e));
} finally {
  report.loadavgEnd = loadavg();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "brand.json"), JSON.stringify(report, null, 2));
  await s?.quit();
  site.close();
}
const failed = report.checks.filter((c) => !c.pass).length;
console.log(
  `${report.checks.length - failed}/${report.checks.length} passed (Safari ${report.safari ?? "?"})`,
);
process.exit(failed ? 1 : 0);
