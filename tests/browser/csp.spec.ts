// P0-G4 negative control: the production CSP is actually enforced, and 'wasm-unsafe-eval' is
// what allows the worker to compile WebAssembly. Strip it and the engine must fail to start.
import { expect, test } from "@playwright/test";
import { upload, waitForState } from "./helpers.ts";

test("without 'wasm-unsafe-eval' the WASM engine is blocked", async ({
  page,
  context,
  browserName,
}) => {
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith("http")) return route.continue();
    const response = await route.fetch();
    const headers = { ...response.headers() };
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === "content-security-policy")
        headers[k] = headers[k]!.replace(" 'wasm-unsafe-eval'", "");
    }
    await route.fulfill({ response, headers });
  });
  await page.goto("/");
  await upload(page, "procedural/circle.png");
  await waitForState(page, "error", 30_000);
  const text = await page.getByTestId("status").textContent();
  test.info().annotations.push({ type: "observed", description: `${browserName}: ${text}` });
  expect(text).toMatch(/worker_crashed|wasm|WebAssembly|CompileError|unsafe|eval/i);
});
