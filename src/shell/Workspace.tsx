// The Vectra workspace shell (G-UI, P1-B): top bar, contextual tool rail, central canvas,
// inspector and layers, status bar. It binds to the document session through commands only.
// Tools and views that do not exist yet are not shown (maintainer review of G-UI-R): none
// pretends to work, and none takes a Tab stop.
// G-UI-R layout: docked panels separated by hairlines (no floating cards) and zoom in the status
// bar (DESIGN-SYSTEM §9), so the canvas takes every pixel the chrome does not need.
import {
  CircleAlert,
  Download,
  Keyboard,
  LoaderCircle,
  Maximize,
  Minus,
  MousePointer2,
  Palette,
  Plus,
  Redo2,
  ScanLine,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePanelRef } from "react-resizable-panels";
import { VectorCanvas } from "../canvas-host/CanvasHost.tsx";
import type { DocumentRenderHost } from "../canvas-host/render-host.ts";
import type { CanvasHostHandle, CanvasHostState, CanvasView } from "../canvas-host/types.ts";
import type { Command } from "../document/commands.ts";
import type { Matrix, NodeId } from "../document/model.ts";
import type { DispatchOptions, DocumentSession, SessionSnapshot } from "../document/session.ts";
import { downloadBlob } from "../export/download.ts";
import { type OfflineStatus, watchOfflineStatus } from "../jobs/offline-status.ts";
import type { LengthUnit } from "../vectorization/types.ts";
import { Button } from "../ui/registry/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/registry/dialog";
import { Input } from "../ui/registry/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/registry/resizable";
import { ScrollArea } from "../ui/registry/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/registry/tooltip";
import { Tip } from "../ui/tip.tsx";
import {
  displayName,
  isLocked,
  isVisible,
  pathCount,
  pathFill,
  topLevel,
  transformable as canTransform,
  worldTransformCommands,
} from "./document.ts";
import {
  DocumentInspector,
  EmptyInspector,
  RecolorInspector,
  Section,
  SelectionInspector,
} from "./Inspector.tsx";
import {
  associate,
  createJobs,
  exportDocument,
  PRESETS,
  type PresetId,
  startTrace,
} from "./jobs.ts";
import { LayersPanel } from "./LayersPanel.tsx";
import { installWorkspaceQualification } from "./qualification.ts";

type ToolId = "select" | "trace" | "recolor";
interface Tool {
  id: ToolId;
  label: string;
  icon: LucideIcon;
  key: string;
  /** Rail group: selection and tracing, colour (a divider between groups). */
  group: 0 | 1;
}
// The RFC-002 §16 P1 tools that work today. Smooth, Simplify and Cleanup (path refinement) are
// hidden until they are implemented, then return between Trace and Recolor in their own group.
// The order is the keyboard order the shell and Safari suites check.
const TOOLS: readonly Tool[] = [
  { id: "select", label: "Select", icon: MousePointer2, key: "V", group: 0 },
  { id: "trace", label: "Trace", icon: ScanLine, key: "T", group: 0 },
  { id: "recolor", label: "Recolor", icon: Palette, key: "R", group: 1 },
];
const PRESET_NOTES: Record<PresetId, string> = {
  bw: "Bold shapes and high-contrast artwork.",
  color: "Preserve the richness of the original image.",
  limited: "Reduce artwork to a curated set of colours.",
};

const ACCEPT = "image/png,image/jpeg,image/webp";
/** The Layers header's height (h-9): what a collapsed Layers panel keeps. */
const LAYERS_HEADER = 36;
/** The side column starts narrower on small laptops (under 1440 px wide): more canvas. */
const SIDE_WIDTH = typeof innerWidth === "number" && innerWidth < 1440 ? 296 : 320;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const debugMode = new URLSearchParams(location.search).get("debug") === "1";
const forceMainThread = new URLSearchParams(location.search).get("renderer") === "main";

/** A design token resolved to a canvas colour (the renderer cannot read CSS variables). */
function tokenColor(name: string, fallback: string): string {
  const probe = document.createElement("i");
  probe.style.color = `var(--${name})`;
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c || fallback;
}

/** What the status bar discloses about the renderer: nothing while it is healthy (the render
 *  worker, or starting and drawing in it); the main-thread fallback, a recovery and a failure
 *  are shown. The fallback reason stays set once the client has fallen back, so the disclosure
 *  does not flicker while a fallback renderer draws. */
function rendererNotice(s: CanvasHostState, fallbackReason: string | null): string {
  if (s.kind === "error") return `Renderer error: ${s.message}`;
  if (s.kind === "recovering") return `Renderer: recovering (${s.reason})`;
  if (fallbackReason !== null) return `Renderer: main thread (fallback: ${fallbackReason})`;
  return "";
}

const noSubscribe = () => () => {};
const noSnapshot = () => null;
const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform);
const MOD = isMac ? "Meta" : "Control";

/** Global shortcuts never fire while typing, in dialogs or in open menus/listboxes. */
const shortcutsBlocked = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    t.closest("input, textarea, select, [role=dialog], [role=menu], [role=listbox]") !== null);
/** Undo/redo still work from a slider (a range input edits no text). */
const isRange = (t: EventTarget | null) => t instanceof HTMLInputElement && t.type === "range";

/** A rail or bar button whose name and shortcut are on the trigger itself (tooltips are visual
 *  only, R05-A D9). A disabled control stays focusable (aria-disabled). */
function IconAction(p: {
  label: string;
  icon: ReactNode;
  shortcut?: string;
  ariaShortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  side?: "right" | "bottom" | "top";
  size?: "icon-lg" | "icon";
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={p.size ?? "icon-lg"}
            aria-label={p.label}
            aria-pressed={p.pressed}
            aria-keyshortcuts={p.ariaShortcut}
            aria-disabled={p.disabled ? true : undefined}
            className={
              p.pressed
                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                : p.disabled
                  ? "text-muted-foreground opacity-40 hover:bg-transparent hover:text-muted-foreground"
                  : "text-muted-foreground hover:text-foreground"
            }
            onClick={p.disabled ? undefined : p.onClick}
          />
        }
      >
        {p.icon}
      </TooltipTrigger>
      <TooltipContent side={p.side ?? "right"}>
        {p.label}
        {p.shortcut && (
          <kbd className="ml-1 rounded bg-background/15 px-1 font-sans text-[11px]">
            {p.shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** A hairline between groups of controls. */
const Divider = ({ vertical = true }: { vertical?: boolean }) => (
  <span
    aria-hidden="true"
    className={vertical ? "h-4 w-px shrink-0 bg-border" : "my-1 h-px w-6 shrink-0 bg-border"}
  />
);

function LogoMark() {
  return (
    <svg viewBox="0 0 40 34" className="h-5 w-6" aria-hidden="true">
      <path d="M0 0h9l11 21L31 0h9L20 34z" fill="var(--primary)" />
    </svg>
  );
}

const SHORTCUTS: [string, string][] = [
  ["V", "Select tool"],
  ["T", "Trace tool"],
  ["R", "Recolor tool"],
  [isMac ? "⌘Z" : "Ctrl+Z", "Undo"],
  [isMac ? "⇧⌘Z" : "Ctrl+Shift+Z", "Redo"],
  ["Esc", "Clear selection"],
  ["Delete", "Delete selection (unlocked)"],
  ["+ / −", "Zoom in / out"],
  ["Shift+1", "Fit artboard"],
  ["?", "Keyboard shortcuts"],
];

export function Workspace() {
  // Idle is silent: the status live region is mounted empty and speaks only when something
  // happens (no "Ready").
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [jobs] = useState(() =>
    createJobs((detail) => setStatus({ text: `This page is out of date: ${detail}`, error: true })),
  );
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [rawSelection, setRawSelection] = useState<readonly NodeId[]>([]);
  // The document as of now, for async work (state is a render-time copy).
  const sessionRef = useRef<DocumentSession | null>(null);
  /** Shows a document; the job controller always targets the document the workspace shows.
   *  The selection is cleared: node IDs are allocated per document and repeat across them. */
  const adopt = useCallback(
    (s: DocumentSession | null) => {
      if (s !== sessionRef.current) setRawSelection([]);
      sessionRef.current = s;
      associate(jobs, s);
      setSession(s);
    },
    [jobs],
  );
  const [preset, setPreset] = useState<PresetId>("bw");
  const [tracing, setTracing] = useState<{ jobId: number; name: string; stage: string } | null>(
    null,
  );
  // Set synchronously when an import starts, before any await: a second import (a rapid
  // repeat, or a drop while the first file is still decoding) is refused, never interleaved.
  const importing = useRef(false);
  const [preparing, setPreparing] = useState<{ name: string; abort: AbortController } | null>(null);
  const busy = tracing !== null || preparing !== null;
  // A refused import (another one is running) is reported apart from the running import's status.
  const [refused, setRefused] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const snap: SessionSnapshot | null = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.getSnapshot ?? noSnapshot,
  );
  const state = snap?.state ?? null;
  const selection = useMemo(
    () => (state ? rawSelection.filter((id) => state.nodesById.has(id)) : []),
    [state, rawSelection],
  );
  const [tool, setTool] = useState<ToolId>("select");
  const [hostState, setHostState] = useState<CanvasHostState>({ kind: "starting" });
  // Qualification only: a new key remounts the canvas (lifecycle tests).
  const [canvasKey, setCanvasKey] = useState(0);
  const [host, setHost] = useState<DocumentRenderHost | null>(null);
  // Only the zoom label: a pan does not re-render the whole workspace every frame.
  const [zoom, setZoom] = useState<number | null>(null);
  const onView = useCallback((v: CanvasView) => setZoom(Math.round(v.scale * 100)), []);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const layersPanel = usePanelRef();
  const [layersOpen, setLayersOpen] = useState(true);
  const [offline, setOffline] = useState<OfflineStatus | null>(null);
  const canvas = useRef<CanvasHostHandle>(null);
  // Resolved once, before the canvas mounts: the renderer draws with these colours.
  const [colors] = useState(() => ({
    paper: tokenColor("paper", "#eee8d8"),
    surround: tokenColor("canvas-surround", "#303134"),
    selection: tokenColor("primary", "#b9e87b"),
    halo: tokenColor("background", "#191a1c"),
  }));

  useEffect(() => {
    // Start the compute worker early, so the first import does not wait for the engine.
    void jobs.scheduler.warmup();
    // Offline-ready only when the controlling service worker caches this page's build.
    return watchOfflineStatus(setOffline);
  }, [jobs]);

  const importFile = async (file: File) => {
    if (importing.current) {
      setRefused(`${file.name} was not imported: another import is in progress`);
      return;
    }
    importing.current = true;
    setRefused(null);
    const abort = new AbortController();
    setPreparing({ name: file.name, abort });
    setStatus({ text: `Reading ${file.name}…` });
    try {
      const t = await startTrace(
        jobs,
        file,
        preset,
        () => sessionRef.current,
        abort.signal,
        (stage) => setTracing((cur) => cur && { ...cur, stage }),
      );
      setPreparing(null);
      setTracing({ jobId: t.jobId, name: file.name, stage: "queued" });
      setStatus({ text: `Tracing ${file.name}…` });
      const out = await t.done;
      setTracing(null);
      // A document created for this import is adopted only if the trace committed into it.
      if (out.status !== "committed" && t.created) associate(jobs, sessionRef.current);
      if (out.status === "committed") {
        if (t.created) adopt(t.session);
        setRawSelection([out.layerId]);
        const m = out.result.metrics.stats;
        const ms = out.timings.queuedMs + out.timings.workerMs + out.timings.commitMs;
        setStatus({
          text: `Traced ${file.name}: ${m.paths.toLocaleString("en")} paths, ${m.anchors.toLocaleString("en")} anchors in ${Math.round(ms)} ms`,
        });
      } else if (out.status === "stale")
        setStatus({ text: `Trace discarded: the document changed (${out.reason})`, error: true });
      else if (out.status === "failed")
        setStatus({ text: `Trace failed: ${out.message}`, error: true });
      else setStatus({ text: "Trace cancelled; the document is unchanged" });
    } catch (e) {
      setTracing(null);
      const code = (e as { code?: string }).code;
      if (code === "cancelled") setStatus({ text: message(e) });
      else if (code === "document_replaced") setStatus({ text: message(e), error: true });
      else setStatus({ text: `Import failed: ${message(e)}`, error: true });
    } finally {
      setPreparing(null);
      importing.current = false;
    }
  };

  const run = useCallback(
    (c: Command | Command[], o?: DispatchOptions) => {
      if (!session) return;
      try {
        session.dispatch(c, o);
      } catch (e) {
        setStatus({
          text: `Edit rejected: ${message(e)}`,
          error: true,
        });
      }
    },
    [session],
  );
  const onSelect = useCallback(
    (ids: readonly NodeId[], mode: "replace" | "toggle") =>
      setRawSelection((cur) =>
        mode === "replace"
          ? ids
          : [...cur.filter((id) => !ids.includes(id)), ...ids.filter((id) => !cur.includes(id))],
      ),
    [],
  );
  const transformable = useMemo(
    () => state !== null && canTransform(state, selection),
    [state, selection],
  );
  // A completed canvas gesture: one transaction (one undo step) for the whole selection.
  const onTransform = useCallback(
    (ids: readonly NodeId[], m: readonly [number, number, number, number, number, number]) => {
      if (state) run(worldTransformCommands(state, ids, [...m] as Matrix));
    },
    [state, run],
  );
  // Read live by the qualification API, which is installed once.
  const live = useRef({ host, selection, onTransform });
  useEffect(() => {
    live.current = { host, selection, onTransform };
  });
  useEffect(() => {
    if (!debugMode) return;
    return installWorkspaceQualification({
      jobs,
      host: () => live.current.host,
      session: () => sessionRef.current,
      adopt,
      selection: () => live.current.selection,
      select: (ids) => setRawSelection(ids),
      remountCanvas: () => setCanvasKey((k) => k + 1),
      transform: (ids, m) => live.current.onTransform(ids, m),
    });
  }, [jobs, adopt]);
  /** What keyboard navigation on the canvas announces for a node. */
  const describe = useCallback((id: NodeId) => {
    const s = sessionRef.current?.getSnapshot().state;
    const n = s?.nodesById.get(id);
    if (!s || !n) return String(id);
    const parts = [displayName(n, s)];
    if (n.name) parts.push(n.kind);
    if (n.kind === "path") {
      const f = pathFill(s, id);
      if (f.color !== null) parts.push(`fill #${(f.color >>> 8).toString(16).padStart(6, "0")}`);
    } else parts.push(`${pathCount(s, id)} paths`);
    if (isLocked(s, id)) parts.push("locked");
    if (!isVisible(s, id)) parts.push("hidden");
    return parts.join(", ");
  }, []);
  const undo = useCallback(() => session?.undo(), [session]);
  const redo = useCallback(() => session?.redo(), [session]);
  const deleteSelection = useCallback(() => {
    if (!state) return;
    const ids = topLevel(state, selection).filter((id) => !isLocked(state, id));
    if (ids.length) run({ type: "delete", ids });
  }, [state, selection, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (shortcutsBlocked(e.target) && !(isRange(e.target) && (e.metaKey || e.ctrlKey))) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y" && !isMac) {
        e.preventDefault();
        redo();
      } else if (e.metaKey || e.ctrlKey || e.altKey) return;
      else if (k === "v") setTool("select");
      else if (k === "t") setTool("trace");
      else if (k === "r") setTool("recolor");
      else if (k === "escape") setRawSelection([]);
      else if (k === "delete" || k === "backspace") deleteSelection();
      else if (k === "+" || k === "=") canvas.current?.zoomBy(1.25);
      else if (k === "-" || k === "_") canvas.current?.zoomBy(0.8);
      else if (k === "!" && e.shiftKey) canvas.current?.fitToView();
      else if (k === "?") setShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, deleteSelection]);

  const totals = useMemo(() => {
    if (!state) return null;
    let paths = 0;
    for (const id of state.orderedRootIds) paths += pathCount(state, id);
    return { paths, anchors: snap!.anchors };
  }, [state, snap]);

  const activeTool = TOOLS.find((t) => t.id === tool)!;
  const inspector = (() => {
    if (tool === "trace")
      return (
        <Section title="Preset">
          <div role="radiogroup" aria-label="Trace preset" className="grid gap-1">
            {PRESETS.map((p) => (
              <div
                key={p.id}
                className="grid rounded-md border border-transparent hover:bg-elevated has-checked:border-control-border has-checked:bg-elevated"
              >
                <label className="flex cursor-pointer items-center gap-2.5 px-2 pt-1.5 text-xs font-medium">
                  <input
                    type="radio"
                    name="preset"
                    value={p.id}
                    checked={preset === p.id}
                    onChange={() => setPreset(p.id)}
                    aria-describedby={`preset-note-${p.id}`}
                    className="accent-primary"
                  />
                  {p.label}
                </label>
                <span
                  id={`preset-note-${p.id}`}
                  className="pr-2 pb-1.5 pl-[1.85rem] text-2xs text-muted-foreground"
                >
                  {PRESET_NOTES[p.id]}
                </span>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            className="border-control-border"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload data-icon="inline-start" /> Import and trace…
          </Button>
          <p className="text-2xs text-pretty text-muted-foreground">
            Each import is traced with the engine defaults of the chosen preset and added as a new
            layer. Trace parameters cannot be adjusted in this build yet.
          </p>
        </Section>
      );
    if (!session || !snap) return <EmptyInspector />;
    if (tool === "recolor") return <RecolorInspector snap={snap} run={run} />;
    if (selection.length)
      return (
        <SelectionInspector
          key={selection.join(",")}
          session={session}
          snap={snap}
          ids={selection}
          bounds={host?.boundsOf(topLevel(snap.state, selection)) ?? null}
          run={run}
        />
      );
    return <DocumentInspector snap={snap} />;
  })();

  const presetLabel = PRESETS.find((p) => p.id === preset)!.label;
  const rendererText = rendererNotice(hostState, host?.client.diag.fallbackReason ?? null);
  const statusText = tracing
    ? `Tracing ${tracing.name} (${tracing.stage})…`
    : preparing
      ? `Preparing ${preparing.name}…`
      : status.text;

  return (
    <TooltipProvider delay={300}>
      <div className="grid h-full grid-rows-[44px_minmax(0,1fr)_28px] bg-background">
        {/* Top bar: identity and document; history and file actions. Artwork is the only view
            today, so there is no view switch until Paths or Compare exists. */}
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-panel px-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex shrink-0 items-center gap-1.5">
              <LogoMark />
              <span className="text-[15px] font-bold tracking-tight">vectra</span>
            </div>
            <Divider />
            <p className="min-w-0 truncate text-ui" data-testid="document-title">
              {session ? (
                "Untitled artwork"
              ) : (
                <span className="text-muted-foreground">No document</span>
              )}
              {snap?.dirty && <span className="text-muted-foreground"> · Edited</span>}
            </p>
          </div>
          <div className="flex min-w-0 items-center justify-end gap-1.5">
            <div className="flex items-center" role="group" aria-label="History">
              <IconAction
                label="Undo"
                icon={<Undo2 />}
                shortcut={isMac ? "⌘Z" : "Ctrl+Z"}
                ariaShortcut={`${MOD}+Z`}
                disabled={!snap?.canUndo}
                side="bottom"
                size="icon"
                onClick={undo}
              />
              <IconAction
                label="Redo"
                icon={<Redo2 />}
                shortcut={isMac ? "⇧⌘Z" : "Ctrl+Shift+Z"}
                ariaShortcut={`${MOD}+Shift+Z`}
                disabled={!snap?.canRedo}
                side="bottom"
                size="icon"
                onClick={redo}
              />
              <IconAction
                label="Keyboard shortcuts"
                icon={<Keyboard />}
                shortcut="?"
                ariaShortcut="Shift+?"
                side="bottom"
                size="icon"
                onClick={() => setShortcutsOpen(true)}
              />
            </div>
            <Divider />
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="import-input"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (f) void importFile(f);
              }}
            />
            <Button
              variant="outline"
              className="h-8 border-control-border"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload data-icon="inline-start" /> Import
            </Button>
            <Button
              className="h-8 px-3.5 font-semibold disabled:bg-elevated disabled:text-muted-foreground disabled:opacity-100"
              disabled={!session}
              onClick={() => setExportOpen(true)}
            >
              <Download data-icon="inline-start" /> Export
            </Button>
          </div>
        </header>

        <div className="flex min-h-0">
          {/* Tool rail */}
          <nav
            aria-label="Tools"
            className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-panel py-2"
          >
            {TOOLS.map((t, i) => (
              <div key={t.id} className="contents">
                {i > 0 && TOOLS[i - 1]!.group !== t.group && <Divider vertical={false} />}
                <IconAction
                  label={t.label}
                  icon={<t.icon className="size-[18px]" />}
                  shortcut={t.key}
                  ariaShortcut={t.key}
                  pressed={tool === t.id}
                  onClick={() => setTool(t.id)}
                />
              </div>
            ))}
          </nav>

          <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
            <ResizablePanel id="canvas" minSize={360}>
              <section
                aria-label="Canvas"
                className="vx-canvas-frame relative h-full min-w-0 overflow-hidden bg-canvas-surround"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) void importFile(f);
                }}
              >
                <VectorCanvas
                  key={canvasKey}
                  ref={canvas}
                  session={session}
                  selection={selection}
                  onSelect={onSelect}
                  onStateChange={setHostState}
                  onViewChange={onView}
                  onHost={setHost}
                  paper={colors.paper}
                  workspace={colors.surround}
                  selectionColor={colors.selection}
                  haloColor={colors.halo}
                  transformable={transformable}
                  onTransform={onTransform}
                  forceMainThread={forceMainThread}
                  label="Artwork canvas"
                  describe={describe}
                  className="vectra-canvas absolute inset-0"
                />

                {!session && (
                  // The empty canvas: a blank ivory sheet, the artboard to come, is the drop target.
                  <div className="pointer-events-none absolute inset-0 grid place-items-center bg-canvas-surround p-8">
                    <div className="pointer-events-auto grid aspect-[4/3] w-full max-w-[34rem] rounded-[3px] bg-paper p-5 text-background shadow-2xl shadow-black/40">
                      <div className="grid place-content-center justify-items-center gap-3 border border-dashed border-background/30 px-6 text-center">
                        <Upload className="size-6" aria-hidden="true" />
                        <h2 className="text-lg font-semibold tracking-tight">
                          Drop an image to start
                        </h2>
                        <p className="max-w-[22rem] text-xs text-pretty text-ink-muted">
                          PNG, JPEG or WebP. It is traced on this device with the {presetLabel}{" "}
                          preset and becomes the first layer; nothing is uploaded.
                        </p>
                        {busy ? (
                          <p className="flex items-center gap-2 text-xs font-medium">
                            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                            {statusText}
                          </p>
                        ) : (
                          <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                            <Button
                              className="ring-1 ring-background"
                              onClick={() => fileInput.current?.click()}
                            >
                              <Upload data-icon="inline-start" /> Choose image…
                            </Button>
                            <Button
                              variant="ghost"
                              className="text-background hover:bg-background/10 hover:text-background"
                              onClick={() => setTool("trace")}
                            >
                              Change preset
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </ResizablePanel>
            <ResizableHandle
              withHandle
              aria-label="Resize inspector"
              className="bg-border after:w-2 [&>div]:bg-control-border"
            />
            <ResizablePanel id="side" defaultSize={SIDE_WIDTH} minSize={288} maxSize={336}>
              <ResizablePanelGroup orientation="vertical">
                <ResizablePanel id="inspector" minSize={160}>
                  <aside
                    aria-label="Inspector"
                    className="flex h-full flex-col overflow-hidden bg-panel"
                  >
                    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
                      <activeTool.icon className="size-3.5 text-primary" aria-hidden="true" />
                      <h2 className="text-ui font-semibold">{activeTool.label}</h2>
                      {activeTool.key && (
                        <kbd className="ml-auto rounded border border-border px-1.5 text-2xs text-muted-foreground">
                          {activeTool.key}
                        </kbd>
                      )}
                    </div>
                    <ScrollArea className="min-h-0 flex-1">{inspector}</ScrollArea>
                  </aside>
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  aria-label="Resize layers"
                  className="bg-border aria-[orientation=horizontal]:after:h-2 [&>div]:bg-control-border"
                />
                {/* Layers never collapse by themselves (not by viewport height either): the
                    header's disclosure, or a drag of the split past the minimum, collapses them
                    to the 36 px header; the split stays resizable. */}
                <ResizablePanel
                  id="layers"
                  defaultSize="30"
                  minSize={120}
                  collapsible
                  collapsedSize={LAYERS_HEADER}
                  panelRef={layersPanel}
                  onResize={() => setLayersOpen(!layersPanel.current?.isCollapsed())}
                >
                  <div className="flex h-full flex-col overflow-hidden bg-panel">
                    <LayersPanel
                      state={state}
                      selection={selection}
                      onSelect={onSelect}
                      run={run}
                      open={layersOpen}
                      onToggle={() => {
                        const p = layersPanel.current;
                        if (p?.isCollapsed()) p.expand();
                        else p?.collapse();
                      }}
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Status bar: what is happening (left); the document, view and app state (right) */}
        <footer className="flex min-w-0 items-center gap-3 border-t border-border bg-panel pr-2 pl-3 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {busy ? (
              <LoaderCircle
                className="size-3.5 shrink-0 animate-spin text-primary"
                aria-hidden="true"
              />
            ) : (
              status.error && (
                <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
              )
            )}
            <span
              role={status.error ? "alert" : "status"}
              data-testid="status"
              title={statusText || undefined}
              className={`min-w-0 truncate ${status.error ? "text-destructive" : "text-foreground/85"}`}
            >
              {status.error ? "Error: " : ""}
              {statusText}
            </span>
            {refused && (
              <span
                role="status"
                data-testid="import-refused"
                className="min-w-0 truncate text-warning"
              >
                {refused}
              </span>
            )}
            {(tracing || preparing) && (
              <Button
                variant="outline"
                size="xs"
                className="shrink-0 border-control-border"
                onClick={() => (tracing ? jobs.cancel(tracing.jobId) : preparing?.abort.abort())}
              >
                <X data-icon="inline-start" /> Cancel import
              </Button>
            )}
          </div>
          {/* Document items stay mounted (their test IDs are part of the contract), hidden
              while there is no document. */}
          <div hidden={!state} className="flex shrink-0 items-center gap-3">
            <span className="shrink-0 tabular-nums" data-testid="complexity">
              {totals
                ? `${totals.paths.toLocaleString("en")} paths · ${totals.anchors.toLocaleString("en")} anchors`
                : "No artwork"}
            </span>
            <Divider />
            <span className="shrink-0 tabular-nums">
              {state ? `${state.artboard.width} × ${state.artboard.height} px` : "No artboard"}
            </span>
            <div role="group" aria-label="Zoom" className="flex shrink-0 items-center">
              <Tip
                label="Zoom out (−)"
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Zoom out"
                    aria-keyshortcuts="-"
                    disabled={!session}
                    onClick={() => canvas.current?.zoomBy(0.8)}
                  />
                }
              >
                <Minus />
              </Tip>
              <span className="w-11 text-center text-foreground/85 tabular-nums" data-testid="zoom">
                {session && zoom !== null ? `${zoom}%` : "—"}
              </span>
              <Tip
                label="Zoom in (+)"
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Zoom in"
                    aria-keyshortcuts="+"
                    disabled={!session}
                    onClick={() => canvas.current?.zoomBy(1.25)}
                  />
                }
              >
                <Plus />
              </Tip>
              <Tip
                label="Fit artboard (Shift+1)"
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Fit artboard"
                    aria-keyshortcuts="Shift+1"
                    disabled={!session}
                    onClick={() => canvas.current?.fitToView()}
                  />
                }
              >
                <Maximize />
              </Tip>
            </div>
          </div>
          <Divider />
          {/* The renderer speaks only when it is not healthy: the main-thread fallback, a
              recovery or a failure. It stays mounted (empty while healthy) as a live region, with
              its state and host for the tests and the debug API. */}
          <span
            data-testid="canvas-state"
            data-state={hostState.kind}
            data-host={hostState.kind === "ready" ? hostState.host : undefined}
            role={hostState.kind === "error" ? "alert" : "status"}
            title={rendererText || undefined}
            className={`flex max-w-96 min-w-0 items-center gap-1.5 empty:-ml-3 ${hostState.kind === "error" ? "text-destructive" : "text-warning"}`}
          >
            {rendererText ? (
              <>
                <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{rendererText}</span>
              </>
            ) : null}
          </span>
          {offline?.updateWaiting && (
            <span data-testid="update-waiting" className="shrink-0 text-foreground/85">
              Update ready: it is used once every Vectra tab has closed
            </span>
          )}
          <span
            data-testid="offline-status"
            data-state={offline?.ready ? "ready" : offline?.mismatch ? "mismatch" : "none"}
            className={`flex shrink-0 items-center gap-1.5 ${offline?.mismatch ? "text-warning" : ""}`}
            title={
              offline?.mismatch
                ? "A different version of Vectra is installed for offline use. This tab keeps working while online; reload it when convenient."
                : undefined
            }
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${offline?.ready ? "bg-primary" : offline?.mismatch ? "bg-warning" : "bg-control-border"}`}
            />
            {offline?.ready
              ? "Offline ready"
              : offline?.mismatch
                ? "Offline unavailable: another version is installed"
                : "Offline not ready"}
          </span>
        </footer>
      </div>

      {session && (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          summary={
            state && totals
              ? `${state.artboard.width} × ${state.artboard.height} px artboard · ${totals.paths.toLocaleString("en")} paths`
              : null
          }
          onExport={async (format, pdf, name) => {
            setStatus({ text: `Exporting ${format.toUpperCase()}…` });
            try {
              const bytes = await exportDocument(jobs, session, format, pdf);
              if (!bytes) return setStatus({ text: "Export cancelled" });
              const type = format === "svg" ? "image/svg+xml" : "application/pdf";
              downloadBlob(
                new Blob([bytes as Uint8Array<ArrayBuffer>], { type }),
                `${name}.${format}`,
              );
              setStatus({
                text: `Exported ${name}.${format} (${Math.ceil(bytes.byteLength / 1024)} KB)`,
              });
            } catch (e) {
              setStatus({ text: `Export failed: ${message(e)}`, error: true });
            }
          }}
        />
      )}

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Shortcuts are ignored while typing in a field, in dialogs and in open menus.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-xs">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="border-t border-border py-1.5 text-muted-foreground">{v}</dt>
                <dd className="border-t border-border py-1.5 text-right">
                  <kbd className="rounded border border-control-border bg-background px-1.5 py-0.5 text-2xs tabular-nums">
                    {k}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

const FORMATS = {
  svg: { label: "SVG", note: "Editable vector" },
  pdf: { label: "PDF", note: "Vector, physical size" },
} as const;

function ExportDialog(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is exported, e.g. "640 × 430 px artboard · 1,613 paths". */
  summary: string | null;
  onExport: (format: "svg" | "pdf", pdf: { width: number; unit: LengthUnit }, name: string) => void;
}) {
  const [format, setFormat] = useState<"svg" | "pdf">("svg");
  const [name, setName] = useState("artwork");
  const [width, setWidth] = useState(200);
  const [unit, setUnit] = useState<LengthUnit>("mm");
  const valid = name.trim() !== "" && (format === "svg" || width > 0);
  const field = "h-8 rounded-md border-control-border bg-background text-sm dark:bg-background";
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export artwork</DialogTitle>
          <DialogDescription>
            Vector paths only, generated on this device by the engine. Nothing is uploaded.
          </DialogDescription>
        </DialogHeader>
        {p.summary && (
          <p className="rounded-md bg-background px-3 py-2 text-xs text-muted-foreground tabular-nums">
            {p.summary}
          </p>
        )}
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            p.onOpenChange(false);
            p.onExport(format, { width, unit }, name.trim());
          }}
        >
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-1.5 text-xs text-muted-foreground">Format</legend>
            {(["svg", "pdf"] as const).map((f) => (
              <div
                key={f}
                className="grid rounded-md border border-control-border px-3 py-2 has-checked:border-primary has-checked:bg-primary/10"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="radio"
                    name="format"
                    checked={format === f}
                    onChange={() => setFormat(f)}
                    aria-describedby={`format-note-${f}`}
                    className="accent-primary"
                  />
                  {FORMATS[f].label}
                </label>
                <span id={`format-note-${f}`} className="pl-5 text-2xs text-muted-foreground">
                  {FORMATS[f].note}
                </span>
              </div>
            ))}
          </fieldset>
          <label className="grid gap-1 text-xs text-muted-foreground">
            File name
            <span className="relative">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${field} pr-12 text-foreground`}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
              >
                .{format}
              </span>
            </span>
          </label>
          {format === "pdf" && (
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <label className="grid gap-1 text-xs text-muted-foreground">
                Page width
                <Input
                  type="number"
                  min={1}
                  value={width}
                  onChange={(e) => setWidth(e.target.valueAsNumber)}
                  className={`${field} text-foreground tabular-nums`}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Unit
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as LengthUnit)}
                  className="h-8 rounded-md border border-control-border bg-background px-2 text-sm text-foreground"
                >
                  <option value="mm">mm</option>
                  <option value="in">in</option>
                  <option value="pt">pt</option>
                </select>
              </label>
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!valid} className="font-semibold">
              <Download data-icon="inline-start" /> Export {format.toUpperCase()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
