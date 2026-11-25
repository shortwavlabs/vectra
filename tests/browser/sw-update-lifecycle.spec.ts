// Single-build sessions across application updates (RFC-002 §15.3, TD-PLATFORM-006, G-JOB):
// old tabs after a new deploy, worker recreation in an old tab (online and offline), update
// announcement without a forced reload, cache invalidation, offline after the update, and an
// interrupted install. Build 2 is a genuinely different production build (different build ID,
// page, worker and WASM file names), and build 1's files are removed from the server when it
// is deployed, so an old tab can only work from its own cache.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { writeOutput } from "./helpers.ts";
import { api, COLOR, diag, jobId, loadSynthetic, outcome, waitForStage } from "./jobs-helpers.ts";
import {
  cacheEntries,
  cacheKeys,
  checkForUpdate,
  DIST,
  evictShell,
  makeBuild2,
  precachedFiles,
  recoveryReason,
  serve,
  swVersion,
  templateOnlyVariant,
  versionOf,
} from "./sw-site.ts";

let build2 = "";
test.beforeAll(() => {
  build2 = makeBuild2();
});
test.afterAll(() => rmSync(build2, { recursive: true, force: true }));

const buildIdOf = (page: Page) =>
  page.evaluate(
    () => (window as { __vectra?: { ready?: { buildId: string } } }).__vectra?.ready?.buildId,
  );
async function open(context: BrowserContext, url: string) {
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.getByTestId("offline-ready")).toHaveText("Offline-ready.", { timeout: 30_000 });
  await expect.poll(() => buildIdOf(page), { timeout: 30_000 }).toBeTruthy();
  return page;
}

/**
 * Terminates the worker (explicit cancel of a running trace), then traces on a new one. With
 * `churn`, five previews are submitted while the new worker loads (the TD-ARCH-006 pattern):
 * only the last runs, on exactly one new worker.
 */
async function recreateWorker(page: Page, churn = false) {
  const id = jobId(await api(page, "final", COLOR));
  await waitForStage(page, id, "segment");
  expect((await api<{ ok: boolean }>(page, "cancel", id)).ok).toBe(true);
  const before = await diag(page);
  const ids = await page.evaluate(
    (n) => {
      const j = (
        window as unknown as { __vectra: { jobs: { preview(o: unknown): { jobId: number } } } }
      ).__vectra.jobs;
      return Array.from(
        { length: n },
        (_, k) =>
          j.preview({
            settings: {
              mode: "bw",
              threshold: 140 - k * 10,
              invert: false,
              speckle: 16,
              alphaThreshold: 128,
            },
          }).jobId,
      );
    },
    churn ? 5 : 1,
  );
  const outs = await Promise.all(ids.map((j) => outcome(page, j)));
  expect(outs.at(-1)!.status, JSON.stringify(outs.at(-1))).toBe("succeeded");
  expect(outs.slice(0, -1).every((o) => o.status === "cancelled")).toBe(true);
  const after = await diag(page);
  expect(after.workersCreated).toBe((before.workersCreated as number) + 1);
  expect(after.startupFailures).toBe(before.startupFailures);
  expect(after.buildMismatches).toBe(0);
}

/** Crashes the render worker and waits until a new one presents the current snapshot. */
type RenderApi = {
  crash(): boolean;
  diag(): { client: { lastRecoveryMs: number | null; buildMismatches: number } };
};
const renderApi = (page: Page) => ({
  crash: () =>
    page.evaluate(() =>
      (window as unknown as { __vectra: { canvas: RenderApi } }).__vectra.canvas.crash(),
    ),
  diag: () =>
    page.evaluate(() =>
      (window as unknown as { __vectra: { canvas: RenderApi } }).__vectra.canvas.diag(),
    ),
});
async function recreateRenderWorker(page: Page) {
  const r = renderApi(page);
  expect(await r.crash()).toBe(true);
  await expect
    .poll(async () => (await r.diag()).client.lastRecoveryMs !== null, { timeout: 30_000 })
    .toBe(true);
  await expect(page.getByTestId("canvas-state")).toHaveText("Canvas: render worker", {
    timeout: 30_000,
  });
  expect((await r.diag()).client.buildMismatches).toBe(0);
}

test("an old tab keeps its build across a deploy; the update waits, then replaces the old cache", async ({
  browser,
  browserName,
}) => {
  const site = await serve(DIST);
  const context = await browser.newContext();
  const log: Record<string, unknown> = {};
  try {
    const old = await open(context, `${site.origin}/?debug=1`);
    const b1 = await buildIdOf(old);
    const v1 = await swVersion(old);
    await loadSynthetic(old);

    // Deploy build 2; build 1's files are gone from the server.
    site.deploy(build2);
    await checkForUpdate(old);
    await expect(old.getByTestId("update-waiting")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => cacheKeys(old), { timeout: 30_000 }).toHaveLength(2);
    expect(await swVersion(old)).toBe(v1); // not activated, not forced

    // The old tab recreates its worker from its own cache, online and offline, and a reload
    // keeps it on build 1 (navigation from the controlling version's cache).
    await recreateWorker(old);
    await context.setOffline(true);
    await recreateWorker(old, true); // start-up churn, offline, in an old tab after a deploy
    await recreateRenderWorker(old); // the render worker too, from the old version's cache
    await old.reload();
    await expect.poll(() => buildIdOf(old), { timeout: 30_000 }).toBe(b1);
    await loadSynthetic(old);
    await recreateWorker(old);
    await context.setOffline(false);
    await old.reload();
    await expect.poll(() => buildIdOf(old), { timeout: 30_000 }).toBe(b1);
    // A second tab opened now also gets build 1: the old version still has a page.
    const second = await open(context, `${site.origin}/?debug=1`);
    expect(await buildIdOf(second)).toBe(b1);

    // Close every build-1 page: the next visit activates build 2 and drops build 1's cache.
    await old.close();
    await second.close();
    const next = await open(context, `${site.origin}/?debug=1`);
    await expect.poll(() => buildIdOf(next), { timeout: 30_000 }).not.toBe(b1);
    const b2 = await buildIdOf(next);
    const v2 = await swVersion(next);
    await expect.poll(() => cacheKeys(next), { timeout: 30_000 }).toEqual([`vectra-${v2}`]);
    // Cache invalidation: build 1's worker is no longer served from any cache.
    const oldWorker = readdirSync(join(DIST, "assets")).find((f) =>
      f.startsWith("compute.worker-"),
    )!;
    expect(await next.evaluate(async (u) => (await fetch(u)).status, `./assets/${oldWorker}`)).toBe(
      404,
    );

    // Offline after the update: reload, trace and recreate the worker on build 2.
    await context.setOffline(true);
    await next.reload();
    await expect.poll(() => buildIdOf(next), { timeout: 30_000 }).toBe(b2);
    await loadSynthetic(next);
    await recreateWorker(next, true);
    Object.assign(log, { b1, b2, v1, v2, diag: await diag(next) });
  } finally {
    writeOutput(`g-job/${browserName}-update-lifecycle.json`, JSON.stringify(log, null, 2));
    await context.close();
    site.server.close();
    rmSync(site.root, { recursive: true, force: true });
  }
});

test("an interrupted install leaves the old version intact; a later install succeeds", async ({
  browser,
  browserName,
}) => {
  const site = await serve(DIST);
  const context = await browser.newContext();
  const log: Record<string, unknown> = {};
  try {
    const page = await open(context, `${site.origin}/?debug=1`);
    const b1 = await buildIdOf(page);
    const v1 = await swVersion(page);
    await loadSynthetic(page);

    site.deploy(build2);
    const wasm2 = `/assets/${readdirSync(join(build2, "assets")).find((f) => f.endsWith(".wasm"))}`;
    site.failing.add(wasm2);
    await checkForUpdate(page);
    await expect.poll(() => site.hits.get(wasm2) ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const r = await navigator.serviceWorker.getRegistration();
            return r!.installing === null && r!.waiting === null;
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect.poll(() => cacheKeys(page), { timeout: 30_000 }).toEqual([`vectra-${v1}`]); // no partial cache
    await expect(page.getByTestId("update-waiting")).toHaveCount(0);
    expect(await swVersion(page)).toBe(v1);

    // The old version still works, offline included.
    await context.setOffline(true);
    await recreateWorker(page);
    await page.reload();
    await expect.poll(() => buildIdOf(page), { timeout: 30_000 }).toBe(b1);
    await context.setOffline(false);

    // The network recovers: the next update check installs build 2 completely.
    site.failing.clear();
    await checkForUpdate(page);
    await expect(page.getByTestId("update-waiting")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => cacheKeys(page), { timeout: 30_000 }).toHaveLength(2);
    Object.assign(log, { b1, v1, caches: await cacheKeys(page) });
  } finally {
    writeOutput(`g-job/${browserName}-interrupted-install.json`, JSON.stringify(log, null, 2));
    await context.close();
    site.server.close();
    rmSync(site.root, { recursive: true, force: true });
  }
});

test("a service-worker-only update gets a new cache; its interrupted install leaves the live cache intact", async ({
  browser,
  browserName,
}) => {
  const variant = templateOnlyVariant();
  const site = await serve(DIST);
  const context = await browser.newContext();
  const log: Record<string, unknown> = {};
  try {
    const page = await open(context, `${site.origin}/?debug=1`);
    const b1 = await buildIdOf(page);
    const vA = await swVersion(page);
    const vB = versionOf(variant);
    expect(vB).not.toBe(vA); // identical application files, different template: new cache version
    await loadSynthetic(page);
    const before = await cacheEntries(page);
    expect(before).toEqual({ [`vectra-${vA}`]: precachedFiles() });

    // Deploy B; its install fails mid-way (the WASM request is cut).
    site.deploy(variant);
    const wasm = `/assets/${readdirSync(join(DIST, "assets")).find((f) => f.endsWith(".wasm"))}`;
    site.failing.add(wasm);
    const hitsBefore = site.hits.get(wasm) ?? 0;
    await checkForUpdate(page);
    await expect
      .poll(() => site.hits.get(wasm) ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(hitsBefore);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const r = await navigator.serviceWorker.getRegistration();
            return r!.installing === null && r!.waiting === null;
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    expect(await cacheEntries(page)).toEqual(before); // build A's cache untouched
    expect(await swVersion(page)).toBe(vA);

    // Build A keeps working offline: reload and worker recreation (with start-up churn).
    await context.setOffline(true);
    await page.reload();
    await expect.poll(() => buildIdOf(page), { timeout: 30_000 }).toBe(b1);
    await loadSynthetic(page);
    await recreateWorker(page, true);
    await context.setOffline(false);

    // The network recovers: B installs completely and waits.
    site.failing.clear();
    await checkForUpdate(page);
    await expect(page.getByTestId("update-waiting")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => cacheKeys(page), { timeout: 30_000 })
      .toEqual([`vectra-${vA}`, `vectra-${vB}`].sort());
    Object.assign(log, { vA, vB, before, after: await cacheEntries(page) });
  } finally {
    writeOutput(`g-job/${browserName}-sw-template-update.json`, JSON.stringify(log, null, 2));
    await context.close();
    site.server.close();
    rmSync(site.root, { recursive: true, force: true });
    rmSync(variant, { recursive: true, force: true });
  }
});

test("an evicted shell is never replaced by another build: recovery page; other tabs keep working", async ({
  browser,
  browserName,
}) => {
  const site = await serve(DIST);
  const context = await browser.newContext();
  const log: Record<string, unknown> = {};
  try {
    const tab = await open(context, `${site.origin}/?debug=1`);
    const other = await open(context, `${site.origin}/?debug=1`);
    const b1 = await buildIdOf(tab);
    await loadSynthetic(other);
    site.deploy(build2); // the server now has only build 2
    expect(await evictShell(tab)).toBe(true); // as if the browser evicted the shell entry
    await tab.reload();
    await expect.poll(() => recoveryReason(tab), { timeout: 30_000 }).toBe("version");
    await expect(tab.getByText("Other open Vectra tabs keep working")).toBeVisible();
    expect(await tab.evaluate(() => "__vectra" in window)).toBe(false); // no app code ran here
    // The other tab is unaffected: same build, worker recreation works.
    expect(await buildIdOf(other)).toBe(b1);
    await recreateWorker(other);
    // Offline, the same eviction gives the offline recovery page. (The server is made
    // unreachable: Playwright's Firefox offline emulation does not cover service-worker fetches.)
    await context.setOffline(true);
    site.down = true;
    await tab.reload();
    await expect.poll(() => recoveryReason(tab), { timeout: 30_000 }).toBe("offline");
    Object.assign(log, { b1, recovered: "version, offline" });
  } finally {
    writeOutput(`g-job/${browserName}-sw-evicted-shell.json`, JSON.stringify(log, null, 2));
    await context.close();
    site.server.close();
    rmSync(site.root, { recursive: true, force: true });
  }
});

test("an evicted shell is repaired from an identical build on the network", async ({ browser }) => {
  const site = await serve(DIST);
  const context = await browser.newContext();
  try {
    const page = await open(context, `${site.origin}/?debug=1`);
    const b1 = await buildIdOf(page);
    const entries = await cacheEntries(page);
    expect(await evictShell(page)).toBe(true);
    await page.reload();
    await expect.poll(() => buildIdOf(page), { timeout: 30_000 }).toBe(b1);
    await expect(page.getByTestId("offline-ready")).toHaveText("Offline-ready.", {
      timeout: 30_000,
    });
    expect(await cacheEntries(page)).toEqual(entries); // the shell is back in the cache
  } finally {
    await context.close();
    site.server.close();
    rmSync(site.root, { recursive: true, force: true });
  }
});

test("a page claimed by another build's worker on first install says it has no offline copy", async ({
  browser,
}) => {
  const site = await serve(DIST);
  const context = await browser.newContext();
  try {
    site.holding.add("/sw.js"); // the registration request waits while a deploy happens
    const page = await context.newPage();
    await page.goto(`${site.origin}/?debug=1`);
    await expect.poll(() => buildIdOf(page), { timeout: 30_000 }).toBeTruthy();
    const b1 = await buildIdOf(page);
    await expect.poll(() => site.hits.get("/sw.js") ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    site.deploy(build2);
    site.release();
    await expect(page.getByTestId("offline-mismatch")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("offline-ready")).not.toHaveText("Offline-ready.");
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    expect(await buildIdOf(page)).toBe(b1); // the page itself still runs build 1
  } finally {
    await context.close();
    site.server.close();
    rmSync(site.root, { recursive: true, force: true });
  }
});
