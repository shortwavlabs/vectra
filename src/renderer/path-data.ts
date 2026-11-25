// Linear Path2D construction (R02, TD-REN-001): one SVG path-data string per path, built in a
// single pass over the packet arrays, then `new Path2D(d)`. Incremental moveTo/bezierCurveTo is
// quadratic in Chromium (16.9 s for one 250k-anchor path).
import type { RenderPacket } from "./snapshot.ts";

const VERB_M = 0;
const VERB_L = 1;
const VERB_C = 2;
const VERB_Z = 3;

/** SVG path data of path `i` of `p`, in packet (document) coordinates. */
export function pathData(p: RenderPacket, i: number): string {
  const v0 = p.verbOffsets[i]!;
  const v1 = p.verbOffsets[i + 1]!;
  let c = p.coordOffsets[i]!;
  const xy = p.coords;
  const parts: string[] = [];
  for (let v = v0; v < v1; v++) {
    switch (p.verbs[v]) {
      case VERB_M:
        parts.push(`M${xy[c]} ${xy[c + 1]}`);
        c += 2;
        break;
      case VERB_L:
        parts.push(`L${xy[c]} ${xy[c + 1]}`);
        c += 2;
        break;
      case VERB_C:
        parts.push(`C${xy[c]} ${xy[c + 1]} ${xy[c + 2]} ${xy[c + 3]} ${xy[c + 4]} ${xy[c + 5]}`);
        c += 6;
        break;
      case VERB_Z:
        parts.push("Z");
        break;
      default:
        throw new Error(`unknown verb ${p.verbs[v]}`);
    }
  }
  return parts.join("");
}

/** [minX, minY, maxX, maxY] of every path's control points (4 numbers per path). */
export function pathBounds(p: RenderPacket): Float64Array {
  const n = p.verbOffsets.length - 1;
  const out = new Float64Array(4 * n);
  for (let i = 0; i < n; i++) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let c = p.coordOffsets[i]!; c < p.coordOffsets[i + 1]!; c += 2) {
      const x = p.coords[c]!;
      const y = p.coords[c + 1]!;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    out.set([x0, y0, x1, y1], 4 * i);
  }
  return out;
}
