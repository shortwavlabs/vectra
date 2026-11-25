// Property and fuzz tests over random command, undo and redo sequences (seeded, reproducible).
import { describe, expect, test } from "vite-plus/test";
import { type Command, GEOMETRY_COMMANDS } from "./commands.ts";
import { loadContainer, saveContainer } from "../persistence/container.ts";
import { evaluate } from "./evaluate.ts";
import { copyDiagnostics, OWNER_KINDS } from "./geometry-store.ts";
import { DEFAULT_DOC_LIMITS, validateState } from "./invariants.ts";
import { type DocState, DocumentError, type Matrix, type NodeId, rotate90Matrix } from "./model.ts";
import type { DocumentSession } from "./session.ts";
import { FIXTURE_SCENES, fixturePacket } from "./testing/fixtures.ts";
import { fixtureSession } from "./testing/helpers.ts";
import { testPacketPort } from "./testing/packet-adapter.ts";
import { randomPacket, rng, type Rng } from "./testing/synthetic.ts";

const MATRICES: Matrix[] = [
  [1, 0, 0, 1, 5, -7],
  [2, 0, 0, 0.5, 0, 0],
  [-1, 0, 0, 1, 10, 0],
  rotate90Matrix(1, 3, 4),
  [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0], // breaks clips
  [1, 0.25, 0, 1, 0, 0], // skew: breaks clips
  [0, 0, 0, 0, 0, 0], // singular
  [1e9, 0, 0, 1e-3, 0, 0], // ill-conditioned
];

function randomCommand(r: Rng, s: DocState): Command {
  const ids = [...s.nodesById.keys()];
  const any = (): NodeId => (ids.length && r.bool(0.95) ? r.pick(ids) : "pth_999999");
  const some = () => Array.from({ length: 1 + r.int(3) }, any);
  const paths = ids.filter((id) => s.nodesById.get(id)!.kind === "path");
  const pal = [...s.paletteById.keys()];
  if (ids.length < 3 && r.bool(0.6)) return { type: "commitTrace", packet: randomPacket(r) };
  switch (r.int(19)) {
    case 0:
      return r.bool(0.5)
        ? { type: "commitTrace", packet: randomPacket(r) }
        : { type: "commitTrace", packet: fixturePacket(r.pick([...FIXTURE_SCENES.keys()])) };
    case 1: {
      const layers = s.orderedRootIds.filter((id) => s.nodesById.get(id)!.kind === "layer");
      return {
        type: "commitTrace",
        packet: randomPacket(r),
        replaceLayerId: layers.length ? r.pick(layers) : any(),
      };
    }
    case 2:
      return { type: "delete", ids: some() };
    case 3:
      return { type: "duplicate", ids: some() };
    case 4:
      return { type: "reorder", id: any(), index: r.int(4) };
    case 5:
      return {
        type: "reparent",
        ids: some(),
        parentId: r.bool(0.2) ? null : any(),
        index: r.int(3),
      };
    case 6:
      return { type: "setVisible", ids: some(), visible: r.bool() };
    case 7:
      return { type: "setLocked", ids: some(), locked: r.bool() };
    case 8:
      return { type: "rename", id: any(), name: r.pick(["a", "b-1", "", "run-0", "not valid"]) };
    case 9:
      return { type: "setTransform", id: any(), matrix: r.pick(MATRICES) };
    case 10:
      return { type: "applyTransform", ids: some(), matrix: r.pick(MATRICES) };
    case 11:
      return { type: "rotate90", ids: some(), turns: r.pick([1, 2, 3] as const) };
    case 12:
      return {
        type: "setFill",
        ids: paths.length ? [r.pick(paths)] : some(),
        fill:
          r.bool(0.4) || !pal.length
            ? { color: r.int(2 ** 32) }
            : r.bool(0.8)
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
    default:
      return paths.length
        ? { type: "bake", packet: randomPacket(r), targetIds: [r.pick(paths)] }
        : {
            type: "setArtboard",
            width: 1 + r.int(2000),
            height: 1 + r.int(2000),
            background: null,
          };
  }
}

/** Expected owner counts recomputed from the states, compared with the store. */
function checkOwnership(session: DocumentSession) {
  const { store } = session;
  const { past, future } = session.historyStates();
  const chunksOf = (st: DocState) => [...session.derivedOf(st)!.chunks.keys()];
  const expected = new Map<string, { document: number; history: number }>();
  const add = (id: string, k: "document" | "history") => {
    const e = expected.get(id) ?? { document: 0, history: 0 };
    e[k]++;
    expected.set(id, e);
  };
  for (const id of chunksOf(session.state)) add(id, "document");
  for (const st of [...past, ...future]) for (const id of chunksOf(st)) add(id, "history");
  expect(new Set(store.chunkIds())).toEqual(new Set(expected.keys())); // no leak, nothing missing
  for (const [id, e] of expected)
    expect(store.ownerCounts(id)).toEqual({ ...e, snapshot: 0, job: 0 });
  const b = store.bytes();
  expect(OWNER_KINDS.reduce((t, k) => t + b.byOwnerKind[k], 0)).toBe(b.total);
  expect(store.checkIntegrity()).toBe(true);
}

/** The evaluation accepts every reachable state: unique run ids, in-range run references. */
function checkEvaluation(state: DocState) {
  const { runs, drawList } = evaluate(state);
  expect(new Set(runs.map((r) => r.id)).size).toBe(runs.length);
  for (const d of drawList) expect(d.groupRun >= 0 && d.groupRun < runs.length).toBe(true);
}

/** Every accepted state saves, loads and re-saves byte-identically, with an equal evaluation. */
async function checkRoundTrip(session: DocumentSession) {
  const a = await saveContainer(session, { codec: "none" });
  const loaded = await loadContainer(a, { port: testPacketPort, limits: session.limits });
  expect(await saveContainer(loaded, { codec: "none" })).toEqual(a);
  expect(evaluate(loaded.state)).toEqual(evaluate(session.state));
}

describe("random command / undo / redo sequences", () => {
  const SEEDS = 30;
  const STEPS = 80;
  for (let seed = 1; seed <= SEEDS; seed++)
    test(`seed ${seed}: invariants, revisions, redo, refcounts, evaluation, container round trip`, async () => {
      const r = rng(seed);
      const session = fixtureSession([r.pick([...FIXTURE_SCENES.keys()])], {
        limits: { ...DEFAULT_DOC_LIMITS, maxAnchors: 20_000 },
        history: { maxEntries: 2 + r.int(12), maxBytes: r.bool(0.3) ? 40_000 : 128 * 2 ** 20 },
      });
      let accepted = 0;
      for (let step = 0; step < STEPS; step++) {
        const before = session.getSnapshot();
        const roll = r.next();
        if (roll < 0.15) {
          const did = session.undo();
          expect(session.getSnapshot().revision).toBe(before.revision + (did ? 1 : 0));
        } else if (roll < 0.25) {
          const did = session.redo();
          expect(session.getSnapshot().revision).toBe(before.revision + (did ? 1 : 0));
        } else {
          const cmd = randomCommand(r, session.state);
          const commits = session.store.stats.commits;
          const copies = { ...copyDiagnostics };
          const copyCalls = session.store.stats.jobCopies + session.store.stats.renderCopies;
          try {
            session.dispatch(cmd);
            const after = session.getSnapshot();
            if (after.state !== before.state) {
              accepted++;
              expect(after.revision).toBe(before.revision + 1);
              expect(after.canRedo).toBe(false);
            } else expect(after).toBe(before);
          } catch (e) {
            if (!(e instanceof DocumentError)) throw e;
            expect(session.getSnapshot()).toBe(before); // document unchanged on any error
          }
          if (!GEOMETRY_COMMANDS.has(cmd.type)) expect(session.store.stats.commits).toBe(commits);
          expect(copyDiagnostics).toEqual(copies);
          expect(session.store.stats.jobCopies + session.store.stats.renderCopies).toBe(copyCalls);
        }
        validateState(session.state, session.store, session.limits); // invariants hold
        checkEvaluation(session.state);
        if (step === STEPS / 2) await checkRoundTrip(session);
        expect(session.nextId).toBeGreaterThan(session.derivedOf(session.state)!.maxIdNumber);
        checkOwnership(session);
      }
      await checkRoundTrip(session);
      expect(accepted).toBeGreaterThan(5);
      // Unwind: undo everything, then redo everything, invariants and refcounts hold throughout.
      while (session.undo()) checkOwnership(session);
      while (session.redo()) checkOwnership(session);
    });

  test("chunks are freed exactly when the last owner (an evicted history entry) releases", () => {
    const session = fixtureSession(["circle-bw", "nested_rings-bw"], {
      history: { maxEntries: 2, maxBytes: 2 ** 30 },
    });
    const chunks = session.store.chunkIds();
    session.dispatch({ type: "delete", ids: [...session.state.orderedRootIds] });
    for (const id of chunks)
      expect(session.store.ownerCounts(id)).toMatchObject({
        document: 0,
        history: 2 - chunks.indexOf(id),
      });
    session.dispatch({ type: "setArtboard", width: 100, height: 100 });
    expect(session.store.chunkIds()).toEqual(chunks); // still referenced by the delete's undo entry
    session.dispatch({ type: "setArtboard", width: 200, height: 100 });
    expect(session.store.chunkIds()).toEqual([]); // that entry was evicted: freed
    expect(session.store.bytes().total).toBe(0);
  });
});
