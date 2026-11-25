// Scene v1 (engine interchange JSON) → GeometryPacket v1, mirroring the Rust
// `GeometryPacket::from_scene` exactly: groups in order, paths in order, styles deduplicated in
// first-use order on (fill, paletteId, stroke colour and width, fill rule). Identical validated
// scenes give byte-identical packets in Rust, WASM and TypeScript (C3 r2, AM-1 AR-3).
import {
  type GeometryPacket,
  PacketError,
  type Style,
  VERB_C,
  VERB_L,
  VERB_M,
  VERB_Z,
} from "./types.ts";

export interface SceneColorFill {
  color: string;
  paletteId: string | null;
}
export interface ScenePath {
  fill: SceneColorFill | null;
  stroke: { color: string; width: number } | null;
  fillRule: "nonzero" | "evenodd";
  verbs: string;
  coords: number[];
}
export interface SceneGroup {
  id: string;
  clip: { x: number; y: number; width: number; height: number } | null;
  paths: ScenePath[];
}
export interface SceneV1 {
  version: 1;
  width: number;
  height: number;
  background: string | null;
  palette: { id: string; color: string }[];
  groups: SceneGroup[];
  metadata: Record<string, unknown>;
}

/** `#rrggbb` or `#rrggbbaa` → RGBA8888 (alpha 255 when omitted), as the engine's `Rgba`. */
export function colorToU32(hex: string): number {
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex))
    throw new PacketError("manifest", `colour ${JSON.stringify(hex)} must be #rrggbb or #rrggbbaa`);
  const n = parseInt(hex.slice(1), 16);
  return hex.length === 9 ? n >>> 0 : ((n * 256) | 0xff) >>> 0;
}

/** RGBA8888 → `#rrggbb` (alpha 255) or `#rrggbbaa`, as the engine serialises `Rgba`. */
export function u32ToColor(v: number): string {
  const hex = (v >>> 0).toString(16).padStart(8, "0");
  return hex.endsWith("ff") ? `#${hex.slice(0, 6)}` : `#${hex}`;
}

const VERB: Record<string, number> = { M: VERB_M, L: VERB_L, C: VERB_C, Z: VERB_Z };

export function packetFromScene(scene: SceneV1): GeometryPacket {
  let verbCount = 0;
  let coordCount = 0;
  let pathCount = 0;
  for (const g of scene.groups)
    for (const p of g.paths) {
      pathCount++;
      verbCount += p.verbs.length;
      coordCount += p.coords.length;
    }
  const verbs = new Uint8Array(verbCount);
  const coords = new Float64Array(coordCount);
  const verbOffsets = new Uint32Array(pathCount + 1);
  const coordOffsets = new Uint32Array(pathCount + 1);
  const styleIndex = new Uint32Array(pathCount);
  const groupIndex = new Uint32Array(pathCount);
  const styles: Style[] = [];
  const keys = new Map<string, number>();
  let vi = 0;
  let ci = 0;
  let pi = 0;
  scene.groups.forEach((g, gi) => {
    for (const p of g.paths) {
      const style: Style = {
        fill: p.fill ? colorToU32(p.fill.color) : null,
        paletteId: p.fill?.paletteId ?? null,
        stroke: p.stroke ? { color: colorToU32(p.stroke.color), width: p.stroke.width } : null,
        evenOdd: p.fillRule === "evenodd",
      };
      const key = JSON.stringify([style.fill, style.paletteId, style.stroke, style.evenOdd]);
      let si = keys.get(key);
      if (si === undefined) {
        si = styles.length;
        keys.set(key, si);
        styles.push(style);
      }
      styleIndex[pi] = si;
      groupIndex[pi] = gi;
      for (const ch of p.verbs) {
        const v = VERB[ch];
        if (v === undefined)
          throw new PacketError("opcode", `unsupported verb ${JSON.stringify(ch)}`);
        verbs[vi++] = v;
      }
      coords.set(p.coords, ci);
      ci += p.coords.length;
      pi++;
      verbOffsets[pi] = vi;
      coordOffsets[pi] = ci;
    }
  });
  return {
    manifest: {
      packetVersion: 1,
      width: scene.width,
      height: scene.height,
      pathCount,
      verbCount,
      coordCount,
      styles,
      groups: scene.groups.map((g) => ({ id: g.id, clip: g.clip })),
    },
    verbs,
    coords,
    verbOffsets,
    coordOffsets,
    styleIndex,
    groupIndex,
  };
}
