// TEST-ONLY correctness scenes for the renderer and hit testing (G-R0): compound paths and holes
// in every winding configuration, nonzero vs evenodd self-intersection, translucent overlaps in
// paint order, a rectangular clip, cubics, a 1 px bar and tiny dots. Used by unit tests and by the
// browser correctness fixtures (compared with the independent resvg reference).
import type { SceneV1 } from "../../document/testing/synthetic.ts";

const K = 0.5522847498;

/** A circle as 4 cubics; `cw` sets the direction (y down: clockwise on screen). */
function circle(
  cx: number,
  cy: number,
  r: number,
  cw: boolean,
): { verbs: string; coords: number[] } {
  const k = K * r;
  const pts = cw
    ? [
        [cx, cy - r],
        [cx + k, cy - r, cx + r, cy - k, cx + r, cy],
        [cx + r, cy + k, cx + k, cy + r, cx, cy + r],
        [cx - k, cy + r, cx - r, cy + k, cx - r, cy],
        [cx - r, cy - k, cx - k, cy - r, cx, cy - r],
      ]
    : [
        [cx, cy - r],
        [cx - k, cy - r, cx - r, cy - k, cx - r, cy],
        [cx - r, cy + k, cx - k, cy + r, cx, cy + r],
        [cx + k, cy + r, cx + r, cy + k, cx + r, cy],
        [cx + r, cy - k, cx + k, cy - r, cx, cy - r],
      ];
  return { verbs: "MCCCCZ", coords: pts.flat() };
}
const join = (...parts: { verbs: string; coords: number[] }[]) => ({
  verbs: parts.map((p) => p.verbs).join(""),
  coords: parts.flatMap((p) => p.coords),
});
function star(cx: number, cy: number, r: number) {
  const pts: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return { verbs: "MLLLLZ", coords: pts };
}
const rect = (x: number, y: number, w: number, h: number) => ({
  verbs: "MLLLZ",
  coords: [x, y, x + w, y, x + w, y + h, x, y + h],
});

const METADATA = {
  generator: "vectra-test",
  engineVersion: "0.0.0",
  mode: "color",
  presetVersion: 1,
  seed: 1,
  sourceWidth: 200,
  sourceHeight: 160,
  params: { mode: "color" },
};

/** 200×160: rings (hole / filled / evenodd hole), stars (evenodd / nonzero), translucent discs,
 *  a 1 px bar, tiny dots, and a clipped disc. */
export const CORRECTNESS_SCENE: SceneV1 = {
  version: 1,
  width: 200,
  height: 160,
  background: null,
  palette: [],
  groups: [
    {
      id: "shapes",
      clip: null,
      paths: [
        {
          fill: { color: "#1d4ed8" },
          stroke: null,
          fillRule: "nonzero",
          ...join(circle(40, 40, 30, true), circle(40, 40, 15, false)),
        },
        {
          fill: { color: "#b91c1c" },
          stroke: null,
          fillRule: "nonzero",
          ...join(circle(110, 40, 30, true), circle(110, 40, 15, true)),
        },
        {
          fill: { color: "#15803d" },
          stroke: null,
          fillRule: "evenodd",
          ...join(circle(168, 40, 28, true), circle(168, 40, 14, true)),
        },
        { fill: { color: "#7c3aed" }, stroke: null, fillRule: "evenodd", ...star(40, 110, 30) },
        { fill: { color: "#ea580c" }, stroke: null, fillRule: "nonzero", ...star(110, 110, 30) },
        {
          fill: { color: "#ff000080" },
          stroke: null,
          fillRule: "nonzero",
          ...circle(160, 100, 18, true),
        },
        {
          fill: { color: "#00ff0080" },
          stroke: null,
          fillRule: "nonzero",
          ...circle(176, 114, 18, true),
        },
        {
          fill: { color: "#0000ff80" },
          stroke: null,
          fillRule: "nonzero",
          ...circle(150, 122, 18, true),
        },
        { fill: { color: "#000000" }, stroke: null, fillRule: "nonzero", ...rect(5, 150, 190, 1) },
        {
          fill: { color: "#000000" },
          stroke: null,
          fillRule: "nonzero",
          ...join(rect(10, 140, 0.5, 0.5), rect(14, 140, 1, 1), rect(18, 140, 2, 2)),
        },
      ],
    },
    {
      id: "clipped",
      clip: { x: 60, y: 125, width: 40, height: 20 },
      paths: [
        {
          fill: { color: "#0f766e" },
          stroke: null,
          fillRule: "nonzero",
          ...circle(80, 135, 15, true),
        },
      ],
    },
  ],
  metadata: METADATA,
};

/** Points with their expected hit (path index in the "shapes" group, 10 = the clipped disc). */
export const HIT_CHECKS: { x: number; y: number; path: number | null; why: string }[] = [
  { x: 40, y: 40, path: null, why: "nonzero ring with a reversed inner ring: hole" },
  { x: 40, y: 15, path: 0, why: "nonzero ring body" },
  { x: 110, y: 40, path: 1, why: "nonzero, same-direction inner ring: filled" },
  { x: 168, y: 40, path: null, why: "evenodd ring: hole" },
  { x: 168, y: 18, path: 2, why: "evenodd ring body" },
  { x: 40, y: 112, path: null, why: "evenodd pentagram centre: empty" },
  { x: 110, y: 112, path: 4, why: "nonzero pentagram centre: filled" },
  { x: 162, y: 112, path: 7, why: "three translucent discs: the topmost" },
  { x: 100, y: 150.5, path: 8, why: "1 px bar" },
  { x: 80, y: 135, path: 10, why: "clipped disc, inside the clip" },
  { x: 80, y: 122, path: null, why: "clipped disc, outside the clip" },
  { x: 195, y: 5, path: null, why: "empty artboard" },
];
