// G-R1 §9: keyboard selection of individual vector paths, without a DOM element per object. The
// canvas is a focusable widget (role application, roledescription canvas): arrow keys walk the
// document tree, Enter/Space select, Shift toggles; a polite live region announces; the cursor's
// box is drawn; the focus ring is visible; the inspector is reachable from the canvas by Tab.
// Automated checks of keyboard behaviour and announced text, not a screen-reader test
// (VoiceOver is the owner checklist, docs/research/g-r1/VOICEOVER-CHECKLIST.md).
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/procedural");

async function importFixture(page: Page, file: string) {
  await page.getByTestId("import-input").setInputFiles(join(FIXTURES, file));
  await expect(page.getByTestId("status")).toContainText(`Traced ${file}`, { timeout: 90_000 });
  await expect(page.getByTestId("canvas-state")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}
const announcer = (page: Page) => page.getByTestId("canvas-announcer");
const canvas = (page: Page) => page.getByTestId("canvas-host");

test("keyboard: reach the canvas, walk the tree, select single paths, announce", async ({
  page,
}) => {
  await page.goto("/workspace.html");
  await importFixture(page, "nested_rings.png");
  await page.keyboard.press("Escape"); // clear the import's layer selection
  // The canvas is in the Tab order (from the tool rail).
  await page.getByRole("button", { name: "Select", exact: true }).focus();
  let reached = false;
  for (let i = 0; i < 20 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await canvas(page).evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await expect(canvas(page)).toHaveAttribute("role", "application");
  await expect(canvas(page)).toHaveAttribute("aria-roledescription", "canvas");
  // The focus ring is visible on the canvas (keyboard focus).
  const ring = await canvas(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return `${cs.outlineStyle} ${cs.outlineWidth}`;
  });
  expect(ring).toBe("solid 2px");
  await expect(announcer(page)).toHaveAttribute("aria-live", "polite");

  // First arrow: the top-most layer; Right: into it, to its top-most object; down to a path.
  await page.keyboard.press("ArrowDown");
  await expect(announcer(page)).toContainText("nested_rings, layer, 3 paths, 1 of 1");
  await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 4; i++) {
    const text = (await announcer(page).textContent()) ?? "";
    if (/^Path \d+/.test(text)) break;
    await page.keyboard.press("ArrowRight"); // descend through groups to a path
  }
  await expect(announcer(page)).toContainText(/^Path \d+, fill #[0-9a-f]{6}, \d+ of \d+$/);
  await expect(page.getByTestId("keyboard-cursor")).toBeVisible();
  // Enter selects the single path; the inspector shows it.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selection-name")).toHaveText(/^Path \d+$/);
  await expect(announcer(page)).toContainText(/^Path \d+, fill #[0-9a-f]{6} selected$/);
  // Down to a sibling path; Shift+Enter adds it.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+Enter");
  await expect(page.getByTestId("selection-name")).toHaveText("2 objects");
  await page.keyboard.press("Shift+Enter"); // and removes it again
  await expect(page.getByTestId("selection-name")).toHaveText(/^Path \d+$/);
  // Left goes back up to the parent; announcements carry the position.
  await page.keyboard.press("ArrowLeft");
  await expect(announcer(page)).toContainText(/\d+ of \d+/);
  // No DOM element per object: the canvas holds a fixed, small number of nodes.
  expect(await canvas(page).evaluate((el) => el.querySelectorAll("*").length)).toBeLessThan(40);
});

test("keyboard: from a selected path, Tab reaches the inspector's transform fields", async ({
  page,
}) => {
  await page.goto("/workspace.html");
  await importFixture(page, "nested_rings.png");
  await page.keyboard.press("Escape");
  await canvas(page).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selection-name")).not.toHaveText("");
  let reached = false;
  for (let i = 0; i < 25 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label")?.startsWith("X") ?? false,
    );
    if (!reached)
      reached =
        (await page
          .getByRole("textbox", { name: "X (px)" })
          .evaluate((el) => el === document.activeElement)
          .catch(() => false)) ?? false;
  }
  expect(reached).toBe(true);
  // A keyboard edit from there is one command, undoable.
  const x = page.getByRole("textbox", { name: "X (px)" });
  const x0 = Number(await x.inputValue());
  await page.keyboard.press("ArrowUp");
  await expect(x).toHaveValue(String(x0 + 1));
});

test("announcements: errors are alerts; processing is a polite status", async ({ page }) => {
  await page.goto("/workspace.html");
  await expect(page.getByTestId("status")).toHaveAttribute("role", "status");
  await page.getByTestId("import-input").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await expect(page.getByTestId("status")).toContainText("Import failed");
  await expect(page.getByTestId("status")).toHaveAttribute("role", "alert");
});
