// G-UI-R before/after evidence: the same eight workspace states at three desktop sizes, from
// the production build (Chromium). Opt-in: UI_R_SHOTS=before|after writes PNGs to
// tests/output/g-ui-r/<phase>/ (ignored by git); routine runs skip it.
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import {
  canvasSettled,
  expect,
  importFixture,
  openWorkspace,
  selectOnCanvas,
  test,
} from "./ui-helpers.ts";

const PHASE = process.env.UI_R_SHOTS;
const OUT = resolve(import.meta.dirname, "../output/g-ui-r", PHASE ?? "unset");
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  // UI_R_EXTRA=1: smaller laptops, for the discoverability check (after only).
  ...(process.env.UI_R_EXTRA === "1"
    ? [
        { width: 1280, height: 720 },
        { width: 1024, height: 640 },
      ]
    : []),
];

test.skip(({ browserName }) => browserName !== "chromium", "evidence screenshots: Chromium only");
test.skip(!PHASE, "set UI_R_SHOTS=before|after to write the G-UI-R evidence set");

async function shot(page: Page, guard: { drain: (s: string) => Promise<unknown[]> }, name: string) {
  await page.waitForTimeout(400); // focus rings, tooltips and popovers finish their transitions
  expect(await guard.drain(`before ${name}`), "CSP violations before screenshot").toEqual([]);
  const { width, height } = page.viewportSize()!;
  await page.screenshot({ path: resolve(OUT, `${name}-${width}x${height}.png`), caret: "initial" });
}
const neutral = (page: Page) => page.mouse.move(2, 2); // no hover state, no tooltip

for (const size of SIZES) {
  test(`G-UI-R states at ${size.width}×${size.height}`, async ({ page, guard }) => {
    await page.setViewportSize(size);
    await openWorkspace(page);
    await expect(page.getByText("Offline ready")).toBeVisible({ timeout: 30_000 });
    await neutral(page);
    await shot(page, guard, "01-empty");

    await importFixture(page, "external/hokusai-great-wave-640.jpg", "Limited Palette");
    await page.keyboard.press("Escape"); // the artwork alone, nothing selected
    await neutral(page);
    await shot(page, guard, "02-imported");

    // The layer selected from Layers: the canvas shows its box and transform handles.
    await page.getByTestId("layer-row").first().locator("button[aria-pressed]").click();
    await expect(page.getByTestId("handle-se")).toHaveCount(1);
    await canvasSettled(page);
    await neutral(page);
    await shot(page, guard, "03-layer-selected");

    // A single path picked on the canvas (exact hit test).
    await page.keyboard.press("Escape");
    await selectOnCanvas(page);
    await canvasSettled(page);
    await neutral(page);
    await shot(page, guard, "04-path-selected");

    // The colour picker on that path's fill, focused on its 2-D area.
    await page.getByRole("button", { name: /^Fill colour/ }).click();
    await expect(page.getByRole("slider", { name: "Saturation and brightness" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await neutral(page);
    await shot(page, guard, "05-colour-picker");
    await page.keyboard.press("Escape");

    // The Recolor tool: the document palette.
    await page.getByRole("button", { name: "Recolor" }).click();
    await neutral(page);
    await shot(page, guard, "06-recolor");

    // Keyboard focus on the canvas: Tab from the tool rail, Down, Right (dashed cursor).
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Recolor" }).focus();
    const canvas = page.getByTestId("canvas-host");
    for (let i = 0; i < 20; i++) {
      if (await canvas.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(canvas).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("keyboard-cursor")).toBeVisible();
    await neutral(page);
    await shot(page, guard, "07-canvas-keyboard");

    // The export dialog.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Export artwork" })).toBeVisible();
    await neutral(page);
    await shot(page, guard, "08-export-dialog");
  });
}
