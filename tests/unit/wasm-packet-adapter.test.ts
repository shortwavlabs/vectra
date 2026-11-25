// WASM packet adapter (corrective review, AM-1): one set of limits for producing and accepting
// packets, and explicit failure on PacketResult misuse.
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { PacketError } from "../../src/geometry/packet/types.ts";
import { validatePacket as validateTs } from "../../src/geometry/packet/validate.ts";
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

// Review finding 5 (LOW, documented in tests/fixtures/packet-conformance/README.md): text the
// TS side never produces. serde_json refuses it at parse time (`manifest`, before step 1);
// JSON.parse accepts it, so the TS validator reports the first contract step that fails.
// Both refuse; only the code differs.
test("text-level JSON failures: WASM says manifest, TS reports a later step", () => {
  const tsCode = (text: string) => {
    try {
      const empty = new Uint32Array(0);
      validateTs({
        manifest: JSON.parse(text),
        verbs: new Uint8Array(0),
        coords: new Float64Array(0),
        verbOffsets: new Uint32Array([0]),
        coordOffsets: new Uint32Array([0]),
        styleIndex: empty,
        groupIndex: empty,
      });
      return "ok";
    } catch (e) {
      return e instanceof PacketError ? e.code : `untyped:${String(e)}`;
    }
  };
  const nested = `${"[".repeat(130)}${"]".repeat(130)}`;
  for (const text of [
    '{"packetVersion":2,"x":1e400}',
    `{"packetVersion":2,"x":${nested}}`,
    '{"packetVersion":2,"x":"\\ud800"}',
  ]) {
    const e = new Uint32Array(0);
    const wasmCode = codeOf(() =>
      validatePacket(
        text,
        new Uint8Array(0),
        new Float64Array(0),
        new Uint32Array([0]),
        new Uint32Array([0]),
        e,
        e,
      ),
    );
    expect([wasmCode, tsCode(text)], text).toEqual(["manifest", "version"]);
  }
});

// The shared C3 conformance suite through the built WASM validator (product limits). Cases the
// WASM signature cannot express are left out: custom limits, TS-only array types and detached
// buffers, and C3.0 byte streams. Manifest-only cases run with empty sections, because steps 1–2
// fail before any section is read.
interface ConformanceCase {
  id: string;
  kind: "arrays" | "bytes" | "manifest";
  expect: string;
  tsOnly?: boolean;
  limits?: unknown;
  manifest: unknown;
  arrays?: Record<string, (number | string)[]>;
  derived?: { anchors: number; pathAnchors: number[]; subpathStart: number[] };
}
const conformance = (
  JSON.parse(
    readFileSync(new URL("../fixtures/packet-conformance/cases.json", import.meta.url), "utf8"),
  ) as { cases: ConformanceCase[] }
).cases.filter(
  (c) => c.kind !== "bytes" && !c.tsOnly && !c.limits && (c.kind === "arrays" || c.expect !== "ok"),
);
const num = (v: number | string) =>
  v === "NaN" ? NaN : v === "Infinity" ? Infinity : v === "-Infinity" ? -Infinity : (v as number);

test("the shared conformance cases WASM can express give the expected codes", () => {
  expect(conformance.length).toBe(35);
  for (const c of conformance) {
    const a = (k: string) => (c.arrays?.[k] ?? []).map(num);
    let out = "";
    const code = codeOf(() => {
      out = validatePacket(
        JSON.stringify(c.manifest),
        new Uint8Array(a("verbs")),
        new Float64Array(a("coords")),
        new Uint32Array(a("verbOffsets")),
        new Uint32Array(a("coordOffsets")),
        new Uint32Array(a("styleIndex")),
        new Uint32Array(a("groupIndex")),
      );
    });
    expect(code, c.id).toBe(c.expect);
    if (c.expect === "ok" && c.derived)
      expect(JSON.parse(out), c.id).toEqual({
        anchors: c.derived.anchors,
        paths: c.derived.pathAnchors.length,
        subpaths: c.derived.subpathStart.length,
      });
  }
});
