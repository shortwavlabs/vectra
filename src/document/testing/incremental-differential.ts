// TEST-ONLY differential harness (TD-PERF-007, G-DOC-R stage B): the incremental validator
// against the full validateState on seeded random transactions. Every episode's session runs
// in `compare` mode, so each real dispatch is also checked inside the integrated session. Shared by
// src/document/incremental-validate.test.ts (asserts) and scripts/bench-td-perf-007.mjs
// (--differential, writes the record). Node-importable: no import.meta.glob.
//
// Three classes of transaction:
//   command-rejected  a command threw in applyCommand; neither validator runs (as in dispatch)
//   command           a real command transaction (1–3 commands) whose result reaches validation
//   forged            a post-state built by editing a few map entries directly, bypassing the
//                     commands (a model of a command bug): cycles, orphans, second parents,
//                     dangling references, key ≠ id, duplicate ID numbers, depth, budget...
// The incremental validator is fast-accept: it proves a state valid or answers `undecided`.
// A disagreement is an acceptance of a state the full validator rejects, or an acceptance with
// different derived data. `undecided` on a valid state is only a missed fast path.

import { applyCommand, type Command, DraftLog } from "../commands.ts";
import { GeometryStore } from "../geometry-store.ts";
import { checkIncremental } from "../incremental-validate.ts";
import {
  DEFAULT_DOC_LIMITS,
  type DocLimits,
  type StateDerived,
  validateState,
} from "../invariants.ts";
import {
  type ContainerNode,
  createDocument,
  type DocNode,
  type DocState,
  DocumentError,
  IdAllocator,
  isContainer,
  type Matrix,
  type NodeId,
  rotate90Matrix,
} from "../model.ts";
import { NodeMap } from "../node-map.ts";
import { DocumentSession, sameDerived, ValidationDisagreement } from "../session.ts";
import { TEST_PROVENANCE } from "./provenance.ts";
import { randomPacket, rng, type Rng, syntheticPacket } from "./synthetic.ts";

export interface Disagreement {
  readonly index: number;
  readonly class: "command" | "forged";
  readonly label: string;
  readonly detail: string;
}
interface Tally {
  compared: number;
  fullRejected: number;
  decided: number;
}
export interface DifferentialSummary {
  seed: number;
  transactions: number;
  commandRejected: number;
  noOps: number;
  /** Validator-reached comparisons (command + forged). */
  compared: number;
  fullAccepted: number;
  fullRejected: number;
  /** Incremental proved valid (and full agreed, unless listed in disagreements). */
  decided: number;
  /** Incremental undecided on a state the full validator accepts (fallback cost only). */
  undecidedValid: number;
  /** Incremental undecided on a state the full validator rejects (the required answer). */
  undecidedInvalid: number;
  byClass: Record<"command" | "forged", Tally>;
  byLabel: Record<string, Tally>;
  fullErrorCodes: Record<string, number>;
  undecidedReasons: Record<string, number>;
  /** Reasons for `undecided` on states the full validator accepts (missed fast paths). */
  undecidedValidReasons: Record<string, number>;
  /** Command transactions validated through their Draft write log (stage C). */
  writeLogged: number;
  /** Stage D (AM-2): single-forgery states validated as a plain Map and as a NodeMap. */
  singleDefect: { checked: number; sameVerdict: number; messageDiffers: Record<string, number> };
  disagreements: Disagreement[];
}

const MATRICES: Matrix[] = [
  [1, 0, 0, 1, 5, -7],
  [2, 0, 0, 0.5, 0, 0],
  [-1, 0, 0, 1, 10, 0],
  rotate90Matrix(1, 3, 4),
  [1e9, 0, 0, 1e9, 0, 0], // valid, but nested it overflows the composed transform
  [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0], // breaks clips
  [1, 0.25, 0, 1, 0, 0], // skew: breaks clips
  [0, 0, 0, 0, 0, 0], // singular
  [1e9, 0, 0, 1e-3, 0, 0], // ill-conditioned
  [Number.NaN, 0, 0, 1, 0, 0],
];
const NAMES = ["a", "b-1", "", "run-0", "x".repeat(300), "bad\uD800", "ok😀"];
const DIGEST = "ab".repeat(32);

function randomCommand(r: Rng, s: DocState): Command {
  const ids = [...s.nodesById.keys()];
  const any = (): NodeId =>
    ids.length && r.bool(0.92) ? r.pick(ids) : r.pick(["pth_999999", "grp_424242"]);
  const some = () => Array.from({ length: 1 + r.int(3) }, any);
  const paths = ids.filter((id) => s.nodesById.get(id)!.kind === "path");
  const pal = [...s.paletteById.keys()];
  const layers = s.orderedRootIds.filter((id) => s.nodesById.get(id)!.kind === "layer");
  switch (r.int(21)) {
    case 0:
      return { type: "commitTrace", provenance: TEST_PROVENANCE, packet: randomPacket(r) };
    case 1:
      return {
        type: "commitTrace",
        provenance: TEST_PROVENANCE,
        packet: randomPacket(r),
        replaceLayerId: layers.length && r.bool(0.9) ? r.pick(layers) : any(),
      };
    case 2:
      return { type: "delete", ids: some() };
    case 3:
      return { type: "duplicate", ids: some() };
    case 4:
      return { type: "reorder", id: any(), index: r.int(5) - 1 };
    case 5: // includes moves into a node's own subtree (cycles), rejected by the command
      return {
        type: "reparent",
        ids: some(),
        parentId: r.bool(0.15) ? null : any(),
        index: r.int(3),
      };
    case 6:
      return { type: "setVisible", ids: some(), visible: r.bool() };
    case 7:
      return { type: "setLocked", ids: some(), locked: r.bool() };
    case 8:
      return { type: "rename", id: any(), name: r.pick(NAMES) };
    case 9:
      return { type: "setTransform", id: any(), matrix: r.pick(MATRICES) };
    case 10:
      return { type: "applyTransform", ids: some(), matrix: r.pick(MATRICES) };
    case 11:
      return { type: "rotate90", ids: some(), turns: r.pick([1, 2, 3] as const) };
    case 12:
      return {
        type: "setFill",
        ids:
          paths.length && r.bool(0.8)
            ? Array.from({ length: 1 + r.int(4) }, () => r.pick(paths))
            : some(),
        fill: r.bool(0.3)
          ? { color: r.bool(0.9) ? r.int(2 ** 32) : -1 }
          : r.bool(0.15) || !pal.length
            ? { paletteRef: "pal_999999" } // bad palette reference: rejected by the command
            : r.bool(0.9)
              ? { paletteRef: r.pick(pal) }
              : null,
      };
    case 13:
      return pal.length
        ? { type: "setPaletteColor", paletteRef: r.pick(pal), color: r.int(2 ** 32) }
        : { type: "setArtboard", width: 1 + r.int(2000), height: 1 + r.int(2000) };
    case 14:
      return { type: "group", ids: some() };
    case 15:
      return { type: "ungroup", id: any() };
    case 16:
      return {
        type: "setClip",
        id: any(),
        rect: { x: r.int(200) - 50, y: r.int(200) - 50, width: r.int(300), height: 1 + r.int(300) },
      };
    case 17:
      return { type: "releaseClip", id: any() };
    case 18:
      return {
        type: "setArtboard",
        width: r.pick([0, 1 + r.int(2000), 20_000]),
        height: 1 + r.int(2000),
        background: r.pick([null, 0xffffffff, -1]),
      };
    case 19:
      return {
        type: "attachSource",
        asset: {
          digest: r.bool(0.9) ? DIGEST : "XYZ",
          mime: "image/png",
          width: 1 + r.int(100),
          height: 1 + r.int(100),
          embedded: false,
          decodePolicy: "browser-canvas-v1",
        },
      };
    default: {
      const targets = paths.length
        ? [...new Set(Array.from({ length: 1 + r.int(2) }, () => r.pick(paths)))]
        : [any()];
      const n = r.bool(0.85) ? targets.length : targets.length + 1;
      return {
        type: "bake",
        packet: syntheticPacket({ paths: n, anchorsPerPath: 2 + r.int(4), seed: r.int(2 ** 31) }),
        targetIds: targets,
      };
    }
  }
}

// --- forged post-states ---------------------------------------------------------------------------
const FORGERIES = [
  "rename",
  "move",
  "add-path",
  "delete-path",
  "delete-max-id",
  "transform",
  "reorder",
  "same-list-copy",
  "recolour-style",
  "bad-entry",
  "cycle",
  "second-parent",
  "orphan",
  "dangling-child",
  "dangling-style",
  "bad-palette-ref",
  "remove-style",
  "remove-palette",
  "remove-asset",
  "key-mismatch",
  "dup-number",
  "kind",
  "deep-chain",
  "clip",
  "budget",
  "bad-local",
  "artboard",
  "document-id",
  // Added after the stage B independent review (G-DOC-R report §1.6).
  "undefined-entry",
  "asset-field",
  "shared-list",
  "remove-source",
  // Added for G-DOC-R stage D (brief §5).
  "aliased-node",
] as const;

function forge(r: Rng, prev: DocState): { label: string; next: DocState } | null {
  const nodes = new Map(prev.nodesById);
  const styles = new Map(prev.stylesById);
  const palette = new Map(prev.paletteById);
  const assets = new Map(prev.sourceAssetsById);
  let roots = [...prev.orderedRootIds];
  let artboard = prev.artboard;
  let documentId = prev.documentId;
  let fresh = 1_000_000_000 + r.int(1_000_000) * 100;
  const freshId = (p: string) => `${p}_${fresh++}`;
  const kids = (p: NodeId | null): NodeId[] =>
    p === null
      ? roots
      : [...((nodes.get(p) as { orderedChildIds?: NodeId[] })?.orderedChildIds ?? [])];
  const setKids = (p: NodeId | null, list: NodeId[]) => {
    if (p === null) roots = list;
    else nodes.set(p, { ...nodes.get(p)!, orderedChildIds: list } as DocNode);
  };
  const parentOf = (x: NodeId): NodeId | null | undefined => {
    if (roots.includes(x)) return null;
    for (const [k, n] of nodes) if (isContainer(n) && n.orderedChildIds.includes(x)) return k;
    return undefined;
  };
  const pick = (pred: (n: DocNode) => boolean): NodeId | null => {
    // Skips keys holding `undefined` (the undefined-entry forgery).
    const xs = [...nodes].filter(([, n]) => n !== undefined && pred(n)).map(([k]) => k);
    return xs.length ? r.pick(xs) : null;
  };
  const containers = () => pick((n) => isContainer(n));
  const path = () => pick((n) => n.kind === "path");
  const patch = (id: NodeId, p: Partial<DocNode> | Record<string, unknown>) =>
    nodes.set(id, { ...nodes.get(id)!, ...p } as DocNode);
  const detach = (x: NodeId) => {
    const p = parentOf(x);
    if (p !== undefined)
      setKids(
        p,
        kids(p).filter((y) => y !== x),
      );
  };
  const descendants = (x: NodeId, seen = new Set<NodeId>()): NodeId[] => {
    if (seen.has(x)) return []; // an earlier forgery in this transaction may have made a cycle
    seen.add(x);
    const list = (nodes.get(x) as { orderedChildIds?: unknown } | undefined)?.orderedChildIds;
    return Array.isArray(list) ? list.flatMap((c: NodeId) => [c, ...descendants(c, seen)]) : [];
  };
  const newPath = (template: NodeId): NodeId => {
    const t = nodes.get(template)!;
    const id = freshId("pth");
    nodes.set(id, { ...t, id, name: "" });
    return id;
  };

  const apply = (m: (typeof FORGERIES)[number]): boolean => {
    switch (m) {
      case "rename": {
        const x = pick(() => true);
        return !!x && !!patch(x, { name: r.pick(NAMES) });
      }
      case "move": {
        const x = pick((n) => n.kind === "group" || n.kind === "path");
        const p = containers();
        if (!x || !p) return false;
        detach(x);
        const list = kids(p);
        list.splice(r.int(list.length + 1), 0, x);
        setKids(p, list);
        return true;
      }
      case "add-path": {
        const t = path();
        const p = containers();
        if (!t || !p) return false;
        setKids(p, [...kids(p), newPath(t)]);
        return true;
      }
      case "delete-path": {
        const x = path();
        if (!x) return false;
        detach(x);
        nodes.delete(x);
        return true;
      }
      case "delete-max-id": {
        const x = [...nodes.keys()].sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)))[0];
        if (!x) return false;
        detach(x);
        for (const d of [x, ...descendants(x)]) nodes.delete(d);
        return true;
      }
      case "transform": {
        const x = pick(() => true);
        return !!x && !!patch(x, { localTransform: r.pick(MATRICES) });
      }
      case "reorder": {
        const p = r.bool(0.2) ? null : containers();
        const list = kids(p);
        if (list.length < 2) return false;
        setKids(p, list.reverse());
        return true;
      }
      case "same-list-copy": {
        const p = containers();
        return !!p && (setKids(p, kids(p)), true);
      }
      case "recolour-style": {
        const k = [...styles.keys()];
        if (!k.length) return false;
        const id = r.pick(k);
        styles.set(id, { ...styles.get(id)!, fill: r.int(2 ** 32), paletteRef: null });
        return true;
      }
      case "bad-entry": {
        // Palette and style entry rules (P1–P2, S1, S3–S5); some edits stay valid.
        const p = [...palette.keys()];
        const s = [...styles.keys()];
        if (p.length && r.bool(0.5)) {
          const id = r.bool(0.8) ? r.pick(p) : freshId("pal");
          const e = palette.get(id) ?? { id, name: "fresh", color: 0xff };
          palette.set(id, {
            ...e,
            ...r.pick([{ name: "bad name!" }, { color: -1 }, { color: 7 }]),
          });
          return true;
        }
        if (!s.length) return false;
        const id = r.pick(s);
        const st = styles.get(id)!;
        styles.set(
          id,
          r.pick([
            { ...st, fill: 0xff, paletteRef: p.length ? p[0]! : "pal_1" }, // both colour authorities
            { ...st, fill: null, paletteRef: null, stroke: null }, // nothing to paint
            { ...st, stroke: { color: 0xff, width: 0 } }, // bad stroke
            { ...st, fill: 2 ** 32 }, // not RGBA8888
            { ...st, stroke: { color: 0xff, width: 2 } }, // valid
          ]),
        );
        return true;
      }
      case "cycle": {
        const g = pick((n) => n.kind === "group");
        if (!g) return false;
        const inner = [g, ...descendants(g)].filter((d) => isContainer(nodes.get(d)));
        const target = r.pick(inner);
        if (r.bool(0.7)) detach(g);
        setKids(target, [...kids(target), g]);
        return true;
      }
      case "second-parent": {
        const x = pick((n) => n.kind === "group" || n.kind === "path");
        const p = containers();
        if (!x || !p) return false;
        setKids(p, [...kids(p), x]);
        return true;
      }
      case "orphan": {
        const x = pick(() => true);
        return !!x && (detach(x), true);
      }
      case "dangling-child": {
        const p = r.bool(0.2) ? null : containers();
        setKids(p, [...kids(p), r.pick(["pth_999999999", "grp_888888888"])]);
        return true;
      }
      case "dangling-style": {
        const x = path();
        return !!x && !!patch(x, { styleRef: "sty_999999999" });
      }
      case "bad-palette-ref": {
        const k = [...styles.keys()];
        if (!k.length) return false;
        const id = r.pick(k);
        styles.set(id, { ...styles.get(id)!, fill: null, paletteRef: "pal_999999999" });
        return true;
      }
      case "remove-style": {
        const k = [...styles.keys()];
        return !!k.length && styles.delete(r.pick(k));
      }
      case "remove-palette": {
        const k = [...palette.keys()];
        return !!k.length && palette.delete(r.pick(k));
      }
      case "remove-asset": {
        const k = [...assets.keys()];
        return !!k.length && assets.delete(r.pick(k));
      }
      case "key-mismatch": {
        const x = pick(() => true);
        if (!x) return false;
        const n = nodes.get(x)!;
        const k = freshId(x.slice(0, 3));
        nodes.delete(x);
        nodes.set(k, n);
        const p = parentOf(x);
        if (p !== undefined && r.bool(0.7))
          setKids(
            p,
            kids(p).map((y) => (y === x ? k : y)),
          );
        return true;
      }
      case "dup-number": {
        const t = path();
        const p = pick((n) => n.kind === "group");
        const victim = r.pick([...nodes.keys(), ...styles.keys(), ...palette.keys()]);
        if (!t || !p || !victim) return false;
        const id = `pth_${r.bool(0.5) ? "0" : ""}${victim.slice(4)}`;
        if (nodes.has(id)) return false;
        nodes.set(id, { ...nodes.get(t)!, id });
        setKids(p, [...kids(p), id]);
        return true;
      }
      case "kind": {
        if (r.bool(0.5)) {
          const x = pick((n) => n.kind === "path" || n.kind === "group");
          if (!x) return false;
          detach(x);
          roots = [...roots, x];
        } else {
          const x = pick((n) => n.kind === "layer" || n.kind === "source");
          const p = containers();
          if (!x || !p || x === p) return false;
          detach(x);
          setKids(p, [...kids(p), x]);
        }
        return true;
      }
      case "deep-chain": {
        const t = path();
        const p = pick((n) => n.kind === "group" || n.kind === "layer");
        if (!t || !p) return false;
        const depth = 2 + r.int(70);
        const scale = r.pick([1, 2, 1e9]);
        let child = newPath(t);
        for (let i = 0; i < depth; i++) {
          const g = freshId("grp");
          nodes.set(g, {
            kind: "group",
            id: g,
            name: "",
            visible: true,
            locked: false,
            localTransform: [scale, 0, 0, scale, 0, 0],
            orderedChildIds: [child],
          });
          child = g;
        }
        setKids(p, [...kids(p), child]);
        return true;
      }
      case "clip": {
        const x = r.bool(0.8) ? containers() : path();
        if (!x) return false;
        const rect = r.bool(0.85)
          ? { x: 0, y: 0, width: 1 + r.int(50), height: 1 + r.int(50) }
          : { x: 0, y: 0, width: 0, height: 5 };
        return !!patch(x, { clipRef: rect });
      }
      case "budget": {
        const t = path();
        const p = pick((n) => n.kind === "group");
        if (!t || !p) return false;
        const add = Array.from({ length: 1 + r.int(400) }, () => newPath(t));
        setKids(p, [...kids(p), ...add]);
        return true;
      }
      case "bad-local": {
        const x = pick(() => true);
        if (!x) return false;
        const n = nodes.get(x)!;
        const bad: Record<string, unknown>[] = [{ visible: "yes" }, { name: 7 }];
        if (n.kind === "path")
          bad.push(
            { fillRule: "x" },
            { geometry: { ...n.geometry, pathIndex: 1e6 } },
            { geometry: { ...n.geometry, chunkId: "chk_999999" } },
          );
        if (n.kind === "group")
          bad.push({ traceProvenance: { bogus: true } }, { orderedChildIds: "x" });
        if (n.kind === "layer") bad.push({ traceProvenance: { bogus: true } });
        if (n.kind === "source")
          bad.push({ assetId: "ast_999999999" }, { sourceToDocument: [0, 0, 0, 0, 0, 0] });
        return !!patch(x, r.pick(bad));
      }
      case "artboard":
        artboard = {
          ...artboard,
          ...r.pick([{ width: 0 }, { width: 20_000 }, { background: -1 }, { width: 640 }]),
        };
        return true;
      case "document-id":
        documentId = r.pick(["bad id!", "fine-id"]);
        return true;
      case "undefined-entry": {
        // A key holding `undefined` (review C1), sometimes hiding a removal from size checks.
        if (r.bool(0.3)) {
          const y = path();
          if (y) {
            detach(y);
            nodes.delete(y);
          }
        }
        const [m, p] = r.pick([
          [nodes, "pth"],
          [styles, "sty"],
          [palette, "pal"],
          [assets, "ast"],
        ] as const);
        // A new key holding undefined, or an existing key set to undefined (stage D).
        const existing = [...(m as Map<string, unknown>).keys()];
        (m as Map<string, unknown>).set(
          existing.length && r.bool(0.5) ? r.pick(existing) : freshId(p),
          undefined,
        );
        return true;
      }
      case "asset-field": {
        const k = [...assets].filter(([, a]) => a !== undefined).map(([id]) => id);
        if (!k.length) return false;
        const id = r.pick(k);
        const a = assets.get(id)!;
        assets.set(id, {
          ...a,
          ...r.pick<Record<string, unknown>>([
            { mime: "image/gif" },
            { width: 0 },
            { height: 20_000 },
            { embedded: "no" },
            { decodePolicy: "x" },
            { provenance: { kind: "bogus" } },
            { digest: "AB".repeat(32) },
            { width: a.width }, // valid: a new object with the same fields
          ]),
        });
        return true;
      }
      case "shared-list": {
        // Two containers share one child array (same reference).
        const a = containers();
        const b = containers();
        if (!a || !b || a === b) return false;
        const list = (nodes.get(a) as ContainerNode).orderedChildIds;
        nodes.set(b, { ...nodes.get(b)!, orderedChildIds: list } as DocNode);
        return true;
      }
      case "aliased-node": {
        // One node object under two keys (an aliased mutable object a buggy command could
        // leave): the second key does not match the object's id.
        const x = pick(() => true);
        const p = pick((n) => n.kind === "group");
        if (!x || !p) return false;
        const k = freshId(x.slice(0, 3));
        nodes.set(k, nodes.get(x)!);
        setKids(p, [...kids(p), k]);
        return true;
      }
      case "remove-source": {
        // Valid: a root source node and, with its last reference, its asset.
        const x = r.pick(roots.filter((id) => nodes.get(id)?.kind === "source"));
        if (!x) return false;
        const asset = (nodes.get(x) as { assetId: string }).assetId;
        roots = roots.filter((id) => id !== x);
        nodes.delete(x);
        if (![...nodes.values()].some((n) => n?.kind === "source" && n.assetId === asset))
          assets.delete(asset);
        return true;
      }
    }
  };

  const labels: string[] = [];
  for (let tries = 0; labels.length < (r.bool(0.25) ? 2 : 1) && tries < 20; tries++) {
    const m = r.pick(FORGERIES);
    if (apply(m)) labels.push(m);
  }
  if (!labels.length) return null;
  const next: DocState = {
    documentId,
    artboard,
    orderedRootIds: roots,
    nodesById: nodes,
    stylesById: styles,
    paletteById: palette,
    sourceAssetsById: assets,
  };
  return { label: labels.join("+"), next };
}

// --- harness --------------------------------------------------------------------------------------
/** Keys whose node entries differ between two states (the identity diff). */
function changedKeys(a: DocState, b: DocState): Set<NodeId> {
  const out = new Set<NodeId>();
  // `has`, not only `get`: a new key holding `undefined` is a change (review C1).
  for (const [k, v] of b.nodesById) if (a.nodesById.get(k) !== v || !a.nodesById.has(k)) out.add(k);
  for (const k of a.nodesById.keys()) if (!b.nodesById.has(k)) out.add(k);
  return out;
}
function episode(r: Rng): DocumentSession {
  const limits: DocLimits = {
    ...DEFAULT_DOC_LIMITS,
    // A small cap in a third of the episodes, so duplicates, traces and forgeries cross it.
    maxAnchors: r.pick([30 + r.int(300), 2_000 + r.int(20_000), 2_000 + r.int(20_000)]),
    maxDepth: r.pick([4, 5, 64, 64]),
    maxNodes: r.pick([150, 2_000_000, 2_000_000]),
  };
  const session = new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: "diff", width: 512, height: 512 }),
    limits,
    history: { maxEntries: 2 + r.int(20), maxBytes: 128 * 2 ** 20 },
    validation: "compare",
  });
  for (let i = 1 + r.int(3); i > 0; i--)
    try {
      session.dispatch({
        type: "commitTrace",
        provenance: TEST_PROVENANCE,
        packet: randomPacket(r),
      });
    } catch (e) {
      if (!(e instanceof DocumentError)) throw e;
    }
  // Stage D: one episode in eight also holds a trace of 1,100–3,000 paths, so its node map and
  // parent index span several chunks and edits cross chunk split and merge boundaries.
  if (r.bool(0.125))
    try {
      session.dispatch({
        type: "commitTrace",
        provenance: TEST_PROVENANCE,
        packet: syntheticPacket({
          paths: 1100 + r.int(1900),
          anchorsPerPath: 2,
          groups: 1 + r.int(3),
          seed: r.int(2 ** 31),
        }),
      });
    } catch (e) {
      if (!(e instanceof DocumentError)) throw e;
    }
  return session;
}

export function runDifferential(o: { seed: number; transactions: number }): DifferentialSummary {
  const r = rng(o.seed);
  const tally = (): Tally => ({ compared: 0, fullRejected: 0, decided: 0 });
  const out: DifferentialSummary = {
    seed: o.seed,
    transactions: o.transactions,
    commandRejected: 0,
    noOps: 0,
    compared: 0,
    fullAccepted: 0,
    fullRejected: 0,
    decided: 0,
    undecidedValid: 0,
    undecidedInvalid: 0,
    byClass: { command: tally(), forged: tally() },
    byLabel: {},
    fullErrorCodes: {},
    undecidedReasons: {},
    undecidedValidReasons: {},
    writeLogged: 0,
    singleDefect: { checked: 0, sameVerdict: 0, messageDiffers: {} },
    disagreements: [],
  };
  const count = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
  let session = episode(r);
  let steps = 0;

  /** Both validators on one post-state, before any store.settle(). Returns the full verdict. */
  const compare = (
    index: number,
    cls: "command" | "forged",
    label: string,
    prev: DocState,
    next: DocState,
    writes: ReadonlySet<NodeId> | null = null,
  ) => {
    const { store, limits } = session;
    let full: StateDerived | null = null;
    try {
      full = validateState(next, store, limits);
    } catch (e) {
      count(
        out.fullErrorCodes,
        e instanceof DocumentError ? e.code : `untyped:${(e as Error).name}`,
      );
    }
    // AM-2: single-defect rejection semantics are equivalent under the new map order. A state
    // with one forgery is validated again with its node map as a NodeMap: same verdict, same
    // code; the message may differ only where it names one of two entries (duplicate number).
    if (cls === "forged" && !label.includes("+") && !label.endsWith("~writes")) {
      const verdict = (st: DocState) => {
        try {
          validateState(st, store, limits);
          return "accepted";
        } catch (e) {
          return e instanceof DocumentError
            ? `${e.code}: ${e.message}`
            : `untyped:${(e as Error).message}`;
        }
      };
      const a = verdict(next);
      const b = verdict({ ...next, nodesById: NodeMap.from(next.nodesById) });
      out.singleDefect.checked++;
      const code = (v: string) => v.split(":")[0];
      if (a === b) out.singleDefect.sameVerdict++;
      else if (code(a) !== code(b) || label !== "dup-number")
        out.disagreements.push({
          index,
          class: cls,
          label,
          detail: `map order changed a single-defect verdict: ${a} | ${b}`,
        });
      else count(out.singleDefect.messageDiffers, label);
    }
    const inc = checkIncremental(prev, session.derivedOf(prev)!, next, store, limits, writes);
    const rows = [out.byClass[cls], (out.byLabel[`${cls}:${label}`] ??= tally())];
    out.compared++;
    for (const t of rows) t.compared++;
    if (full) out.fullAccepted++;
    else {
      out.fullRejected++;
      for (const t of rows) t.fullRejected++;
    }
    if (inc.derived) {
      out.decided++;
      for (const t of rows) t.decided++;
      const disagree = (detail: string) =>
        out.disagreements.push({ index, class: cls, label, detail });
      if (!full) disagree("incremental accepted a state the full validator rejects");
      else if (!sameDerived(full, inc.derived)) disagree("derived data differs");
    } else {
      count(out.undecidedReasons, inc.reason);
      if (full) {
        out.undecidedValid++;
        count(out.undecidedValidReasons, inc.reason);
      } else out.undecidedInvalid++;
    }
    return full !== null;
  };

  for (let i = 0; i < o.transactions; i++) {
    if (++steps > 150 || session.state.nodesById.size === 0) {
      session = episode(r);
      steps = 0;
    }
    const roll = r.next();
    if (roll < 0.08) session.undo();
    else if (roll < 0.12) session.redo();
    const prev = session.state;
    const { store } = session;

    if (r.bool(0.35)) {
      const f = forge(r, prev);
      if (!f) {
        out.noOps++;
        continue;
      }
      // Both change-set paths: the identity diff, and an exact write set (as a complete Draft
      // log would give), so the log path's diffKeys also meets every forgery.
      compare(i, "forged", f.label, prev, f.next);
      // A strict superset as well: unchanged keys and a key absent from both states.
      const writes = changedKeys(prev, f.next);
      if (r.bool(0.5)) {
        for (const k of [...prev.nodesById.keys()].slice(0, 3)) writes.add(k);
        writes.add("pth_987654321");
      }
      compare(i, "forged", `${f.label}~writes`, prev, f.next, writes);
      continue;
    }

    // A real transaction: built twice from one sub-seed (commitTrace and bake consume packets).
    const sub = r.int(2 ** 31);
    const build = () => {
      const q = rng(sub);
      return Array.from({ length: q.bool(0.25) ? 2 + q.int(2) : 1 }, () => randomCommand(q, prev));
    };
    const cmds = build();
    const label = cmds.map((c) => c.type).join("+");
    const log = new DraftLog();
    const ctx = {
      store,
      ids: new IdAllocator(session.nextId),
      commit: (p: Parameters<typeof store.commit>[0]) => store.commit(p),
      log,
    };
    let next = prev;
    // Stage D: a transaction, failed or not, never changes its predecessor (shared chunks).
    const before = [...prev.nodesById.entries()];
    const unchanged = () => {
      const now = [...prev.nodesById.entries()];
      return (
        now.length === before.length &&
        now.every(([k, v], j) => before[j]![0] === k && before[j]![1] === v)
      );
    };
    try {
      for (const c of cmds) {
        const out = applyCommand(next, c, ctx);
        log.step(next, out);
        next = out;
      }
    } catch (e) {
      if (!(e instanceof DocumentError)) throw e;
      out.commandRejected++;
      store.settle();
      if (!unchanged())
        out.disagreements.push({
          index: i,
          class: "command",
          label: "failed",
          detail: "a failed transaction changed its predecessor",
        });
      continue;
    }
    if (!unchanged())
      out.disagreements.push({
        index: i,
        class: "command",
        label,
        detail: "a transaction changed its predecessor",
      });
    if (next === prev) {
      out.noOps++;
      store.settle();
      continue;
    }
    // Stage C: every command transaction's log must be complete and cover the true change set.
    const missed = [...changedKeys(prev, next)].filter((k) => !log.keys.has(k));
    if (!log.complete || missed.length)
      out.disagreements.push({
        index: i,
        class: "command",
        label,
        detail: `write log incomplete (flag ${log.complete}; missed ${missed.slice(0, 5).join(",")})`,
      });
    else out.writeLogged++;
    const fullOk = compare(i, "command", label, prev, next, log.complete ? log.keys : null);
    store.settle();
    // Advance through the real dispatch, which must reach the same verdict.
    try {
      session.dispatch(build());
      if (!fullOk)
        out.disagreements.push({
          index: i,
          class: "command",
          label,
          detail: "dispatch accepted a state validateState rejects",
        });
    } catch (e) {
      if (e instanceof ValidationDisagreement) {
        out.disagreements.push({ index: i, class: "command", label, detail: e.message });
        continue;
      }
      if (!(e instanceof DocumentError)) throw e;
      if (fullOk && e.code !== "history_budget")
        out.disagreements.push({
          index: i,
          class: "command",
          label,
          detail: `dispatch rejected (${e.code}) a state validateState accepts`,
        });
    }
  }
  return out;
}
