// Node smoke test of the generated WASM artifact. NOT browser evidence: browser
// compatibility is verified separately by the Playwright suite in tests/browser.
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import {
  engineVersion,
  initSync,
} from "../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";

test("generated wasm instantiates in Node and reports the engine version", () => {
  initSync({
    module: readFileSync(
      new URL("../../packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm", import.meta.url),
    ),
  });
  expect(engineVersion()).toBe("0.0.0");
});
