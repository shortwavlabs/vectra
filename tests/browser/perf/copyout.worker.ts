// Worker side of the browser copy-out benchmark: WASM compute and WASM → JS copy-out are timed
// here, then the six arrays are transferred to the main thread.
import init, {
  vectorizePacket,
} from "../../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";

interface Job {
  side: number;
  pitch: number;
  reps: number;
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const { side, pitch, reps } = e.data;
  await init();
  const rgba = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const i = 4 * (y * side + x);
      const v = Math.round(40 + 160 * ((x + y) / (2 * side)));
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  const req = JSON.stringify({
    presetVersion: 1,
    seed: 1,
    maxPixels: 50_000_000,
    maxAnchors: 1_000_000,
    settings: { mode: "halftone", pitch },
  });
  for (let r = 0; r < reps + 1; r++) {
    const t0 = performance.now();
    const p = vectorizePacket(rgba, side, side, req);
    const t1 = performance.now();
    const arrays = [
      p.takeVerbs(),
      p.takeCoords(),
      p.takeVerbOffsets(),
      p.takeCoordOffsets(),
      p.takeStyleIndex(),
      p.takeGroupIndex(),
    ];
    const t2 = performance.now();
    const manifest = p.manifestJson;
    p.free();
    const sentAt = performance.timeOrigin + performance.now();
    (self as unknown as Worker).postMessage(
      { r, compute: t1 - t0, copyOut: t2 - t1, sentAt, manifest, arrays },
      arrays.map((a) => a.buffer as ArrayBuffer),
    );
  }
};
