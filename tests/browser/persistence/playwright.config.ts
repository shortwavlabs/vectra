import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Persistence qualification (P1-A): a harness page that imports the production modules from
// src/, so it needs the Vite dev server (the root config tests the production build instead).
// Specs are `*.pw.ts`: the root config's testDir includes this folder, and its default
// testMatch (`*.spec.ts`/`*.test.ts`) must not pick these up against `vp preview`.
const ROOT = resolve(import.meta.dirname, "../../..");
const PORT = 4180;

export default defineConfig({
  testDir: ".",
  testMatch: "*.pw.ts",
  outputDir: resolve(ROOT, "tests/output/persistence/playwright"),
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(ROOT, "tests/output/persistence/results.json") }],
  ],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  webServer: {
    command: `pnpm exec vp dev --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: ROOT,
    url: `http://127.0.0.1:${PORT}/tests/browser/persistence/harness.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
