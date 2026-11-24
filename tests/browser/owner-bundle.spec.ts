// Generates the P0-R owner acceptance bundle through the real workbench UI (Chromium):
//   OWNER_BUNDLE=1 pnpm exec playwright test tests/browser/owner-bundle.spec.ts --project=chromium
// Output: docs/research/p0-r/owner-acceptance-bundle/ (SVG + PDF pairs and MANIFEST.json).
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { lastResult, selectMode, upload, waitForState } from "./helpers.ts";

// OWNER_BUNDLE_DIR re-generates elsewhere (P0-R-GEO byte-identity check) without touching v1.
const OUT = process.env.OWNER_BUNDLE_DIR
  ? resolve(process.env.OWNER_BUNDLE_DIR)
  : resolve(import.meta.dirname, "../../docs/research/p0-r/owner-acceptance-bundle");

interface Case {
  name: string;
  file: string;
  mode: string;
  checks: string;
  tweak?: (page: Page) => Promise<void>;
}

const CASES: Case[] = [
  {
    name: "01-bw-photo-talbot",
    file: "external/talbot-scene-in-a-library-640.jpg",
    mode: "bw",
    checks: "B&W photo: closed paths, holes, no background",
  },
  {
    name: "02-bw-transparent-ring",
    file: "procedural/transparent_ring.png",
    mode: "bw",
    checks: "B&W on a transparent source: ring hole and surroundings stay transparent",
  },
  {
    name: "03-limited-hokusai",
    file: "external/hokusai-great-wave-640.jpg",
    mode: "limited",
    checks: "Limited colour (8): palette-only fills, seam-free mosaic",
  },
  {
    name: "04-color-discs",
    file: "procedural/antialiased_discs.png",
    mode: "color",
    checks: "Full colour: overlapping regions, exact colours",
  },
  {
    name: "05-color-transparent-hole",
    file: "procedural/logo_transparent_hole.png",
    mode: "color",
    checks: "Full colour with a transparent hole: hole is see-through",
  },
  {
    name: "06-oldprint-talbot",
    file: "external/talbot-scene-in-a-library-640.jpg",
    mode: "halftone",
    checks: "Old Print halftone: vector dots on ivory paper rect, dots clipped to the artboard",
    tweak: async (page) => {
      await page.getByLabel("Pitch (px)").fill("10");
    },
  },
  {
    name: "07-oldprint-transparent-gradient",
    file: "procedural/gradient.png",
    mode: "halftone",
    checks: "Old Print without paper: transparent background; dot area follows tone",
    tweak: async (page) => {
      await page.getByLabel("Paper background").uncheck();
    },
  },
];

test.skip(
  !process.env.OWNER_BUNDLE,
  "set OWNER_BUNDLE=1 to regenerate the owner acceptance bundle",
);

test("owner acceptance bundle", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "generated once, in Chromium");
  mkdirSync(OUT, { recursive: true });
  const manifest = [];
  await page.goto("/");
  for (const c of CASES) {
    await selectMode(page, c.mode);
    const before = (await lastResult(page)).results ?? 0;
    await upload(page, c.file);
    await expect.poll(async () => (await lastResult(page)).results ?? 0).toBeGreaterThan(before);
    if (c.tweak) {
      const n = (await lastResult(page)).results;
      await c.tweak(page);
      await expect
        .poll(async () => (await lastResult(page)).results ?? 0, { timeout: 30_000 })
        .toBeGreaterThan(n);
    }
    await waitForState(page, "done");
    const r = await lastResult(page);
    for (const [kind, testId] of [
      ["svg", "download-svg"],
      ["pdf", "download-pdf"],
    ] as const) {
      if (kind === "pdf") {
        await page.getByTestId("pdf-width").fill("200");
        await page.getByTestId("pdf-unit").selectOption("mm");
      }
      const dl = page.waitForEvent("download");
      await page.getByTestId(testId).click();
      const target = join(OUT, `${c.name}.${kind}`);
      copyFileSync((await (await dl).path())!, target);
      const bytes = readFileSync(target);
      manifest.push({
        file: `${c.name}.${kind}`,
        source: c.file,
        mode: c.mode,
        settings:
          (await page.evaluate(
            () =>
              (window as unknown as { __vectra: { lastRequest: unknown } }).__vectra.lastRequest,
          )) ?? null,
        pdfWidth: kind === "pdf" ? "200 mm" : null,
        paths: r.last.metrics.stats.paths,
        anchors: r.last.metrics.stats.anchors,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        check: c.checks,
      });
    }
  }
  writeFileSync(join(OUT, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
});
