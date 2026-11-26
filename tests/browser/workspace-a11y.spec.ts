// G-R1 §9: keyboard selection of individual vector paths, without a DOM element per object. The
// canvas is a focusable widget (role application, roledescription canvas): arrow keys walk the
// document tree, Enter/Space select, Shift toggles; a polite live region announces; the cursor's
// box is drawn; the focus ring is visible; the inspector is reachable from the canvas by Tab.
// Automated checks of keyboard behaviour and announced text, not a screen-reader test
// (VoiceOver is the owner checklist, docs/research/g-r1/VOICEOVER-CHECKLIST.md).
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { decodePng } from "./renderer/compare.ts";

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

type Rgb3 = [number, number, number];
const hex = (c: string): Rgb3 => {
  const m = /^rgba?\((\d+), (\d+), (\d+)/.exec(c);
  if (!m) throw new Error(`colour ${c}`);
  return [+m[1]!, +m[2]!, +m[3]!];
};
const near = (a: Rgb3, b: Rgb3, tol = 12) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
/** The rendered pixels of the canvas host's edge bands, from a screenshot of the host (not its
 *  computed style): at depth 1 CSS px (the ring's outer 2 px band) and 3 CSS px (its inner
 *  band), at 16 points along each of the four edges, away from the corners. */
async function edgeBands(page: Page) {
  const img = decodePng(await canvas(page).screenshot());
  // Screenshots are in device pixels (WebKit's Desktop Safari profile renders at 2×).
  const dpr = img.w / (await canvas(page).boundingBox())!.width;
  const at = (x: number, y: number): Rgb3 => {
    const i = 3 * (y * img.w + x);
    return [img.px[i]!, img.px[i + 1]!, img.px[i + 2]!];
  };
  const outer: Rgb3[] = [];
  const inner: Rgb3[] = [];
  const where: string[] = [];
  for (let k = 1; k <= 16; k++) {
    const x = Math.round((img.w * (k + 1)) / 18);
    const y = Math.round((img.h * (k + 1)) / 18);
    for (const [band, css] of [
      [outer, 1],
      [inner, 3],
    ] as const) {
      const d = Math.round(css * dpr);
      band.push(at(x, d), at(x, img.h - 1 - d), at(d, y), at(img.w - 1 - d, y));
      if (band === inner)
        where.push(`${x},${d}`, `${x},${img.h - 1 - d}`, `${d},${y}`, `${img.w - 1 - d},${y}`);
    }
  }
  return { outer, inner, where, size: `${img.w}×${img.h}` };
}

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
  // The focus ring is drawn (keyboard focus): rendered pixels, see the focus-ring test below.
  await expect(page.getByTestId("canvas-focus-ring")).toBeVisible();
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

test("canvas focus ring: rendered above every layer on keyboard focus, not on a pointer click", async ({
  page,
}) => {
  type Dbg = {
    __vectra: {
      canvas: {
        setView(s: number, x: number, y: number): void;
        hitDocument(x: number, y: number): string | null;
      };
    };
  };
  await page.goto("/workspace.html?debug=1");
  await importFixture(page, "nested_rings.png"); // 256 × 256 artboard; the layer is selected
  // Zoom so the artboard spans 4× the canvas, centred: artwork, paper and the selection overlay
  // lie under every edge, so the ring is checked over the canvas layers, not the bare surround.
  const box = (await canvas(page).boundingBox())!;
  const scale = (4 * Math.max(box.width, box.height)) / 256;
  const view = { scale, tx: box.width / 2 - 128 * scale, ty: box.height / 2 - 128 * scale };
  await page.evaluate(
    (v) => (window as unknown as Dbg).__vectra.canvas.setView(v.scale, v.tx, v.ty),
    view,
  );
  await expect(page.getByTestId("canvas-state")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("selection-bounds")).toHaveCount(1);
  // A visible point on a path, from the exact hit test (document coordinates → canvas pixels).
  const target = await page.evaluate(
    (v) => {
      const c = (window as unknown as Dbg).__vectra.canvas;
      for (let j = 1; j < 16; j++)
        for (let i = 1; i < 16; i++) {
          const cx = (v.w * i) / 16;
          const cy = (v.h * j) / 16;
          if (c.hitDocument((cx - v.tx) / v.scale, (cy - v.ty) / v.scale)) return [cx, cy];
        }
      return null;
    },
    { ...view, w: box.width, h: box.height },
  );
  expect(target).not.toBeNull();
  const [px, py] = [box.x + target![0]!, box.y + target![1]!];
  const ringEl = page.getByTestId("canvas-focus-ring");
  const colours = await ringEl.evaluate((el) => {
    const cs = getComputedStyle(el);
    const d = document.createElement("div");
    d.style.color = cs.getPropertyValue("--vx-focus-halo").trim();
    document.body.append(d);
    const halo = getComputedStyle(d).color;
    d.remove();
    return { ring: cs.outlineColor, halo };
  });
  const lime = hex(colours.ring);
  const halo = hex(colours.halo);
  // Unfocused: no ring.
  const select = page.getByRole("button", { name: "Select", exact: true });
  await select.focus();
  await expect(ringEl).toBeHidden();
  const before = await edgeBands(page);
  expect(before.outer.filter((c) => near(c, lime)).length).toBeLessThan(before.outer.length / 4);
  // Keyboard focus (Tab): the ring is drawn on every edge, above the canvases and the overlay.
  let reached = false;
  for (let i = 0; i < 20 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await canvas(page).evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  expect(await canvas(page).evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  await expect(ringEl).toBeVisible();
  const focused = await edgeBands(page);
  const off = (band: Rgb3[], want: Rgb3) =>
    band.flatMap((c, i) => (near(c, want) ? [] : [`${focused.where[i]}=${c.join(",")}`]));
  expect(off(focused.outer, lime), focused.size).toEqual([]);
  expect(off(focused.inner, halo), focused.size).toEqual([]);
  // The ring takes no pointer input: at the ring, the topmost element is a canvas layer, and a
  // click on a path still selects it through the hit test.
  const atRing = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.getAttribute("data-testid") ?? "other",
    [box.x + 1, box.y + box.height / 2],
  );
  expect(atRing).not.toBe("canvas-focus-ring");
  await page.mouse.click(px, py);
  await expect(page.getByTestId("selection-name")).toHaveText(/^Path \d+$/);
  // A pointer click from elsewhere focuses the canvas without the ring (focus-visible), and
  // selects as before.
  await page.evaluate(() =>
    (
      window as unknown as { __vectra: { workspace: { select(ids: string[]): void } } }
    ).__vectra.workspace.select([]),
  );
  await expect(page.getByTestId("selection-bounds")).toHaveCount(0);
  await select.click();
  await page.mouse.click(px, py);
  expect(await canvas(page).evaluate((el) => el === document.activeElement)).toBe(true);
  expect(await canvas(page).evaluate((el) => el.matches(":focus-visible"))).toBe(false);
  await expect(ringEl).toBeHidden();
  await expect(page.getByTestId("selection-name")).toHaveText(/^Path \d+$/);
  const clicked = await edgeBands(page);
  expect(clicked.outer.filter((c) => near(c, lime)).length).toBeLessThan(clicked.outer.length / 4);
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
