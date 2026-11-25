// Shared helpers for the G-JOB browser qualification (workbench `?debug=1` qualification API).
import { type BrowserContext, expect, type Page } from "@playwright/test";
import { uploadGenerated, waitForState } from "./helpers.ts";

export type Summary = {
  status: string;
  jobId: number;
  code?: string;
  reason?: string;
  layerId?: string;
  bytes?: number;
  bytesDigest?: string;
  form?: string;
  settledAt: number;
  anchors?: number;
  queuedMs?: number;
  workerMs?: number;
  postMs?: number;
  commitMs?: number;
  snapshotMs?: number;
};
export type Sub = { accepted: boolean; jobId?: number; code?: string; message?: string };

/** Calls the qualification API in the page. */
export async function api<T>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([f, a]) =>
      (window as unknown as { __vectra: { jobs: Record<string, (...x: unknown[]) => unknown> } })
        .__vectra.jobs[f as string]!(...(a as unknown[])),
    [fn, args] as const,
  ) as Promise<T>;
}
export const outcome = (page: Page, jobId: number) => api<Summary>(page, "outcome", jobId);
export const diag = (page: Page) => api<Record<string, number | string | null>>(page, "diag");
export const jobId = (s: Sub) => {
  expect(s.accepted, JSON.stringify(s)).toBe(true);
  return s.jobId!;
};
export const BW = { mode: "bw", threshold: 128, invert: false, speckle: 16, alphaThreshold: 128 };
export const bw = (threshold: number) => ({ settings: { ...BW, threshold } });
export const COLOR = {
  settings: {
    mode: "color",
    colorPrecision: 6,
    layerDifference: 16,
    speckle: 4,
    compositing: "stacked",
    alphaThreshold: 128,
  },
};

export async function openWorkbench(
  page: Page,
  context: BrowserContext,
  offline: boolean,
  query = "",
) {
  await page.goto(`/?debug=1${query}`);
  await expect(page.getByTestId("offline-ready")).toHaveText("Offline-ready.", { timeout: 30_000 });
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as { __vectra?: { ready?: unknown } }).__vectra?.ready)),
    )
    .toBe(true);
  if (offline) {
    await context.setOffline(true);
    await page.reload(); // the page, its worker and the WASM now come from the service worker
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((window as { __vectra?: { ready?: unknown } }).__vectra?.ready),
        ),
      )
      .toBe(true);
  }
}

/** A 2400×1800 synthetic colour image (as R03), then waits for the workbench's own preview. */
export async function loadSynthetic(page: Page) {
  await uploadGenerated(page, {
    width: 2400,
    height: 1800,
    type: "image/png",
    name: "synthetic.png",
  });
  await expect(page.getByText("Original · 2400×1800")).toBeVisible({ timeout: 60_000 });
  await waitForState(page, "done");
}

export async function waitForStage(page: Page, id: number, stage: string) {
  await expect
    .poll(async () => (await api<{ stage: string }[]>(page, "stages", id)).map((s) => s.stage), {
      timeout: 60_000,
      intervals: [5],
    })
    .toContain(stage);
}
