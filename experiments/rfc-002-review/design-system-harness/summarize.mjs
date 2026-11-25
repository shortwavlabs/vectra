// Condenses test-results/playwright-report.json into the committed artifacts:
// playwright-results.json (status + notes per test/engine) and csp-violations.json.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ART = resolve(import.meta.dirname, "../../../docs/research/rfc-002-review/artifacts/design-system");
const report = JSON.parse(readFileSync(resolve(import.meta.dirname, "test-results/playwright-report.json"), "utf8"));
const parse = (d) => { try { return JSON.parse(d); } catch { return d; } };
const strip = (s) => s?.replace(/\u001b\[[0-9;]*m/g, "").replaceAll(resolve(import.meta.dirname, "../../.."), "<repo>");

const results = [];
const csp = {};
for (const suite of report.suites) for (const spec of suite.specs) for (const t of spec.tests) {
  const r = t.results.at(-1);
  const notes = Object.fromEntries((r.annotations ?? t.annotations).map((a) => [a.type, parse(a.description)]));
  results.push({ test: spec.title, engine: t.projectName, status: r.status, durationMs: r.duration, retries: t.results.length - 1, notes, errors: (r.errors ?? []).map((e) => strip(e.message)) });
  (csp[t.projectName] ??= {})[spec.title] = { violations: notes["csp-violations"], console: notes["console-errors"], external: notes["external-requests"] };
}
const env = { playwright: report.config.version, startTime: report.stats.startTime, stats: report.stats };
writeFileSync(`${ART}/playwright-results.json`, JSON.stringify({ env, results }, null, 2) + "\n");
writeFileSync(`${ART}/csp-violations.json`, JSON.stringify(csp, null, 2) + "\n");
for (const e of ["chromium", "firefox", "webkit"]) {
  const rs = results.filter((r) => r.engine === e);
  console.log(e, rs.filter((r) => r.status === "passed").length, "/", rs.length);
}
