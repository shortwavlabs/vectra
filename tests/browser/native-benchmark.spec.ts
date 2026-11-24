// P0-R-G5 native-resolution baseline (opt-in): BENCH_NATIVE=1 pnpm exec playwright test tests/browser/native-benchmark.spec.ts
// Requires `node scripts/fetch-native-corpus.mjs` (images in tests/output/native-corpus/).
// For each image and mode: a fresh page (cold: new worker and WASM instance), then the same
// file imported again on that page (warm). Records decode, engine stages, SVG/PDF, transfer,
// preview paint, import→visible time, main-thread responsiveness, memory, counts and sizes.
// THROTTLE=4 runs Chromium with 4x CPU throttling (lower-end proxy, not a real device).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { FIXTURES, lastResult, OUTPUT, selectMode } from "./helpers.ts";

const CORPUS = join(OUTPUT, "native-corpus");
const corpus = JSON.parse(readFileSync(join(FIXTURES, "native-corpus.json"), "utf8")).images as {
  id: string;
  width: number;
  height: number;
}[];
const ONLY = process.env.BENCH_IMAGES?.split(",");
const MODES = (process.env.BENCH_MODES ?? "bw,color,limited,halftone").split(",");
const THROTTLE = Number(process.env.THROTTLE ?? "1");
const EXTRA = process.env.BENCH_EXTRA?.split(",") ?? []; // additional files under native-corpus/derived

test.skip(!process.env.BENCH_NATIVE, "set BENCH_NATIVE=1 to run the native-corpus benchmark");
test.setTimeout(3 * 60 * 60 * 1000);

async function importAndMeasure(page: Page, file: string, expectedResults: number) {
  // Clear first: re-selecting the same file would not fire a change event (warm run).
  await page.getByTestId("file").setInputFiles([]);
  const t0 = Date.now();
  await page.getByTestId("file").setInputFiles(file);
  await expect
    .poll(
      async () => {
        const state = await page.getByTestId("status").getAttribute("data-state");
        if (state === "error")
          throw new Error((await page.getByTestId("status").textContent()) ?? "error");
        return (await lastResult(page)).previews ?? 0;
      },
      { timeout: 30 * 60 * 1000, intervals: [100] },
    )
    .toBeGreaterThanOrEqual(expectedResults);
  const r = await lastResult(page);
  return {
    wallMs: Date.now() - t0,
    decodeMs: r.decodeMs,
    wasmCallMs: r.last.timings.wasmCallMs,
    svgMs: r.last.timings.svgMs,
    parseMs: r.last.timings.parseMs,
    roundTripMs: r.last.roundTripMs,
    transferAndOverheadMs: r.last.roundTripMs - r.last.timings.wasmCallMs,
    previewMs: r.last.previewMs,
    importToVisibleMs: r.last.importToVisibleMs,
    engine: r.last.metrics.timingsMs,
    stats: r.last.metrics.stats,
    dots: r.last.metrics.dots,
    svgBytes: r.last.svgBytes,
    wasmMemoryBytes: r.last.memoryBytes,
    processing: r.last.responsiveness,
    preview: r.last.previewResponsiveness,
    jsHeapBytes: await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? null,
    ),
  };
}

async function exportPdf(page: Page) {
  // Timing comes from the worker (debug snapshot); the saved file itself is not needed here.
  await page.getByTestId("download-pdf").click();
  await expect
    .poll(async () => (await lastResult(page)).lastPdf?.ms, { timeout: 10 * 60 * 1000 })
    .toBeTruthy();
  const p = (await lastResult(page)).lastPdf;
  await page.evaluate(
    () => delete (window as unknown as { __vectra: Record<string, unknown> }).__vectra.lastPdf,
  );
  return { pdfMs: p.ms, pdfBytes: p.bytes };
}

test("native corpus baseline", async ({ context, browserName }) => {
  test.skip(THROTTLE > 1 && browserName !== "chromium", "CPU throttling uses Chromium CDP");
  mkdirSync(join(OUTPUT, "native-bench"), { recursive: true });
  const out = join(
    OUTPUT,
    "native-bench",
    `${browserName}${THROTTLE > 1 ? `-throttle${THROTTLE}x` : ""}.jsonl`,
  );
  const images = [
    ...corpus
      .filter((c) => !ONLY || ONLY.includes(c.id))
      .map((c) => ({ id: c.id, file: join(CORPUS, `${c.id}.jpg`) })),
    ...EXTRA.map((f) => ({ id: f.replace(/\.\w+$/, ""), file: join(CORPUS, "derived", f) })),
  ];
  for (const img of images) {
    if (!existsSync(img.file))
      throw new Error(`missing ${img.file}; run node scripts/fetch-native-corpus.mjs`);
    for (const mode of MODES) {
      // A new page per row gets a fresh worker and WASM instance ("cold").
      const page = await context.newPage();
      if (THROTTLE > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
      }
      const row: Record<string, unknown> = { browserName, throttle: THROTTLE, image: img.id, mode };
      try {
        await page.goto("/");
        await page.getByTestId("max-pixels").selectOption("25000000");
        await expect
          .poll(() =>
            page.evaluate(() =>
              Boolean((window as unknown as { __vectra?: { ready?: unknown } }).__vectra?.ready),
            ),
          )
          .toBe(true);
        row.wasmInitMs = (await lastResult(page)).ready.initMs;
        await selectMode(page, mode);
        row.cold = await importAndMeasure(page, img.file, 1);
        Object.assign(row.cold as object, await exportPdf(page));
        row.warm = await importAndMeasure(page, img.file, 2);
      } catch (e) {
        row.error = String(e).split("\n")[0]!.slice(0, 300);
      }
      appendFileSync(out, JSON.stringify(row) + "\n");
      await page.close();
    }
  }
});
