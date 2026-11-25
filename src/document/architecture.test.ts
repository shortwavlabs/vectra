// Architectural rules for G-DOC production code (G0 next-gate brief, ownership section):
// - production modules never import the test-only adapter in src/document/testing;
// - the document needs no renderer types or worker handles (stop condition);
// - imports stay inside src/document, src/persistence and the pure intake sniffer.
import { describe, expect, test } from "vite-plus/test";

const sources = import.meta.glob<string>(["/src/document/**/*.ts", "/src/persistence/**/*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const production = Object.entries(sources).filter(
  ([path]) => !path.endsWith(".test.ts") && !path.startsWith("/src/document/testing/"),
);
// Static `import … from`, `export … from`, side-effect `import "…"` and dynamic `import("…")`.
const importsOf = (text: string) =>
  [
    ...text.matchAll(
      /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g,
    ),
  ].map((m) => (m[1] ?? m[2])!);
const resolve = (from: string, spec: string) => {
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

describe("G-DOC architecture", () => {
  test("the scan sees the production modules", () => {
    const names = production.map(([p]) => p);
    expect(names).toContain("/src/document/geometry-store.ts");
    expect(names).toContain("/src/persistence/container.ts");
    expect(names.length).toBeGreaterThanOrEqual(11);
  });

  test("production code never imports src/document/testing", () => {
    for (const [path, text] of production)
      for (const spec of importsOf(text))
        expect(resolve(path, spec).startsWith("/src/document/testing"), `${path} → ${spec}`).toBe(
          false,
        );
  });

  test("imports stay within document, persistence and the intake sniffer", () => {
    for (const [path, text] of production)
      for (const spec of importsOf(text)) {
        const target = resolve(path, spec);
        const ok =
          target.startsWith("/src/document/") ||
          target.startsWith("/src/persistence/") ||
          target === "/src/vectorization/intake.ts";
        expect(ok, `${path} → ${spec}`).toBe(true);
      }
  });

  test("no renderer, worker or DOM-canvas dependencies in the document", () => {
    for (const [path, text] of production)
      expect(
        /\b(Worker|OffscreenCanvas|Path2D|CanvasRenderingContext2D|postMessage)\b/.test(text),
        path,
      ).toBe(false);
  });
});
