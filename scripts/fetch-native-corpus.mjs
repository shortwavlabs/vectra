#!/usr/bin/env node
// Downloads the native-resolution benchmark corpus (tests/fixtures/native-corpus.json) into
// tests/output/native-corpus/ and verifies size, SHA-1 (as published by Wikimedia Commons) and,
// once recorded, SHA-256. Images are CC0 / public domain; they are not committed to Git.
// Usage: node scripts/fetch-native-corpus.mjs [--record]   (--record writes SHA-256 values)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = join(root, "tests/fixtures/native-corpus.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const dir = join(root, "tests/output/native-corpus");
mkdirSync(dir, { recursive: true });
const UA = "vectra-benchmark-corpus/0.1 (open-source test corpus download)";
let failed = 0;
for (const img of manifest.images) {
  const path = join(dir, `${img.id}.jpg`);
  if (!existsSync(path)) {
    // Sequential download with curl (Node's fetch was answered with HTTP 429 where curl, with the
    // same User-Agent, was not); curl honours Retry-After via --retry. Pause between files.
    execFileSync(
      "curl",
      ["-fsSL", "--retry", "5", "--retry-delay", "15", "-A", UA, "-o", path, img.url],
      { stdio: "inherit" },
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
  const buf = readFileSync(path);
  const sha1 = createHash("sha1").update(buf).digest("hex");
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const ok =
    buf.length === img.bytes && sha1 === img.sha1 && (img.sha256 === null || img.sha256 === sha256);
  if (process.argv.includes("--record") && ok) img.sha256 = sha256;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${img.id} ${img.width}x${img.height} ${buf.length} B sha256=${sha256}`,
  );
  if (!ok) failed++;
}
if (process.argv.includes("--record"))
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
process.exit(failed ? 1 : 0);
