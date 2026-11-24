import { expect, test } from "@playwright/test";
import { upload, waitForState } from "./helpers.ts";

test("production build traces in a module worker under the production CSP", async ({ page }) => {
  const cspViolations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|CSP|Refused/i.test(m.text())) cspViolations.push(m.text());
  });
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("'wasm-unsafe-eval'");
  await upload(page, "procedural/circle.png");
  await waitForState(page, "done");
  await expect(page.getByTestId("paths")).toHaveText("1 / 1");
  expect(cspViolations).toEqual([]);
});
