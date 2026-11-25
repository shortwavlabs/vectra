// G-UI: the workspace bound to a real document. Artwork comes from real final traces through
// the job system (no fixture seeding); every edit is a document command, checked through the
// UI only (values, layer order and undo steps), including the explicit qualification of the
// repaired slider and colour picker (R05-A D1–D7, RFC-002 §7 coalescing).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import {
  canvasSettled,
  expect,
  FIXTURES,
  importFixture,
  note,
  openWorkspace,
  selectOnCanvas,
  test,
} from "./ui-helpers.ts";

const undo = (page: Page) => page.getByRole("button", { name: "Undo" }).click();
const redo = (page: Page) => page.getByRole("button", { name: "Redo" }).click();
const order = (page: Page) =>
  page
    .getByTestId("layer-row")
    .evaluateAll((rows) =>
      rows
        .filter((r) => r.closest("ul")?.getAttribute("aria-label") === "Layers")
        .map((r) => r.querySelector("button[aria-pressed] span")!.textContent),
    );
const rowNamed = (page: Page, name: string) =>
  page.getByTestId("layer-row").filter({ has: page.getByText(name, { exact: true }) });

test("import: keyboard-opened chooser, local trace, no upload", async ({ page, guard }) => {
  await openWorkspace(page);
  await page.waitForLoadState("networkidle");
  const before = guard.requests.length;
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import", exact: true }).focus();
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(resolve(FIXTURES, "procedural/adjacent_colors.png"));
  await expect(page.getByTestId("status")).toContainText("Traced adjacent_colors.png", {
    timeout: 90_000,
  });
  await canvasSettled(page);
  await expect(page.getByTestId("canvas-image")).toBeVisible();
  await expect(page.getByTestId("layer-row")).toHaveCount(1);
  await expect(page.getByTestId("document-title")).toContainText("Untitled artwork · Edited");
  await expect(page.getByTestId("complexity")).toContainText("paths");
  const during = guard.requests.slice(before);
  note("requests during import", during);
  // The file never leaves the device: only same-origin GETs of the build's own assets.
  for (const u of during) {
    const url = new URL(u);
    if (url.protocol === "blob:" || url.protocol === "data:") continue; // local, in-page
    expect(url.host).toBe(new URL(page.url()).host);
  }
});

test("layers: visibility, lock, rename, Move up/down, keyboard and pointer reorder", async ({
  page,
}) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png");
  await importFixture(page, "procedural/nested_rings.png");
  expect(await order(page)).toEqual(["nested_rings", "adjacent_colors"]); // top-most first

  // Visibility and lock are commands (undoable).
  await page.getByRole("button", { name: "Hide nested_rings" }).click();
  await expect(page.getByRole("button", { name: "Show nested_rings" })).toBeVisible();
  await undo(page);
  await expect(page.getByRole("button", { name: "Hide nested_rings" })).toBeVisible();
  await page.getByRole("button", { name: "Lock nested_rings" }).click();
  await expect(page.getByRole("button", { name: "Reorder nested_rings" })).toBeDisabled();
  await page.getByRole("button", { name: "More actions for nested_rings" }).click();
  for (const item of ["Rename", "Move up", "Move down", "Duplicate", "Delete"])
    await expect(page.getByRole("menuitem", { name: item })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Unlock nested_rings" }).click();

  // Rename with F2; Escape cancels, Enter commits; undo restores.
  const name = rowNamed(page, "adjacent_colors").locator("button[aria-pressed]");
  await name.focus();
  await page.keyboard.press("F2");
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");
  expect(await order(page)).toEqual(["nested_rings", "adjacent_colors"]);
  await name.focus();
  await page.keyboard.press("F2");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Colours");
  await page.keyboard.press("Enter");
  expect(await order(page)).toEqual(["nested_rings", "Colours"]);
  await undo(page);
  expect(await order(page)).toEqual(["nested_rings", "adjacent_colors"]);

  // Explicit Move up / Move down on the selection (one command each).
  await rowNamed(page, "adjacent_colors").locator("button[aria-pressed]").click();
  await page.getByRole("button", { name: "Move adjacent_colors up" }).click();
  expect(await order(page)).toEqual(["adjacent_colors", "nested_rings"]);
  await expect(page.getByRole("button", { name: "Move adjacent_colors up" })).toBeDisabled();
  await page.getByRole("button", { name: "Move adjacent_colors down" }).click();
  expect(await order(page)).toEqual(["nested_rings", "adjacent_colors"]);

  // Keyboard drag on the handle: Space, ArrowDown, Space = one reorder, one undo step.
  await page.getByRole("button", { name: "Reorder nested_rings" }).focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(() => order(page)).toEqual(["adjacent_colors", "nested_rings"]);
  const live = await page.locator('[aria-live="assertive"]').allTextContents();
  note("dnd-kit live region (name-based, D8)", live.join(" | "));
  expect(live.join(" ")).toContain("nested_rings dropped at position 2 of 2");
  await undo(page);
  expect(await order(page)).toEqual(["nested_rings", "adjacent_colors"]);

  // Pointer drag on the handle.
  const from = (await page.getByRole("button", { name: "Reorder adjacent_colors" }).boundingBox())!;
  const to = (await page.getByRole("button", { name: "Reorder nested_rings" }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(
      from.x + from.width / 2,
      from.y + from.height / 2 + ((to.y - from.y - 6) * i) / 12,
    );
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(["adjacent_colors", "nested_rings"]);
  // dnd-kit swallows clicks for 50 ms after a pointer drag ends (its click-after-drag guard);
  // a person cannot click that fast, an automated click can.
  await page.waitForTimeout(100);
  await undo(page);
  expect(await order(page)).toEqual(["nested_rings", "adjacent_colors"]);
  await redo(page);
  expect(await order(page)).toEqual(["adjacent_colors", "nested_rings"]);
});

test("selection: canvas click, Escape, layer row; Delete is undoable and skips locked", async ({
  page,
}) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);
  await selectOnCanvas(page);
  await expect(page.getByTestId("selection-outline")).toHaveCount(1);
  await expect(page.getByTestId("selection-name")).toHaveText(/^Path \d+$/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selection-outline")).toHaveCount(0);
  await rowNamed(page, "adjacent_colors").locator("button[aria-pressed]").click();
  await expect(page.getByTestId("selection-name")).toHaveText("adjacent_colors");
  await page.getByRole("button", { name: "Lock adjacent_colors" }).click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("layer-row")).toHaveCount(1);
  await expect(page.getByRole("note")).toContainText("Locked");
  await page.getByRole("button", { name: "Unlock adjacent_colors" }).click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("layer-row")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("layer-row")).toHaveCount(1);
});

const scale = (page: Page) => page.getByRole("slider", { name: "Scale" });
const scaleValue = async (page: Page) => Number(await scale(page).getAttribute("aria-valuenow"));

test("slider (Scale): name, value, keyboard steps coalesce into one undo entry", async ({
  page,
}) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png"); // the new layer is selected
  const s = scale(page);
  await expect(s).toHaveAttribute("aria-valuenow", "100");
  // Base UI renders a native range input: min/max are its own attributes.
  await expect(s).toHaveAttribute("min", "10");
  await expect(s).toHaveAttribute("max", "400");
  // D1: the thumb carries the name; D2: one thumb for one value.
  await expect(page.getByRole("slider")).toHaveCount(1);
  await s.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(s).toHaveAttribute("aria-valuenow", "105");
  // D7 / RFC §7: five keyboard commits are one history entry.
  await undo(page);
  await expect(s).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByTestId("layer-row")).toHaveCount(1); // the trace itself is still there
  await redo(page);
  await expect(s).toHaveAttribute("aria-valuenow", "105");
  // A focus change ends the run: 2 steps, blur, 2 steps = two entries.
  await undo(page);
  await s.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Reset" }).focus();
  await s.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(s).toHaveAttribute("aria-valuenow", "104");
  await undo(page);
  await expect(s).toHaveAttribute("aria-valuenow", "102");
  await undo(page);
  await expect(s).toHaveAttribute("aria-valuenow", "100");
});

test("slider (Scale): a pointer drag commits once; Escape during a drag cancels", async ({
  page,
}) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png");
  const thumb = (await scale(page).boundingBox())!;
  const track = (await page.locator('[data-slot="slider-track"]').first().boundingBox())!;
  const cy = thumb.y + thumb.height / 2;
  await page.mouse.move(thumb.x + thumb.width / 2, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(thumb.x + (i * track.width) / 40, cy);
  await page.mouse.up();
  const dragged = await scaleValue(page);
  note("value after a 10-move drag", dragged);
  expect(dragged).toBeGreaterThan(110);
  await undo(page);
  await expect(scale(page)).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByTestId("layer-row")).toHaveCount(1);
  // Escape mid-drag: nothing is committed.
  const t2 = (await scale(page).boundingBox())!;
  await page.mouse.move(t2.x + t2.width / 2, cy);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(t2.x + (i * track.width) / 40, cy);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(scale(page)).toHaveAttribute("aria-valuenow", "100");
  // No new history entry: the undone drag is still redoable (a commit would clear redo).
  await expect(page.getByRole("button", { name: "Redo" })).not.toHaveAttribute("aria-disabled");
});

test("numeric field: Enter commits, Escape reverts, arrow steps coalesce", async ({ page }) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png");
  const x = page.getByRole("textbox", { name: "X (px)" });
  const x0 = Number(await x.inputValue());
  await x.fill(String(x0 + 20));
  await x.press("Enter");
  await expect(x).toHaveValue(String(x0 + 20));
  await x.fill("999");
  await x.press("Escape");
  await expect(x).toHaveValue(String(x0 + 20));
  for (let i = 0; i < 3; i++) await x.press("ArrowUp");
  await expect(x).toHaveValue(String(x0 + 23));
  await undo(page); // the three arrow steps
  await expect(x).toHaveValue(String(x0 + 20));
  await undo(page); // the Enter commit
  await expect(x).toHaveValue(String(x0));
});

const fillTrigger = (page: Page) => page.getByRole("button", { name: /^Fill colour: #/ });
const fillHex = async (page: Page) =>
  /#[0-9a-f]{6}/.exec((await fillTrigger(page).getAttribute("aria-label"))!)![0];

test("colour picker: names, keyboard, hex draft, Apply once, Escape cancels", async ({ page }) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png", "Limited Palette");
  await selectOnCanvas(page);
  const original = await fillHex(page);
  const trigger = fillTrigger(page);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const area = page.getByRole("slider", { name: "Saturation and brightness" });
  await expect(area).toBeFocused(); // D5: keyboard-operable 2-D area, focused on open
  const text0 = await area.getAttribute("aria-valuetext");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");
  note("area value text", { before: text0, after: await area.getAttribute("aria-valuetext") });
  expect(await area.getAttribute("aria-valuetext")).not.toBe(text0);
  const hue = page.getByRole("slider", { name: "Hue" }); // D3: named thumbs
  await hue.focus();
  const h0 = Number(await hue.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowRight");
  await expect(hue).toHaveAttribute("aria-valuenow", String((h0 + 1) % 360));
  // D4: typing key by key keeps the draft text; Enter commits it to the draft colour.
  const hex = page.getByRole("textbox", { name: "Hex" });
  await hex.focus();
  await page.keyboard.press("ControlOrMeta+a");
  const typed: string[] = [];
  for (const ch of "#3366cc") {
    await page.keyboard.type(ch);
    typed.push(await hex.inputValue());
  }
  note("hex field after each key", typed);
  expect(typed).toEqual(["#", "#3", "#33", "#336", "#3366", "#3366c", "#3366cc"]);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("color-draft")).toHaveText("#3366cc");
  // Invalid text is reported and blocks Apply.
  await hex.fill("#33");
  await hex.press("Enter");
  await expect(hex).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  await hex.fill("#3366cc");
  await hex.press("Enter");
  // D6: one commit on Apply, focus back on the trigger.
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(fillTrigger(page)).toHaveAttribute("aria-label", /^Fill colour: #3366cc\./);
  await expect(fillTrigger(page)).toBeFocused();
  await undo(page);
  expect(await fillHex(page)).toBe(original);
  await redo(page);
  expect(await fillHex(page)).toBe("#3366cc");
  // Escape cancels: no change, no history entry.
  await fillTrigger(page).click();
  await page.getByRole("textbox", { name: "Hex" }).fill("#ff0000");
  await page.getByRole("textbox", { name: "Hex" }).press("Enter");
  await page.keyboard.press("Escape");
  await expect(area).toBeHidden();
  expect(await fillHex(page)).toBe("#3366cc");
  await expect(fillTrigger(page)).toBeFocused();
  // Apply without a change commits nothing: the next undo still reverts #3366cc.
  await fillTrigger(page).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await undo(page);
  expect(await fillHex(page)).toBe(original);
});

test("recolor: palette colours edit every path that uses them (one undo step)", async ({
  page,
}) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png", "Limited Palette");
  await page.getByRole("button", { name: "Recolor" }).click();
  const entries = page.getByRole("list", { name: "Palette colours" }).getByRole("listitem");
  expect(await entries.count()).toBeGreaterThan(1);
  const first = entries.first().getByRole("button", { name: /^Palette colour / });
  const before = await first.getAttribute("aria-label");
  await first.click();
  await page.getByRole("textbox", { name: "Hex" }).fill("#0a7f55");
  await page.getByRole("textbox", { name: "Hex" }).press("Enter");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(first).toHaveAttribute("aria-label", /#0a7f55\./);
  await canvasSettled(page);
  await undo(page);
  await expect(first).toHaveAttribute("aria-label", before!);
});

test("export: dialog focus management; SVG and PDF are real engine output", async ({ page }) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/nested_rings.png");
  const trigger = page.getByRole("button", { name: "Export", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Export artwork" });
  await expect(dialog).toBeVisible();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  await expect.poll(inside).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(i < 5 ? "Tab" : "Shift+Tab");
    await expect.poll(inside, { message: `focus escaped on Tab #${i + 1}` }).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole("textbox", { name: "File name" }).fill("rings");
  const [svg] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Export SVG" }).click(),
  ]);
  expect(svg.suggestedFilename()).toBe("rings.svg");
  const text = readFileSync((await svg.path())!, "utf8");
  const inventory = await page.evaluate((t) => {
    const doc = new DOMParser().parseFromString(t, "image/svg+xml");
    return {
      parseError: doc.querySelector("parsererror") !== null,
      paths: doc.querySelectorAll("path").length,
      rasters: doc.querySelectorAll("image, foreignObject").length,
    };
  }, text);
  note("svg inventory", inventory);
  expect(inventory).toMatchObject({ parseError: false, rasters: 0 });
  expect(inventory.paths).toBeGreaterThan(0);
  await expect(page.getByTestId("status")).toContainText("Exported rings.svg");

  await trigger.click();
  await dialog.getByRole("radio", { name: /^PDF/ }).check();
  const [pdf] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Export PDF" }).click(),
  ]);
  const bytes = readFileSync((await pdf.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  note("pdf bytes", bytes.byteLength);
});

// As the P0 privacy suite: offline after load (an offline reload is not exercised; Playwright
// Firefox refuses navigations in offline mode before the service worker can answer).
test("offline: once loaded, import, trace, edit and export work with no network", async ({
  page,
  context,
}) => {
  await openWorkspace(page);
  await expect(page.getByText("Offline ready")).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await importFixture(page, "procedural/nested_rings.png");
  await page.getByRole("button", { name: "Hide nested_rings" }).click();
  await canvasSettled(page);
  const [svg] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.getByRole("button", { name: "Export SVG" }).click();
    })(),
  ]);
  expect(svg.suggestedFilename()).toBe("artwork.svg");
  await expect(page.getByTestId("layer-row")).toHaveCount(1);
  await context.setOffline(false);
});
