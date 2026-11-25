// Disposable static server for the RFC-002 review harnesses. Serves the bench pages, the
// built WASM package and benchmark scenes with exactly the production headers from
// public/_headers (CSP included), so every measurement runs under the shipped CSP.
// Usage: node experiments/rfc-002-review/bench/server.mjs [port]
import { createServer } from "node:http";
import { readFileSync, statSync, createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const mounts = {
  "/bench/": join(root, "experiments/rfc-002-review/bench"),
  "/pkg/": join(root, "packages/vector-engine-wasm/pkg"),
  "/scenes/real/": join(root, "tests/output/regression-a4cf172"),
  "/scenes/synth/": join(root, "tests/output/rfc-002-review/scenes"),
  "/scenes/native/": join(root, "tests/output/native"),
  "/packets/": join(root, "tests/output/rfc-002-review/packets"),
};

// Production headers for "/*" from public/_headers (verbatim).
const headers = [];
let inGlobal = false;
for (const line of readFileSync(join(root, "public/_headers"), "utf8").split("\n")) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  if (!/^\s/.test(line)) {
    inGlobal = line.trim() === "/*";
    continue;
  }
  const i = line.indexOf(":");
  if (inGlobal && i > 0) headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
};

const port = Number(process.argv[2] ?? 4199);
createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  for (const [k, v] of headers) res.setHeader(k, v);
  res.setHeader("Cache-Control", "no-store");
  const mount = Object.keys(mounts).find((m) => path.startsWith(m));
  const file = mount && normalize(join(mounts[mount], path.slice(mount.length)));
  if (!file || !file.startsWith(mounts[mount])) return res.writeHead(404).end();
  let st;
  try {
    st = statSync(file);
  } catch {
    return res.writeHead(404).end();
  }
  if (!st.isFile()) return res.writeHead(404).end();
  res.writeHead(200, {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    "Content-Length": st.size,
  });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`bench server http://127.0.0.1:${port}/bench/`));
