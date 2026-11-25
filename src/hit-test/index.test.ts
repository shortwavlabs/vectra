// Hit-test service conformance (RFC-002 §9, R02 §7): holes in every winding configuration,
// evenodd vs nonzero, topmost in paint order, clips, locks, visibility, transforms, the subpath
// and band indexes, and agreement with an independent brute-force winding test.
import { describe, expect, test } from "vite-plus/test";
import { evaluate } from "../document/evaluate.ts";
import { GeometryStore } from "../document/geometry-store.ts";
import { createDocument, type LayerNode } from "../document/model.ts";
import { DocumentSession } from "../document/session.ts";
import { sceneProvenance } from "../document/testing/provenance.ts";
import { encodeScene, type SceneV1 } from "../document/testing/synthetic.ts";
import { HitTester } from "./index.ts";
import { CORRECTNESS_SCENE, HIT_CHECKS } from "./testing/scenes.ts";

function session(scene: SceneV1) {
  const s = new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: "hit", width: scene.width, height: scene.height }),
  });
  s.dispatch({
    type: "commitTrace",
    packet: encodeScene(scene),
    provenance: sceneProvenance(scene),
  });
  return s;
}
const tester = (s: DocumentSession) => new HitTester(evaluate(s.state), s.store);
const nodeOfPath = (s: DocumentSession) => evaluate(s.state).drawList.map((it) => it.nodeId);

describe("correctness scene", () => {
  const s = session(CORRECTNESS_SCENE);
  const nodes = nodeOfPath(s);
  test.each(HIT_CHECKS)("($x, $y): $why", ({ x, y, path }) => {
    expect(tester(s).hit(x, y)).toBe(path === null ? null : nodes[path]);
  });

  test("locked and hidden items are not hit; the item beneath is", () => {
    const t = session(CORRECTNESS_SCENE);
    const ids = nodeOfPath(t);
    t.dispatch({ type: "setLocked", ids: [ids[7]!], locked: true });
    expect(tester(t).hit(162, 112)).toBe(ids[6]); // locked: drawn, not selectable
    t.dispatch({ type: "setLocked", ids: [ids[7]!], locked: false });
    t.dispatch({ type: "setVisible", ids: [ids[7]!], visible: false });
    expect(tester(t).hit(162, 112)).toBe(ids[6]);
  });

  test("a layer transform moves hits with the artwork", () => {
    const t = session(CORRECTNESS_SCENE);
    const ids = nodeOfPath(t);
    const layer = t.state.orderedRootIds.find((id) => t.state.nodesById.get(id)!.kind === "layer")!;
    t.dispatch({ type: "setTransform", id: layer, matrix: [2, 0, 0, 2, 10, 20] });
    const h = tester(t);
    expect(h.hit(2 * 40 + 10, 2 * 15 + 20)).toBe(ids[0]); // ring body
    expect(h.hit(2 * 40 + 10, 2 * 40 + 20)).toBeNull(); // ring hole
    expect((t.state.nodesById.get(layer) as LayerNode).kind).toBe("layer");
  });
});

describe("indexes", () => {
  const META = CORRECTNESS_SCENE.metadata;
  test("a compound path with many subpaths is indexed per subpath (holes and gaps miss)", () => {
    const verbs: string[] = [];
    const coords: number[] = [];
    for (let i = 0; i < 50; i++) {
      const x = 4 * i;
      verbs.push("MLLLZ");
      coords.push(x, 10, x + 2, 10, x + 2, 12, x, 12);
    }
    const scene: SceneV1 = {
      version: 1,
      width: 200,
      height: 20,
      background: null,
      palette: [],
      groups: [
        {
          id: "g",
          clip: null,
          paths: [
            {
              fill: { color: "#000000" },
              stroke: null,
              fillRule: "evenodd",
              verbs: verbs.join(""),
              coords,
            },
          ],
        },
      ],
      metadata: { ...META, sourceWidth: 200, sourceHeight: 20 },
    };
    const t = session(scene);
    const h = tester(t);
    expect(h.size).toBe(50); // one entry per subpath
    expect(h.hit(41, 11)).not.toBeNull();
    expect(h.hit(43, 11)).toBeNull(); // between subpaths
  });

  test("a huge subpath uses the band index and agrees with a brute-force test", () => {
    const n = 5000;
    const coords: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      const r = 80 + 10 * Math.sin(17 * a); // wavy, so bands matter
      coords.push(100 + r * Math.cos(a), 100 + r * Math.sin(a));
    }
    const scene: SceneV1 = {
      version: 1,
      width: 200,
      height: 200,
      background: null,
      palette: [],
      groups: [
        {
          id: "g",
          clip: null,
          paths: [
            {
              fill: { color: "#000000" },
              stroke: null,
              fillRule: "nonzero",
              verbs: `M${"L".repeat(n - 1)}Z`,
              coords,
            },
          ],
        },
      ],
      metadata: { ...META, sourceWidth: 200, sourceHeight: 200 },
    };
    const t = session(scene);
    const h = tester(t);
    let seed = 3;
    const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 200;
    for (let k = 0; k < 500; k++) {
      const x = r();
      const y = r();
      expect(h.hit(x, y) !== null, `(${x}, ${y})`).toBe(insidePolygon(coords, x, y));
    }
  });
});

function insidePolygon(c: number[], x: number, y: number): boolean {
  let w = 0;
  const n = c.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, ay, bx, by] = [c[2 * i]!, c[2 * i + 1]!, c[2 * j]!, c[2 * j + 1]!];
    const cross = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
    if (ay <= y) {
      if (by > y && cross > 0) w++;
    } else if (by <= y && cross < 0) w--;
  }
  return w !== 0;
}

/** An independent reference: every item, topmost first, finely flattened, no index. */
function bruteForce(scene: SceneV1, x: number, y: number): number | null {
  const items = scene.groups.flatMap((g) => g.paths.map((p) => ({ p, clip: g.clip })));
  for (let k = items.length - 1; k >= 0; k--) {
    const { p, clip } = items[k]!;
    if (
      clip &&
      !(x >= clip.x && x <= clip.x + clip.width && y >= clip.y && y <= clip.y + clip.height)
    )
      continue;
    let w = 0;
    let ci = 0;
    let poly: number[] = [];
    const flush = () => {
      const n = poly.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [ax, ay, bx, by] = [poly[2 * i]!, poly[2 * i + 1]!, poly[2 * j]!, poly[2 * j + 1]!];
        const cross = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
        if (ay <= y) {
          if (by > y && cross > 0) w++;
        } else if (by <= y && cross < 0) w--;
      }
      poly = [];
    };
    let px = 0;
    let py = 0;
    for (const v of p.verbs) {
      if (v === "M") {
        flush();
        px = p.coords[ci]!;
        py = p.coords[ci + 1]!;
        poly.push(px, py);
        ci += 2;
      } else if (v === "L") {
        px = p.coords[ci]!;
        py = p.coords[ci + 1]!;
        poly.push(px, py);
        ci += 2;
      } else if (v === "C") {
        const [x1, y1, x2, y2, x3, y3] = p.coords.slice(ci, ci + 6) as [
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        for (let i = 1; i <= 512; i++) {
          const t = i / 512;
          const u = 1 - t;
          poly.push(
            u * u * u * px + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * py + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          );
        }
        px = x3;
        py = y3;
        ci += 6;
      }
    }
    flush();
    if (p.fillRule === "evenodd" ? w % 2 !== 0 : w !== 0) return k;
  }
  return null;
}

test("property: 2,000 random points agree with the brute-force reference (boundary-ambiguous points skipped)", () => {
  const s = session(CORRECTNESS_SCENE);
  const nodes = nodeOfPath(s);
  const h = tester(s);
  let seed = 11;
  const r = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  let checked = 0;
  for (let k = 0; k < 2000; k++) {
    const x = r() * 200;
    const y = r() * 160;
    const ref = bruteForce(CORRECTNESS_SCENE, x, y);
    const near = [
      [0.15, 0],
      [-0.15, 0],
      [0, 0.15],
      [0, -0.15],
    ].some(([dx, dy]) => bruteForce(CORRECTNESS_SCENE, x + dx!, y + dy!) !== ref);
    if (near) continue;
    checked++;
    expect(h.hit(x, y), `(${x}, ${y})`).toBe(ref === null ? null : nodes[ref]);
  }
  expect(checked).toBeGreaterThan(1900);
});
