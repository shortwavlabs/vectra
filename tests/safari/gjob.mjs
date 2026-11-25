#!/usr/bin/env node
// Real Safari qualification of G-JOB against the production build (`pnpm run build` first):
//   node tests/safari/gjob.mjs [scenario ...]
// Each scenario runs in a fresh WebDriver session on a fresh origin (so service-worker state is
// isolated). "Offline" means the origin refuses connections (WebDriver has no network
// emulation; navigator.onLine stays true). Results: tests/output/safari/gjob.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { DIST, makeBuild2, ROOT, serve, templateOnlyVariant, versionOf } from "./support.mjs";
import { Safari } from "./webdriver.mjs";

const OUT = join(ROOT, "tests/output/safari");
const BW = (threshold) => ({
  settings: { mode: "bw", threshold, invert: false, speckle: 16, alphaThreshold: 128 },
});
const COLOR = { mode: "color" };
const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
};

// --- page helpers -----------------------------------------------------------------------------
const jobs = (s, fn, ...args) => s.execAsync((f, a) => window.__vectra.jobs[f](...a), fn, args);
const diag = (s) => jobs(s, "diag");
const outcome = (s, id) => jobs(s, "outcome", id);
const jobId = (sub) => {
  assert(sub && sub.accepted, `accepted: ${JSON.stringify(sub)}`);
  return sub.jobId;
};
const ready = (s, label = "ready") =>
  s.waitFor(() => Boolean(window.__vectra && window.__vectra.ready), { label });
const offlineReady = (s) =>
  s.waitFor(
    () => document.querySelector("[data-testid=offline-ready]")?.textContent === "Offline-ready.",
    { label: "offline-ready" },
  );
const buildIdOf = (s) => s.exec(() => window.__vectra?.ready?.buildId ?? null);
const swVersion = (s) =>
  s.execAsync(
    () =>
      new Promise((ok) => {
        navigator.serviceWorker.addEventListener(
          "message",
          (e) => e.data?.type === "vectra-sw-version" && ok(e.data),
          { once: true },
        );
        navigator.serviceWorker.controller.postMessage("vectra-sw-version");
      }),
  );
const cacheEntries = (s) =>
  s.execAsync(async () => {
    const out = {};
    for (const k of (await caches.keys()).filter((x) => x.startsWith("vectra-")))
      out[k] = (await (await caches.open(k)).keys()).length;
    return out;
  });
const checkForUpdate = (s) =>
  s.execAsync(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    await r.update().catch(() => {});
    return true;
  });
/** A 2400×1800 synthetic colour image fed to the file input, then the workbench's preview. */
async function loadSynthetic(s) {
  await s.execAsync(async () => {
    const width = 2400;
    const height = 1800;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, "#202020");
    g.addColorStop(1, "#f0e8d8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 60% ${30 + (i % 40)}%)`;
      ctx.beginPath();
      ctx.arc(
        (((i * 7919) % 1000) / 1000) * width,
        (((i * 104729) % 1000) / 1000) * height,
        ((5 + (i % 30)) * width) / 1000,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "synthetic.png", { type: "image/png" }));
    const input = document.querySelector("[data-testid=file]");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await s.waitFor(
    () =>
      document.body.innerText.includes("Original · 2400×1800") &&
      document.querySelector("[data-testid=status]")?.dataset.state === "done",
    { timeout: 120_000, label: "synthetic preview done" },
  );
}
const waitForStage = (s, id, stage) =>
  s.waitFor((j, st) => window.__vectra.jobs.stages(j).some((x) => x.stage === st), {
    args: [id, stage],
    interval: 20,
    label: `stage ${stage}`,
  });
/** Terminates the worker by cancelling a running trace, then traces on a new one (with churn). */
async function recreateWorker(s, churn = false) {
  const id = jobId(await jobs(s, "final", COLOR));
  await waitForStage(s, id, "segment");
  const ack = await jobs(s, "cancel", id);
  assert(ack.ok, "cancel of a running trace");
  const before = await diag(s);
  const ids = await s.exec(
    (n) => {
      const j = window.__vectra.jobs;
      return Array.from(
        { length: n },
        (_, k) =>
          j.preview({
            settings: {
              mode: "bw",
              threshold: 140 - k * 10,
              invert: false,
              speckle: 16,
              alphaThreshold: 128,
            },
          }).jobId,
      );
    },
    churn ? 5 : 1,
  );
  const outs = [];
  for (const i of ids) outs.push(await outcome(s, i));
  const after = await diag(s);
  assert(outs.at(-1).status === "succeeded", `last preview: ${JSON.stringify(outs.at(-1))}`);
  assert(
    outs.slice(0, -1).every((o) => o.status === "cancelled"),
    "earlier previews cancelled",
  );
  assert(after.workersCreated === before.workersCreated + 1, "exactly one new worker");
  assert(after.startupFailures === before.startupFailures, "no start-up failure");
  assert(after.buildMismatches === 0, "no build mismatch");
  return {
    cancelAckMs: ack.ackMs,
    workersCreated: after.workersCreated,
    outcomes: outs.map((o) => o.status),
  };
}

// --- scenarios --------------------------------------------------------------------------------
let build2 = null;
const getBuild2 = () => (build2 ??= makeBuild2());

const scenarios = {
  async "handshake-startup"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s);
    await offlineReady(s);
    const d = await diag(s);
    const sw = await swVersion(s);
    const b = await buildIdOf(s);
    assert(d.handshakes >= 1 && d.buildMismatches === 0, "handshake passed");
    assert(sw.buildId === b, "controller caches this build");
    return { buildId: b, swVersion: sw.version, handshakes: d.handshakes };
  },

  async "churn-online-offline"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s);
    await offlineReady(s);
    await loadSynthetic(s);
    const online = await recreateWorker(s, true);
    site.down = true;
    const offline = [];
    for (let k = 0; k < 4; k++) offline.push(await recreateWorker(s, true));
    return { online, offline };
  },

  async "cancel-ui-ack"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s);
    await loadSynthetic(s);
    // C9: cancel invoked → UI shows cancelled. A colour preview runs; the cancel button is
    // clicked in the page and the time to the "cancelled" state is measured there.
    await s.exec(() => {
      const sel = document.querySelector("[data-testid=mode]");
      sel.value = "color";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await s.waitFor(
      () => document.querySelector("[data-testid=status]")?.dataset.state === "processing",
      {
        label: "processing",
      },
    );
    await s.waitFor(() => window.__vectra.jobs.diag().running !== null, { label: "running" });
    const ms = await s.execAsync(
      () =>
        new Promise((ok) => {
          const status = document.querySelector("[data-testid=status]");
          const t0 = performance.now();
          const obs = new MutationObserver(() => {
            if (status.dataset.state === "cancelled") {
              obs.disconnect();
              ok(performance.now() - t0);
            }
          });
          obs.observe(status, { attributes: true });
          document.querySelector("[data-testid=cancel]").click();
        }),
    );
    assert(ms <= 200, `cancel acknowledged in ${ms} ms`);
    return { clickToCancelledMs: ms };
  },

  async "offline-reload-and-recreation"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s);
    await offlineReady(s);
    const b = await buildIdOf(s);
    site.down = true;
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s, "ready after offline reload");
    assert((await buildIdOf(s)) === b, "same build offline");
    await loadSynthetic(s);
    return { buildId: b, recreation: await recreateWorker(s, true) };
  },

  async "single-build-update"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s);
    await offlineReady(s);
    const b1 = await buildIdOf(s);
    const v1 = (await swVersion(s)).version;
    const old = (await s.handles())[0];
    await loadSynthetic(s);
    site.deploy(getBuild2()); // build 1's files are gone from the server
    await checkForUpdate(s);
    await s.waitFor(() => Boolean(document.querySelector("[data-testid=update-waiting]")), {
      label: "update announced",
    });
    assert((await swVersion(s)).version === v1, "not activated");
    const recreateOnline = await recreateWorker(s);
    site.down = true;
    const recreateOffline = await recreateWorker(s, true);
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s, "old tab reload offline");
    assert((await buildIdOf(s)) === b1, "reload keeps build 1 offline");
    site.down = false;
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s, "old tab reload online");
    assert((await buildIdOf(s)) === b1, "reload keeps build 1 online");
    // A second tab while build 1 is open also gets build 1.
    const second = await s.newTab();
    await s.switchTo(second);
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s, "second tab");
    assert((await buildIdOf(s)) === b1, "second tab gets build 1");
    // Close every build-1 page (keep a blank tab), then visit again: build 2 activates.
    const blank = await s.newTab();
    await s.closeWindow(); // second
    await s.switchTo(old);
    await s.closeWindow(); // old
    await s.switchTo(blank);
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s, "new visit");
    const t0 = Date.now();
    while ((await buildIdOf(s)) === b1 && Date.now() - t0 < 30_000) {
      await new Promise((r) => setTimeout(r, 500));
      await s.navigate(`${site.origin}/?debug=1`);
      await ready(s, "new visit (retry)");
    }
    const b2 = await buildIdOf(s);
    assert(b2 !== b1, "build 2 after the old tabs closed");
    const keys = await s
      .waitFor(
        async () => {
          const k = (await caches.keys()).filter((x) => x.startsWith("vectra-"));
          return k.length === 1 ? k : null;
        },
        { label: "old cache deleted" },
      )
      .catch(() => null);
    const entries = await cacheEntries(s);
    assert(Object.keys(entries).length === 1, `one cache: ${JSON.stringify(entries)}`);
    const oldWorker = readdirSync(join(DIST, "assets")).find((f) =>
      f.startsWith("compute.worker-"),
    );
    const status = await s.execAsync(async (u) => (await fetch(u)).status, `./assets/${oldWorker}`);
    assert(status === 404, `build 1 worker no longer served (${status})`);
    site.down = true;
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s, "offline after update");
    assert((await buildIdOf(s)) === b2, "build 2 offline");
    await loadSynthetic(s);
    const after = await recreateWorker(s, true);
    return { b1, b2, recreateOnline, recreateOffline, entries, keys, after };
  },

  async "template-only-update"(s, site) {
    const variant = templateOnlyVariant();
    try {
      await s.navigate(`${site.origin}/?debug=1`);
      await ready(s);
      await offlineReady(s);
      const b1 = await buildIdOf(s);
      const vA = (await swVersion(s)).version;
      const vB = versionOf(variant);
      assert(vB !== vA, "template-only change gets a new cache version");
      await loadSynthetic(s);
      const before = await cacheEntries(s);
      site.deploy(variant);
      const wasm = `/assets/${readdirSync(join(DIST, "assets")).find((f) => f.endsWith(".wasm"))}`;
      site.failing.add(wasm);
      const hits0 = site.hits.get(wasm) ?? 0;
      await checkForUpdate(s);
      const t0 = Date.now();
      while ((site.hits.get(wasm) ?? 0) === hits0 && Date.now() - t0 < 30_000)
        await new Promise((r) => setTimeout(r, 200));
      assert((site.hits.get(wasm) ?? 0) > hits0, "install fetched the failing asset");
      await s.waitFor(
        async () => {
          const r = await navigator.serviceWorker.getRegistration();
          return r.installing === null && r.waiting === null;
        },
        { label: "install failed" },
      );
      const after = await cacheEntries(s);
      assert(JSON.stringify(after) === JSON.stringify(before), "build A's cache untouched");
      site.down = true;
      await s.navigate(`${site.origin}/?debug=1`);
      await ready(s, "offline reload under build A");
      assert((await buildIdOf(s)) === b1, "build A offline");
      await loadSynthetic(s);
      const recreation = await recreateWorker(s, true);
      site.down = false;
      site.failing.clear();
      await checkForUpdate(s);
      await s.waitFor(() => Boolean(document.querySelector("[data-testid=update-waiting]")), {
        label: "B installed and waiting",
      });
      return { vA, vB, before, after, recreation, final: await cacheEntries(s) };
    } finally {
      rmSync(variant, { recursive: true, force: true });
    }
  },

  async "interrupted-install"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s);
    await offlineReady(s);
    const b1 = await buildIdOf(s);
    const before = await cacheEntries(s);
    const b2dir = getBuild2();
    site.deploy(b2dir);
    const wasm2 = `/assets/${readdirSync(join(b2dir, "assets")).find((f) => f.endsWith(".wasm"))}`;
    site.failing.add(wasm2);
    await checkForUpdate(s);
    const t0 = Date.now();
    while (!(site.hits.get(wasm2) > 0) && Date.now() - t0 < 30_000)
      await new Promise((r) => setTimeout(r, 200));
    await s.waitFor(
      async () => {
        const r = await navigator.serviceWorker.getRegistration();
        return r.installing === null && r.waiting === null;
      },
      { label: "install failed" },
    );
    const after = await cacheEntries(s);
    assert(JSON.stringify(after) === JSON.stringify(before), "no partial cache; old cache intact");
    site.down = true;
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s, "offline reload");
    assert((await buildIdOf(s)) === b1, "old version offline");
    await loadSynthetic(s);
    const recreation = await recreateWorker(s);
    site.down = false;
    site.failing.clear();
    await checkForUpdate(s);
    await s.waitFor(() => Boolean(document.querySelector("[data-testid=update-waiting]")), {
      label: "later install succeeds",
    });
    return { before, after, recreation };
  },

  async "cache-eviction-recovery"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s);
    await offlineReady(s);
    const b1 = await buildIdOf(s);
    const entries = await cacheEntries(s);
    const evict = () =>
      s.execAsync(async () => {
        const key = (await caches.keys()).find((k) => k.startsWith("vectra-"));
        return (await caches.open(key)).delete(new URL("./index.html", location.href).href);
      });
    // Same build on the server: the shell is repaired.
    assert(await evict(), "shell evicted");
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s, "repaired shell");
    assert((await buildIdOf(s)) === b1, "same build repaired");
    assert(
      JSON.stringify(await cacheEntries(s)) === JSON.stringify(entries),
      "shell back in cache",
    );
    // A second tab keeps working while the first meets build 2 on the server.
    const first = (await s.handles())[0];
    const other = await s.newTab();
    await s.switchTo(other);
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s, "other tab");
    await loadSynthetic(s);
    await s.switchTo(first);
    site.deploy(getBuild2());
    assert(await evict(), "shell evicted again");
    await s.navigate(`${site.origin}/?debug=1`);
    const reason = await s.waitFor(
      () => (document.body?.dataset.testid === "sw-recovery" ? document.body.dataset.reason : null),
      { label: "recovery page" },
    );
    assert(reason === "version", `recovery reason ${reason}`);
    assert((await s.exec(() => "__vectra" in window)) === false, "no app code ran");
    await s.switchTo(other);
    assert((await buildIdOf(s)) === b1, "other tab still build 1");
    const otherTab = await recreateWorker(s);
    await s.switchTo(first);
    site.down = true;
    await s.navigate(`${site.origin}/?debug=1`);
    const offline = await s.waitFor(
      () => (document.body?.dataset.testid === "sw-recovery" ? document.body.dataset.reason : null),
      { label: "offline recovery page" },
    );
    assert(offline === "offline", `offline reason ${offline}`);
    return { b1, reason, offline, otherTab };
  },

  async "frozen-export-and-integrity"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await ready(s);
    await loadSynthetic(s);
    assert(
      (await outcome(s, jobId(await jobs(s, "final", BW(128))))).status === "committed",
      "final",
    );
    const before = await outcome(s, jobId(await jobs(s, "exportDocument", "svg")));
    const ids = await s.exec(() => {
      const j = window.__vectra.jobs;
      const long = j.final({ mode: "color" }).jobId;
      const exp = j.exportDocument("svg").jobId;
      j.recolourAll(0x123456ff);
      return { long, exp };
    });
    const frozen = await outcome(s, ids.exp);
    await outcome(s, ids.long);
    const after = await outcome(s, jobId(await jobs(s, "exportDocument", "svg")));
    assert(
      frozen.status === "delivered" && frozen.bytesDigest === before.bytesDigest,
      "frozen snapshot",
    );
    assert(after.bytesDigest !== before.bytesDigest, "edits visible afterwards");
    // Integrity after repeated termination (cancel and crash), offline.
    const digest = await jobs(s, "documentDigest");
    site.down = true;
    for (let k = 0; k < 4; k++) {
      const id = jobId(await jobs(s, "final", COLOR));
      await waitForStage(s, id, "segment");
      await jobs(s, "cancel", id);
      await outcome(s, jobId(await jobs(s, "preview", BW(90 + k))));
      await jobs(s, "inject", "crash-now");
    }
    await new Promise((r) => setTimeout(r, 500));
    assert((await jobs(s, "documentDigest")) === digest, "document byte-identical");
    assert(await jobs(s, "storeIntact"), "store intact");
    assert(await jobs(s, "undo"), "undo");
    assert(await jobs(s, "redo"), "redo");
    assert((await jobs(s, "documentDigest")) === digest, "undo/redo restore the same digest");
    const d = await diag(s);
    assert(d.snapshotRefs === 0 && d.reservedBytes === 0, "no leaked ownership");
    return {
      before: before.bytesDigest,
      frozen: frozen.bytesDigest,
      after: after.bytesDigest,
      diag: d,
    };
  },

  async "build-mismatch-refused"(s, site) {
    // The server rewrites the worker's build ID (first visit; the cache will hold it too).
    site.rewrite = (path, body) =>
      path.includes("/assets/compute.worker-")
        ? Buffer.from(
            body.toString("utf8").replace(/buildId:`[0-9a-f]{16}`/, "buildId:`0000000000000000`"),
          )
        : body;
    await s.navigate(`${site.origin}/?debug=1`);
    await s.waitFor(
      () => document.querySelector("[data-testid=status]")?.textContent.includes("build_mismatch"),
      { label: "build mismatch shown" },
    );
    const d = await s.exec(() => window.__vectra.jobs.diag());
    assert(d.handshakes === 0 && d.buildMismatches >= 1 && d.state === "skewed", "refused");
    return { diag: d };
  },
};

// --- runner -----------------------------------------------------------------------------------
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(scenarios);
mkdirSync(OUT, { recursive: true });
const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(),
  started: new Date().toISOString(),
  loadavgStart: loadavg(),
  results: [],
};
for (const name of names) {
  const site = await serve(DIST);
  let s;
  const t0 = Date.now();
  const r = { name };
  try {
    s = await Safari.open();
    report.safari ??= {
      version: s.capabilities.browserVersion,
      platform: `${s.capabilities.platformName} ${s.capabilities["safari:platformVersion"]} (${s.capabilities["safari:platformBuildVersion"]})`,
    };
    r.details = await scenarios[name](s, site);
    r.pass = true;
  } catch (e) {
    r.pass = false;
    r.error = String(e.stack ?? e);
    try {
      writeFileSync(join(OUT, `gjob-${name}.png`), await s.screenshot());
    } catch {}
  } finally {
    r.ms = Date.now() - t0;
    await s?.quit().catch(() => {});
    site.close();
  }
  report.results.push(r);
  console.log(
    `${r.pass ? "PASS" : "FAIL"} ${name} (${r.ms} ms)${r.pass ? "" : `\n  ${r.error.split("\n")[0]}`}`,
  );
}
report.loadavgEnd = loadavg();
if (build2) rmSync(build2, { recursive: true, force: true });
writeFileSync(join(OUT, "gjob.json"), JSON.stringify(report, null, 2));
const failed = report.results.filter((r) => !r.pass).length;
console.log(
  `${report.results.length - failed}/${report.results.length} passed (Safari ${report.safari?.version})`,
);
process.exitCode = failed ? 1 : 0;
