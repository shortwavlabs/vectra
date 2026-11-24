// P0-G5 benchmark harness (opt-in: BENCH=1 pnpm exec playwright test tests/browser/benchmark.spec.ts).
// Feeds a photographic source (the CC0 Talbot fixture scaled up as JPEG q0.9) through the real
// UI path: decode → worker → WASM → SVG, then PDF export. Results are appended per run to
// tests/output/bench/<browser>.jsonl so partial results survive timeouts.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { lastResult, OUTPUT, selectMode, uploadGenerated, waitForState } from "./helpers.ts";

const SIZES_MP = (process.env.BENCH_SIZES ?? "1,4,12,24").split(",").map(Number);
const MODES = (process.env.BENCH_MODES ?? "bw,color,limited,halftone").split(",");
const RUNS = Number(process.env.BENCH_RUNS ?? "3");

test.skip(!process.env.BENCH, "set BENCH=1 to run the benchmark harness");
test.setTimeout(60 * 60 * 1000);

async function setHalftonePitch(page: Page, mp: number) {
  // Constant dot count per image (same physical print size at higher source resolution).
  await page.getByLabel("Pitch (px)").fill(String(Math.max(8, Math.round(8 * Math.sqrt(mp)))));
}

test("benchmark matrix", async ({ page, browserName }) => {
  mkdirSync(join(OUTPUT, "bench"), { recursive: true });
  const out = join(OUTPUT, "bench", `${browserName}.jsonl`);
  await page.goto("/");
  await page.getByTestId("max-pixels").selectOption("50000000");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as unknown as { __vectra?: { ready?: unknown } }).__vectra?.ready),
      ),
    )
    .toBe(true);
  const ready = (await lastResult(page)).ready;
  appendFileSync(
    out,
    JSON.stringify({
      kind: "ready",
      browserName,
      ...ready,
      userAgent: await page.evaluate(() => navigator.userAgent),
    }) + "\n",
  );
  for (const mp of SIZES_MP) {
    const side = Math.round(Math.sqrt(mp * 1e6 * (640 / 526)));
    const width = side;
    const height = Math.round((side * 526) / 640);
    for (const mode of MODES) {
      for (let run = 0; run < (mp >= 12 ? 1 : RUNS); run++) {
        const row: Record<string, unknown> = {
          kind: "run",
          browserName,
          mp,
          width,
          height,
          mode,
          run,
        };
        try {
          await selectMode(page, mode);
          if (mode === "halftone") await setHalftonePitch(page, mp);
          const before = (await lastResult(page)).results ?? 0;
          await uploadGenerated(page, {
            width,
            height,
            type: "image/jpeg",
            name: `bench-${mp}mp.jpg`,
            baseJpeg: "external/talbot-scene-in-a-library-640.jpg",
          });
          await expect
            .poll(
              async () => {
                const state = await page.getByTestId("status").getAttribute("data-state");
                if (state === "error")
                  throw new Error((await page.getByTestId("status").textContent()) ?? "error");
                return (await lastResult(page)).results;
              },
              { timeout: 20 * 60 * 1000, intervals: [250] },
            )
            .toBeGreaterThan(before);
          await waitForState(page, "done");
          const r = await lastResult(page);
          Object.assign(row, {
            decodeMs: r.decodeMs,
            wasmCallMs: r.last.timings.wasmCallMs,
            svgMs: r.last.timings.svgMs,
            roundTripMs: r.last.roundTripMs,
            engine: r.last.metrics.timingsMs,
            stats: r.last.metrics.stats,
            dots: r.last.metrics.dots,
            svgBytes: r.last.svgBytes,
            wasmMemoryBytes: r.last.memoryBytes,
            responsiveness: r.last.responsiveness,
            jsHeapBytes: await page.evaluate(
              () =>
                (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
                  ?.usedJSHeapSize ?? null,
            ),
          });
          const pdf = page.waitForEvent("download");
          await page.getByTestId("download-pdf").click();
          await (await pdf).path();
          await expect
            .poll(async () => (await lastResult(page)).lastPdf?.ms, { timeout: 10 * 60 * 1000 })
            .toBeTruthy();
          const p = (await lastResult(page)).lastPdf;
          Object.assign(row, { pdfMs: p.ms, pdfBytes: p.bytes });
          await page.evaluate(() => {
            delete (window as unknown as { __vectra: Record<string, unknown> }).__vectra.lastPdf;
          });
        } catch (e) {
          row.error = String(e).slice(0, 400);
          await page.reload();
          await page.getByTestId("max-pixels").selectOption("50000000");
        }
        appendFileSync(out, JSON.stringify(row) + "\n");
      }
    }
  }
});
