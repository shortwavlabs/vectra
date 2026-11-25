// Main side of the browser copy-out benchmark: worker → main transport (transfer of the six
// arrays) and main-thread validation with the production TS validator.
import { validatePacket } from "../../../src/geometry/packet/validate.ts";
import type { GeometryPacket } from "../../../src/geometry/packet/types.ts";

interface Row {
  compute: number;
  copyOut: number;
  transport: number;
  validate: number;
}
declare global {
  interface Window {
    __copyout?: unknown;
  }
}

const params = new URLSearchParams(location.search);
const reps = Number(params.get("reps") ?? 30);
const side = Number(params.get("side") ?? 2318);
const pitch = Number(params.get("pitch") ?? 5.2);
const rows: Row[] = [];
let anchors = 0;
let bytes = 0;
const worker = new Worker(new URL("./copyout.worker.ts", import.meta.url), { type: "module" });
worker.onmessage = (e: MessageEvent) => {
  const receivedAt = performance.timeOrigin + performance.now();
  const { r, compute, copyOut, sentAt, manifest, arrays } = e.data as {
    r: number;
    compute: number;
    copyOut: number;
    sentAt: number;
    manifest: string;
    arrays: [Uint8Array, Float64Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array];
  };
  const [verbs, coords, verbOffsets, coordOffsets, styleIndex, groupIndex] = arrays;
  const t = performance.now();
  const d = validatePacket({
    manifest: JSON.parse(manifest),
    verbs,
    coords,
    verbOffsets,
    coordOffsets,
    styleIndex,
    groupIndex,
  } as GeometryPacket & Record<string, unknown>);
  const validate = performance.now() - t;
  anchors = d.anchors;
  bytes = arrays.reduce((s, a) => s + a.byteLength, 0);
  if (r > 0) rows.push({ compute, copyOut, transport: receivedAt - sentAt, validate });
  if (rows.length === reps) {
    const stat = (k: keyof Row) => {
      const v = rows.map((x) => x[k]).sort((a, b) => a - b);
      return {
        median: +v[Math.floor(v.length / 2)]!.toFixed(3),
        p95: +v[Math.ceil(0.95 * v.length) - 1]!.toFixed(3),
        min: +v[0]!.toFixed(3),
        max: +v.at(-1)!.toFixed(3),
      };
    };
    window.__copyout = {
      userAgent: navigator.userAgent,
      reps,
      workload: { side, pitch, anchors, packetBytes: bytes },
      ms: {
        compute: stat("compute"),
        copyOut: stat("copyOut"),
        transport: stat("transport"),
        validate: stat("validate"),
      },
    };
    worker.terminate();
  }
};
worker.postMessage({ side, pitch, reps });
