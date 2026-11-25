// G-JOB adversarial qualification against the production build: scheduling under pressure,
// start-up timeout, crashes, duplicate/stale/wrong-generation messages, document replacement,
// export during concurrent edits, resource budgets, recycling, repeated worker recreation and
// mixed-version refusal. Chromium, Firefox and Playwright WebKit (not Safari).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { upload, waitForState, writeOutput } from "./helpers.ts";
import {
  api,
  bw,
  COLOR,
  diag,
  jobId,
  loadSynthetic,
  openWorkbench,
  outcome,
  type Sub,
  type Summary,
  waitForStage,
} from "./jobs-helpers.ts";

type Jobs = {
  preview(o?: unknown): Sub;
  final(o?: unknown): Sub;
  exportDocument(f: string): Sub;
  recolourAll(c: number): number;
  replaceDocument(): void;
};

const results: Record<string, unknown> = {};
test.afterAll(({ browserName }) => {
  writeOutput(`g-job/${browserName}-adversarial.json`, JSON.stringify(results, null, 2));
});

test("explicit jobs queue behind previews, never cancelled by them; priority then FIFO", async ({
  page,
  context,
}) => {
  await openWorkbench(page, context, false);
  await loadSynthetic(page);
  await outcome(page, jobId(await api(page, "final", bw(128)))); // a layer to export
  const ids = await page.evaluate(() => {
    const j = (window as unknown as { __vectra: { jobs: Jobs } }).__vectra.jobs;
    const bwS = (t: number) => ({
      settings: { mode: "bw", threshold: t, invert: false, speckle: 16, alphaThreshold: 128 },
    });
    return {
      p1: j.preview(bwS(100)).jobId!,
      f1: j.final(bwS(110)).jobId!,
      e1: j.exportDocument("svg").jobId!,
      f2: j.final(bwS(120)).jobId!,
      e2: j.exportDocument("pdf").jobId!,
      p2: j.preview(bwS(90)).jobId!,
    };
  });
  const o: Record<string, Summary> = {};
  for (const [k, id] of Object.entries(ids)) o[k] = await outcome(page, id);
  expect(o.p1!).toMatchObject({ status: "cancelled", reason: "preempted" });
  expect([o.f1!.status, o.f2!.status, o.e1!.status, o.e2!.status]).toEqual([
    "committed",
    "committed",
    "delivered",
    "delivered",
  ]);
  expect(o.p2!.status).toBe("succeeded");
  // f1 was running; then exports (priority) in FIFO order, then f2, then the preview.
  const order = Object.entries(o)
    .filter(([k]) => k !== "p1")
    .sort((a, b) => a[1].settledAt - b[1].settledAt)
    .map(([k]) => k);
  expect(order).toEqual(["f1", "e1", "e2", "f2", "p2"]);
  results.priorities = { order, outcomes: o };
});

test("queue saturation rejects the fifth waiting explicit job before acceptance", async ({
  page,
  context,
}) => {
  await openWorkbench(page, context, false);
  await loadSynthetic(page);
  const t0 = Date.now();
  const subs = await page.evaluate(() => {
    const j = (window as unknown as { __vectra: { jobs: Jobs } }).__vectra.jobs;
    const bwS = (t: number) => ({
      settings: { mode: "bw", threshold: t, invert: false, speckle: 16, alphaThreshold: 128 },
    });
    return [
      j.final(bwS(100)), // running
      j.final(bwS(101)),
      j.exportDocument("svg"),
      j.final(bwS(102)),
      j.exportDocument("pdf"), // 4 waiting
      j.final(bwS(103)), // refused
      j.preview(bwS(104)), // previews are never refused
    ];
  });
  expect(subs.slice(0, 5).every((s) => s.accepted)).toBe(true);
  expect(subs[5]).toMatchObject({ accepted: false, code: "busy" });
  expect(subs[5]!.message).toMatch(/cancel one or wait/);
  expect(subs[6]!.accepted).toBe(true);
  const reservedAtPeak = (await diag(page)).reservedBytes;
  const outs = await Promise.all(
    subs.filter((s) => s.accepted).map((s) => outcome(page, s.jobId!)),
  );
  expect(outs.map((x) => x.status)).toEqual([
    "committed",
    "committed",
    "delivered",
    "committed",
    "delivered",
    "succeeded",
  ]);
  const d = await diag(page);
  expect(d.rejectedBusy).toBe(1);
  expect(d.reservedBytes).toBe(0);
  results.saturation = { drainMs: Date.now() - t0, reservedAtPeak, rejectedBusy: d.rejectedBusy };
});

test("a worker that never starts in time is retried once, then fails with an actionable error", async ({
  page,
  context,
}) => {
  await openWorkbench(page, context, false);
  await page.goto("/?debug=1&startupTimeoutMs=1");
  await upload(page, "procedural/circle.png");
  await waitForState(page, "error");
  await expect(page.getByTestId("status")).toContainText("worker_startup_failed");
  await expect(page.getByTestId("status")).toContainText("offline");
  const r = await outcome(page, jobId(await api(page, "preview", bw(100))));
  expect(r).toMatchObject({ status: "failed", code: "worker_startup_failed" });
  const d = await diag(page);
  expect(d.startupTimeouts as number).toBeGreaterThanOrEqual(4);
  expect(d.startupRetries as number).toBeGreaterThanOrEqual(2);
  results.startupTimeout = d;
});

test("crash, fatal abort, duplicate, stale progress, late error and wrong generation", async ({
  page,
  context,
}) => {
  await openWorkbench(page, context, false);
  await upload(page, "procedural/circle.png");
  await waitForState(page, "done");
  await outcome(page, jobId(await api(page, "final", bw(128))));
  const digest = await api<string>(page, "documentDigest");
  const run = async (fault: string, o: unknown = bw(100), kind = "preview") => {
    await outcome(page, jobId(await api(page, "preview", bw(99)))); // a ready worker
    expect(await api<boolean>(page, "inject", fault)).toBe(true);
    return outcome(page, jobId(await api(page, kind, o)));
  };
  const d0 = await diag(page);
  expect(await run("crash-next-job", bw(100), "final")).toMatchObject({
    status: "failed",
    code: "worker_crashed",
  });
  expect(await run("fatal-next-job", bw(100), "final")).toMatchObject({
    status: "failed",
    code: "wasm_abort",
  });
  expect((await run("duplicate-next-result")).status).toBe("succeeded");
  expect((await run("stale-progress-after-next-result")).status).toBe("succeeded");
  expect((await run("late-error-after-next-result")).status).toBe("succeeded");
  await page.waitForTimeout(200); // the worker sends its late error 50 ms after the result
  expect(await run("wrong-generation-next-result")).toMatchObject({
    status: "failed",
    code: "protocol_error",
  });
  await page.waitForTimeout(200);
  const d1 = await diag(page);
  expect((d1.droppedResults as number) - (d0.droppedResults as number)).toBe(1);
  expect((d1.droppedProgress as number) - (d0.droppedProgress as number)).toBe(1);
  expect((d1.droppedErrors as number) - (d0.droppedErrors as number)).toBe(1);
  expect((d1.wrongGenerationDropped as number) - (d0.wrongGenerationDropped as number)).toBe(1);
  expect((d1.crashes as number) - (d0.crashes as number)).toBe(2); // crash + wrong generation
  expect((d1.fatalErrors as number) - (d0.fatalErrors as number)).toBe(1);
  // Failed explicit jobs changed nothing; the next one works.
  expect(await api<string>(page, "documentDigest")).toBe(digest);
  expect((await outcome(page, jobId(await api(page, "final", bw(128))))).status).toBe("committed");
  results.faults = { before: d0, after: d1 };
});

test("document replacement during a trace makes the result stale", async ({ page, context }) => {
  await openWorkbench(page, context, false);
  await upload(page, "procedural/circle.png");
  await waitForState(page, "done");
  const id = await page.evaluate(() => {
    const j = (window as unknown as { __vectra: { jobs: Jobs } }).__vectra.jobs;
    const s = j.final({
      settings: { mode: "bw", threshold: 128, invert: false, speckle: 16, alphaThreshold: 128 },
    });
    j.replaceDocument();
    return s.jobId!;
  });
  expect(await outcome(page, id)).toMatchObject({ status: "stale", reason: "document_replaced" });
  expect(await api<string[]>(page, "layerIds")).toEqual([]);
});

test("an export accepted before concurrent edits exports the frozen snapshot", async ({
  page,
  context,
}) => {
  await openWorkbench(page, context, false);
  await loadSynthetic(page);
  await outcome(page, jobId(await api(page, "final", bw(128))));
  const before = await outcome(page, jobId(await api(page, "exportDocument", "svg")));
  const ids = await page.evaluate(() => {
    const j = (window as unknown as { __vectra: { jobs: Jobs } }).__vectra.jobs;
    const long = j.final({
      settings: {
        mode: "color",
        colorPrecision: 6,
        layerDifference: 16,
        speckle: 4,
        compositing: "stacked",
        alphaThreshold: 128,
      },
    }).jobId!;
    const exp = j.exportDocument("svg").jobId!; // queued behind the long trace
    j.recolourAll(0x123456ff); // edits while the export waits
    return { long, exp };
  });
  const frozen = await outcome(page, ids.exp);
  await outcome(page, ids.long);
  const after = await outcome(page, jobId(await api(page, "exportDocument", "svg")));
  expect(frozen.status).toBe("delivered");
  expect(frozen.bytesDigest).toBe(before.bytesDigest);
  expect(after.bytesDigest).not.toBe(before.bytesDigest);
  expect((await diag(page)).snapshotRefs).toBe(0);
  results.frozenExport = {
    before: before.bytesDigest,
    frozen: frozen.bytesDigest,
    after: after.bytesDigest,
  };
});

test("resource budgets: refused before posting, or a typed engine failure; nothing committed", async ({
  page,
  context,
}) => {
  await openWorkbench(page, context, false);
  await loadSynthetic(page);
  const created = (await diag(page)).submitted;
  const refused = await api<Sub>(page, "final", { ...bw(128), maxPixels: 1000 });
  expect(refused).toMatchObject({ accepted: false, code: "resource_budget" });
  expect(refused.message).toMatch(/Reduce its resolution/);
  expect((await diag(page)).submitted).toBe(created); // never reached the scheduler
  const over = await outcome(page, jobId(await api(page, "final", { ...COLOR, maxAnchors: 10 })));
  expect(over).toMatchObject({ status: "failed", code: "too_many_primitives" });
  expect(await api<string[]>(page, "layerIds")).toEqual([]);
  results.budget = { refused, over };
});

test("worker recycling after every job keeps results and the document intact", async ({
  page,
  context,
}) => {
  await openWorkbench(page, context, false, "&recycleMiB=1");
  await upload(page, "procedural/nested_rings.png");
  await waitForState(page, "done");
  await outcome(page, jobId(await api(page, "final", bw(128))));
  const digest = await api<string>(page, "documentDigest");
  for (let k = 0; k < 4; k++)
    expect((await outcome(page, jobId(await api(page, "preview", bw(100 + k))))).status).toBe(
      "succeeded",
    );
  const d = await diag(page);
  expect(d.recycles as number).toBeGreaterThanOrEqual(5);
  expect(await api<string>(page, "documentDigest")).toBe(digest);
  results.recycling = d;
});

test("geometry, history and provenance survive repeated worker recreation (offline)", async ({
  page,
  context,
}) => {
  await openWorkbench(page, context, true);
  await loadSynthetic(page);
  await outcome(page, jobId(await api(page, "final", bw(128))));
  await outcome(page, jobId(await api(page, "final", bw(100))));
  const digest = await api<string>(page, "documentDigest");
  const created0 = (await diag(page)).workersCreated as number;
  for (let k = 0; k < 6; k++) {
    const id = jobId(await api(page, "final", COLOR));
    await waitForStage(page, id, "segment");
    await api(page, "cancel", id);
    await outcome(page, jobId(await api(page, "preview", bw(90 + k))));
    await api(page, "inject", "crash-now");
  }
  await expect
    .poll(async () => (await diag(page)).workersCreated as number)
    .toBeGreaterThanOrEqual(created0 + 6);
  expect(await api<string>(page, "documentDigest")).toBe(digest);
  expect(await api<boolean>(page, "storeIntact")).toBe(true);
  expect(await api<boolean>(page, "undo")).toBe(true);
  expect(await api<boolean>(page, "redo")).toBe(true);
  expect(await api<string>(page, "documentDigest")).toBe(digest);
  results.recreation = await diag(page);
});

test("a worker from another build is refused: no job posted, explicit jobs fail, reload prompted", async ({
  browser,
}) => {
  // Service workers blocked so the route can serve the foreign worker; build identity is the
  // handshake's job, independent of caching.
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const dist = resolve(import.meta.dirname, "../../dist/assets");
  const workerFile = readdirSync(dist).find((f) => f.startsWith("compute.worker-"))!;
  const original = readFileSync(join(dist, workerFile), "utf8");
  const id = /buildId:`([0-9a-f]{16})`/.exec(original)![1]!;
  await context.route(`**/assets/${workerFile}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: original.replace(`buildId:\`${id}\``, "buildId:`0000000000000000`"),
    }),
  );
  await page.goto("/?debug=1");
  await expect(page.getByTestId("status")).toContainText("build_mismatch", { timeout: 30_000 });
  await expect(page.getByTestId("status")).toContainText("reload");
  await upload(page, "procedural/circle.png");
  await expect(page.getByText("Original · ")).toBeVisible({ timeout: 30_000 });
  const r = await api<Sub>(page, "final", bw(128));
  expect(r).toMatchObject({ accepted: false, code: "build_mismatch" });
  const d = await diag(page);
  expect(d).toMatchObject({ handshakes: 0, buildMismatches: 1, state: "skewed" });
  results.mixedVersion = d;
  await context.close();
});
