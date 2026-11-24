// End-to-end tests of the production build in Chromium, Firefox and WebKit:
// real decode, real module worker, real WASM, real downloads.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  lastResult,
  selectMode,
  shownRequest,
  svgInventory,
  upload,
  uploadGenerated,
  waitForSource,
  waitForState,
  writeOutput,
} from "./helpers.ts";

const ALLOWED_ELEMENTS = ["clipPath", "defs", "desc", "g", "path", "rect", "svg"];
const ALLOWED_ATTRIBUTES = [
  "class",
  "clip-path",
  "d",
  "fill",
  "fill-opacity",
  "fill-rule",
  "height",
  "id",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "version",
  "viewBox",
  "width",
  "x",
  "xmlns",
  "y",
];

const CASES: [string, string][] = [
  ["procedural/circle.png", "bw"],
  ["procedural/nested_rings.png", "bw"],
  ["procedural/thin_strokes.png", "bw"],
  ["procedural/transparent_ring.png", "color"],
  ["procedural/logo_transparent_hole.png", "color"],
  ["procedural/adjacent_colors.png", "limited"],
  ["procedural/antialiased_discs.png", "color"],
  ["procedural/noise.png", "bw"],
  ["procedural/gradient.png", "halftone"],
  ["procedural/color_gradient.png", "limited"],
  ["external/hokusai-great-wave-640.jpg", "limited"],
  ["external/talbot-scene-in-a-library-640.jpg", "halftone"],
  ["external/talbot-scene-in-a-library-640.jpg", "color"],
];

test("fixtures trace in a real browser and the SVG passes the element/attribute allowlist", async ({
  page,
  browserName,
}) => {
  await page.goto("/");
  const rows: Record<string, unknown>[] = [];
  for (const [file, mode] of CASES) {
    await selectMode(page, mode);
    const before = (await lastResult(page)).results ?? 0;
    await upload(page, file);
    await waitForState(page, "done");
    await expect.poll(async () => (await lastResult(page)).results).toBeGreaterThan(before);
    const inv = await svgInventory(page);
    expect(inv.parseError).toBe(false);
    expect(inv.elements.filter((e) => !ALLOWED_ELEMENTS.includes(e))).toEqual([]);
    expect(inv.attributes.filter((a) => !ALLOWED_ATTRIBUTES.includes(a))).toEqual([]);
    const r = await lastResult(page);
    expect(r.last.metrics.stats.paths).toBeGreaterThan(0);
    rows.push({
      file,
      mode,
      ...r.last.metrics.stats,
      svgBytes: r.last.svgBytes,
      wasmCallMs: r.last.timings.wasmCallMs,
      decodeMs: r.decodeMs,
      memoryBytes: r.last.memoryBytes,
    });
  }
  writeOutput(`browser/${browserName}-fixtures.json`, JSON.stringify(rows, null, 2));
});

test("SVG and PDF downloads are produced from the same scene and contain only vector data", async ({
  page,
  browserName,
}) => {
  await page.goto("/");
  for (const [file, mode] of [
    ["procedural/nested_rings.png", "bw"],
    ["procedural/transparent_ring.png", "color"],
    ["external/hokusai-great-wave-640.jpg", "limited"],
    ["external/talbot-scene-in-a-library-640.jpg", "halftone"],
  ] as const) {
    await selectMode(page, mode);
    await upload(page, file);
    await waitForState(page, "done");
    const stem = `exports/${browserName}/${file.split("/")[1]!.replace(/\.\w+$/, "")}-${mode}`;
    const [svgDl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-svg").click(),
    ]);
    const svgPath = writeOutput(`${stem}.svg`, "");
    await svgDl.saveAs(svgPath);
    await page.getByTestId("pdf-width").fill("150");
    await page.getByTestId("pdf-unit").selectOption("mm");
    const [pdfDl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-pdf").click(),
    ]);
    const pdfPath = writeOutput(`${stem}.pdf`, "");
    await pdfDl.saveAs(pdfPath);
    const svg = readFileSync(svgPath, "utf8");
    const pdf = readFileSync(pdfPath).toString("latin1");
    expect(svg).toContain("<svg");
    for (const forbidden of ["<image", "<script", "foreignObject", "href=", "data:"])
      expect(svg).not.toContain(forbidden);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    for (const forbidden of ["/Image", "/XObject", "/Font", "/JavaScript"])
      expect(pdf).not.toContain(forbidden);
    const mediaBox = /\/MediaBox \[([^\]]+)\]/.exec(pdf)![1]!.trim().split(/\s+/).map(Number);
    expect(Math.abs(mediaBox[2]! - (150 * 72) / 25.4)).toBeLessThan(0.1);
    await expect(page.getByTestId("pdf-bytes")).not.toHaveText("—");
  }
});

test("cancellation is acknowledged immediately and the next job succeeds", async ({ page }) => {
  await page.goto("/");
  await selectMode(page, "color");
  await uploadGenerated(page, {
    width: 3000,
    height: 3000,
    type: "image/jpeg",
    name: "large.jpg",
    baseJpeg: "external/talbot-scene-in-a-library-640.jpg",
  });
  await waitForSource(page, 3000, 3000);
  await waitForState(page, "processing");
  const t0 = Date.now();
  await page.getByTestId("cancel").click();
  await waitForState(page, "cancelled", 5_000);
  const clickToVisibleMs = Date.now() - t0;
  const dbg = await lastResult(page);
  expect(dbg.cancelAckMs).toBeLessThan(50);
  expect(clickToVisibleMs).toBeLessThan(1_000);
  // Re-run with a cheap mode: a fresh worker is created and completes.
  await selectMode(page, "bw");
  await waitForState(page, "done");
  const after = await lastResult(page);
  expect(after.stats.terminations).toBeGreaterThanOrEqual(1);
  writeOutput(
    `browser/${test.info().project.name}-cancel.json`,
    JSON.stringify({ cancelAckMs: dbg.cancelAckMs, clickToVisibleMs, stats: after.stats }, null, 2),
  );
});

test("rapid setting changes never show a stale result", async ({ page }) => {
  await page.goto("/");
  await upload(page, "external/talbot-scene-in-a-library-640.jpg");
  await waitForState(page, "done");
  const slider = page.getByLabel(/^Threshold/);
  // 51 keyboard steps from 128 down to 77: each step is a settings change.
  await slider.focus();
  for (let i = 0; i < 51; i++) await slider.press("ArrowLeft");
  // The displayed result must end up being the one for the final value, and stay there.
  await expect
    .poll(async () => (await shownRequest(page))?.settings.threshold, { timeout: 60_000 })
    .toBe(77);
  await waitForState(page, "done");
  const settled = (await lastResult(page)).results;
  await page.waitForTimeout(1_500);
  expect((await shownRequest(page)).settings.threshold).toBe(77);
  expect((await lastResult(page)).results).toBe(settled);
});

test("malformed, unsupported and oversized inputs produce actionable errors", async ({ page }) => {
  await page.goto("/");
  const input = page.getByTestId("file");
  await input.setInputFiles({
    name: "not-an-image.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is plain text, not a PNG file at all"),
  });
  await waitForState(page, "error");
  await expect(page.getByTestId("status")).toContainText("unsupported_format");
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(64);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12, "latin1");
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  await input.setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: png(16000, 16000) });
  await waitForState(page, "error");
  await expect(page.getByTestId("status")).toContainText("too_many_pixels");
  await input.setInputFiles({
    name: "truncated.png",
    mimeType: "image/png",
    buffer: png(100, 100),
  });
  await waitForState(page, "error");
  await expect(page.getByTestId("status")).toContainText("decode_failed");
  // The app keeps working afterwards.
  await upload(page, "procedural/circle.png");
  await waitForState(page, "done");
});

test("repeated imports keep memory bounded", async ({ page, browserName }) => {
  await page.goto("/");
  await selectMode(page, "color");
  const samples: { wasm: number; heap: number | null }[] = [];
  for (let i = 0; i < 20; i++) {
    await upload(
      page,
      i % 2 ? "external/talbot-scene-in-a-library-640.jpg" : "external/hokusai-great-wave-640.jpg",
    );
    await waitForState(page, "done");
    await expect.poll(async () => (await lastResult(page)).results).toBeGreaterThan(i);
    const r = await lastResult(page);
    const heap = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? null,
    );
    samples.push({ wasm: r.last.memoryBytes, heap });
  }
  writeOutput(`browser/${browserName}-memory.json`, JSON.stringify(samples, null, 2));
  const wasm = samples.map((s) => s.wasm);
  expect(Math.max(...wasm.slice(10))).toBeLessThanOrEqual(Math.max(...wasm.slice(0, 10)) * 1.25);
});
