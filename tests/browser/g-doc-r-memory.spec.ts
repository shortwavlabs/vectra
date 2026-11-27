// G-DOC-R stage D (AM-2 §3): browser memory evidence, Chromium only (DevTools protocol).
//   G_DOC_R_MEMORY=1 pnpm exec playwright test tests/browser/g-doc-r-memory.spec.ts --project=chromium
// In the production build, with a registered G-R1 workload loaded: clear history, collect
// garbage, read the page's main-isolate heap (Runtime.getHeapUsage); build a history; read the
// heap and the session's accounted history structure bytes; clear the history and read again.
// Measured history retention = heap before clearing − after. Accounted bytes are a model, not a
// measurement (C3.2 r3). Firefox and WebKit expose no comparable heap reading.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { writeOutput } from "./helpers.ts";

const W = resolve(import.meta.dirname, "../output/g-r1/workloads");
test.skip(!process.env.G_DOC_R_MEMORY, "set G_DOC_R_MEMORY=1 (needs the local G-R1 workloads)");
test.use({ serviceWorkers: "block" });
test.setTimeout(10 * 60_000);

type Node = { id: string; kind: string; children?: Node[] };
test("accounted history structure bytes against the measured heap (Chromium)", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the DevTools protocol heap reading is Chromium only");
  const rows: unknown[] = [];
  for (const name of ["bark-1224", "bark-2350"]) {
    const file = join(W, `${name}.vectra`);
    expect(existsSync(file), file).toBe(true);
    await page.route(`**/__workloads/${name}.vectra`, (r) =>
      r.fulfill({ body: readFileSync(file), contentType: "application/octet-stream" }),
    );
    await page.goto("/workspace.html?debug=1");
    await expect.poll(() => page.evaluate(() => "__vectra" in window)).toBe(true);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    const heap = async () => {
      for (let i = 0; i < 4; i++) await cdp.send("HeapProfiler.collectGarbage");
      return (await cdp.send("Runtime.getHeapUsage")).usedSize;
    };
    const api = <T>(fn: string, ...args: unknown[]) =>
      page.evaluate(
        ([f, a]) => {
          const w = (
            window as unknown as {
              __vectra: { workspace: Record<string, (...x: unknown[]) => unknown> };
            }
          ).__vectra;
          return w.workspace[f as string]!(...(a as unknown[]));
        },
        [fn, args] as const,
      ) as Promise<T>;
    await api("loadContainerUrl", `/__workloads/${name}.vectra`);
    const tree = await api<Node[]>("tree");
    const paths: string[] = [];
    const groups: string[] = [];
    const walk = (n: Node) => {
      if (n.kind === "path") paths.push(n.id);
      if (n.kind === "group") groups.push(n.id);
      n.children?.forEach(walk);
    };
    tree.forEach(walk);
    const clear = (w: number) =>
      api(
        "dispatch",
        { type: "setArtboard", width: 1000 + w, height: 1000 },
        { withoutHistory: true },
      );
    for (const [label, run] of [
      [
        "50 small edits",
        async () => {
          for (let i = 0; i < 50; i++)
            await api("dispatch", {
              type: "setVisible",
              ids: [paths[(i * 97) % paths.length]],
              visible: i % 2 === 0,
            });
        },
      ],
      [
        "10 structural edits (reorder a path in its group: a new sibling list each)",
        async () => {
          for (let i = 0; i < 10; i++)
            await api("dispatch", {
              type: "reorder",
              id: paths[(i * 131) % paths.length],
              index: 0,
            });
        },
      ],
    ] as const) {
      await clear(1);
      const h0 = await heap();
      await run();
      const h1 = await heap();
      const accounted = await api<{ structure: number; total: number }>("historyBytes");
      await clear(2);
      const h2 = await heap();
      rows.push({
        workload: name,
        paths: paths.length,
        scenario: label,
        accountedStructure: accounted.structure,
        accountedTotal: accounted.total,
        measuredHistory: h1 - h2,
        growth: h1 - h0,
        ratio: +(accounted.structure / (h1 - h2)).toFixed(3),
      });
    }
    await cdp.detach();
  }
  writeOutput("g-doc-r/memory-chromium.json", JSON.stringify(rows, null, 2));
  for (const r of rows) console.log(JSON.stringify(r));
});
