// TEST-ONLY packet sources: scene v1 → packet (the review's JS encoder, corrected to the C3
// manifest), a seeded PRNG, and synthetic packets for property, fuzz and performance runs.
// No import.meta.glob here: the Node benchmark imports this file directly.

import type { IncomingPacket, PacketStyle } from "../packet-port.ts";

/** mulberry32: small, fast, deterministic. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    bool: (p = 0.5) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

/** Scene v1 colour "#rrggbb" or "#rrggbbaa" → RGBA8888. */
export const parseColor = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return hex.length === 9 ? n >>> 0 : ((n << 8) | 0xff) >>> 0;
};

interface ScenePath {
  fill: { color: string; paletteId?: string | null } | null;
  stroke: { color: string; width: number } | null;
  fillRule: "nonzero" | "evenodd";
  verbs: string;
  coords: number[];
}
export interface SceneV1 {
  version: 1;
  width: number;
  height: number;
  background: string | null;
  palette: { id: string; color: string }[];
  groups: {
    id: string;
    clip: { x: number; y: number; width: number; height: number } | null;
    paths: ScenePath[];
  }[];
  metadata: Record<string, unknown>;
}

const VERB = { M: 0, L: 1, C: 2, Z: 3 } as Record<string, number>;

/** Encode a parsed scene v1 into a fresh IncomingPacket (styles deduplicated in first-use order). */
export function encodeScene(scene: SceneV1): IncomingPacket {
  let V = 0;
  let C = 0;
  let P = 0;
  for (const g of scene.groups)
    for (const p of g.paths) {
      P++;
      V += p.verbs.length;
      C += p.coords.length;
    }
  const verbs = new Uint8Array(V);
  const coords = new Float64Array(C);
  const verbOffsets = new Uint32Array(P + 1);
  const coordOffsets = new Uint32Array(P + 1);
  const styleIndex = new Uint32Array(P);
  const groupIndex = new Uint32Array(P);
  const styles: PacketStyle[] = [];
  const styleKey = new Map<string, number>();
  let vi = 0;
  let ci = 0;
  let pi = 0;
  scene.groups.forEach((g, gi) => {
    for (const p of g.paths) {
      const style: PacketStyle = {
        fill: p.fill ? parseColor(p.fill.color) : null,
        paletteId: p.fill?.paletteId ?? null,
        stroke: p.stroke ? { color: parseColor(p.stroke.color), width: p.stroke.width } : null,
        evenOdd: p.fillRule === "evenodd",
      };
      const key = JSON.stringify(style);
      let s = styleKey.get(key);
      if (s === undefined) {
        s = styles.length;
        styleKey.set(key, s);
        styles.push(style);
      }
      styleIndex[pi] = s;
      groupIndex[pi] = gi;
      for (const ch of p.verbs) verbs[vi++] = VERB[ch] ?? 255;
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
      pathCount: P,
      verbCount: V,
      coordCount: C,
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

export interface SyntheticOptions {
  paths: number;
  anchorsPerPath: number;
  seed?: number;
  groups?: number;
  styles?: number;
  clip?: boolean;
}

/**
 * A valid packet of `paths` closed paths, each `M + (anchorsPerPath-1)` L/C segments + Z,
 * coordinates in [0, 1000). Paths are split evenly over `groups` groups.
 */
export function syntheticPacket(o: SyntheticOptions): IncomingPacket {
  const r = rng(o.seed ?? 1);
  const P = o.paths;
  const A = o.anchorsPerPath;
  const nGroups = Math.max(1, o.groups ?? 1);
  const nStyles = Math.max(1, o.styles ?? 4);
  // Decide segment kinds first to size the coordinate array exactly.
  const kinds = new Uint8Array(P * (A - 1));
  let C = 0;
  for (let i = 0; i < kinds.length; i++) {
    kinds[i] = r.bool(0.5) ? 2 : 1;
    C += kinds[i] === 2 ? 6 : 2;
  }
  C += 2 * P;
  const V = P * (A + 1);
  const verbs = new Uint8Array(V);
  const coords = new Float64Array(C);
  const verbOffsets = new Uint32Array(P + 1);
  const coordOffsets = new Uint32Array(P + 1);
  const styleIndex = new Uint32Array(P);
  const groupIndex = new Uint32Array(P);
  let vi = 0;
  let ci = 0;
  let ki = 0;
  for (let i = 0; i < P; i++) {
    verbs[vi++] = 0;
    coords[ci++] = r.next() * 1000;
    coords[ci++] = r.next() * 1000;
    for (let s = 1; s < A; s++) {
      const k = kinds[ki++]!;
      verbs[vi++] = k;
      for (let n = k === 2 ? 6 : 2; n > 0; n--) coords[ci++] = r.next() * 1000;
    }
    verbs[vi++] = 3;
    verbOffsets[i + 1] = vi;
    coordOffsets[i + 1] = ci;
    styleIndex[i] = i % nStyles;
    groupIndex[i] = Math.floor((i * nGroups) / P);
  }
  const styles: PacketStyle[] = [];
  for (let s = 0; s < nStyles; s++)
    styles.push({
      fill: ((0x20304000 + s * 0x1f1f1f00) | 0xff) >>> 0,
      paletteId: s % 2 === 0 ? `ink${s}` : null,
      stroke: null,
      evenOdd: s % 3 === 0,
    });
  const groups = [];
  for (let g = 0; g < nGroups; g++)
    groups.push({
      id: `g${g}`,
      clip: o.clip && g === 0 ? { x: 0, y: 0, width: 1000, height: 1000 } : null,
    });
  return {
    manifest: {
      packetVersion: 1,
      width: 1000,
      height: 1000,
      pathCount: P,
      verbCount: V,
      coordCount: C,
      styles,
      groups,
    },
    verbs,
    coords,
    verbOffsets,
    coordOffsets,
    styleIndex,
    groupIndex,
  };
}

/** A small random valid packet for property tests. */
export const randomPacket = (r: Rng) =>
  syntheticPacket({
    paths: 1 + r.int(6),
    anchorsPerPath: 2 + r.int(5),
    seed: r.int(2 ** 31),
    groups: 1 + r.int(3),
    styles: 1 + r.int(3),
    clip: r.bool(0.3),
  });
