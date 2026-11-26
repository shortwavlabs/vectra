// G-BRAND: the two inline copies of the approved symbol stay identical to their masters, element
// for element (viewBox, geometry, colours, drawing order): the top bar's BrandMark
// (Workspace.tsx, ivory + lime) and the service worker's recovery page (generate-sw.mjs,
// canonical charcoal + lime).
import { expect, test } from "vite-plus/test";

const files = import.meta.glob<string>(
  [
    "/branding/vectra-symbol.svg",
    "/branding/vectra-symbol-ivory.svg",
    "/src/shell/Workspace.tsx",
    "/scripts/generate-sw.mjs",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** Each drawing element with its attributes (camelCased, sorted; ids and ARIA ignored). */
const elements = (src: string) =>
  [...src.matchAll(/<(g|rect|path|circle)\b([^>]*)>/g)].map(
    ([, tag, attrs]) =>
      tag +
      [...attrs!.matchAll(/([\w-]+)="([^"]*)"/g)]
        .filter(([, k]) => k !== "id")
        .map(([, k, v]) => ` ${k!.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}=${v}`)
        .sort()
        .join(""),
  );

for (const [copy, master, source, pattern] of [
  [
    "top-bar mark",
    "vectra-symbol-ivory.svg",
    "/src/shell/Workspace.tsx",
    /function BrandMark\(\) \{[\s\S]*?\n\}\n/,
  ],
  [
    "recovery-page symbol",
    "vectra-symbol.svg",
    "/scripts/generate-sw.mjs",
    /const symbol = `[\s\S]*?`;/,
  ],
] as const) {
  test(`the ${copy} repeats branding/${master} exactly`, () => {
    const svg = files[`/branding/${master}`]!;
    const inline = pattern.exec(files[source]!)![0];
    expect(inline).toContain(`viewBox="${/viewBox="([^"]+)"/.exec(svg)![1]}"`);
    expect(elements(inline)).toEqual(elements(svg));
    expect(elements(svg)).toHaveLength(14);
  });
}
