// R05-A: CSP, offline and keyboard/a11y checks of the design-system harness in three engines.
// Every test records CSP violations, console errors and off-host requests as annotations
// (read by summarize.mjs). Violations are drained per step so they can be attributed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

const ART = resolve(import.meta.dirname, "../../../../docs/research/rfc-002-review/artifacts/design-system");
const EXPECTED_CSP = readFileSync(resolve(import.meta.dirname, "../../../../public/_headers"), "utf8")
  .split("\n")
  .find((l) => l.trim().startsWith("Content-Security-Policy:"))!
  .split(/:(.*)/)[1]!
  .trim();

type Violation = { step: string; directive: string; blocked: string; source: string; line: number; sample: string };
type Guard = {
  steps: Violation[];
  external: string[];
  requests: string[];
  consoleErrors: string[];
  expectClean: boolean;
  drain: (step: string) => Promise<Violation[]>;
};

const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page, context }, use, info) => {
      const g: Guard = {
        steps: [],
        external: [],
        requests: [],
        consoleErrors: [],
        expectClean: true,
        drain: async (step) => {
          const v = await page.evaluate(() => (window as any).__csp.splice(0));
          const out = v.map((x: Omit<Violation, "step">) => ({ step, ...x }));
          g.steps.push(...out);
          return out;
        },
      };
      // Init scripts are injected by the automation protocol, not as inline page scripts.
      await context.addInitScript(() => {
        (window as any).__csp = [];
        document.addEventListener("securitypolicyviolation", (e) =>
          (window as any).__csp.push({
            directive: e.effectiveDirective,
            blocked: e.blockedURI,
            source: e.sourceFile,
            line: e.lineNumber,
            sample: e.sample,
          }),
        );
      });
      await context.route("**/*", (route) => {
        const u = new URL(route.request().url());
        if (u.protocol.startsWith("http") && u.hostname !== "127.0.0.1") {
          g.external.push(u.href);
          return route.abort();
        }
        return route.continue();
      });
      context.on("request", (r) => g.requests.push(r.url()));
      page.on("console", (m) => m.type() === "error" && g.consoleErrors.push(m.text()));
      page.on("pageerror", (e) => g.consoleErrors.push(`pageerror: ${e.message}`));
      await use(g);
      if (!page.isClosed()) await g.drain("end").catch(() => {});
      info.annotations.push(
        { type: "csp-violations", description: JSON.stringify(g.steps) },
        { type: "external-requests", description: JSON.stringify(g.external) },
        { type: "console-errors", description: JSON.stringify(g.consoleErrors) },
      );
      expect(g.external, "off-host requests").toEqual([]);
      if (g.expectClean) {
        expect(g.steps, "CSP violations").toEqual([]);
        expect(g.consoleErrors, "console errors").toEqual([]);
      }
    },
    { auto: true },
  ],
});

const note = (type: string, value: unknown) =>
  test.info().annotations.push({ type, description: typeof value === "string" ? value : JSON.stringify(value) });

async function open(page: Page, url = "/") {
  const res = await page.goto(url);
  await expect(page.getByTestId("canvas-size")).toContainText("backing");
  return res!;
}

async function tabTo(page: Page, testId: string, max = 30) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((id) => document.activeElement?.getAttribute("data-testid") === id, testId)) return i + 1;
  }
  throw new Error(`Tab never reached ${testId}`);
}

const text = async (page: Page, id: string) => (await page.getByTestId(id).textContent())!.trim();

test("CSP header is the _headers policy; mitigated build loads clean; detector fires", async ({ page, guard }) => {
  const res = await open(page);
  expect(res.headers()["content-security-policy"]).toBe(EXPECTED_CSP);
  await page.waitForTimeout(300);
  expect(await guard.drain("load")).toEqual([]);
  // Mitigation: Base UI's scrollbar-hiding class comes from our stylesheet instead of an inline <style>.
  const sw = await page.locator(".base-ui-disable-scrollbar").first().evaluate((el) => getComputedStyle(el).scrollbarWidth);
  note("scrollbar-width on .base-ui-disable-scrollbar", sw ?? "unsupported");
  expect(await page.locator("style").count(), "inline <style> elements in DOM").toBe(0);
  // Negative control on the same page: an injected inline <style> must be reported.
  const consoleBefore = guard.consoleErrors.length;
  await page.evaluate(() => document.head.append(Object.assign(document.createElement("style"), { textContent: "b{}" })));
  await expect.poll(async () => (await page.evaluate(() => (window as any).__csp.length))).toBeGreaterThan(0);
  const control = await guard.drain("negative-control-injected-style");
  note("control", control);
  expect(control[0]!.directive).toMatch(/^style-src/);
  guard.steps = guard.steps.filter((v) => v.step !== "negative-control-injected-style");
  await page.waitForTimeout(100);
  note("control console errors (expected, removed)", guard.consoleErrors.splice(consoleBefore));
});

test("positive control: without CSPProvider, Base UI inline <style> is blocked", async ({ page, guard }) => {
  guard.expectClean = false;
  await open(page, "/?csp=default");
  await page.waitForTimeout(300);
  const load = await guard.drain("load (ScrollArea)");
  // Select (inside the colour picker) also renders the style element when opened.
  await page.getByTestId("color-trigger").click();
  await page.getByRole("combobox").first().click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  const select = await guard.drain("open Select");
  note("violations", { load, select });
  expect(load.length + select.length).toBeGreaterThan(0);
  expect([...load, ...select].every((v) => /^style-src/.test(v.directive))).toBe(true);
  // Engine CSP console messages are expected here; keep them (Chromium prints the hash it would accept).
  note("expected CSP console messages", guard.consoleErrors.filter((e) => /Content.Security.Policy|style-src|inline style|stylesheet/i.test(e)));
  guard.consoleErrors = guard.consoleErrors.filter((e) => !/Content.Security.Policy|style-src|inline style|stylesheet/i.test(e));
  expect(guard.consoleErrors).toEqual([]);
});

test("tool rail: names, pressed state, tooltip on keyboard focus", async ({ page }) => {
  await open(page);
  const rail = page.getByRole("navigation", { name: "Tools" });
  const names = await rail.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(names).toEqual(["Select", "Trace", "Pen", "Smooth", "Simplify", "Cleanup", "Recolor"]);
  await expect(rail.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
  const tabs = await tabTo(page, "tool-select");
  note("tab presses to first tool", tabs);
  const tip = page.locator('[data-slot="tooltip-content"][data-open]');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Select");
  await page.keyboard.press("Tab");
  await expect(tip).toContainText("Trace");
  await page.keyboard.press("Enter");
  await expect(rail.getByRole("button", { name: "Trace" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
});

test("dialog: keyboard open, focus trap, Escape closes, focus returns", async ({ page }) => {
  await open(page);
  const trigger = page.getByRole("button", { name: "Export…" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  // Base UI moves initial focus into the popup after a frame, so poll rather than read once.
  await expect.poll(inside, { message: "initial focus inside dialog", timeout: 1000 }).toBe(true);
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(i < 5 ? "Tab" : "Shift+Tab");
    // Base UI focus guards hold focus for one task before redirecting it back inside.
    await expect.poll(inside, { message: `focus escaped on Tab #${i + 1}`, timeout: 1000 }).toBe(true);
    seen.add(await page.evaluate(() => { const e = document.activeElement!; return e.getAttribute("data-testid") ?? e.textContent!.trim(); }));
  }
  note("focus stops visited inside dialog", [...seen]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("popover: keyboard open/close and focus return", async ({ page }) => {
  await open(page);
  const trigger = page.getByRole("button", { name: "View options" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const pop = page.getByTestId("view-popover");
  await expect(pop).toBeVisible();
  note("focus moved into popover", await page.evaluate(() => !!document.activeElement?.closest('[data-testid="view-popover"]')));
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press(" ");
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
});

test("slider: transient previews vs commits (keyboard and drag)", async ({ page }) => {
  await open(page);
  const thumb = page.getByRole("slider", { name: "Detail" });
  await thumb.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("committed")).toHaveText("55");
  const kb = { previews: Number(await text(page, "previews")), commits: Number(await text(page, "commits")) };
  note("keyboard 5x ArrowRight", kb);
  const box = (await page.getByTestId("detail-slider").boundingBox())!;
  const tb = (await thumb.locator("xpath=..").boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(tb.x + tb.width / 2 - i * (box.width / 25), tb.y + tb.height / 2);
  await page.mouse.up();
  const drag = {
    previews: Number(await text(page, "previews")) - kb.previews,
    commits: Number(await text(page, "commits")) - kb.commits,
    committed: await text(page, "committed"),
  };
  note("mouse drag (10 moves)", drag);
  expect(drag.previews).toBeGreaterThan(1);
  expect(drag.commits).toBe(1);
});

test("numeric input: commit on Enter, clamp, Escape reverts", async ({ page }) => {
  await open(page);
  const input = page.getByTestId("detail-input");
  await input.fill("73");
  await input.press("Enter");
  await expect(page.getByTestId("committed")).toHaveText("73");
  await expect(page.getByRole("slider", { name: "Detail" })).toHaveAttribute("aria-valuenow", "73");
  await input.fill("250");
  await input.press("Enter");
  await expect(page.getByTestId("committed")).toHaveText("100");
  await input.fill("12");
  await input.press("Escape");
  await expect(input).toHaveValue("100");
  await expect(page.getByTestId("commits")).toHaveText("2");
});

test("colour picker: keyboard, hex entry, Apply commits once, Escape cancels", async ({ page }) => {
  await open(page);
  const previews = async () => Number(await text(page, "color-previews"));
  note("onValueChange calls on mount, no interaction", await previews());
  const trigger = page.getByTestId("color-trigger");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("color-content")).toBeVisible();
  note("area tabIndex (2D saturation/value area)", await page.getByTestId("color-area").evaluate((el) => (el as HTMLElement).tabIndex));
  const hue = page.getByRole("slider", { name: "Hue" });
  await hue.focus();
  const p0 = await previews();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(previews).toBeGreaterThan(p0);
  note("onValueChange calls for 2 hue ArrowRight presses", (await previews()) - p0);
  const hex = page.getByLabel("Hex color value");
  // Real key-by-key typing (what a keyboard user does) vs programmatic fill.
  await hex.focus();
  await page.keyboard.press("ControlOrMeta+a");
  const typed: string[] = [];
  for (const ch of "#3366cc") {
    await page.keyboard.type(ch);
    typed.push(`${ch}→${await hex.inputValue()}`);
  }
  note("hex field after each typed key of '#3366cc' (select-all first)", typed);
  await hex.fill("#ff8800");
  await expect(hex).toHaveValue("#ff8800");
  // Base UI Select (format) inside the popover: keyboard open, Escape closes only the Select.
  await page.getByRole("combobox").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(page.getByTestId("color-content")).toBeVisible();
  await expect(page.getByTestId("color-commits")).toHaveText("0");
  await page.getByTestId("color-apply").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("color-content")).toBeHidden();
  await expect(page.getByTestId("color-committed")).toHaveText("#ff8800");
  await expect(page.getByTestId("color-commits")).toHaveText("1");
  note("focus returned to trigger after Apply", await trigger.evaluate((el) => el === document.activeElement));
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Hex color value").fill("#0000ff");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("color-content")).toBeHidden();
  await expect(page.getByTestId("color-committed")).toHaveText("#ff8800");
  await expect(page.getByTestId("color-commits")).toHaveText("1");
});

const order = (page: Page) => page.getByTestId("layer-name").allTextContents();

test("sortable: keyboard reorder (Space, ArrowDown, Space)", async ({ page }) => {
  await open(page);
  await page.getByTestId("handle-ink-1").focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(() => order(page)).toEqual(["Ink 2", "Ink 1", "Ink 3", "Source"]);
  await expect(page.getByTestId("moves")).toHaveText("1");
  const live = await page.locator('[role="status"][aria-live="assertive"], [aria-live="assertive"]').allTextContents();
  note("dnd-kit live region text", live.join(" | "));
  await expect(page.getByTestId("handle-source")).toBeDisabled();
});

test("sortable: mouse drag reorder", async ({ page }) => {
  await open(page);
  const from = (await page.getByTestId("handle-ink-3").boundingBox())!;
  const to = (await page.getByTestId("handle-ink-1").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + ((to.y - from.y - 4) * i) / 12);
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(["Ink 3", "Ink 1", "Ink 2", "Source"]);
  await expect(page.getByTestId("moves")).toHaveText("1");
});

test("resizable: keyboard and pointer resize update canvas CSS and backing size", async ({ page }) => {
  await open(page);
  const parse = async () => {
    const m = (await text(page, "canvas-size")).match(/CSS (\d+)×(\d+) px · DPR ([\d.]+) · backing (\d+)×(\d+)/)!;
    return { w: +m[1]!, h: +m[2]!, dpr: +m[3]!, bw: +m[4]!, bh: +m[5]! };
  };
  // ResizeObserver output lags input; read only once two samples 150 ms apart agree.
  const settled = async () => {
    for (;;) {
      const a = await parse();
      await page.waitForTimeout(150);
      const b = await parse();
      if (a.w === b.w && a.bw === b.bw) return b;
    }
  };
  const before = await settled();
  const handle = page.getByRole("separator", { name: "Resize inspector" });
  await handle.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  const kb = await settled();
  expect(kb.w).toBeLessThan(before.w);
  // Displayed CSS size is rounded; backing is round(fractional width × DPR), so allow ≤ 1 device px per DPR.
  expect(Math.abs(kb.bw - kb.w * kb.dpr)).toBeLessThanOrEqual(kb.dpr);
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(hb.x + hb.width / 2 + i * 10, hb.y + hb.height / 2);
  await page.mouse.up();
  const ptr = await settled();
  expect(ptr.w).toBeGreaterThan(kb.w);
  note("canvas sizes", { before, keyboard: kb, pointer: ptr, ariaValueNow: await handle.getAttribute("aria-valuenow") });
});

test("file input: keyboard-opened chooser, local File only, zero requests", async ({ page, guard }) => {
  await open(page);
  await page.waitForLoadState("networkidle");
  const n = guard.requests.length;
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("file-trigger").focus();
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({ name: "private-artwork.png", mimeType: "image/png", buffer: Buffer.alloc(2048, 7) });
  await expect(page.getByTestId("file-item")).toContainText("private-artwork.png");
  await page.waitForTimeout(500);
  const during = guard.requests.slice(n);
  note("requests during file selection", during);
  expect(during).toEqual([]);
});

test("global shortcut: fires on canvas, not in inputs or dialogs", async ({ page }) => {
  await open(page);
  await page.locator("body").click({ position: { x: 300, y: 300 } });
  await page.keyboard.press("p");
  await expect(page.getByTestId("active-tool")).toHaveText("pen");
  await page.getByTestId("detail-input").focus();
  await page.keyboard.press("v");
  await expect(page.getByTestId("active-tool")).toHaveText("pen");
  await page.getByRole("button", { name: "Export…" }).click();
  await page.getByTestId("export-name").focus();
  await page.keyboard.type("v");
  await expect(page.getByTestId("export-name")).toHaveValue("artwork.svgv");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("v");
  await expect(page.getByTestId("active-tool")).toHaveText("pen");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.locator("body").click({ position: { x: 300, y: 300 } });
  await page.keyboard.press("v");
  await expect(page.getByTestId("active-tool")).toHaveText("select");
});

test("screenshot", async ({ page, browserName, guard }) => {
  await open(page);
  await page.waitForTimeout(300);
  expect(await guard.drain("before screenshot")).toEqual([]);
  const consoleBefore = guard.consoleErrors.length;
  // caret: "initial" avoids Playwright's caret-hiding style injection.
  await page.screenshot({ path: `${ART}/harness-${browserName}.png`, scale: "css", caret: "initial" });
  if (browserName === "chromium") {
    await page.getByTestId("color-trigger").click();
    await expect(page.getByTestId("color-content")).toBeVisible();
    await page.screenshot({ path: `${ART}/harness-chromium-color-picker.png`, scale: "css", caret: "initial" });
  }
  note("violations after screenshot (tool-induced, not app)", await guard.drain("after screenshot"));
  note("console errors after screenshot (tool-induced, not app)", guard.consoleErrors.splice(consoleBefore));
  guard.steps = guard.steps.filter((v) => v.step !== "after screenshot");
});
