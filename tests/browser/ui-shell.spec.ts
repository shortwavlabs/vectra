// G-UI shell: CSP (with positive and negative controls), tool rail, dialog focus management,
// shortcuts guard, resizable panels, reduced motion, tokens and contrast — all on the
// production build (promoted from the R05-A harness suite).
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { EXPECTED_CSP, expect, note, openWorkspace, test } from "./ui-helpers.ts";

test("CSP header is the _headers policy; the shell loads clean; the detector fires", async ({
  page,
  guard,
}) => {
  const res = await openWorkspace(page);
  expect(res.headers()["content-security-policy"]).toBe(EXPECTED_CSP);
  await page.waitForTimeout(300);
  expect(await guard.drain("load")).toEqual([]);
  // Base UI ScrollArea is on screen; its scrollbar rule comes from our stylesheet.
  const hidden = page.locator(".base-ui-disable-scrollbar").first();
  await expect(hidden).toBeAttached();
  note(
    "scrollbar-width on .base-ui-disable-scrollbar",
    await hidden.evaluate((el) => getComputedStyle(el).scrollbarWidth ?? "unsupported"),
  );
  expect(await page.locator("style").count(), "inline <style> elements in the DOM").toBe(0);
  // Negative control: an injected inline <style> must be reported.
  const consoleBefore = guard.consoleErrors.length;
  await page.evaluate(() =>
    document.head.append(Object.assign(document.createElement("style"), { textContent: "b{}" })),
  );
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __csp: unknown[] }).__csp.length))
    .toBeGreaterThan(0);
  const control = await guard.drain("negative-control");
  note("negative control", control);
  expect(control[0]!.directive).toMatch(/^style-src/);
  guard.violations = guard.violations.filter((v) => v.step !== "negative-control");
  await page.waitForTimeout(100);
  guard.consoleErrors.splice(consoleBefore);
});

test("positive control: without CSPProvider, Base UI's inline <style> is blocked", async ({
  page,
  guard,
}) => {
  guard.expectClean = false;
  await openWorkspace(page, "?csp=default");
  await page.waitForTimeout(300);
  const load = await guard.drain("load (ScrollArea)");
  note("violations", load);
  expect(load.length).toBeGreaterThan(0);
  expect(load.every((v) => /^style-src/.test(v.directive))).toBe(true);
  const csp = /Content.Security.Policy|style-src|inline style|stylesheet/i;
  note(
    "expected CSP console messages",
    guard.consoleErrors.filter((e) => csp.test(e)),
  );
  expect(guard.consoleErrors.filter((e) => !csp.test(e))).toEqual([]);
});

test("tool rail: names, pressed state, unavailable tools explained and focusable", async ({
  page,
}) => {
  await openWorkspace(page);
  const rail = page.getByRole("navigation", { name: "Tools" });
  const names = await rail
    .getByRole("button")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(names).toEqual([
    "Select",
    "Trace",
    "Smooth, not available yet",
    "Simplify, not available yet",
    "Cleanup, not available yet",
    "Recolor",
  ]);
  await expect(rail.getByRole("button", { name: "Select" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const n of ["Smooth", "Simplify", "Cleanup"]) {
    const b = rail.getByRole("button", { name: new RegExp(`^${n},`) });
    await expect(b).toHaveAttribute("aria-disabled", "true");
    await expect(b).not.toHaveAttribute("aria-pressed");
  }
  // Keyboard: tooltip on focus, Enter selects, the unavailable tool does nothing.
  await rail.getByRole("button", { name: "Select" }).focus();
  const tip = page.locator('[data-slot="tooltip-content"][data-open]');
  await page.keyboard.press("Tab");
  await expect(tip).toContainText("Trace");
  await page.keyboard.press("Enter");
  await expect(rail.getByRole("button", { name: "Trace" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  await expect(tip).toContainText("Smooth, not available yet");
  await page.keyboard.press("Enter");
  await expect(rail.getByRole("button", { name: "Trace" })).toHaveAttribute("aria-pressed", "true");
  await expect(rail.getByRole("button", { name: "Recolor" })).toHaveAttribute(
    "aria-keyshortcuts",
    "R",
  );
});

test("shortcuts dialog: opens by key and button, traps focus, Escape returns focus", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.locator("body").click({ position: { x: 600, y: 400 } });
  await page.keyboard.press("Shift+?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const trigger = page.getByRole("button", { name: "Keyboard shortcuts" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  await expect.poll(inside, { message: "initial focus inside the dialog" }).toBe(true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(i < 3 ? "Tab" : "Shift+Tab");
    await expect.poll(inside, { message: `focus escaped on Tab #${i + 1}` }).toBe(true);
  }
  // Global shortcuts do not fire inside a dialog (the rest of the page is inert meanwhile).
  await page.keyboard.press("r");
  await expect(page.locator('nav button[aria-label="Select"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("global shortcuts: fire on the page, not in inputs", async ({ page }) => {
  await openWorkspace(page);
  const pressed = (name: string) =>
    expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator("body").click({ position: { x: 600, y: 400 } });
  await page.keyboard.press("t");
  await pressed("Trace");
  // In a form control (the preset radio group) the key is ignored.
  await page.getByRole("radio", { name: "Full Colour" }).focus();
  await page.keyboard.press("r");
  await pressed("Trace");
  await page.locator("body").click({ position: { x: 600, y: 400 } });
  await page.keyboard.press("r");
  await pressed("Recolor");
  await page.keyboard.press("v");
  await pressed("Select");
});

test("resizable panels: keyboard and pointer, inspector width within 288–336 px", async ({
  page,
}) => {
  await openWorkspace(page);
  const side = page.getByRole("complementary", { name: "Inspector" });
  const width = async () => (await side.boundingBox())!.width;
  const w0 = await width();
  const handle = page.getByRole("separator", { name: "Resize inspector" });
  await handle.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  const wk = await width();
  expect(wk).toBeLessThan(w0);
  expect(wk).toBeGreaterThanOrEqual(287.5);
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(hb.x + hb.width / 2 - i * 10, hb.y + 40);
  await page.mouse.up();
  const wp = await width();
  expect(wp).toBeGreaterThan(wk);
  expect(wp).toBeLessThanOrEqual(336.5);
  const v = page.getByRole("separator", { name: "Resize layers" });
  const h0 = (await side.boundingBox())!.height;
  await v.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  expect((await side.boundingBox())!.height).toBeGreaterThan(h0);
  note("inspector widths", { initial: w0, keyboard: wk, pointer: wp });
});

test("reduced motion: transitions collapse when the user asks for it", async ({ page }) => {
  await openWorkspace(page);
  const duration = () =>
    page
      .getByRole("button", { name: "Select" })
      .evaluate((el) => getComputedStyle(el).transitionDuration);
  const normal = await duration();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await duration();
  note("transition-duration", { normal, reduced });
  expect(parseFloat(normal)).toBeGreaterThan(0.05);
  const ms = parseFloat(reduced) * (reduced.endsWith("ms") ? 1 : 1000);
  expect(ms).toBeLessThan(0.02);
});

// WCAG 2.x relative luminance and contrast ratio.
const lum = (rgb: number[]) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

test("tokens: contrast table from the running build; dual focus ring", async ({
  page,
  browserName,
}) => {
  await openWorkspace(page);
  // Resolve every token to sRGB through the browser itself (computed colour of a probe).
  const tokens = await page.evaluate(() => {
    const names = [
      "background",
      "panel",
      "elevated",
      "canvas-surround",
      "paper",
      "foreground",
      "muted-foreground",
      "border",
      "control-border",
      "primary",
      "primary-foreground",
      "destructive",
      "warning",
      "ink-muted",
    ];
    const probe = document.createElement("i");
    document.body.append(probe);
    const out: Record<string, number[]> = {};
    for (const n of names) {
      probe.style.color = `var(--${n})`;
      out[n] = getComputedStyle(probe)
        .color.match(/\d+(\.\d+)?/g)!
        .slice(0, 3)
        .map(Number);
    }
    probe.remove();
    return out;
  });
  const surfaces = ["background", "panel", "elevated", "canvas-surround"];
  const rows: { pair: string; ratio: number; need: number; pass: boolean }[] = [];
  const add = (fg: string, bg: string, need: number) => {
    const r = Math.round(ratio(tokens[fg]!, tokens[bg]!) * 100) / 100;
    rows.push({ pair: `${fg} on ${bg}`, ratio: r, need, pass: r >= need });
  };
  for (const s of surfaces) {
    for (const t of ["foreground", "muted-foreground", "primary", "destructive", "warning"])
      add(t, s, 4.5);
    add("control-border", s, 3); // input outlines, slider tracks, resize grips
    add("primary", s, 3); // focus ring outer (lime)
  }
  add("primary-foreground", "primary", 4.5);
  // G-UI-R empty state: ink text printed on the paper sheet.
  add("background", "paper", 4.5);
  add("ink-muted", "paper", 4.5);
  add("background", "paper", 3); // focus ring inner ring on the artwork surface
  add("background", "primary", 3); // inner ring against a lime-filled control
  for (const s of surfaces)
    rows.push({
      pair: `border on ${s} (decorative only)`,
      ratio: Math.round(ratio(tokens.border!, tokens[s]!) * 100) / 100,
      need: 0,
      pass: true,
    });
  note("contrast", rows);
  if (browserName === "chromium") {
    const dir = resolve(import.meta.dirname, "../output/ui");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "contrast.json"), JSON.stringify({ tokens, rows }, null, 2));
  }
  expect(rows.filter((r) => !r.pass)).toEqual([]);

  // The focus ring as rendered: lime outline, 2 px offset filled by a dark inner ring.
  await page.getByRole("button", { name: "Select" }).focus();
  await page.keyboard.press("Tab");
  await page.waitForTimeout(400); // shadcn buttons transition their ring
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement!);
    return {
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      offset: cs.outlineOffset,
      shadow: cs.boxShadow,
    };
  });
  note("focus ring", ring);
  expect(ring.outline).toBe("solid 2px rgb(185, 232, 123)");
  expect(ring.offset).toBe("2px");
  expect(ring.shadow).toContain("rgb(25, 26, 28)");
});
