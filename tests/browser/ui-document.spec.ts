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
  await expect(page.getByTestId("canvas-host")).toBeVisible();
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
  await expect(page.getByTestId("selection-bounds")).toHaveCount(0);
  await selectOnCanvas(page);
  await expect(page.getByTestId("selection-bounds")).toHaveCount(1);
  await expect(page.getByTestId("selection-name")).toHaveText(/^Path \d+$/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selection-bounds")).toHaveCount(0);
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

// The trigger names one colour ("Fill colour: #rrggbb. Edit colour") or, when the selected
// paths' fills differ, none ("Fill colour: mixed. Edit colour").
const fillTrigger = (page: Page) => page.getByRole("button", { name: /^Fill colour: / });
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

test("keyboard only: select a layer in Layers and fill its paths", async ({ page }) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png", "Limited Palette");
  await page.keyboard.press("Escape");
  await rowNamed(page, "adjacent_colors").locator("button[aria-pressed]").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selection-name")).toHaveText("adjacent_colors");
  await expect(page.getByTestId("fill-note")).toContainText(/Applies to [\d,]+ paths/);
  // The layer's paths have different fills: the control names no single colour before Apply.
  await expect(fillTrigger(page)).toHaveAttribute("aria-label", "Fill colour: mixed. Edit colour");
  await expect(fillTrigger(page)).toContainText("Mixed");
  await expect(fillTrigger(page)).not.toContainText("#");
  await expect(page.getByTestId("fill-note")).toContainText("Their fills differ");
  await fillTrigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Current mixed")).toBeVisible();
  await page.getByRole("textbox", { name: "Hex" }).focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("#2050a0");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Apply" }).focus();
  await page.keyboard.press("Enter");
  await expect(fillTrigger(page)).toHaveAttribute("aria-label", /^Fill colour: #2050a0\./);
  // Every path of the layer now has that fill.
  await selectOnCanvas(page);
  expect(await fillHex(page)).toBe("#2050a0");
  await undo(page);
  expect(await fillHex(page)).not.toBe("#2050a0");
});

test("recolor: palette colours edit every path that uses them (one undo step)", async ({
  page,
}) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png", "Limited Palette");
  await page.getByRole("button", { name: "Recolor" }).click();
  const entries = page.getByRole("list", { name: "Palette colours" }).getByRole("listitem");
  expect(await entries.count()).toBeGreaterThan(1);
  // Locks protect against transforms and deletion, not against a global palette edit.
  await expect(page.getByTestId("recolor-note")).toHaveText(
    "A palette edit recolours every path that uses that colour, including locked paths: locks prevent transforms and deletion, not palette edits.",
  );
  const first = entries.first().getByRole("button", { name: /^Colour \d+: #[0-9a-f]{6}\./ });
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

/** Drops a generated image onto the canvas (the same path as a dragged file). */
async function dropGenerated(page: Page, o: { width: number; height: number; name: string }) {
  await page.evaluate(async ({ width, height, name }) => {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f0e8d8";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 60% ${25 + (i % 50)}%)`;
      ctx.beginPath();
      const x = (((i * 7919) % 1000) / 1000) * width;
      const y = (((i * 104729) % 1000) / 1000) * height;
      ctx.arc(x, y, ((4 + (i % 25)) * width) / 1000, 0, Math.PI * 2);
      ctx.fill();
    }
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], name, { type: "image/png" }));
    const target = document.querySelector('[data-testid="canvas-host"]')!;
    target.dispatchEvent(
      new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  }, o);
}

test("drop, cancel and failure: a cancelled or failed import leaves no document", async ({
  page,
}) => {
  await openWorkspace(page);
  // A file that is not an image is rejected before any job.
  await page.getByTestId("import-input").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is not a PNG file at all"),
  });
  await expect(page.getByTestId("status")).toContainText("Import failed");
  await expect(page.getByTestId("document-title")).toHaveText("No document");
  // A long trace (Full Colour, 3000×3000) cancelled from the status bar.
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await page.getByRole("radio", { name: "Full Colour" }).check();
  await dropGenerated(page, { width: 3000, height: 3000, name: "large.png" });
  // Cancel during the trace itself (the same button also cancels during preparation).
  await expect(page.getByTestId("status")).toContainText("Tracing large.png", { timeout: 30_000 });
  await page.getByRole("button", { name: "Cancel import" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Trace cancelled; the document is unchanged",
  );
  await expect(page.getByTestId("document-title")).toHaveText("No document");
  await expect(page.getByTestId("layer-row")).toHaveCount(0);
  // The same drop path, small enough to finish.
  await dropGenerated(page, { width: 320, height: 200, name: "dropped.png" });
  await expect(page.getByTestId("status")).toContainText("Traced dropped.png", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("layer-row")).toHaveCount(1);
});

test("layers menu: Rename, Move up/down, Duplicate and Delete, each one undo step", async ({
  page,
}) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png");
  await importFixture(page, "procedural/nested_rings.png");
  const menu = async (layer: string, item: string) => {
    await page.getByRole("button", { name: `More actions for ${layer}` }).click();
    await page.getByRole("menuitem", { name: item }).click();
  };
  await menu("adjacent_colors", "Move up");
  expect(await order(page)).toEqual(["adjacent_colors", "nested_rings"]);
  await menu("adjacent_colors", "Move down");
  expect(await order(page)).toEqual(["nested_rings", "adjacent_colors"]);
  await menu("nested_rings", "Duplicate");
  await expect(page.getByTestId("layer-row")).toHaveCount(3);
  await undo(page);
  await expect(page.getByTestId("layer-row")).toHaveCount(2);
  await menu("nested_rings", "Delete");
  expect(await order(page)).toEqual(["adjacent_colors"]);
  await undo(page);
  expect(await order(page)).toEqual(["nested_rings", "adjacent_colors"]);
  await menu("nested_rings", "Rename");
  const input = page.getByRole("textbox", { name: "Name of nested_rings" });
  await expect(input).toBeFocused();
  await input.fill("Rings");
  await input.press("Enter");
  expect(await order(page)).toEqual(["Rings", "adjacent_colors"]);
});

test("layer rows fit the panel at its minimum and maximum width", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openWorkspace(page);
  await importFixture(page, "external/hokusai-great-wave-640.jpg");
  await page.getByRole("button", { name: /^Expand / }).click();
  const handle = page.getByRole("separator", { name: "Resize inspector" });
  for (const key of ["ArrowRight", "ArrowLeft"]) {
    await handle.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press(key);
    const panel = (await page.getByRole("region", { name: "Layers" }).boundingBox())!;
    const rows = await page.getByTestId("layer-row").all();
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const b = (await row.boundingBox())!;
      const more = (await row.getByRole("button", { name: /^More actions/ }).boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
      expect(more.x + more.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    }
    note(`layers panel width after ${key}`, panel.width);
  }
});

// G-UI-R: at 1366×768 the Fill section was cut off at the inspector/layers split. On small
// laptops the whole Fill section (trigger and note) must be visible without scrolling.
test("small laptops: the inspector shows Fill without scrolling", async ({ page }) => {
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await openWorkspace(page);
    await importFixture(page, "external/hokusai-great-wave-640.jpg"); // the layer is selected
    const viewport = page
      .getByRole("complementary", { name: "Inspector" })
      .locator('[data-slot="scroll-area-viewport"]');
    const visible = async (what: string) => {
      const v = (await viewport.boundingBox())!;
      for (const el of [fillTrigger(page), page.getByTestId("fill-note")]) {
        const b = (await el.boundingBox())!;
        expect(b.y + b.height, `${what} at ${size.width}×${size.height}`).toBeLessThanOrEqual(
          v.y + v.height + 0.5,
        );
      }
      note(`inspector space left below Fill, ${what}, ${size.width}×${size.height}`, {
        px: Math.round(
          v.y +
            v.height -
            (await page.getByTestId("fill-note").evaluate((e) => e.getBoundingClientRect().bottom)),
        ),
      });
    };
    await visible("layer selected");
    await selectOnCanvas(page);
    await visible("path selected");
  }
});

test("canvas zoom and fit; rotate and reset in the inspector", async ({ page }) => {
  await openWorkspace(page);
  await importFixture(page, "external/hokusai-great-wave-640.jpg");
  const zoom = page.getByTestId("zoom");
  const fit = (await zoom.textContent())!;
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect(parseInt((await zoom.textContent())!)).toBeGreaterThan(parseInt(fit));
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  expect(parseInt((await zoom.textContent())!)).toBeLessThan(parseInt(fit));
  await page.getByRole("button", { name: "Fit artboard" }).click();
  await expect(zoom).toHaveText(fit);
  // The same with the keyboard shortcuts (+, −, Shift+1).
  await page.keyboard.press("+");
  expect(parseInt((await zoom.textContent())!)).toBeGreaterThan(parseInt(fit));
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  expect(parseInt((await zoom.textContent())!)).toBeLessThan(parseInt(fit));
  await page.keyboard.press("Shift+Digit1");
  await expect(zoom).toHaveText(fit);
  // A quarter turn of the selected layer swaps its size; undo restores it.
  const size = page.getByText(/^Size [\d.]+ × [\d.]+ px$/);
  const [w, h] = (await size.textContent())!.match(/[\d.]+/g)!;
  await page.getByRole("button", { name: "Rotate 90° clockwise" }).click();
  await expect(size).toHaveText(`Size ${h} × ${w} px`);
  await undo(page);
  await expect(size).toHaveText(`Size ${w} × ${h} px`);
  // Reset returns the scale to 100 %.
  const value = page.getByRole("textbox", { name: "Scale value (%)" });
  await value.fill("150");
  await value.press("Enter");
  await expect(scale(page)).toHaveAttribute("aria-valuenow", "150");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(scale(page)).toHaveAttribute("aria-valuenow", "100");
});

test("the canvas catches up with rapid keyboard edits; no export job is involved", async ({
  page,
}) => {
  await openWorkspace(page, "?debug=1");
  await importFixture(page, "external/hokusai-great-wave-640.jpg", "Limited Palette");
  type Probe = {
    canvas: {
      diag(): {
        lastExact: { renderRevision: number } | null;
        renderRevision: number;
        documentRevision: number;
      };
    };
    workspace: { revision(): number; jobsSubmitted(): number };
  };
  const probe = () =>
    page.evaluate(() => {
      const v = (window as unknown as { __vectra: Probe }).__vectra;
      const d = v.canvas.diag();
      return {
        revision: v.workspace.revision(),
        drawn: d.documentRevision,
        exactIsLatest: d.lastExact?.renderRevision === d.renderRevision,
        jobs: v.workspace.jobsSubmitted(),
      };
    });
  const before = await probe();
  await scale(page).focus();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(50);
  }
  await canvasSettled(page);
  await expect.poll(probe, { timeout: 30_000 }).toEqual({
    revision: before.revision + 10,
    drawn: before.revision + 10,
    exactIsLatest: true,
    jobs: before.jobs, // the canvas renders the document directly: no job per edit
  });
  // Undo works from the focused slider (a range input edits no text).
  await page.keyboard.press("ControlOrMeta+z");
  await expect(scale(page)).toHaveAttribute("aria-valuenow", "100");
});

test("control boundaries and the OS colour scheme, measured in the running build", async ({
  page,
  browserName,
}) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png");
  const measure = () =>
    page.evaluate(() => {
      const rgb = (c: string) =>
        c
          .match(/\d+(\.\d+)?/g)!
          .slice(0, 3)
          .map(Number);
      const css = (sel: string, prop: string) =>
        rgb(getComputedStyle(document.querySelector(sel)!).getPropertyValue(prop));
      const imp = 'header button[class*="border-control-border"]';
      return {
        panel: css('[aria-label="Inspector"]', "background-color"),
        inputBorder: css('input[aria-label="X (px)"]', "border-top-color"),
        sliderTrack: css('[data-slot="slider-track"]', "background-color"),
        resizeGrip: css('[data-slot="resizable-handle"] > div', "background-color"),
        importButton: [...css(imp, "background-color"), ...css(imp, "border-top-color")],
      };
    });
  const light = await measure();
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await measure();
  expect(dark, "the OS colour scheme changes nothing").toEqual(light);
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return Math.round(((x! + 0.05) / (y! + 0.05)) * 100) / 100;
  };
  const rows = {
    "input border vs panel": ratio(light.inputBorder, light.panel),
    "slider track vs panel": ratio(light.sliderTrack, light.panel),
    "resize grip vs background": ratio(light.resizeGrip, [25, 26, 28]),
  };
  note(`computed control contrast (${browserName})`, { ...rows, colours: light });
  for (const r of Object.values(rows)) expect(r).toBeGreaterThanOrEqual(3);
});

// Maintainer review of G-UI-R: the engine's generated palette names (p0…, c0…, ink) are shown
// as "Colour N+1", N being the number in the name, never the list position; the document and
// its exports keep the engine's names.
test("palette names: Colour N+1 on screen, the engine's names in the export", async ({ page }) => {
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png", "Limited Palette");
  const exportSvg = async () => {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const [d] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export SVG" }).click(),
    ]);
    return readFileSync((await d.path())!, "utf8");
  };
  const before = await exportSvg();
  // The engine's palette ids as exported: `class="pN"` on each path, with its fill.
  const fills = new Map<string, string>();
  for (const m of before.matchAll(/fill="(#[0-9a-f]{6})"[^>]*class="(p\d+)"/g))
    fills.set(m[2]!, m[1]!);
  note("exported palette", Object.fromEntries(fills));
  expect(fills.size).toBeGreaterThan(1);
  expect(before).not.toContain("Colour");

  // Recolor: every entry is "Colour N", and Colour N is the engine's p(N−1).
  await page.getByRole("button", { name: "Recolor" }).click();
  const list = page.getByRole("list", { name: "Palette colours" });
  const names = await list
    .getByRole("button")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!));
  note("recolor names", names);
  const shown = names.map((n) => /^Colour (\d+): (#[0-9a-f]{6})\. Edit colour$/.exec(n)!);
  expect(shown.every(Boolean), names.join(" | ")).toBe(true);
  for (const m of shown) expect(fills.get(`p${Number(m[1]) - 1}`)).toBe(m[2]);
  // The list is in first-use order, so the numbers are not the positions.
  expect(shown.map((m) => Number(m[1]))).not.toEqual(shown.map((_, i) => i + 1));
  await expect(list).not.toContainText(/\bp\d/);
  // The picker's document swatches use the same names.
  await list.getByRole("button").first().click();
  const swatches = await page
    .getByRole("group", { name: "Document colours" })
    .getByRole("button")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!));
  expect(swatches.length).toBe(names.length);
  for (const s of swatches) expect(s).toMatch(/^Use Colour \d+, #[0-9a-f]{6}$/);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // The Fill note of a single path names its palette colour the same way.
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await selectOnCanvas(page);
  const uses = /Uses Colour (\d+) from the palette/.exec(
    (await page.getByTestId("fill-note").textContent())!,
  );
  expect(uses).not.toBeNull();
  expect(fills.get(`p${Number(uses![1]) - 1}`)).toBe(await fillHex(page));
  // Its layer row says it holds the selection (in words, not colour alone).
  await expect(rowNamed(page, "adjacent_colors")).toContainText("Contains selection");
  // Nothing shown on screen reaches the document: the export is byte for byte the same.
  expect(await exportSvg()).toBe(before);
});

// Maintainer review: Layers never collapse by themselves (no height breakpoint). The header's
// disclosure collapses them to the header and restores them; the split stays resizable.
test("layers: an explicit collapse control at 1024×640, 1280×720 and 1366×768", async ({
  page,
}) => {
  const toggle = page.getByRole("button", { name: "Layers", exact: true });
  const panel = page.getByRole("region", { name: "Layers" });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const rows = page.getByTestId("layer-row");
  const height = async (l: typeof panel) => Math.round((await l.boundingBox())!.height);
  for (const size of [
    { width: 1024, height: 640 },
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
  ]) {
    const at = `${size.width}×${size.height}`;
    await page.setViewportSize(size);
    await openWorkspace(page);
    await importFixture(page, "procedural/adjacent_colors.png");
    // Expanded on load at every size.
    await expect(toggle, at).toHaveAttribute("aria-expanded", "true");
    await expect(rows.first(), at).toBeVisible();
    const open = { layers: await height(panel), inspector: await height(inspector) };
    expect(open.layers, at).toBeGreaterThanOrEqual(120);
    const t = (await toggle.boundingBox())!;
    expect(t.y + t.height, `${at}: the control is on screen`).toBeLessThanOrEqual(size.height);
    // Collapse: the header stays, the rows leave the page (no hidden Tab stops).
    await toggle.click();
    await expect(toggle, at).toHaveAttribute("aria-expanded", "false");
    await expect(rows.first(), at).toBeHidden();
    await expect.poll(() => height(panel), { message: at }).toBeLessThanOrEqual(37);
    expect(await height(inspector), at).toBeGreaterThan(open.inspector);
    // Keyboard: the same control expands them to their previous size.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle, at).toHaveAttribute("aria-expanded", "true");
    await expect(rows.first(), at).toBeVisible();
    await expect.poll(() => height(panel), { message: at }).toBe(open.layers);
    note(`layers at ${at}`, open);
  }
  // A shorter window never collapses them: near their minimum at 1366×768, then 1024×640.
  const separator = page.getByRole("separator", { name: "Resize layers" });
  const drag = async (dy: number) => {
    const s = (await separator.boundingBox())!;
    const [x, y] = [s.x + s.width / 2, s.y + s.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x, y + (dy * i) / 10);
    await page.mouse.up();
  };
  await drag((await height(panel)) - 125);
  expect(await height(panel)).toBeLessThan(140);
  await page.setViewportSize({ width: 1024, height: 640 });
  // (Chromium lays out one frame at the relative size before the panel restores its pixels.)
  await expect.poll(() => height(panel)).toBeGreaterThanOrEqual(120);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rows.first()).toBeVisible();
  // A drag of the split past the minimum collapses them; the control follows. The pointer
  // stays inside the window (WebKit drops moves outside it).
  await drag((await height(panel)) - 10);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(rows.first()).toBeHidden();
});

// Maintainer review: a healthy renderer is not shown; the fallback, a recovery and a failure
// are. `?renderer=main` takes the client's fallback path (a deterministic fallback).
test("renderer: the main-thread fallback is disclosed; a healthy worker is silent", async ({
  page,
}) => {
  const renderer = page.getByTestId("canvas-state");
  await openWorkspace(page);
  await importFixture(page, "procedural/adjacent_colors.png");
  await expect(renderer).toHaveAttribute("data-host", "worker");
  await expect(renderer).toHaveText("");
  await openWorkspace(page, "?renderer=main");
  await importFixture(page, "procedural/adjacent_colors.png");
  await expect(renderer).toHaveAttribute("data-state", "ready");
  await expect(renderer).toHaveAttribute("data-host", "main-thread");
  await expect(renderer).toHaveAttribute("role", "status");
  await expect(renderer).toBeVisible();
  await expect(renderer).toHaveText(
    "Renderer: main thread (fallback: main-thread renderer selected)",
  );
});
