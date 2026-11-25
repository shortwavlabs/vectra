// Tiny static server for the production build. Applies the repository's public/_headers rules
// verbatim (same parsing as the root vite.config.ts preview plugin), so the harness runs under
// the exact deployment CSP. Usage: node serve.mjs [dir=dist/app] [port=4317]
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname, process.argv[2] ?? "dist/app");
const port = Number(process.argv[3] ?? 4317);
export const HEADERS_FILE = resolve(import.meta.dirname, "../../../public/_headers");

const rules = [];
for (const line of readFileSync(HEADERS_FILE, "utf8").split("\n")) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  if (!/^\s/.test(line)) {
    const escaped = line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    rules.push({ pattern: new RegExp(`^${escaped}$`), headers: [] });
    continue;
  }
  const idx = line.indexOf(":");
  if (idx > 0) rules.at(-1)?.headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};

createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  for (const rule of rules)
    if (rule.pattern.test(path)) for (const [k, v] of rule.headers) res.setHeader(k, v);
  let file = normalize(join(root, path === "/" ? "index.html" : path));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
