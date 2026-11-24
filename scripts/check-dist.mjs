#!/usr/bin/env node
// Static checks on the production build (dist/) for Cloudflare Pages / static hosting.
// Fails if any asset exceeds the Pages per-file limit, the file count limit is exceeded,
// required assets are missing, or the bundle references a remote origin at runtime.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const dist = resolve(import.meta.dirname, "../dist");
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // Cloudflare Pages: 25 MiB per file
const MAX_FILES = 20_000; // Cloudflare Pages Free plan

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ path: relative(dist, p), bytes: statSync(p).size });
  }
};
walk(dist);

const errors = [];
if (files.length > MAX_FILES) errors.push(`${files.length} files > ${MAX_FILES}`);
for (const f of files)
  if (f.bytes > MAX_ASSET_BYTES) errors.push(`${f.path} is ${f.bytes} bytes > 25 MiB`);

const has = (re) => files.some((f) => re.test(f.path));
if (!has(/^index\.html$/)) errors.push("missing index.html");
if (!has(/^_headers$/)) errors.push("missing _headers");
if (!has(/\.wasm$/)) errors.push("missing .wasm asset");
if (!has(/worker.*\.js$/)) errors.push("missing worker bundle");

// No runtime dependency on a third-party origin: scan text assets for absolute http(s) URLs
// other than XML namespace identifiers and documentation links in comments are not expected.
const allowed = [/^http:\/\/www\.w3\.org\//, /^https:\/\/react\.dev\/errors\//];
for (const f of files.filter((x) => /\.(html|js|css)$/.test(x.path))) {
  const text = readFileSync(join(dist, f.path), "utf8");
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)) {
    if (!allowed.some((re) => re.test(m[0]))) errors.push(`${f.path} references ${m[0]}`);
  }
}

for (const f of files.sort((a, b) => b.bytes - a.bytes)) {
  console.log(`${String(f.bytes).padStart(10)}  ${f.path}`);
}
console.log(`${files.length} files, ${files.reduce((s, f) => s + f.bytes, 0)} bytes total`);
if (errors.length) {
  console.error("dist check FAILED:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("dist check passed");
