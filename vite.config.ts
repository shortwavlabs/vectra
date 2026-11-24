import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

/** Headers for `/*` from public/_headers, so `vp preview` serves what Cloudflare Pages serves. */
function productionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  let inRootRule = false;
  for (const line of readFileSync(new URL("./public/_headers", import.meta.url), "utf8").split(
    "\n",
  )) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      inRootRule = line.trim() === "/*";
      continue;
    }
    const idx = line.indexOf(":");
    if (inRootRule && idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return headers;
}

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "**/*.md",
      "packages/vector-engine-wasm/pkg/**",
      "experiments/**",
      "docs/research/p0/artifacts/**",
    ],
  },
  lint: {
    plugins: ["react", "typescript", "oxc"],
    ignorePatterns: ["packages/vector-engine-wasm/pkg/**", "experiments/**"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { allowConstantExport: true }],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
  },
  plugins: lazyPlugins(() => [react()]),
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
  preview: { headers: productionHeaders() },
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
  },
});
