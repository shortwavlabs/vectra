// P0-R-G2 acceptance: offline cancellation, crash and recycling recovery in Chromium, Firefox
// and Playwright WebKit (not Safari). Production build only (the service worker is
// registered in production builds).
import { readFileSync } from "node:fs";
import { expect, type BrowserContext, type Page, type Request, test } from "@playwright/test";
import {
  fixture,
  lastResult,
  selectMode,
  shownRequest,
  uploadGenerated,
  waitForState,
  writeOutput,
} from "./helpers.ts";

const TOKEN = "PRIVATE-offline-4d1b";

async function openOffline(page: Page, context: BrowserContext, query = "?debug=1") {
  await page.goto(`/${query}`);
  await expect(page.getByTestId("offline-ready")).toHaveText("Offline-ready.", { timeout: 30_000 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as unknown as { __vectra?: { ready?: unknown } }).__vectra?.ready),
      ),
    )
    .toBe(true);
  await context.setOffline(true);
}

function recordRequests(context: BrowserContext) {
  const log: {
    url: string;
    method: string;
    bodyBytes: number;
    fromServiceWorker: boolean | null;
  }[] = [];
  const pending: Promise<void>[] = [];
  context.on("request", (r: Request) => {
    const entry = {
      url: r.url(),
      method: r.method(),
      bodyBytes: r.postDataBuffer()?.length ?? 0,
      fromServiceWorker: null as boolean | null,
    };
    log.push(entry);
    pending.push(
      r.response().then(
        (res) => void (entry.fromServiceWorker = res?.fromServiceWorker() ?? false),
        () => void (entry.fromServiceWorker = false),
      ),
    );
  });
  return { log, settle: () => Promise.all(pending) };
}

async function startLargeJobAndCancel(page: Page, n: number) {
  await selectMode(page, "color");
  await uploadGenerated(page, {
    width: 3000,
    height: 3000,
    type: "image/jpeg",
    name: `${TOKEN}-${n}.jpg`,
    baseJpeg: "external/talbot-scene-in-a-library-640.jpg",
  });
  await waitForState(page, "processing");
  await page.getByTestId("cancel").click();
  await waitForState(page, "cancelled");
}

async function download(page: Page, testId: string): Promise<string> {
  const dl = page.waitForEvent("download");
  await page.getByTestId(testId).click();
  return (await (await dl).path())!;
}

test("offline: repeated cancel → recover → trace → export, with no network traffic", async ({
  page,
  context,
  browserName,
}) => {
  await openOffline(page, context);
  const net = recordRequests(context);
  const cycles = [];
  for (let n = 1; n <= 3; n++) {
    await startLargeJobAndCancel(page, n);
    const t0 = Date.now();
    await selectMode(page, "bw"); // re-traces the same (large) source on a fresh worker
    await waitForState(page, "done", 60_000);
    cycles.push({ cycle: n, cancelToResultMs: Date.now() - t0 });
  }
  const svg = readFileSync(await download(page, "download-svg"), "utf8");
  const pdf = readFileSync(await download(page, "download-pdf")).toString("latin1");
  expect(svg).toContain("<svg");
  for (const bad of ["<image", "<script", "foreignObject", "href="]) expect(svg).not.toContain(bad);
  expect(pdf.startsWith("%PDF-")).toBe(true);
  for (const bad of ["/Image", "/XObject", "/Font"]) expect(pdf).not.toContain(bad);

  // Stale results: rapid changes after recovery; only the final setting may be displayed.
  const slider = page.getByLabel(/^Threshold/);
  await slider.focus();
  for (let i = 0; i < 20; i++) await slider.press("ArrowLeft");
  await expect
    .poll(async () => (await shownRequest(page))?.settings.threshold, { timeout: 60_000 })
    .toBe(108);
  await waitForState(page, "done");

  await net.settle();
  const stats = (await lastResult(page)).stats;
  writeOutput(
    `offline-recovery/${browserName}-cycles.json`,
    JSON.stringify({ cycles, stats, requests: net.log }, null, 2),
  );
  expect(stats.terminations).toBeGreaterThanOrEqual(3);
  expect(stats.workersCreated).toBeGreaterThanOrEqual(4);
  for (const r of net.log) {
    expect(r.method === "GET" || r.url.startsWith("blob:"), JSON.stringify(r)).toBe(true);
    expect(r.bodyBytes).toBe(0);
    expect(r.url).not.toContain(TOKEN);
    expect(r.url).not.toMatch(/threshold|talbot/i);
    // Every non-blob request while offline was answered by the service worker cache.
    if (!r.url.startsWith("blob:") && !r.url.startsWith("data:"))
      expect(r.fromServiceWorker, JSON.stringify(r)).toBe(true);
  }
});

async function nextResult(page: Page, before: number) {
  await expect
    .poll(async () => (await lastResult(page)).results ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(before);
  await waitForState(page, "done");
}

test("offline: an injected worker crash recovers on the next job", async ({ page, context }) => {
  // A crash injected by message is delivered only while the worker is idle: a worker blocked in
  // synchronous WASM handles messages after the call returns. Crashes during a job (e.g. a WASM
  // abort) take the same client path and are covered by the client unit tests.
  await openOffline(page, context);
  await page.getByTestId("file").setInputFiles(fixture("procedural/nested_rings.png"));
  await waitForState(page, "done");
  for (const mode of ["color", "bw", "limited"]) {
    const before = (await lastResult(page)).results ?? 0;
    await page.evaluate(() =>
      (window as unknown as { __vectra: { crashWorker(): boolean } }).__vectra.crashWorker(),
    );
    await expect.poll(async () => (await lastResult(page)).stats.terminations).toBeGreaterThan(0);
    await selectMode(page, mode);
    await nextResult(page, before);
  }
  const stats = (await lastResult(page)).stats;
  expect(stats.terminations).toBeGreaterThanOrEqual(3);
  expect(stats.workersCreated).toBeGreaterThanOrEqual(4);
});

test("offline: worker recycling after every job keeps working", async ({
  page,
  context,
  browserName,
}) => {
  await openOffline(page, context, "?recycleMiB=1");
  await page.getByTestId("file").setInputFiles(fixture("procedural/circle.png"));
  await nextResult(page, 0);
  for (const mode of ["color", "limited", "halftone", "bw"]) {
    const before = (await lastResult(page)).results ?? 0;
    await selectMode(page, mode);
    await nextResult(page, before);
  }
  const stats = (await lastResult(page)).stats;
  writeOutput(`offline-recovery/${browserName}-recycling.json`, JSON.stringify(stats, null, 2));
  expect(stats.terminations).toBeGreaterThanOrEqual(5);
  expect(stats.workersCreated).toBeGreaterThanOrEqual(5);
});
