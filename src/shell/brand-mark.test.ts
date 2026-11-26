// G-BRAND: the top bar's mark (BrandMark in Workspace.tsx) is the approved symbol's ivory + lime
// master, element for element: same viewBox, geometry, colours and drawing order.
import { expect, test } from "vite-plus/test";

const files = import.meta.glob<string>(
  ["/branding/vectra-symbol-ivory.svg", "/src/shell/Workspace.tsx"],
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

test("the top-bar mark repeats branding/vectra-symbol-ivory.svg exactly", () => {
  const master = files["/branding/vectra-symbol-ivory.svg"]!;
  const shell = files["/src/shell/Workspace.tsx"]!;
  const mark = /function BrandMark\(\) \{[\s\S]*?\n\}\n/.exec(shell)![0];
  expect(mark).toContain(`viewBox="${/viewBox="([^"]+)"/.exec(master)![1]}"`);
  expect(elements(mark)).toEqual(elements(master));
  expect(elements(master)).toHaveLength(14);
});
