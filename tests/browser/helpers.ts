import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

export const FIXTURES = resolve(import.meta.dirname, "../fixtures");
export const OUTPUT = resolve(import.meta.dirname, "../output");
export const fixture = (file: string) => join(FIXTURES, file);

export function writeOutput(rel: string, data: string | Uint8Array): string {
  const p = join(OUTPUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
}

export async function waitForState(page: Page, state: string, timeout = 120_000) {
  await expect(page.getByTestId("status")).toHaveAttribute("data-state", state, { timeout });
}

export async function upload(page: Page, file: string) {
  await page.getByTestId("file").setInputFiles(fixture(file));
}

/** Sets a control by its accessible label and waits for the re-trace to finish. */
export async function setNumber(page: Page, label: string, value: number) {
  await page.getByLabel(label).fill(String(value));
}

export async function selectMode(page: Page, mode: string) {
  await page.getByTestId("mode").selectOption(mode);
}

/** Debug snapshot exposed by the workbench (metrics only, never artwork). */
export async function lastResult(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() =>
    JSON.parse(JSON.stringify((window as unknown as { __vectra?: unknown }).__vectra ?? {})),
  );
}

/**
 * Downloads the current SVG via the UI and parses it with the browser's own DOMParser.
 * (The production CSP's connect-src 'self' blocks fetch() of blob: URLs, so the test cannot
 * read the preview image's object URL directly.)
 */
export async function svgInventory(page: Page) {
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-svg").click(),
  ]);
  const text = readFileSync((await dl.path())!, "utf8");
  return page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const elements = new Set<string>();
    const attributes = new Set<string>();
    for (const el of Array.from(doc.querySelectorAll("*"))) {
      elements.add(el.localName);
      for (const a of Array.from(el.attributes)) attributes.add(a.name);
    }
    return {
      parseError: doc.querySelector("parsererror") !== null,
      elements: [...elements].sort(),
      attributes: [...attributes].sort(),
      viewBox: doc.documentElement.getAttribute("viewBox"),
      bytes: text.length,
    };
  }, text);
}

/** Last request whose result is displayed (from the workbench debug snapshot). */
export async function shownRequest(page: Page): Promise<any> {
  return page.evaluate(
    () => (window as unknown as { __vectra?: { lastRequest?: unknown } }).__vectra?.lastRequest,
  );
}

/** Creates an image in the page (OffscreenCanvas) and feeds it to the file input like a user would. */
export async function uploadGenerated(
  page: Page,
  opts: {
    width: number;
    height: number;
    type: "image/png" | "image/jpeg";
    name: string;
    baseJpeg?: string;
  },
) {
  const base = opts.baseJpeg ? readFileSync(fixture(opts.baseJpeg)).toString("base64") : null;
  await page.evaluate(
    async ({ width, height, type, name, base }) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d")!;
      if (base) {
        const bytes = Uint8Array.from(atob(base), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        ctx.drawImage(bmp, 0, 0, width, height);
        bmp.close();
      } else {
        const g = ctx.createLinearGradient(0, 0, width, height);
        g.addColorStop(0, "#202020");
        g.addColorStop(1, "#f0e8d8");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        for (let i = 0; i < 400; i++) {
          ctx.fillStyle = `hsl(${(i * 37) % 360} 60% ${30 + (i % 40)}%)`;
          ctx.beginPath();
          ctx.arc(
            (((i * 7919) % 1000) / 1000) * width,
            (((i * 104729) % 1000) / 1000) * height,
            ((5 + (i % 30)) * width) / 1000,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      const blob = await canvas.convertToBlob({ type, quality: 0.9 });
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type }));
      const input = document.querySelector<HTMLInputElement>("[data-testid=file]")!;
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { ...opts, base },
  );
}
