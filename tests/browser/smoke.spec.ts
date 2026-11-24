import { expect, test } from "@playwright/test";

test("production build loads WASM inside a module worker under the production CSP", async ({
  page,
}) => {
  const cspViolations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|CSP/i.test(m.text())) cspViolations.push(m.text());
  });
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("'wasm-unsafe-eval'");
  await expect(page.getByTestId("engine-version")).toHaveText(/^engine \d+\.\d+\.\d+$/);
  expect(cspViolations).toEqual([]);
});
