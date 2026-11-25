// WASM packet adapter (corrective review, AM-1): one set of limits for producing and accepting
// packets, and explicit failure on PacketResult misuse.
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import {
  initSync,
  sceneToPacket,
  validatePacket,
  vectorizePacket,
} from "../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";

initSync({
  module: readFileSync(
    new URL("../../packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm", import.meta.url),
  ),
});
const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (JSON.parse(String(e)) as { code: string }).code;
  }
};

test("vectorizePacket never produces a packet that validatePacket would refuse", () => {
  // A request may allow up to the engineering ceiling, but the packet route is capped at the
  // product limit (C3): a 2500² gradient halftone at pitch 5 has ~1.23M anchors.
  const side = 2500;
  const rgba = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    const v = (40 + (160 * (i % side)) / side) | 0;
    rgba.fill(v, 4 * i, 4 * i + 3);
    rgba[4 * i + 3] = 255;
  }
  const req = JSON.stringify({
    presetVersion: 1,
    seed: 1,
    maxPixels: 50_000_000,
    maxAnchors: 2_000_000,
    settings: { mode: "halftone", pitch: 5 },
  });
  let accepted: string;
  try {
    const p = vectorizePacket(rgba, side, side, req);
    const arrays = [
      p.takeVerbs(),
      p.takeCoords(),
      p.takeVerbOffsets(),
      p.takeCoordOffsets(),
      p.takeStyleIndex(),
      p.takeGroupIndex(),
    ] as const;
    accepted = codeOf(() => validatePacket(p.manifestJson, ...arrays));
    p.free();
  } catch (e) {
    accepted = `produce:${(JSON.parse(String(e)) as { code: string }).code}`;
  }
  expect(accepted === "ok" || accepted.startsWith("produce:")).toBe(true);
  expect(accepted).not.toBe("budget");
});

const tiny = JSON.stringify({
  version: 1,
  width: 10,
  height: 10,
  background: null,
  palette: [],
  groups: [
    {
      id: "g",
      clip: null,
      paths: [
        {
          fill: { color: "#000000", paletteId: null },
          stroke: null,
          fillRule: "nonzero",
          verbs: "MLLZ",
          coords: [0, 0, 5, 0, 5, 5],
        },
      ],
    },
  ],
  metadata: {
    generator: "vectra",
    engineVersion: "0",
    mode: "bw",
    presetVersion: 1,
    seed: 1,
    sourceWidth: 10,
    sourceHeight: 10,
    params: {},
  },
});

test("taking an array twice, or reading the block after a take, fails explicitly", () => {
  const p = sceneToPacket(tiny);
  expect(p.takeVerbs().length).toBe(4);
  expect(codeOf(() => p.takeVerbs())).toBe("invalid_params");
  expect(codeOf(() => p.blockBytes())).toBe("invalid_params");
  p.free();
});
