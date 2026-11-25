import { expect, test } from "vite-plus/test";
import { pathBounds, pathData } from "./path-data.ts";

const packet = {
  chunkId: "chk_1",
  verbs: Uint8Array.from([0, 1, 2, 3, 0, 1, 3]),
  coords: Float64Array.from([0, 0, 10, 0, 10, 5, 5, 10, 0, 10, 20, 20, 30, 20]),
  verbOffsets: Uint32Array.from([0, 4, 7]),
  coordOffsets: Uint32Array.from([0, 10, 14]),
};

test("path data is one linear pass over the packet arrays", () => {
  expect(pathData(packet, 0)).toBe("M0 0L10 0C10 5 5 10 0 10Z");
  expect(pathData(packet, 1)).toBe("M20 20L30 20Z");
});

test("bounds are per path, over control points", () => {
  expect([...pathBounds(packet)]).toEqual([0, 0, 10, 10, 20, 20, 30, 20]);
});

test("construction is linear: 250k anchors in one path build in well under a second", () => {
  const n = 250_000;
  const big = {
    chunkId: "chk_2",
    verbs: Uint8Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : i === n ? 3 : 1)),
    coords: Float64Array.from({ length: 2 * n }, (_, i) => i),
    verbOffsets: Uint32Array.from([0, n + 1]),
    coordOffsets: Uint32Array.from([0, 2 * n]),
  };
  const t = performance.now();
  const d = pathData(big, 0);
  expect(d.length).toBeGreaterThan(n);
  expect(performance.now() - t).toBeLessThan(1000);
});
