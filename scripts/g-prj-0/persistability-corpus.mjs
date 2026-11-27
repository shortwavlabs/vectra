// G-PRJ-0: the broader persistability corpus (beyond the 10,000-transaction unit test). Seeded
// random transactions in every validation mode, with periodic real codec-none containers, each
// state compared with full serialization (src/document/testing/persistable-differential.ts).
//   node scripts/g-prj-0/persistability-corpus.mjs [--seeds 12] [--transactions 10000] [--out f]
import { execFileSync } from "node:child_process";
import { loadavg } from "node:os";
import { writeFileSync } from "node:fs";
import { runPersistDifferential } from "../../src/document/testing/persistable-differential.ts";
import { readHeader, saveContainer } from "../../src/persistence/container.ts";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SEEDS = Number(arg("--seeds", "12"));
const TX = Number(arg("--transactions", "10000"));
const OUT = arg("--out", null);
const save = async (s) => {
  const h = readHeader(await saveContainer(s, { codec: "none" }));
  return {
    total: h.sections.reduce((t, x) => t + x.uncompressedLength, 0),
    sections: h.sections.length,
    document: h.sections[1].uncompressedLength,
  };
};
const runs = [];
const t0 = performance.now();
for (let k = 0; k < SEEDS; k++) {
  // Two thirds incremental (production), the rest split between compare and full.
  const validation = k % 6 === 4 ? "compare" : k % 6 === 5 ? "full" : "incremental";
  const seed = 9001 + k * 7919;
  const t = performance.now();
  const sum = await runPersistDifferential({
    seed,
    transactions: TX,
    saveEvery: 53,
    save,
    validation,
  });
  runs.push({ validation, ms: Math.round(performance.now() - t), ...sum });
  console.error(
    `seed ${seed} ${validation}: ${sum.accepted} accepted, ${sum.rejected} rejected ` +
      `(persist_limit ${sum.rejectedByCode.persist_limit ?? 0}), ${sum.checks} checks, ` +
      `${sum.disagreements.length} disagreements`,
  );
}
const total = (k) => runs.reduce((t, r) => t + r[k], 0);
const result = {
  script: "scripts/g-prj-0/persistability-corpus.mjs",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  trackedChanges:
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }) !==
    "",
  node: process.version,
  loadavgStart: loadavg().map((x) => +x.toFixed(2)),
  transactions: total("transactions"),
  accepted: total("accepted"),
  rejected: total("rejected"),
  checks: total("checks"),
  undos: total("undos"),
  redos: total("redos"),
  coalesced: total("coalesced"),
  withoutHistory: total("withoutHistory"),
  branches: total("branches"),
  rejectedPersistLimit: runs.reduce((t, r) => t + (r.rejectedByCode.persist_limit ?? 0), 0),
  disagreements: runs.flatMap((r) => r.disagreements),
  maxDocumentBytes: Math.max(...runs.map((r) => r.maxDocumentBytes)),
  ms: Math.round(performance.now() - t0),
  runs,
};
const json = JSON.stringify(result, null, 2);
if (OUT) writeFileSync(OUT, json + "\n");
else console.log(json);
process.exit(result.disagreements.length ? 1 : 0);
