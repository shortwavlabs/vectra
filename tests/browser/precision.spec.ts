// P0-R-GEO: the workbench's "Fit: precision" option traces the owner-rejected fixtures through
// the production WASM build and reproduces the corrected files of owner acceptance bundle v2.
// 04 is opaque, so every engine decodes it identically; 05 has partial alpha, whose decode
// differs between engines (P0 limitation), so outside Chromium only its structure is checked.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { lastResult, selectMode, upload, waitForState } from "./helpers.ts";

const V2 = resolve(import.meta.dirname, "../../docs/research/p0-r-geo/owner-acceptance-bundle-v2");

for (const [name, file] of [
  ["04-color-discs", "procedural/antialiased_discs.png"],
  ["05-color-transparent-hole", "procedural/logo_transparent_hole.png"],
] as const) {
  test(`precision fit in the workbench: ${name}`, async ({ page, browserName }) => {
    await page.goto("/");
    await selectMode(page, "color");
    await page.getByRole("combobox", { name: "Fit", exact: true }).selectOption("precision");
    const before = (await lastResult(page)).results ?? 0;
    await upload(page, file);
    await expect.poll(async () => (await lastResult(page)).results ?? 0).toBeGreaterThan(before);
    await waitForState(page, "done");
    const r = await lastResult(page);
    expect(r.last.metrics.precisionFitVersion).toBe(1);
    const dl = page.waitForEvent("download");
    await page.getByTestId("download-svg").click();
    const svg = readFileSync((await (await dl).path())!, "utf8");
    if (browserName === "chromium" || name.startsWith("04")) {
      expect(svg).toBe(readFileSync(`${V2}/${name}-corrected-precision.svg`, "utf8"));
    } else {
      // Frame (4 lines) plus the hole: a handful of cubics, not a staircase.
      expect((svg.match(/C/g) ?? []).length).toBeLessThanOrEqual(8);
      expect((svg.match(/M/g) ?? []).length).toBe(2);
    }
  });
}
