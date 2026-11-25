// G-R1 §6.1: the workspace (workspace.html) uses the G-JOB build-aware offline lifecycle.
// "Offline ready" only when the controlling worker caches this page's build; a waiting update
// and a mismatched build are separate notices; nothing forces a reload. Covered here on the
// workspace: offline reload, compute and render worker recovery offline, a deploy while an old
// workspace tab is open (next to an old workbench tab), a template-only update, cache eviction
// (recovery and repair), and a first-install claim by another build's worker.
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  checkForUpdate,
  DIST,
  evictShell,
  makeBuild2,
  recoveryReason,
  serve,
  type Site,
  templateOnlyVariant,
} from "./sw-site.ts";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/procedural");

let build2 = "";
test.beforeAll(() => {
  build2 = makeBuild2();
});
test.afterAll(() => rmSync(build2, { recursive: true, force: true }));

type Probe = {
  canvas: {
    crash(): boolean;
    diag(): { client: { lastRecoveryMs: number | null; buildMismatches: number } } | null;
  };
  workspace: { crashCompute(): boolean; jobsDiag(): Record<string, number> };
};
// Explicit evaluations: the production CSP forbids evaluating strings in the page.
const v = (page: Page) => ({
  crashRender: () =>
    page.evaluate(() => (window as unknown as { __vectra: Probe }).__vectra.canvas.crash()),
  canvasDiag: () =>
    page.evaluate(() => (window as unknown as { __vectra: Probe }).__vectra.canvas.diag()),
  crashCompute: () =>
    page.evaluate(() =>
      (window as unknown as { __vectra: Probe }).__vectra.workspace.crashCompute(),
    ),
  workersCreated: () =>
    page.evaluate(
      () =>
        (window as unknown as { __vectra: Probe }).__vectra.workspace.jobsDiag().workersCreated!,
    ),
});

async function openWorkspace(context: BrowserContext, site: Site) {
  const page = await context.newPage();
  await page.goto(`${site.origin}/workspace.html?debug=1`);
  await expect(page.getByTestId("offline-status")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  return page;
}

async function importFile(page: Page, file: string) {
  await page.getByTestId("import-input").setInputFiles(join(FIXTURES, file));
  await expect(page.getByTestId("status")).toContainText(`Traced ${file}`, { timeout: 90_000 });
  await expect(page.getByTestId("canvas-state")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

/** Crashes the render worker; a new one must present the document again. */
async function recoverRenderer(page: Page) {
  expect(await v(page).crashRender()).toBe(true);
  await expect
    .poll(async () => (await v(page).canvasDiag())?.client.lastRecoveryMs ?? null, {
      timeout: 30_000,
    })
    .not.toBeNull();
  await expect(page.getByTestId("canvas-state")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  // A healthy render worker again: disclosed by the state attributes, silent in the status bar.
  await expect(page.getByTestId("canvas-state")).toHaveAttribute("data-host", "worker");
  await expect(page.getByTestId("canvas-state")).toHaveText("");
  expect((await v(page).canvasDiag())?.client.buildMismatches).toBe(0);
}

const close = (site: Site) => {
  site.server.close();
  rmSync(site.root, { recursive: true, force: true });
};

test("offline: the workspace reloads, imports, and recreates both workers from its cache", async ({
  browser,
}) => {
  const site = await serve(DIST);
  const context = await browser.newContext();
  try {
    const page = await openWorkspace(context, site);
    await importFile(page, "adjacent_colors.png");
    // Unreachable server (Firefox's offline emulation does not cover service-worker fetches).
    await context.setOffline(true);
    site.down = true;
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("offline-status")).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("document-title")).toHaveText("No document");
    await importFile(page, "nested_rings.png"); // compute worker and WASM from the cache
    await recoverRenderer(page); // a new render worker from the cache
    const created = await v(page).workersCreated();
    expect(await v(page).crashCompute()).toBe(true);
    await importFile(page, "adjacent_colors.png"); // a new compute worker from the cache
    expect(await v(page).workersCreated()).toBeGreaterThan(created);
    await expect(page.getByTestId("layer-row")).toHaveCount(2);
  } finally {
    await context.close();
    close(site);
  }
});

test("a deploy while old workspace and workbench tabs are open: both keep their build; the update waits; no reload", async ({
  browser,
}) => {
  const site = await serve(DIST);
  const context = await browser.newContext();
  try {
    const page = await openWorkspace(context, site);
    const bench = await context.newPage();
    await bench.goto(`${site.origin}/?debug=1`);
    await expect(bench.getByTestId("offline-ready")).toHaveText("Offline-ready.", {
      timeout: 30_000,
    });
    await importFile(page, "adjacent_colors.png");
    await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
    site.deploy(build2); // the server now has only build 2: build 1 lives only in the cache
    await checkForUpdate(page);
    await expect(page.getByTestId("update-waiting")).toBeVisible({ timeout: 30_000 });
    await expect(bench.getByTestId("update-waiting")).toBeVisible({ timeout: 30_000 });
    // Distinct from a mismatch: this tab's own build still controls it, so it stays offline ready.
    await expect(page.getByTestId("offline-status")).toHaveAttribute("data-state", "ready");
    // No reload happened, and the document is untouched.
    expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);
    await expect(page.getByTestId("layer-row")).toHaveCount(1);
    // The old tab keeps working on build 1 from its cache: both workers can be recreated.
    await recoverRenderer(page);
    expect(await v(page).crashCompute()).toBe(true);
    await importFile(page, "nested_rings.png");
    await expect(page.getByTestId("layer-row")).toHaveCount(2);
  } finally {
    await context.close();
    close(site);
  }
});

test("a template-only update waits behind an open workspace tab, which stays offline ready", async ({
  browser,
}) => {
  const variant = templateOnlyVariant();
  const site = await serve(DIST);
  const context = await browser.newContext();
  try {
    const page = await openWorkspace(context, site);
    await importFile(page, "adjacent_colors.png");
    site.deploy(variant); // same application files, a different worker template
    await checkForUpdate(page);
    await expect(page.getByTestId("update-waiting")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("offline-status")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("layer-row")).toHaveCount(1);
  } finally {
    await context.close();
    close(site);
    rmSync(variant, { recursive: true, force: true });
  }
});

test("an evicted workspace shell: another build's shell is never served; an identical build repairs it", async ({
  browser,
}) => {
  const site = await serve(DIST);
  const context = await browser.newContext();
  try {
    const page = await openWorkspace(context, site);
    // Identical build on the network: the shell is repaired.
    expect(await evictShell(page, "workspace.html")).toBe(true);
    await page.reload();
    await expect(page.getByTestId("offline-status")).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    // Another build on the network: the recovery page, never build 2's shell.
    site.deploy(build2);
    expect(await evictShell(page, "workspace.html")).toBe(true);
    await page.reload();
    await expect.poll(() => recoveryReason(page), { timeout: 30_000 }).toBe("version");
    expect(await page.evaluate(() => "__vectra" in window)).toBe(false); // no app code ran
    // Offline, the same eviction gives the offline recovery page.
    await context.setOffline(true);
    site.down = true;
    await page.reload();
    await expect.poll(() => recoveryReason(page), { timeout: 30_000 }).toBe("offline");
  } finally {
    await context.close();
    close(site);
  }
});

test("a workspace claimed by another build's worker on first install says offline is unavailable", async ({
  browser,
}) => {
  const site = await serve(DIST);
  const context = await browser.newContext();
  try {
    site.holding.add("/sw.js"); // the registration waits while a deploy happens
    const page = await context.newPage();
    await page.goto(`${site.origin}/workspace.html?debug=1`);
    await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
    await expect.poll(() => site.hits.get("/sw.js") ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    site.deploy(build2);
    site.release();
    await expect(page.getByTestId("offline-status")).toHaveAttribute("data-state", "mismatch", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("offline-status")).toContainText("another version");
    await expect(page.getByTestId("update-waiting")).toHaveCount(0); // a separate notice
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  } finally {
    await context.close();
    close(site);
  }
});
