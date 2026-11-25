// G-JOB qualification against the production build (RFC-002 §10.3, C5 r2): the R03 lifecycle
// scenarios 1–12 online and offline, the WebKit offline start-up churn reproduction, and the
// adversarial set. Chromium, Firefox and Playwright WebKit (not Safari). The workbench's
// `?debug=1` qualification API drives the real scheduler, worker, WASM and document; it returns
// outcomes, counters and digests only.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { writeOutput } from "./helpers.ts";
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
  waitForStage,
} from "./jobs-helpers.ts";

async function lifecycle(page: Page, context: BrowserContext, offline: boolean) {
  const log: Record<string, unknown> = { offline };
  await openWorkbench(page, context, offline);
  await loadSynthetic(page);

  // 1–2. Five rapid previews: only the latest completes.
  const ids = await page.evaluate(
    (thresholds) => {
      const j = (window as unknown as { __vectra: { jobs: { preview(o: unknown): Sub } } }).__vectra
        .jobs;
      return thresholds.map(
        (t) =>
          j.preview({
            settings: { mode: "bw", threshold: t, invert: false, speckle: 16, alphaThreshold: 128 },
          }).jobId!,
      );
    },
    [128, 120, 110, 100, 90],
  );
  const rapid = await Promise.all(ids.map((id) => outcome(page, id)));
  expect(rapid.map((o) => o.status)).toEqual([
    "cancelled",
    "cancelled",
    "cancelled",
    "cancelled",
    "succeeded",
  ]);
  log.rapidPreviews = rapid;

  // 3. A final trace is validated and committed as an immutable layer with history.
  const fin = await outcome(page, jobId(await api(page, "final", bw(128))));
  expect(fin.status).toBe("committed");
  expect(await api<string[]>(page, "layerIds")).toHaveLength(1);
  const committed = await api<string>(page, "documentDigest");

  // 4–6. A PDF export from a frozen snapshot, with a preview submitted while it runs: the
  // preview cannot cancel the export and completes afterwards.
  const [e, p] = await page.evaluate(() => {
    const j = (
      window as unknown as {
        __vectra: { jobs: { exportDocument(f: string): Sub; preview(): Sub } };
      }
    ).__vectra.jobs;
    return [j.exportDocument("pdf").jobId!, j.preview().jobId!];
  });
  const [eo, po] = [await outcome(page, e), await outcome(page, p)];
  expect(eo).toMatchObject({ status: "delivered" });
  expect(eo.bytes!).toBeGreaterThan(1000);
  expect(po.status).toBe("succeeded");
  expect(po.settledAt).toBeGreaterThanOrEqual(eo.settledAt);
  log.exportWithPreview = { export: eo, preview: po };

  // 7. Explicit cancel of a long final trace, acknowledged within 200 ms.
  const long = jobId(await api(page, "final", COLOR));
  await waitForStage(page, long, "segment");
  const ack = await api<{ ok: boolean; ackMs: number }>(page, "cancel", long);
  expect(ack.ok).toBe(true);
  expect(ack.ackMs).toBeLessThanOrEqual(200);
  expect(await outcome(page, long)).toMatchObject({ status: "cancelled", reason: "user" });
  log.cancelAckMs = ack.ackMs;

  // 8. The committed layer is byte-identical after the terminations.
  expect(await api<string>(page, "documentDigest")).toBe(committed);
  expect(await api<boolean>(page, "storeIntact")).toBe(true);

  // 9. Injected crash and fatal abort reject only their job; a late error is dropped.
  await outcome(page, jobId(await api(page, "preview", bw(127)))); // a ready worker to inject into
  expect(await api<boolean>(page, "inject", "crash-next-job")).toBe(true);
  expect(await outcome(page, jobId(await api(page, "preview", bw(126))))).toMatchObject({
    status: "failed",
    code: "worker_crashed",
  });
  await outcome(page, jobId(await api(page, "preview", bw(125))));
  expect(await api<boolean>(page, "inject", "fatal-next-job")).toBe(true);
  expect(await outcome(page, jobId(await api(page, "preview", bw(124))))).toMatchObject({
    status: "failed",
    code: "wasm_abort",
  });
  await outcome(page, jobId(await api(page, "preview", bw(123))));
  const errorsBefore = (await diag(page)).droppedErrors as number;
  expect(await api<boolean>(page, "inject", "late-error-after-next-result")).toBe(true);
  expect((await outcome(page, jobId(await api(page, "preview", bw(122))))).status).toBe(
    "succeeded",
  );
  await expect.poll(async () => (await diag(page)).droppedErrors).toBe(errorsBefore + 1);

  // 10. Evaluation on a fresh worker.
  const created = (await diag(page)).workersCreated as number;
  expect((await outcome(page, jobId(await api(page, "preview", bw(121))))).status).toBe(
    "succeeded",
  );
  expect(created).toBeGreaterThanOrEqual(4);

  // 11. Undo and redo while traces run. RFC §10.3 rule 3b (normative) replaces R03's
  // whole-document revision guard: a new-layer final commits if its source still matches,
  // and is stale only if the source changed.
  // Submission and undo in one task, so the undo certainly lands while the job is in flight.
  type J = { final(o: unknown): Sub; undo(): boolean };
  const during = await page.evaluate((o) => {
    const j = (window as unknown as { __vectra: { jobs: J } }).__vectra.jobs;
    const id = j.final(o).jobId!;
    j.undo(); // removes the scenario-3 layer
    return id;
  }, bw(128));
  const duringOut = await outcome(page, during);
  expect(duringOut.status).toBe("committed");
  expect(await api<string[]>(page, "layerIds")).toEqual([duringOut.layerId]);
  const afterCommit = await api<string>(page, "documentDigest");
  const stale = await page.evaluate((o) => {
    const j = (window as unknown as { __vectra: { jobs: J } }).__vectra.jobs;
    const id = j.final(o).jobId!;
    j.undo(); // the new layer
    j.undo(); // the source attachment
    return id;
  }, bw(128));
  expect(await outcome(page, stale)).toMatchObject({ status: "stale", reason: "source_changed" });
  await api(page, "redo");
  await api(page, "redo");
  expect(await api<string>(page, "documentDigest")).toBe(afterCommit); // byte-identical redo
  log.undoDuringTrace = {
    committedDuringUndo: duringOut,
    staleAfterSourceUndo: await outcome(page, stale),
  };

  const d = await diag(page);
  expect(d.settleViolations).toBe(0);
  expect(d.snapshotRefs).toBe(0);
  expect(d.reservedBytes).toBe(0);
  log.diagnostics = d;
  return log;
}

test("R03 lifecycle scenarios 1–11 online (production build)", async ({
  page,
  context,
  browserName,
}) => {
  const log = await lifecycle(page, context, false);
  writeOutput(`g-job/${browserName}-lifecycle-online.json`, JSON.stringify(log, null, 2));
});

test("R03 scenario 12: the lifecycle offline (production build)", async ({
  page,
  context,
  browserName,
}) => {
  const log = await lifecycle(page, context, true);
  writeOutput(`g-job/${browserName}-lifecycle-offline.json`, JSON.stringify(log, null, 2));
});

test("WebKit start-up churn: five previews during an offline worker start-up", async ({
  page,
  context,
  browserName,
}) => {
  const runs = [];
  await openWorkbench(page, context, true);
  await loadSynthetic(page);
  for (let run = 0; run < 4; run++) {
    // Terminate the worker (explicit cancel of a posted job), then submit five previews while
    // the next worker's module graph loads from the service worker.
    const warm = jobId(await api(page, "final", COLOR));
    await waitForStage(page, warm, "segment");
    await api(page, "cancel", warm);
    const before = await diag(page);
    const ids = await page.evaluate(() => {
      const j = (window as unknown as { __vectra: { jobs: { preview(o: unknown): Sub } } }).__vectra
        .jobs;
      return [140, 130, 120, 110, 100].map(
        (t) =>
          j.preview({
            settings: { mode: "bw", threshold: t, invert: false, speckle: 16, alphaThreshold: 128 },
          }).jobId!,
      );
    });
    const outs = await Promise.all(ids.map((id) => outcome(page, id)));
    const after = await diag(page);
    expect(outs.at(-1)!.status, JSON.stringify(outs.at(-1))).toBe("succeeded");
    expect(outs.slice(0, 4).every((o) => o.status === "cancelled")).toBe(true);
    expect((after.workersCreated as number) - (before.workersCreated as number)).toBe(1);
    expect(after.startupFailures).toBe(before.startupFailures);
    runs.push({
      run,
      outcomes: outs,
      workersCreated: after.workersCreated,
      terminations: after.terminations,
    });
  }
  writeOutput(`g-job/${browserName}-churn-offline.json`, JSON.stringify(runs, null, 2));
});
