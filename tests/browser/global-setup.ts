// Deterministic prerequisites for the browser suite, built once before any spec runs, so no
// spec depends on another having run first (G-DOC-R report §3: renderer-behaviour needed the
// binary that only renderer-correctness built).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

export default function globalSetup(): void {
  // The independent resvg reference used by renderer-correctness and renderer-behaviour.
  if (!existsSync(join(ROOT, "target/release/examples/render_compare")))
    execFileSync(
      "cargo",
      ["build", "--release", "--locked", "-p", "vector-engine", "--example", "render_compare"],
      { cwd: ROOT, stdio: "pipe" },
    );
}
