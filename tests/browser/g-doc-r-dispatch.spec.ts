// G-DOC-R closure (brief §3): session dispatch timing in the production build, per engine.
//   G_DOC_R_DISPATCH=1 pnpm exec playwright test tests/browser/g-doc-r-dispatch.spec.ts
//   (optional: G_DOC_R_DISPATCH_SIZES=43000,250000,330000  G_DOC_R_DISPATCH_REPS=30)
// The Node benchmark's three workloads (src/document/testing/bench-workload.ts: 43k, 250k and
// 330k paths) are rebuilt in the page by replaying the workload's own commands, with each packet
// served as a C3.1 geometry record, into a session that is not shown (qualification
// `buildDetached`): no subscribers and no renderer, so only dispatch is timed, on the production
// validation path (`incremental`, asserted). The container loader cannot open the 330k-path
// (996k-anchor) workload: its document section (72.7 MB) exceeds C7's 64 MiB document cap. All
// three workloads are rebuilt the same way, for one method.
// Per transaction type, the Node procedure (scripts/bench-g-doc-r.mjs): an untimed `setArtboard`
// gives a fresh state S; `dispatch(cmd)` on S is timed; undo and redo are timed; an untimed undo
// returns to S. Differences from Node, recorded with the results:
// - commands are built before the timed section (Node builds them inside it; for commitTrace
//   that includes synthesising the packet);
// - Firefox and WebKit pages cannot force a collection: a 5 ms yield between repetitions lets
//   scheduled collection run outside the timed sections, but p95 may include GC pauses;
// - `performance.now()` resolution is the engine's (the page is not cross-origin isolated),
//   measured and recorded.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Command } from "../../src/document/commands.ts";
import { SECTION_KEYS } from "../../src/document/packet-port.ts";
import { buildWorkload } from "../../src/document/testing/bench-workload.ts";
import { encodeRecord } from "../../src/geometry/packet/codec.ts";
import { writeOutput } from "./helpers.ts";

test.skip(!process.env.G_DOC_R_DISPATCH, "set G_DOC_R_DISPATCH=1 (opt-in; minutes per engine)");
test.use({ serviceWorkers: "block" });
test.setTimeout(60 * 60_000);

const SIZES = (process.env.G_DOC_R_DISPATCH_SIZES ?? "43000,250000,330000").split(",").map(Number);
const REPS = Number(process.env.G_DOC_R_DISPATCH_REPS ?? "30");
const WARMUP = 2;
const conditions = () => {
  const ps = execFileSync("ps", ["-Ao", "pcpu,comm", "-r"], { encoding: "utf8" })
    .trim()
    .split("\n");
  return {
    loadavg: loadavg().map((x) => +x.toFixed(2)),
    top: ps.slice(1, 6).map((l) => l.trim().replace(/^(\S+)\s+.*\/(.*)$/, "$1 $2")),
    ngspice: ps.filter((l) => /ngspice/.test(l)).length,
  };
};
type Plain = { ctor: string; data: number[] };
type Spec = {
  names: string[];
  cmds: Record<string, Command>;
  trace: {
    provenance: unknown;
    replaceLayerId: string;
    manifest: unknown;
    arrays: Record<string, Plain>;
  };
  reps: number;
  warmup: number;
};
type Stats = { p50: number; p95: number; max: number };
type Run = {
  resolutionMs: number;
  anchors: number;
  commands: Record<
    string,
    { dispatch: Stats; undo: Stats; redo: Stats; incrementalDecided: number }
  >;
};

test("production session dispatch: 12 transaction types at the three workloads", async ({
  page,
  browserName,
}) => {
  const sw = readFileSync(resolve(import.meta.dirname, "../../dist/sw.js"), "utf8");
  const result = {
    spec: "tests/browser/g-doc-r-dispatch.spec.ts",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    buildId: /BUILD_ID = "([0-9a-f]+)"/.exec(sw)?.[1],
    version: /VERSION = "([0-9a-f]+)"/.exec(sw)?.[1],
    engine: browserName,
    browserVersion: page.context().browser()?.version(),
    reps: REPS,
    warmup: WARMUP,
    conditionsStart: conditions(),
    workloads: [] as unknown[],
  };
  await page.goto("/workspace.html?debug=1");
  await expect.poll(() => page.evaluate(() => "__vectra" in window)).toBe(true);
  for (const paths of SIZES) {
    let doc: ReturnType<typeof buildWorkload> | null = buildWorkload(paths);
    // The build's commands, each packet replaced by the URL of its geometry record.
    const records: Buffer[] = [];
    const setup = doc.setup().map((c) => {
      if (c.type !== "commitTrace") return c;
      const { packet, ...rest } = c;
      records.push(Buffer.from(encodeRecord(packet)));
      return { ...rest, packetUrl: `/__dispatch/${paths}-${records.length - 1}.rec` };
    });
    const names = Object.keys(doc.cmds);
    const cmds = Object.fromEntries(
      names.filter((n) => n !== "commitTrace").map((n) => [n, doc!.cmds[n]!()]),
    );
    const t = doc.cmds.commitTrace!() as Extract<Command, { type: "commitTrace" }>;
    const p = t.packet as unknown as Record<
      string,
      ArrayLike<number> & { constructor: { name: string } }
    >;
    const spec: Spec = {
      names,
      cmds,
      trace: {
        provenance: t.provenance,
        replaceLayerId: t.replaceLayerId!,
        manifest: t.packet.manifest,
        arrays: Object.fromEntries(
          SECTION_KEYS.map((k) => [k, { ctor: p[k]!.constructor.name, data: Array.from(p[k]!) }]),
        ),
      },
      reps: REPS,
      warmup: WARMUP,
    };
    const info = doc.info;
    doc = null;
    await page.route(`**/__dispatch/${paths}-*.rec`, (r) =>
      r.fulfill({
        body: records[Number(/-(\d+)\.rec$/.exec(r.request().url())![1])],
        contentType: "application/octet-stream",
      }),
    );
    const loaded = await page.evaluate(
      (o) =>
        (
          window as unknown as {
            __vectra: {
              workspace: {
                buildDetached(o: unknown): Promise<{ validation: string; nodes: number }>;
              };
            };
          }
        ).__vectra.workspace.buildDetached(o),
      { width: 1000, height: 1000, commands: setup },
    );
    expect(loaded.nodes, "the replayed workload matches the Node build").toBe(info.nodes);
    expect(loaded.validation, "the production validation path").toBe("incremental");
    const before = conditions();
    const run: Run = await page.evaluate(async (spec: Spec) => {
      type Session = {
        state: unknown;
        validation: string;
        validations: { incremental: number; full: number };
        dispatch(c: unknown): void;
        undo(): void;
        redo(): void;
        getSnapshot(): { anchors: number };
      };
      const s = (
        window as unknown as { __vectra: { workspace: { detached(): Session } } }
      ).__vectra.workspace.detached();
      const g = globalThis as unknown as Record<string, { from(a: number[]): unknown }>;
      const make = (name: string) =>
        name === "commitTrace"
          ? {
              type: "commitTrace",
              provenance: spec.trace.provenance,
              replaceLayerId: spec.trace.replaceLayerId,
              packet: {
                manifest: structuredClone(spec.trace.manifest),
                ...Object.fromEntries(
                  Object.entries(spec.trace.arrays).map(([k, a]) => [k, g[a.ctor]!.from(a.data)]),
                ),
              },
            }
          : structuredClone(spec.cmds[name]);
      const q = (xs: number[], pr: number) => {
        const v = [...xs].sort((a, b) => a - b);
        return v[Math.min(v.length - 1, Math.max(0, Math.ceil(pr * v.length) - 1))]!;
      };
      const stats = (xs: number[]) => ({
        p50: +q(xs, 0.5).toFixed(3),
        p95: +q(xs, 0.95).toFixed(3),
        max: +Math.max(...xs).toFixed(3),
      });
      let resolutionMs = Infinity;
      for (let i = 0, t0 = performance.now(); i < 200_000; i++) {
        const t1 = performance.now();
        if (t1 > t0) {
          resolutionMs = Math.min(resolutionMs, t1 - t0);
          t0 = t1;
        }
      }
      const yieldToEngine = () => new Promise((r) => setTimeout(r, 5));
      const commands: Run["commands"] = {};
      for (const name of spec.names) {
        const rows = { dispatch: [] as number[], undo: [] as number[], redo: [] as number[] };
        const v0 = s.validations;
        for (let r = 0; r < spec.warmup + spec.reps; r++) {
          s.dispatch({ type: "setArtboard", width: 1000 + ((r + 1) % 2), height: 1000 });
          const S = s.state;
          const c = make(name);
          await yieldToEngine();
          let t0 = performance.now();
          s.dispatch(c);
          const dispatch = performance.now() - t0;
          if (s.state === S) throw new Error(`${name}: dispatch was a no-op`);
          t0 = performance.now();
          s.undo();
          const undo = performance.now() - t0;
          t0 = performance.now();
          s.redo();
          const redo = performance.now() - t0;
          s.undo();
          if (s.state !== S) throw new Error("undo did not restore S");
          if (r < spec.warmup) continue;
          rows.dispatch.push(dispatch);
          rows.undo.push(undo);
          rows.redo.push(redo);
        }
        const n = spec.warmup + spec.reps;
        commands[name] = {
          dispatch: stats(rows.dispatch),
          undo: stats(rows.undo),
          redo: stats(rows.redo),
          // Each repetition validates setArtboard (always decided) and the command.
          incrementalDecided: +((s.validations.incremental - v0.incremental - n) / n).toFixed(3),
        };
      }
      return { resolutionMs, anchors: s.getSnapshot().anchors, commands };
    }, spec);
    await page.unroute(`**/__dispatch/${paths}-*.rec`);
    result.workloads.push({
      ...info,
      validation: loaded.validation,
      conditionsStart: before,
      conditionsEnd: conditions(),
      ...run,
    });
    const worst = Object.entries(run.commands).sort(
      (a, b) => b[1].dispatch.p50 - a[1].dispatch.p50,
    )[0]!;
    console.log(
      `${browserName} ${paths}: resolution ${run.resolutionMs} ms; worst ${worst[0]} p50 ${worst[1].dispatch.p50} p95 ${worst[1].dispatch.p95} ms`,
    );
  }
  writeOutput(`g-doc-r/dispatch-${browserName}.json`, JSON.stringify(result, null, 2) + "\n");
});
