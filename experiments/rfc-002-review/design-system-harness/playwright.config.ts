import { defineConfig, devices } from "@playwright/test";

// Runs against the production build served with the exact public/_headers rules (serve.mjs).
export default defineConfig({
  testDir: "tests",
  outputDir: "test-results/output",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/playwright-report.json" }]],
  use: { baseURL: "http://127.0.0.1:4317", trace: "off", serviceWorkers: "block" },
  webServer: {
    command: "node serve.mjs dist/app 4317",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
