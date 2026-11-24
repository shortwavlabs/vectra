import { defineConfig, devices } from "@playwright/test";

// Browser tests always run against the production build (`dist/`), never the dev server:
// the dev server injects HMR sockets and inline scripts that would invalidate CSP and privacy results.
export default defineConfig({
  testDir: "tests/browser",
  outputDir: "tests/output/playwright",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "tests/output/playwright-results.json" }]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "off" },
  webServer: {
    command: "pnpm exec vp preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
