// G-UI evidence screenshots of the production build (Chromium; maintainer visual review).
// Written only when UI_SCREENSHOTS=1, so routine runs never touch docs/.
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

test.skip(({ browserName }) => browserName !== "chromium", "evidence screenshots: Chromium only");
test.skip(process.env.UI_SCREENSHOTS !== "1", "set UI_SCREENSHOTS=1 to write docs screenshots");

async function shot(page: Page, guard: { drain: (s: string) => Promise<unknown[]> }, name: string) {
  expect(await guard.drain(`before ${name}`), "CSP violations before screenshot").toEqual([]);
  const { width } = page.viewportSize()!;
  await page.screenshot({ path: resolve(SHOTS, `${name}-${width}.png`), caret: "initial" });
}

for (const size of SIZES) {
  test(`workspace states at ${size.width}×${size.height}`, async ({ page, guard }) => {
    await page.setViewportSize(size);
    await openWorkspace(page);
    await shot(page, guard, "01-empty");

    await importFixture(page, "external/hokusai-great-wave-640.jpg", "Black & White");
    await page.mouse.click(10, 10); // dismiss tooltips
    await shot(page, guard, "02-imported");

    // Select a path on the canvas (interim box hit test).
    const hit = await selectOnCanvas(page);
    await expect(page.getByTestId("selection-outline")).toHaveCount(1);
    await shot(page, guard, "03-selected-object");

    // Layers expanded, layer selected, inspector showing transform.
    await page
      .getByRole("button", { name: /^Expand / })
      .first()
      .click();
    await page
      .getByTestId("layer-row")
      .first()
      .getByRole("button", { pressed: false })
      .first()
      .click();
    await canvasSettled(page);
    await shot(page, guard, "04-layers-inspector");

    // Colour picker open on a selected path.
    await selectOnCanvas(page, [hit as [number, number]]);
    await page.getByRole("button", { name: /^Fill colour/ }).click();
    await expect(page.getByRole("slider", { name: "Saturation and brightness" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await shot(page, guard, "05-colour-picker");
    await page.keyboard.press("Escape");

    // Resized panels (keyboard on the separators).
    await page.getByRole("separator", { name: "Resize inspector" }).focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    await page.getByRole("separator", { name: "Resize layers" }).focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowUp");
    await page.mouse.click(10, 10);
    await shot(page, guard, "06-resized-panels");

    // Keyboard focus: the dual ring on a rail tool and on a lime (pressed) control.
    await page.getByRole("button", { name: "Recolor" }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await shot(page, guard, "07-keyboard-focus");
  });
}
