import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Build identity (C5 handshake): a content hash of every input that shapes the bundle (sources,
 * public files, the WASM package, the lockfile and the configuration), so two different builds
 * never share an ID and a rebuild of identical inputs keeps it. `VECTRA_BUILD_SALT` is for the
 * update-lifecycle tests only: it makes a genuinely different second build.
 */
function buildId(): string {
  const root = new URL(".", import.meta.url).pathname;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const rel = `${dir}/${name}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  for (const dir of ["src", "public", "packages/vector-engine-wasm/pkg"]) walk(dir);
  files.push("index.html", "package.json", "pnpm-lock.yaml", "vite.config.ts", "tsconfig.json");
  const h = createHash("sha256").update(process.env.VECTRA_BUILD_SALT ?? "");
  for (const f of files)
    h.update(f)
      .update("\0")
      .update(readFileSync(join(root, f)));
  return h.digest("hex").slice(0, 16);
}

/** The engine version the WASM reports (`engineVersion()` = the Cargo workspace version). */
function engineVersion(): string {
  const toml = readFileSync(new URL("./Cargo.toml", import.meta.url), "utf8");
  const m = /\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/.exec(toml);
  if (!m) throw new Error("Cargo.toml: workspace.package.version not found");
  return m[1]!;
}

export default defineConfig({
  define: {
    __VECTRA_BUILD_ID__: JSON.stringify(buildId()),
    __VECTRA_ENGINE_VERSION__: JSON.stringify(engineVersion()),
  },
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
