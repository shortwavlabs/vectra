// C3 r2 (AM-1 AR-3): identical validated scenes give byte-identical packets in Rust (the
// committed goldens, produced and re-checked by crates/vector-engine/tests/packet.rs), WASM
// (`sceneToPacket`) and TypeScript (`packetFromScene`).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  initSync,
  sceneToPacket,
} from "../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";
import { encodeBlock } from "../../src/geometry/packet/codec.ts";
import { packetFromScene, type SceneV1 } from "../../src/geometry/packet/scene.ts";
import { validatePacket } from "../../src/geometry/packet/validate.ts";
import { ENGINEERING_LIMITS, type GeometryPacket } from "../../src/geometry/packet/types.ts";

initSync({
  module: readFileSync(
    new URL("../../packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm", import.meta.url),
  ),
});
const dir = new URL("../fixtures/packet-determinism/", import.meta.url);
const cases = readdirSync(dir)
  .filter((f) => f.endsWith(".scene.json.raw"))
  .map((f) => f.slice(0, -".scene.json.raw".length));

describe("packet determinism across Rust, WASM and TypeScript", () => {
  test("the fixture set includes the three TD-PLATFORM-007 cases", () => {
    expect(cases).toEqual(
      expect.arrayContaining(["nested_rings-color", "nested_rings-mosaic", "sharp_corners-mosaic"]),
    );
    expect(cases.length).toBeGreaterThanOrEqual(8);
  });
  for (const c of cases) {
    test(c, () => {
      const json = readFileSync(new URL(`${c}.scene.json.raw`, dir), "utf8");
      const golden = new Uint8Array(readFileSync(new URL(`${c}.packet.bin`, dir)));
      const ts = packetFromScene(JSON.parse(json) as SceneV1);
      validatePacket(ts as GeometryPacket & Record<string, unknown>, ENGINEERING_LIMITS);
      expect(Buffer.from(encodeBlock(ts)).equals(Buffer.from(golden))).toBe(true);
      const wasm = sceneToPacket(json);
      expect(Buffer.from(wasm.blockBytes()).equals(Buffer.from(golden))).toBe(true);
      expect(JSON.parse(wasm.manifestJson)).toEqual(ts.manifest);
      wasm.free();
    });
  }
});
