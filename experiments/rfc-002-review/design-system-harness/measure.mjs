// Bundle sizes (raw / gzip -9 / brotli q11) of dist/{baseline,app,analyze} → artifacts/bundle-sizes.json.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const ART = resolve(import.meta.dirname, "../../../docs/research/rfc-002-review/artifacts/design-system");
const size = (buf) => ({
  raw: buf.length,
  gzip: gzipSync(buf, { level: 9 }).length,
  brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
});
const sum = (files, ext) =>
  files.filter((f) => f.file.endsWith(ext)).reduce((a, f) => ({ raw: a.raw + f.raw, gzip: a.gzip + f.gzip, brotli: a.brotli + f.brotli }), { raw: 0, gzip: 0, brotli: 0 });

const out = {};
for (const build of ["baseline", "app", "analyze"]) {
  const dir = resolve(import.meta.dirname, "dist", build, "assets");
  const files = readdirSync(dir).map((file) => ({ file: file.replace(/-[\w-]{8}\.(js|css)$/, ".$1"), ...size(readFileSync(join(dir, file))) }));
  out[build] = { js: sum(files, ".js"), css: sum(files, ".css"), files };
}
out.delta = Object.fromEntries(
  ["js", "css"].map((k) => [k, Object.fromEntries(["raw", "gzip", "brotli"].map((m) => [m, out.app[k][m] - out.baseline[k][m]]))]),
);
writeFileSync(join(ART, "bundle-sizes.json"), JSON.stringify(out, null, 2) + "\n");
const kb = (n) => (n / 1024).toFixed(1);
for (const b of ["baseline", "app"]) for (const k of ["js", "css"]) console.log(b, k, kb(out[b][k].raw), kb(out[b][k].gzip), kb(out[b][k].brotli));
for (const f of out.analyze.files) console.log("  ", f.file, kb(f.raw), kb(f.gzip), kb(f.brotli));
console.log("delta", JSON.stringify(out.delta));
