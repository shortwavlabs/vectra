#!/usr/bin/env node
// Real Safari qualification of `.vectra` save/load interchange (P1-A persistence harness, served
// by the Vite dev server like tests/browser/persistence):
//   node tests/safari/persistence.mjs
// Safari ↔ Node ↔ Chromium, Firefox and Playwright WebKit, both codecs; round trip and
// byte-identical resave; malformed and oversized input fails atomically with typed errors.
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import { loadContainer, saveContainer } from "../../src/persistence/container.ts";
import {
  buildDocument,
  fromB64,
  SCENES,
  scenePath,
  semantic,
  toB64,
} from "../browser/persistence/document.ts";
import { ROOT } from "./support.mjs";
import { Safari } from "./webdriver.mjs";

const PORT = 4298;
const URL_ = `http://127.0.0.1:${PORT}/tests/browser/persistence/harness.html`;
const OUT = join(ROOT, "tests/output/safari");
const CODECS = ["none", "deflate-raw"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const dev = spawn(
  "pnpm",
  ["exec", "vp", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  // Its own process group: stopping it stops pnpm and the vp dev server it starts.
  { cwd: ROOT, stdio: "ignore", detached: true },
);
const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(),
  loadavgStart: loadavg(),
  checks: [],
};
const check = (name, pass, detail) => {
  report.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
};
let s;
const browsers = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(URL_)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  const TEXTS = Object.fromEntries(
    SCENES.map((n) => [n, readFileSync(join(ROOT, scenePath(n)), "utf8")]),
  );
  const expected = semantic(await buildDocument(TEXTS, { embedded: true }));
  s = await Safari.open();
  report.safari = {
    version: s.capabilities.browserVersion,
    platform: `${s.capabilities.platformName} ${s.capabilities["safari:platformVersion"]}`,
  };
  await s.navigate(URL_);
  await s.waitFor(() => Boolean(window.harness), { timeout: 60_000, label: "harness" });
  const safari = (fn, ...args) => s.execAsync((f, a) => window.harness[f](...a), fn, args);
  const others = {};
  for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
    const b = await type.launch();
    browsers.push(b);
    const page = await b.newPage();
    await page.goto(URL_);
    await page.waitForFunction(() => Boolean(window.harness), null, { timeout: 60_000 });
    others[name] = { page, version: b.version() };
  }
  report.engines = Object.fromEntries(Object.entries(others).map(([k, v]) => [k, v.version]));
  for (const codec of CODECS) {
    const node = toB64(
      await saveContainer(await buildDocument(TEXTS, { embedded: true }), { codec }),
    );
    const saved = await safari("save", codec);
    check(
      `${codec}: Safari save → Node strict load is semantically equal`,
      same(semantic(await loadContainer(fromB64(saved), {})), expected),
    );
    if (codec === "none") check("none: Safari bytes are identical to Node's", saved === node);
    check(`${codec}: Node save → Safari load`, same(await safari("loadSemantic", node), expected));
    for (const [name, o] of Object.entries(others)) {
      const theirs = await o.page.evaluate((c) => window.harness.save(c), codec);
      check(
        `${codec}: ${name} save → Safari load`,
        same(await safari("loadSemantic", theirs), expected),
      );
      check(
        `${codec}: Safari save → ${name} load`,
        same(await o.page.evaluate((b) => window.harness.loadSemantic(b), saved), expected),
      );
    }
    const rt = await safari("roundTrip", codec);
    check(
      `${codec}: Safari round trip (clean, no undo, byte-identical resave)`,
      same(rt.after, rt.before) &&
        rt.savedClean &&
        rt.loadedClean &&
        !rt.loadedCanUndo &&
        rt.resaveIdentical,
    );
    for (const group of ["malformed", "limits"]) {
      const r = await safari("attempts", codec, group);
      const typed = r.results.every((x) => x.error !== null && x.error.containerError);
      const atomic =
        r.sameSession && r.sameSnapshot && r.sameState && r.sameContent && r.storeIntegrity;
      check(
        `${codec}: ${group} input fails atomically with typed errors in Safari (${r.results.length} cases)`,
        typed && atomic,
        r.results.map((x) => [x.name, x.error?.code ?? null]),
      );
    }
  }
} catch (e) {
  check("harness ran", false, String(e.stack ?? e));
} finally {
  await s?.quit().catch(() => {});
  for (const b of browsers) await b.close().catch(() => {});
  if (dev.pid) process.kill(-dev.pid, "SIGTERM");
}
report.loadavgEnd = loadavg();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "persistence.json"), JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.pass).length;
console.log(
  `${report.checks.length - failed}/${report.checks.length} checks passed (Safari ${report.safari?.version})`,
);
process.exitCode = failed ? 1 : 0;
