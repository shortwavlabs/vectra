// G-UI workspace specs (promoted from the R05-A harness suite). Every test runs against the
// production build under the production CSP and records, per step, CSP violations, console
// errors and requests; off-host requests are aborted and fail the test. Violations are drained
// before screenshots, because Playwright's WebKit screenshot injects a <style> (R05-A §6).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

export const EXPECTED_CSP = readFileSync(
  resolve(import.meta.dirname, "../../public/_headers"),
  "utf8",
)
  .split("\n")
  .find((l) => l.trim().startsWith("Content-Security-Policy:"))!
  .split(/:(.*)/)[1]!
  .trim();

export const FIXTURES = resolve(import.meta.dirname, "../fixtures");
export const SHOTS = resolve(import.meta.dirname, "../../docs/research/g-ui/screenshots");

export type Violation = {
  step: string;
  directive: string;
  blocked: string;
  source: string;
  sample: string;
};
export type Guard = {
  violations: Violation[];
  external: string[];
  requests: string[];
  consoleErrors: string[];
  expectClean: boolean;
  drain: (step: string) => Promise<Violation[]>;
};

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page, context, baseURL }, use, info) => {
      const host = new URL(baseURL!).host;
      const g: Guard = {
        violations: [],
        external: [],
        requests: [],
        consoleErrors: [],
        expectClean: true,
        drain: async (step) => {
          const v = (await page.evaluate(() =>
            (window as unknown as { __csp: Omit<Violation, "step">[] }).__csp.splice(0),
          )) as Omit<Violation, "step">[];
          const out = v.map((x) => ({ step, ...x }));
          g.violations.push(...out);
          return out;
        },
      };
      // Init scripts are injected by the automation protocol, not as inline page scripts.
      await context.addInitScript(() => {
        const w = window as unknown as { __csp: unknown[] };
        w.__csp = [];
        document.addEventListener("securitypolicyviolation", (e) =>
          w.__csp.push({
            directive: e.effectiveDirective,
            blocked: e.blockedURI,
            source: e.sourceFile,
            sample: e.sample,
          }),
        );
      });
      await context.route("**/*", (route) => {
        const u = new URL(route.request().url());
        if (u.protocol.startsWith("http") && u.host !== host) {
          g.external.push(u.href);
          return route.abort();
        }
        return route.continue();
      });
      context.on("request", (r) => g.requests.push(r.url()));
      page.on("console", (m) => {
        if (m.type() === "error") g.consoleErrors.push(m.text());
      });
      page.on("pageerror", (e) => g.consoleErrors.push(`pageerror: ${e.message}`));
      await use(g);
      if (!page.isClosed()) await g.drain("end").catch(() => {});
      info.annotations.push(
        { type: "csp-violations", description: JSON.stringify(g.violations) },
        { type: "external-requests", description: JSON.stringify(g.external) },
        { type: "console-errors", description: JSON.stringify(g.consoleErrors) },
      );
      expect(g.external, "off-host requests").toEqual([]);
      if (g.expectClean) {
        expect(g.violations, "CSP violations").toEqual([]);
        expect(g.consoleErrors, "console errors").toEqual([]);
      }
    },
    { auto: true },
  ],
});
export { expect };

export const note = (type: string, value: unknown) =>
  test.info().annotations.push({
    type,
    description: typeof value === "string" ? value : JSON.stringify(value),
  });

export async function openWorkspace(page: Page, query = "") {
  const res = await page.goto(`/workspace.html${query}`);
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  return res!;
}

/** Imports a fixture through the real file input and waits for the committed trace's preview. */
export async function importFixture(page: Page, file: string, preset?: string) {
  if (preset) {
    await page.keyboard.press("t");
    await page.getByRole("radio", { name: preset }).check();
    await page.getByRole("button", { name: "Select", exact: true }).click();
  }
  await page.getByTestId("import-input").setInputFiles(resolve(FIXTURES, file));
  await expect(page.getByTestId("status")).toContainText("Traced", { timeout: 90_000 });
  await expect(page.getByTestId("canvas-image")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("canvas-state")).toContainText("(ready)");
}

/** Waits until the interim canvas shows the current document revision. */
export async function canvasSettled(page: Page) {
  await expect(page.getByTestId("canvas-state")).toContainText("(ready)", { timeout: 30_000 });
}

export async function tabUntil(page: Page, pred: () => Promise<boolean>, max = 40) {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press("Tab");
    if (await pred()) return i;
  }
  throw new Error("Tab never reached the target");
}

/** Clicks artboard points (fractions) until the interim box hit test selects a path. */
export async function selectOnCanvas(page: Page, points: [number, number][] = DEFAULT_POINTS) {
  const art = (await page.getByTestId("artboard").boundingBox())!;
  for (const [fx, fy] of points) {
    await page.mouse.click(art.x + art.width * fx, art.y + art.height * fy);
    if ((await page.getByTestId("selection-outline").count()) > 0) return [fx, fy] as const;
  }
  throw new Error("no path under any probe point");
}
const DEFAULT_POINTS: [number, number][] = [
  [0.7, 0.62],
  [0.55, 0.5],
  [0.3, 0.7],
  [0.8, 0.85],
  [0.2, 0.3],
  [0.5, 0.8],
];
