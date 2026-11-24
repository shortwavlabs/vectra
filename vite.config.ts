import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins, type Plugin } from "vite-plus";

/**
 * Cloudflare-style `_headers` rules from public/_headers, applied per path by `vp preview`
 * so local previews serve the same CSP, security and cache headers as the deployment.
 * Supports what this project uses: literal paths and `*` splats; later rules add headers.
 */
function headersRules(): { pattern: RegExp; headers: [string, string][] }[] {
  const rules: { pattern: RegExp; headers: [string, string][] }[] = [];
  const text = readFileSync(new URL("./public/_headers", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const escaped = line
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      rules.push({ pattern: new RegExp(`^${escaped}$`), headers: [] });
      continue;
    }
    const idx = line.indexOf(":");
    if (idx > 0)
      rules.at(-1)?.headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
  }
  return rules;
}

function productionHeadersPlugin(): Plugin {
  const rules = headersRules();
  return {
    name: "vectra-production-headers",
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "/").split("?")[0] ?? "/";
        for (const rule of rules) {
          if (rule.pattern.test(path)) for (const [k, v] of rule.headers) res.setHeader(k, v);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "**/*.md",
      "packages/vector-engine-wasm/pkg/**",
      "experiments/**",
      "docs/research/p0/artifacts/**",
      "docs/research/p0-r/artifacts/**",
      "docs/research/p0-r-geo/artifacts/**",
      "docs/research/p0-r-geo/owner-acceptance-bundle-v2/**",
      "docs/mockups/**",
    ],
  },
  lint: {
    plugins: ["react", "typescript", "oxc"],
    ignorePatterns: ["packages/vector-engine-wasm/pkg/**", "experiments/**", ".wrangler/**"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { allowConstantExport: true }],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
  },
  plugins: lazyPlugins(() => [react(), productionHeadersPlugin()]),
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
  },
});
