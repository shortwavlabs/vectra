// Workspace qualification API, installed only with `?debug=1`. It gives the Playwright and
// Safari suites read-only probes and deterministic hooks: a gate on the import-preparation
// interval, and document replacement. It adds no product behaviour.
import type { DocumentRenderHost } from "../canvas-host/render-host.ts";
import type { Command } from "../document/commands.ts";
import { GeometryStore } from "../document/geometry-store.ts";
import { createDocument, isContainer, type NodeId } from "../document/model.ts";
import { DocumentSession } from "../document/session.ts";
import type { JobController } from "../jobs/controller.ts";
import { preparationGate } from "./jobs.ts";

export interface WorkspaceProbe {
  jobs: JobController;
  host(): DocumentRenderHost | null;
  session(): DocumentSession | null;
  adopt(session: DocumentSession | null): void;
  selection(): readonly NodeId[];
  select(ids: readonly NodeId[]): void;
}

interface TreeNode {
  id: NodeId;
  kind: string;
  name: string | null;
  visible: boolean;
  locked: boolean;
  children?: TreeNode[];
}

export function installWorkspaceQualification(o: WorkspaceProbe): () => void {
  let release: (() => void) | null = null;
  const api = {
    canvas: {
      diag: () => {
        const h = o.host();
        if (!h) return null;
        return {
          ...h.diag,
          state: h.state,
          client: { ...h.client.diag },
          held: h.client.held.size,
          renderRevision: h.renderRevision,
          documentRevision: h.documentRevision,
          camera: h.camera,
        };
      },
      hitDocument: (x: number, y: number) => o.host()?.hitDocument(x, y) ?? null,
      boundsOf: (ids: NodeId[]) => o.host()?.boundsOf(ids) ?? null,
      itemsOf: (id: NodeId) => [...(o.host()?.itemsOf(id) ?? [])],
      setView: (scale: number, tx: number, ty: number) => o.host()?.setView({ scale, tx, ty }),
      crash: () => o.host()?.client.crashWorker() ?? false,
    },
    workspace: {
      revision: () => o.session()?.getSnapshot().revision ?? null,
      documentId: () => o.session()?.getSnapshot().state.documentId ?? null,
      /** The job controller targets the shown document (or the placeholder when none). */
      associated: () => {
        const s = o.session();
        return s ? o.jobs.session === s : o.jobs.session.getSnapshot().state.documentId === "none";
      },
      jobsSubmitted: () => o.jobs.scheduler.diag.submitted,
      replaceDocument: (width: number, height: number) =>
        o.adopt(
          new DocumentSession(new GeometryStore(), { state: createDocument({ width, height }) }),
        ),
      holdPreparation: () => {
        preparationGate.current = new Promise<void>((r) => (release = r));
      },
      releasePreparation: () => {
        preparationGate.current = null;
        release?.();
        release = null;
      },
      dispatch: (c: Command | Command[]) => o.session()?.dispatch(c),
      undo: () => o.session()?.undo(),
      redo: () => o.session()?.redo(),
      selection: () => [...o.selection()],
      select: (ids: NodeId[]) => o.select(ids),
      tree: (): TreeNode[] => {
        const s = o.session()?.getSnapshot().state;
        if (!s) return [];
        const node = (id: NodeId): TreeNode => {
          const n = s.nodesById.get(id)!;
          return {
            id,
            kind: n.kind,
            name: n.name ?? null,
            visible: n.visible,
            locked: n.locked,
            ...(isContainer(n) ? { children: n.orderedChildIds.map(node) } : {}),
          };
        };
        return s.orderedRootIds.map(node);
      },
    },
  };
  const w = window as unknown as { __vectra?: unknown };
  w.__vectra = api;
  return () => {
    if (w.__vectra === api) delete w.__vectra;
  };
}
