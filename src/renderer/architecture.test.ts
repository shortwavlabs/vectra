// C8 boundary: src/renderer imports only src/renderer (its snapshot and packet read types are
// its own) and the standard library. The canvas host and hit testing never import document
// mutation (commands), persistence, export or job modules.
import { expect, test } from "vite-plus/test";

const sources = import.meta.glob<string>(
  ["/src/renderer/**/*.ts", "/src/canvas-host/**/*.{ts,tsx}", "/src/hit-test/**/*.ts"],
  { query: "?raw", import: "default", eager: true },
);
const production = Object.entries(sources).filter(
  ([path]) => !path.endsWith(".test.ts") && !path.includes("/testing/"),
);
// Static imports and re-exports, side-effect and dynamic imports, and `new URL("…", …)` workers.
const importsOf = (text: string) =>
  [
    ...text.matchAll(
      /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']|new URL\(\s*["']([^"']+)["']/g,
    ),
  ]
    .map((m) => (m[1] ?? m[2] ?? m[3])!)
    .filter((s) => s.startsWith("."));
const resolve = (from: string, spec: string) => {
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};
const edges = production.flatMap(([path, text]) =>
  importsOf(text).map((spec) => ({ from: path, to: resolve(path, spec) })),
);

test("the scan sees the renderer, the canvas host and hit testing", () => {
  const paths = production.map(([p]) => p);
  expect(paths).toEqual(
    expect.arrayContaining([
      "/src/renderer/core.ts",
      "/src/renderer/render.worker.ts",
      "/src/canvas-host/render-host.ts",
      "/src/hit-test/index.ts",
    ]),
  );
});

test("src/renderer imports nothing outside src/renderer", () => {
  const outside = edges
    .filter((e) => e.from.startsWith("/src/renderer/") && !e.to.startsWith("/src/renderer/"))
    .map((e) => `${e.from} → ${e.to}`);
  expect(outside).toEqual([]);
});

test("the canvas host and hit testing never import mutation, persistence, export or jobs", () => {
  const banned = /^\/src\/(document\/commands|document\/export|persistence\/|jobs\/)/;
  const bad = edges
    .filter((e) => !e.from.startsWith("/src/renderer/") && banned.test(e.to))
    .map((e) => `${e.from} → ${e.to}`);
  expect(bad).toEqual([]);
});
