// R01 adversarial validation: every malformed GeometryPacket must be rejected with a typed
// error before it can reach a renderer, exporter or the document. Also demonstrates the
// detachment hazard (a committed buffer placed in a transfer list). Self-checking: exits 1 on
// any unexpected acceptance. Usage: node adversarial.mjs > out.json
import { readFileSync } from "node:fs";
import { checkManifest, clonePacket, encodeScene, LIMITS, PacketError, transferList, validatePacket } from "./packet.mjs";

const root = new URL("../../../", import.meta.url);
const scene = JSON.parse(readFileSync(new URL("tests/output/rfc-002-review/scenes/synthetic-correctness.scene.json", root), "utf8"));
const good = encodeScene(scene);
const fresh = () => ({ ...clonePacket(good), manifest: structuredClone(good.manifest) });

const cases = [
  ["valid packet", null, (p) => p],
  ["verb offsets decreasing", "offsets", (p) => ((p.verbOffsets[3] = p.verbOffsets[1]), p)],
  ["verb offset beyond array", "offsets", (p) => ((p.verbOffsets[2] = 1e9), p)],
  ["bad sentinel", "offsets", (p) => ((p.verbOffsets[p.verbOffsets.length - 1] -= 1), p)],
  ["coordinate offsets inconsistent (surplus)", "arity", (p) => ((p.coordOffsets[1] += 2), p)],
  ["too few coordinates for verbs", "arity", (p) => ((p.coordOffsets[1] -= 2), p)],
  ["coord array shorter than manifest", "length", (p) => ((p.coords = p.coords.subarray(0, p.coords.length - 2)), p)],
  ["NaN coordinate", "coord", (p) => ((p.coords[5] = NaN), p)],
  ["+Infinity coordinate", "coord", (p) => ((p.coords[7] = Infinity), p)],
  ["coordinate beyond ±1e6", "coord", (p) => ((p.coords[9] = 1.5e6), p)],
  ["unknown opcode", "opcode", (p) => ((p.verbs[1] = 7), p)],
  ["segment before moveTo", "grammar", (p) => ((p.verbs[0] = 1), p)],
  ["segment after close without moveTo", "grammar", (p) => {
    // Path 0 is a closed polyline ending in Z; make the next path start with L.
    p.verbs[p.verbOffsets[1]] = 1;
    return p;
  }],
  ["style index out of range", "ref", (p) => ((p.styleIndex[0] = 999), p)],
  ["group index out of range", "ref", (p) => ((p.groupIndex[0] = 999), p)],
  ["groups not contiguous in paint order", "ref", (p) => ((p.groupIndex[p.groupIndex.length - 1] = 0), p)],
  ["wrong array type (Float32 coords)", "type", (p) => ((p.coords = Float32Array.from(p.coords)), p)],
  ["wrong array type (plain array offsets)", "type", (p) => ((p.verbOffsets = Array.from(p.verbOffsets)), p)],
  ["detached buffer (transferred away)", "length", (p) => {
    structuredClone(p.coords.buffer, { transfer: [p.coords.buffer] });
    return p;
  }],
  ["unsupported version", "version", (p) => ((p.manifest.version = 2), p)],
  ["negative count", "manifest", (p) => ((p.manifest.pathCount = -1), p)],
  ["non-integer count", "manifest", (p) => ((p.manifest.verbCount = 1.5), p)],
  ["artboard out of range", "manifest", (p) => ((p.manifest.width = 1e9), p)],
  ["anchor budget exceeded", "budget", (p) => p, { ...LIMITS, maxAnchors: 50 }],
];

const results = [];
let failures = 0;
for (const [name, want, mutate, limits] of cases) {
  let got = null, message = "";
  try {
    validatePacket(mutate(fresh()), limits);
  } catch (e) {
    got = e instanceof PacketError ? e.code : `UNTYPED:${e}`;
    message = e.message;
  }
  const ok = got === want;
  if (!ok) failures++;
  results.push({ case: name, expected: want ?? "accept", got: got ?? "accept", ok, message });
}

// Excessive allocation: manifests declaring huge sizes must be refused BEFORE allocating.
for (const [name, m] of [
  ["declared 2^32 coords", { ...good.manifest, coordCount: 2 ** 32 }],
  ["declared 10M paths", { ...good.manifest, pathCount: 10_000_000 }],
  ["declared 1 GiB total", { ...good.manifest, verbCount: 2 ** 30 }],
]) {
  const before = process.memoryUsage().arrayBuffers;
  let got = null;
  try {
    checkManifest(m);
  } catch (e) {
    got = e.code;
  }
  const grew = process.memoryUsage().arrayBuffers - before;
  const ok = got === "budget" && grew < 1 << 20;
  if (!ok) failures++;
  results.push({ case: name, expected: "budget (no allocation)", got, allocatedBytes: grew, ok });
}

// Detachment hazard: transferring a COMMITTED packet destroys it; a job copy does not.
const committed = clonePacket(good);
const job = clonePacket(committed);
structuredClone(job, { transfer: transferList(job) });
const committedIntact = committed.coords.byteLength === good.coords.byteLength && committed.coords.every((v, i) => v === good.coords[i]);
const jobDetached = job.coords.byteLength === 0;
const victim = clonePacket(good);
structuredClone(victim, { transfer: transferList(victim) });
const hazard = { jobCopyTransferred_committedIntact: committedIntact, jobCopyDetachedAfterTransfer: jobDetached,
  committedTransferredByMistake_byteLength: victim.coords.byteLength };
if (!committedIntact || !jobDetached || victim.coords.byteLength !== 0) failures++;

console.log(JSON.stringify({ node: process.version, cases: results.length, failures, results, hazard }, null, 1));
console.error(`${results.length - failures}/${results.length} adversarial cases behave as expected; detachment demo: ${JSON.stringify(hazard)}`);
process.exit(failures ? 1 : 0);
