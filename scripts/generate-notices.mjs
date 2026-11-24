#!/usr/bin/env node
// Generates public/THIRD-PARTY-NOTICES.txt (copied into dist/ by `vp build`) from the license
// files that each *distributed* dependency ships in its own package:
//   - Rust crates compiled into the WebAssembly module: normal dependencies of
//     vector-engine-wasm for wasm32-unknown-unknown, excluding proc-macro (compile-time) crates;
//   - npm packages bundled into the JavaScript: read from a source-map build;
//   - Vite's module-preload polyfill, which the bundler injects without a source-map entry
//     (its text is the "vite" section of the Vite+ core LICENSE file).
// Texts are copied verbatim; nothing is reconstructed. Packages without license files are
// listed under "Missing license files" and fail `--check`.
// Usage: node scripts/generate-notices.mjs [--check]   (needs node_modules and cargo)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "public/THIRD-PARTY-NOTICES.txt");
const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)([-._].*)?$/i;
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, ...opts });

const licenseFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && LICENSE_FILE.test(e.name))
    .map((e) => e.name)
    .sort();

// ---- Rust crates in the WASM module
const meta = JSON.parse(
  sh("cargo", [
    "metadata",
    "--format-version",
    "1",
    "--locked",
    "--filter-platform",
    "wasm32-unknown-unknown",
  ]),
);
const pkgById = new Map(meta.packages.map((p) => [p.id, p]));
const nodeById = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const workspace = new Set(meta.workspace_members);
const isProcMacro = (p) => p.targets.some((t) => t.kind.includes("proc-macro"));
const start = meta.packages.find((p) => p.name === "vector-engine-wasm").id;
const seen = new Set([start]);
const queue = [start];
while (queue.length) {
  const node = nodeById.get(queue.shift());
  for (const dep of node.deps) {
    const normal = dep.dep_kinds.some((k) => k.kind === null);
    const pkg = pkgById.get(dep.pkg);
    if (!normal || isProcMacro(pkg) || seen.has(dep.pkg)) continue;
    seen.add(dep.pkg);
    queue.push(dep.pkg);
  }
}
const entries = [];
for (const id of [...seen].sort((a, b) => a.localeCompare(b))) {
  if (workspace.has(id)) continue;
  const p = pkgById.get(id);
  const dir = dirname(p.manifest_path);
  entries.push({
    name: p.name,
    version: p.version,
    license: p.license ?? "(see file)",
    origin: "crates.io (WASM module)",
    dir,
    files: licenseFiles(dir),
  });
}

// ---- npm packages in the JavaScript bundle (from a throwaway source-map build)
const tmp = mkdtempSync(join(tmpdir(), "vectra-notices-"));
try {
  sh("pnpm", [
    "exec",
    "vp",
    "build",
    "--sourcemap",
    "--outDir",
    tmp,
    "--emptyOutDir",
    "--logLevel",
    "silent",
  ]);
  const sources = new Set();
  for (const f of readdirSync(join(tmp, "assets")).filter((f) => f.endsWith(".map")))
    for (const s of JSON.parse(readFileSync(join(tmp, "assets", f), "utf8")).sources)
      sources.add(s);
  const npm = new Map();
  for (const s of sources) {
    const m = /node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(s);
    if (m) npm.set(m[1], s.slice(0, m.index + m[0].length - 1));
  }
  for (const [name, rel] of [...npm].sort(([a], [b]) => a.localeCompare(b))) {
    const dir = resolve(join(tmp, "assets"), rel);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    entries.push({
      name,
      version: pkg.version,
      license: pkg.license ?? "(see file)",
      origin: "npm (JavaScript bundle)",
      dir,
      files: licenseFiles(dir),
    });
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---- Vite module-preload polyfill (injected by the bundler)
const bundle = readdirSync(join(root, "dist/assets")).find((f) => /^index-.*\.js$/.test(f));
// pnpm's virtual store holds the Vite+ core package that the build used (catalog-pinned version).
const store = join(root, "node_modules/.pnpm");
const coreEntry = readdirSync(store).find((d) => d.startsWith("@voidzero-dev+vite-plus-core@"));
const coreDir = join(store, coreEntry ?? "missing", "node_modules/@voidzero-dev/vite-plus-core");
let viteSection = null;
if (
  bundle &&
  readFileSync(join(root, "dist/assets", bundle), "utf8").includes('rel="modulepreload"')
) {
  const lic = readFileSync(join(coreDir, "LICENSE"), "utf8");
  const header = lic.slice(0, lic.indexOf("# Licenses of bundled dependencies")).trim();
  const start = lic.indexOf("\n## vite\n");
  const end = lic.indexOf("\n## ", start + 5);
  viteSection = `${header}\n\n${lic.slice(start + 1, end).trim()}`;
  const core = JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8"));
  entries.push({
    name: "vite (module-preload polyfill, via @voidzero-dev/vite-plus-core)",
    version: core.version,
    license: "MIT",
    origin: "bundler-injected runtime code",
    dir: coreDir,
    files: [],
    text: viteSection,
  });
}

// ---- Supplements: verbatim upstream license files for crates published without one
const supplements = JSON.parse(
  readFileSync(join(root, "scripts/notices-supplements/SOURCES.json"), "utf8"),
);
for (const e of entries) {
  const sup = supplements[`${e.name} ${e.version}`];
  if (sup && !e.files.length && !e.text) {
    e.text = `${sup.file} (from ${sup.source}; ${sup.note}):\n\n${readFileSync(join(root, "scripts/notices-supplements", sup.file), "utf8").trim()}`;
    e.supplement = sup.source;
  }
}

// ---- Assemble
const groups = new Map(); // text hash -> { text, packages }
const missing = [];
for (const e of entries) {
  const texts = e.text
    ? [e.text]
    : e.files.map(
        (f) => `${f}:\n\n${readFileSync(join(e.dir, f), "utf8").replace(/\r\n/g, "\n").trim()}`,
      );
  if (!texts.length) missing.push(e);
  for (const t of texts) {
    const h = createHash("sha256").update(t).digest("hex");
    if (!groups.has(h)) groups.set(h, { text: t, packages: [] });
    groups.get(h).packages.push(`${e.name} ${e.version}`);
  }
}
const lines = [
  "Vectra — third-party notices",
  "",
  "Generated by scripts/generate-notices.mjs from Cargo.lock and pnpm-lock.yaml. Do not edit.",
  "This file covers third-party software distributed in the Vectra web application: Rust crates",
  "compiled into the WebAssembly module and JavaScript packages bundled into the scripts.",
  "Development tools, test dependencies and external verification tools are not distributed.",
  "",
  "== Vectra license (LICENSE, verbatim) ==",
  "",
  readFileSync(join(root, "LICENSE"), "utf8").trimEnd(),
  "",
  "== Distributed components ==",
  ...entries
    .map(
      (e) =>
        `${e.name} ${e.version} | ${e.license} | ${e.origin} | ${e.supplement ? `upstream LICENSE (${e.supplement})` : e.text ? "LICENSE (vite section)" : e.files.join(", ") || "NO LICENSE FILE"}`,
    )
    .sort(),
  "",
];
if (missing.length)
  lines.push(
    "== Missing license files ==",
    ...missing.map((e) => `${e.name} ${e.version} (${e.license})`),
    "",
  );
lines.push("== License texts (verbatim, grouped by identical text) ==", "");
for (const g of [...groups.values()].sort((a, b) => a.packages[0].localeCompare(b.packages[0]))) {
  lines.push(
    "-".repeat(78),
    `Applies to: ${g.packages.sort().join(", ")}`,
    "-".repeat(78),
    g.text,
    "",
  );
}
const text = lines.join("\n");
if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current !== text || missing.length) {
    console.error(
      `THIRD-PARTY-NOTICES is out of date or incomplete (missing license files: ${missing.length}). Run node scripts/generate-notices.mjs`,
    );
    process.exit(1);
  }
  console.log(`third-party notices verified (${entries.length} components)`);
} else {
  writeFileSync(out, text);
  console.log(
    `wrote ${out}: ${entries.length} components, ${groups.size} distinct license texts, ${missing.length} without license files`,
  );
  for (const m of missing) console.log(`  missing: ${m.name} ${m.version} (${m.license})`);
}
