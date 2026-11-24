#!/usr/bin/env node
// Reproducible build of packages/vector-engine-wasm -> packages/vector-engine-wasm/pkg.
// Requirements: rustup (toolchain pinned by rust-toolchain.toml) and
// wasm-bindgen-cli whose version exactly matches the wasm-bindgen crate in Cargo.lock.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outDir = join(root, "packages/vector-engine-wasm/pkg");
const wasmIn = join(root, "target/wasm32-unknown-unknown/release/vector_engine_wasm.wasm");

const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

const lock = readFileSync(join(root, "Cargo.lock"), "utf8");
const locked = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
let cli;
try {
  cli = execFileSync("wasm-bindgen", ["--version"], { encoding: "utf8" }).trim().split(" ")[1];
} catch {
  cli = undefined;
}
if (!locked || cli !== locked) {
  console.error(
    `wasm-bindgen CLI ${cli ?? "(not found)"} does not match Cargo.lock ${locked}.\n` +
      `Install it with: cargo install wasm-bindgen-cli --version ${locked} --locked`,
  );
  process.exit(1);
}

// Strip absolute paths from the binary so builds are byte-identical across checkouts.
const home = process.env.HOME ?? process.env.USERPROFILE ?? "/nonexistent";
const cargoHome = process.env.CARGO_HOME ?? join(home, ".cargo");
const rustflags = [
  `--remap-path-prefix=${root}=/vectra`,
  `--remap-path-prefix=${cargoHome}=/cargo`,
];

run(
  "cargo",
  [
    "build",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "-p",
    "vector-engine-wasm",
  ],
  { CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f") },
);
rmSync(outDir, { recursive: true, force: true });
run("wasm-bindgen", ["--target", "web", "--out-dir", outDir, wasmIn]);

for (const f of readdirSync(outDir).sort()) {
  const p = join(outDir, f);
  const hash = createHash("sha256").update(readFileSync(p)).digest("hex");
  console.log(`${hash}  ${statSync(p).size.toString().padStart(9)}  pkg/${f}`);
}
