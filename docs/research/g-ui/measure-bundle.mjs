#!/usr/bin/env node
// G-UI bundle measurement (DESIGN-SYSTEM §7). Run from the repository root after
// `pnpm run build`:  node docs/research/g-ui/measure-bundle.mjs > docs/research/g-ui/bundle-sizes.json
// - production: the files each page loads initially (entry + modulepreloads), from dist/;
// - baseline: a minimal React 19.3.1 counter built with the same pinned toolchain (vp build);
// - attribution: a second build of the workspace with vendor code split into one chunk per
//   library group (bytes attributed by module path; chunk totals ≈ the production bundle).
// Sizes are raw / gzip -9 / brotli q11 of the emitted bytes. Temporary builds go to
// tests/output/bundle (ignored by git).
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "../../..");
const tmp = join(root, "tests/output/bundle");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const size = (buf) => ({
  raw: buf.length,
  gzip: gzipSync(buf, { level: 9 }).length,
  brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
});
const add = (a, b) => ({ raw: a.raw + b.raw, gzip: a.gzip + b.gzip, brotli: a.brotli + b.brotli });
const zero = { raw: 0, gzip: 0, brotli: 0 };
const vp = (args) =>
  execFileSync("pnpm", ["exec", "vp", "build", "--logLevel", "silent", ...args], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

/** Initial files of a page: its module script, modulepreloads and stylesheets. */
function initial(dist, html) {
  const text = readFileSync(join(dist, html), "utf8");
  const refs = [...text.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
  const files = refs.map((f) => ({
    file: f.replace(/-[\w-]{8}\.(js|css)$/, ".$1"),
    ...size(readFileSync(join(dist, f))),
  }));
  return {
    files,
    js: files.filter((f) => f.file.endsWith(".js")).reduce(add, zero),
    css: files.filter((f) => f.file.endsWith(".css")).reduce(add, zero),
  };
}

const dist = join(root, "dist");
const out = { workspace: initial(dist, "workspace.html"), workbench: initial(dist, "index.html") };
out.separate = Object.fromEntries(
  readdirSync(join(dist, "assets"))
    .filter((f) => /\.wasm$|worker/.test(f))
    .map((f) => [f.replace(/-[\w-]{8}\./, "."), size(readFileSync(join(dist, "assets", f)))]),
);

// Baseline: minimal React app, same toolchain.
const base = join(tmp, "baseline");
mkdirSync(base, { recursive: true });
writeFileSync(
  join(base, "index.html"),
  '<!doctype html><html lang="en"><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>\n',
);
writeFileSync(
  join(base, "main.tsx"),
  `import { useState } from "react";
import { createRoot } from "react-dom/client";
function App() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>Clicked {n}</button>;
}
createRoot(document.getElementById("root")!).render(<App />);
`,
);
writeFileSync(
  join(tmp, "baseline.config.ts"),
  `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
export default defineConfig({ root: ${JSON.stringify(base)}, plugins: [react()], base: "./",
  build: { target: "es2022", outDir: ${JSON.stringify(join(tmp, "baseline-dist"))}, emptyOutDir: true } });
`,
);
vp(["--config", join(tmp, "baseline.config.ts")]);
out.baseline = initial(join(tmp, "baseline-dist"), "index.html");

// Attribution build: the workspace page only, vendor groups split into named chunks.
const groups = [
  ["react", "node_modules/.pnpm/(react|react-dom|scheduler)@"],
  ["base-ui", "node_modules/.pnpm/(@base-ui|@floating-ui|use-sync-external-store|reselect|@babel)"],
  ["dnd-kit", "node_modules/.pnpm/(@dnd-kit|tslib)"],
  ["react-resizable-panels", "node_modules/.pnpm/react-resizable-panels@"],
  ["lucide-react", "node_modules/.pnpm/lucide-react@"],
  ["cn-cva-clsx", "node_modules/.pnpm/(cn|class-variance-authority|clsx)@"],
  ["domain", "/src/(document|jobs|vectorization|presets|geometry|export|canvas-host)/"],
  ["ui-owned-and-copied", "/src/ui/"],
  ["shell", "/src/shell/"],
];
writeFileSync(
  join(tmp, "analyze.config.ts"),
  `import base from ${JSON.stringify(join(root, "vite.config.ts"))};
import { mergeConfig } from "vite-plus";
const config = mergeConfig(base, { build: { outDir: ${JSON.stringify(join(tmp, "analyze-dist"))}, emptyOutDir: true,
  rolldownOptions: { input: { workspace: ${JSON.stringify(join(root, "workspace.html"))} }, output: { codeSplitting: { groups: [
${groups.map(([name, re], i) => `    { name: ${JSON.stringify(name)}, test: /${re.replace(/\//g, "\\/")}/, priority: ${groups.length - i} },`).join("\n")}
  ] } } } } });
config.build.rolldownOptions.input = { workspace: ${JSON.stringify(join(root, "workspace.html"))} };
export default config;
`,
);
vp(["--config", join(tmp, "analyze.config.ts")]);
// The workbench alone (index.html as the only input): what main's single-page build ships,
// to show the effect of the second page on the workbench (shared-chunk split only).
writeFileSync(
  join(tmp, "workbench.config.ts"),
  `import base from ${JSON.stringify(join(root, "vite.config.ts"))};
import { mergeConfig } from "vite-plus";
const config = mergeConfig(base, { build: { outDir: ${JSON.stringify(join(tmp, "workbench-dist"))}, emptyOutDir: true } });
config.build.rolldownOptions.input = { index: ${JSON.stringify(join(root, "index.html"))} };
export default config;
`,
);
vp(["--config", join(tmp, "workbench.config.ts")]);
out.workbenchAlone = initial(join(tmp, "workbench-dist"), "index.html");

const adir = join(tmp, "analyze-dist/assets");
out.attribution = readdirSync(adir)
  .filter((f) => f.endsWith(".js") && !f.includes("worker"))
  .map((f) => ({ chunk: f.replace(/-[\w-]{8}\.js$/, ""), ...size(readFileSync(join(adir, f))) }))
  .sort((a, b) => b.gzip - a.gzip);
const of = (name) => out.attribution.find((a) => a.chunk === name) ?? zero;
const ds = [
  "base-ui",
  "dnd-kit",
  "react-resizable-panels",
  "lucide-react",
  "cn-cva-clsx",
  "ui-owned-and-copied",
]
  .map(of)
  .reduce(add, zero);
const kib = (n) => Math.round((n / 1024) * 10) / 10;
out.summary = {
  baselineJsGzipKiB: kib(out.baseline.js.gzip),
  workspaceInitialJsGzipKiB: kib(out.workspace.js.gzip),
  workspaceInitialCssGzipKiB: kib(out.workspace.css.gzip),
  additionalOverBaselineJsGzipKiB: kib(out.workspace.js.gzip - out.baseline.js.gzip),
  designSystemJsGzipKiB: kib(ds.gzip),
  shellJsGzipKiB: kib(of("shell").gzip),
  domainJsGzipKiB: kib(of("domain").gzip),
  workbenchInitialJsGzipKiB: kib(out.workbench.js.gzip),
  workbenchAloneInitialJsGzipKiB: kib(out.workbenchAlone.js.gzip),
  budgets: {
    "additional design-system JS ≤ 150 KiB": kib(ds.gzip) <= 150,
    "additional design-system CSS ≤ 15 KiB": kib(out.workspace.css.gzip) <= 15,
    "total initial UI JS ≤ 250 KiB": kib(out.workspace.js.gzip) <= 250,
  },
};
console.log(JSON.stringify(out, null, 2));
