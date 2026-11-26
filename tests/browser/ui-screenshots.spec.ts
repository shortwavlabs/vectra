// G-UI evidence of the production build for the maintainer's visual review: screenshots
// (Chromium) and accessibility-tree snapshots (Playwright aria snapshots, a PROXY for a
// screen-reader pass, not one). Written only when UI_SCREENSHOTS=1, so routine runs never
// touch docs/.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import {
  canvasSettled,
  expect,
  importFixture,
  openWorkspace,
  selectOnCanvas,
  SHOTS,
  test,
} from "./ui-helpers.ts";

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const;
const ARIA = resolve(SHOTS, "../aria");

test.skip(({ browserName }) => browserName !== "chromium", "evidence screenshots: Chromium only");
test.skip(process.env.UI_SCREENSHOTS !== "1", "set UI_SCREENSHOTS=1 to write docs evidence");

async function shot(page: Page, guard: { drain: (s: string) => Promise<unknown[]> }, name: string) {
  await page.waitForTimeout(400); // let focus rings and tooltips finish their transitions
  expect(await guard.drain(`before ${name}`), "CSP violations before screenshot").toEqual([]);
  const { width } = page.viewportSize()!;
  await page.screenshot({ path: resolve(SHOTS, `${name}-${width}.png`), caret: "initial" });
}
async function aria(page: Page, name: string) {
  mkdirSync(ARIA, { recursive: true });
  writeFileSync(resolve(ARIA, `${name}.yml`), await page.locator("body").ariaSnapshot());
}

for (const size of SIZES) {
  test(`workspace states at ${size.width}×${size.height}`, async ({ page, guard }) => {
    const record = size.width === 1366; // one set of aria snapshots
    await page.setViewportSize(size);
    await openWorkspace(page);
    await expect(page.getByText("Offline ready")).toBeVisible({ timeout: 30_000 });
    await shot(page, guard, "01-empty");
    if (record) await aria(page, "01-empty");

    await importFixture(page, "external/hokusai-great-wave-640.jpg", "Black & White");
    await page.mouse.click(10, 10); // dismiss tooltips
    await shot(page, guard, "02-imported");

    // A path selected on the canvas (exact hit test).
    const hit = await selectOnCanvas(page);
    await expect(page.getByTestId("selection-bounds")).toHaveCount(1);
    await shot(page, guard, "03-selected-object");
    if (record) await aria(page, "03-selected-path");

    // Layers expanded and the layer selected: the inspector shows its transform.
    await page
      .getByRole("button", { name: /^Expand / })
      .first()
      .click();
    await page.getByTestId("layer-row").first().locator("button[aria-pressed]").click();
    await canvasSettled(page);
    await shot(page, guard, "04-layers-inspector");
    if (record) await aria(page, "04-layer-selected");

    // Colour picker open on the selected path.
    await selectOnCanvas(page, [hit as [number, number]]);
    await page.getByRole("button", { name: /^Fill colour/ }).click();
    await expect(page.getByRole("slider", { name: "Saturation and brightness" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await shot(page, guard, "05-colour-picker");
    if (record) await aria(page, "05-colour-picker");
    await page.keyboard.press("Escape");

    // Resized panels (keyboard on the separators).
    await page.getByRole("separator", { name: "Resize inspector" }).focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    await page.getByRole("separator", { name: "Resize layers" }).focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp");
    await page.mouse.click(10, 10);
    await shot(page, guard, "06-resized-panels");

    // Keyboard focus: the dual ring on a rail tool (panel) and on the lime Export button.
    await page.getByRole("button", { name: "Recolor" }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await shot(page, guard, "07-focus-rail");
    await page.getByRole("button", { name: "Import", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeFocused();
    await shot(page, guard, "08-focus-lime");

    // Export dialog (modal focus management).
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Export artwork" })).toBeVisible();
    // 1366 only: the blurred backdrop makes the 1920 PNG exceed the 400 KB evidence limit.
    if (record) await shot(page, guard, "09-export-dialog");
    if (record) await aria(page, "09-export-dialog");
  });
}
