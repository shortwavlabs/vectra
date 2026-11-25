// The Vectra workspace shell (G-UI, P1-B): top bar, contextual tool rail, central canvas,
// inspector and layers, status bar. It binds to the document session through commands only.
// Controls for features that do not exist yet are shown disabled with an explanation; none
// pretends to work.
import {
  Download,
  Eraser,
  Keyboard,
  Maximize,
  Minimize2,
  Minus,
  MousePointer2,
  Palette,
  Plus,
  Redo2,
  ScanLine,
  Spline,
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
import type { CanvasHostHandle, CanvasHostState, CanvasView } from "../canvas-host/types.ts";
import type { Command } from "../document/commands.ts";
import type { NodeId } from "../document/model.ts";
import type { DispatchOptions, DocumentSession, SessionSnapshot } from "../document/session.ts";
import { downloadBlob } from "../export/download.ts";
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
import { isLocked, pathCount, topLevel } from "./document.ts";
import { DocumentInspector, RecolorInspector, Section, SelectionInspector } from "./Inspector.tsx";
import { InterimCanvasHost, type RenderSvg } from "./InterimCanvasHost.tsx";
import {
  createJobs,
  exportDocument,
  PRESETS,
  type PresetId,
  renderPreviewSvg,
  startTrace,
} from "./jobs.ts";
import { LayersPanel } from "./LayersPanel.tsx";

type ToolId = "select" | "trace" | "smooth" | "simplify" | "cleanup" | "recolor";
interface Tool {
  id: ToolId;
  label: string;
  icon: LucideIcon;
  key?: string;
  /** Why the tool is unavailable; undefined when it works. */
  unavailable?: string;
}
// RFC-002 §16 P1 tools only (nodes, booleans and offset are P2-A).
const TOOLS: readonly Tool[] = [
  { id: "select", label: "Select", icon: MousePointer2, key: "V" },
  { id: "trace", label: "Trace", icon: ScanLine, key: "T" },
  { id: "smooth", label: "Smooth", icon: Spline, unavailable: "not available yet" },
  { id: "simplify", label: "Simplify", icon: Minimize2, unavailable: "not available yet" },
  { id: "cleanup", label: "Cleanup", icon: Eraser, unavailable: "not available yet" },
  { id: "recolor", label: "Recolor", icon: Palette, key: "R" },
];

const ACCEPT = "image/png,image/jpeg,image/webp";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

/** A rail or bar button whose name, shortcut and (un)availability are on the trigger itself
 *  (tooltips are visual only, R05-A D9). Unavailable controls stay focusable (aria-disabled). */
function IconAction(p: {
  label: string;
  icon: ReactNode;
  shortcut?: string;
  ariaShortcut?: string;
  unavailable?: string;
  pressed?: boolean;
  disabled?: boolean;
  side?: "right" | "bottom" | "top";
  className?: string;
  onClick?: () => void;
}) {
  const name = p.unavailable ? `${p.label}, ${p.unavailable}` : p.label;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={name}
            aria-pressed={p.pressed}
            aria-keyshortcuts={p.ariaShortcut}
            aria-disabled={p.unavailable || p.disabled ? true : undefined}
            className={`${p.pressed ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "text-foreground/80"} ${p.unavailable || p.disabled ? "opacity-45" : ""} ${p.className ?? ""}`}
            onClick={p.unavailable || p.disabled ? undefined : p.onClick}
          />
        }
      >
        {p.icon}
      </TooltipTrigger>
      <TooltipContent side={p.side ?? "right"}>
        {name}
        {p.shortcut && (
          <kbd className="ml-1 rounded bg-background/15 px-1 font-sans text-[11px]">
            {p.shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function LogoMark() {
  return (
    <svg viewBox="0 0 40 34" className="h-6 w-7" aria-hidden="true">
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
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "Ready" });
  const [jobs] = useState(() =>
    createJobs((detail) => setStatus({ text: `This page is out of date: ${detail}`, error: true })),
  );
  const [session, setSession] = useState<DocumentSession | null>(null);
  const renderSvg = useMemo<RenderSvg>(() => (s) => renderPreviewSvg(jobs, s), [jobs]);
  const [preset, setPreset] = useState<PresetId>("bw");
  const [tracing, setTracing] = useState<{ jobId: number; name: string; stage: string } | null>(
    null,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const snap: SessionSnapshot | null = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.getSnapshot ?? noSnapshot,
  );
  const state = snap?.state ?? null;
  const [rawSelection, setRawSelection] = useState<readonly NodeId[]>([]);
  const selection = useMemo(
    () => (state ? rawSelection.filter((id) => state.nodesById.has(id)) : []),
    [state, rawSelection],
  );
  const [tool, setTool] = useState<ToolId>("select");
  const [hostState, setHostState] = useState<CanvasHostState>({ kind: "empty" });
  const [view, setView] = useState<CanvasView | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const canvas = useRef<CanvasHostHandle>(null);

  useEffect(() => {
    // Offline use needs the service worker to control this page (it claims on first install).
    const sw = navigator.serviceWorker;
    const update = () => setOffline(sw.controller !== null);
    sw?.addEventListener("controllerchange", update);
    void sw?.ready.then(update);
    // Start the compute worker early, so the first import does not wait for the engine.
    void jobs.scheduler.warmup();
    return () => sw?.removeEventListener("controllerchange", update);
  }, [jobs]);

  const importFile = async (file: File) => {
    if (tracing) return;
    setStatus({ text: `Reading ${file.name}…` });
    try {
      const t = await startTrace(jobs, file, preset, session, (stage) =>
        setTracing((cur) => cur && { ...cur, stage }),
      );
      setTracing({ jobId: t.jobId, name: file.name, stage: "queued" });
      setStatus({ text: `Tracing ${file.name}…` });
      const out = await t.done;
      setTracing(null);
      if (out.status === "committed") {
        setSession(t.session);
        setRawSelection([out.layerId]);
        const m = out.result.metrics.stats;
        const ms = out.timings.queuedMs + out.timings.workerMs + out.timings.commitMs;
        setStatus({
          text: `Traced ${file.name}: ${m.paths} paths, ${m.anchors} anchors in ${Math.round(ms)} ms`,
        });
      } else if (out.status === "stale")
        setStatus({ text: `Trace discarded: the document changed (${out.reason})`, error: true });
      else if (out.status === "failed")
        setStatus({ text: `Trace failed: ${out.message}`, error: true });
      else setStatus({ text: "Trace cancelled; the document is unchanged" });
    } catch (e) {
      setTracing(null);
      setStatus({ text: `Import failed: ${message(e)}`, error: true });
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
        <Section title="Trace preset">
          <div role="radiogroup" aria-label="Trace preset" className="grid gap-1">
            {PRESETS.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
              >
                <input
                  type="radio"
                  name="preset"
                  value={p.id}
                  checked={preset === p.id}
                  onChange={() => setPreset(p.id)}
                  className="accent-primary"
                />
                {p.label}
              </label>
            ))}
          </div>
          <Button
            variant="outline"
            className="border-control-border"
            disabled={tracing !== null}
            onClick={() => fileInput.current?.click()}
          >
            <Upload data-icon="inline-start" /> Import and trace…
          </Button>
          <p className="text-xs text-muted-foreground">
            Each import is traced with the engine defaults of the chosen preset and added as a new
            layer. Trace parameters cannot be adjusted in this build yet.
          </p>
        </Section>
      );
    if (!session || !snap)
      return (
        <Section title="No document">
          <p className="text-xs text-muted-foreground">
            Import an image to create a document: it is traced on this device and added as a layer.
          </p>
        </Section>
      );
    if (tool === "recolor") return <RecolorInspector snap={snap} run={run} />;
    if (selection.length)
      return (
        <SelectionInspector
          key={selection.join(",")}
          session={session}
          snap={snap}
          ids={selection}
          run={run}
        />
      );
    return <DocumentInspector snap={snap} />;
  })();

  return (
    <TooltipProvider delay={300}>
      <div className="grid h-full grid-rows-[48px_minmax(0,1fr)_28px] bg-background">
        {/* Top bar */}
        <header className="flex items-center gap-3 border-b border-border bg-panel px-3">
          <div className="flex items-center gap-2">
            <LogoMark />
            <span className="text-lg font-bold tracking-tight">vectra</span>
            <span className="text-xs text-muted-foreground">/ Studio</span>
          </div>
          <div className="flex-1" />
          <p className="text-sm text-foreground/85" data-testid="document-title">
            {session ? "Untitled artwork" : "No document"}
            {snap?.dirty && <span className="text-muted-foreground"> · Edited</span>}
          </p>
          <div className="flex-1" />
          <div className="flex items-center gap-0.5" role="group" aria-label="History">
            <IconAction
              label="Undo"
              icon={<Undo2 />}
              shortcut={isMac ? "⌘Z" : "Ctrl+Z"}
              ariaShortcut={`${MOD}+Z`}
              disabled={!snap?.canUndo}
              side="bottom"
              onClick={undo}
            />
            <IconAction
              label="Redo"
              icon={<Redo2 />}
              shortcut={isMac ? "⇧⌘Z" : "Ctrl+Shift+Z"}
              ariaShortcut={`${MOD}+Shift+Z`}
              disabled={!snap?.canRedo}
              side="bottom"
              onClick={redo}
            />
            <IconAction
              label="Keyboard shortcuts"
              icon={<Keyboard />}
              shortcut="?"
              ariaShortcut="Shift+?"
              side="bottom"
              onClick={() => setShortcutsOpen(true)}
            />
          </div>
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
            disabled={tracing !== null}
            onClick={() => fileInput.current?.click()}
          >
            <Upload data-icon="inline-start" /> Import
          </Button>
          <Button
            className="h-8 px-4 font-semibold"
            disabled={!session}
            onClick={() => setExportOpen(true)}
          >
            <Download data-icon="inline-start" /> Export
          </Button>
        </header>

        <div className="flex min-h-0 gap-2 p-2">
          {/* Tool rail */}
          <nav
            aria-label="Tools"
            className="flex w-14 shrink-0 flex-col items-center gap-1.5 rounded-md bg-panel py-2"
          >
            {TOOLS.map((t) => (
              <IconAction
                key={t.id}
                label={t.label}
                icon={<t.icon className="size-5" />}
                shortcut={t.key}
                ariaShortcut={t.key}
                unavailable={t.unavailable}
                pressed={t.unavailable ? undefined : tool === t.id}
                className={tool === t.id ? undefined : "bg-elevated"}
                onClick={() => setTool(t.id)}
              />
            ))}
          </nav>

          <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
            <ResizablePanel id="canvas" minSize={360}>
              <section
                aria-label="Canvas"
                className="flex h-full min-w-0 flex-col overflow-hidden rounded-md bg-canvas-surround"
              >
                <div className="flex h-11 shrink-0 items-center justify-center gap-1 bg-panel">
                  <div role="group" aria-label="View" className="flex gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-pressed="true"
                      className="bg-accent px-3"
                    >
                      Artwork
                    </Button>
                    {["Paths", "Compare"].map((v) => (
                      <Button
                        key={v}
                        variant="ghost"
                        size="sm"
                        aria-disabled="true"
                        aria-label={`${v} view, available with the production renderer`}
                        title={`${v} view: available with the production renderer`}
                        className="px-3 text-muted-foreground"
                      >
                        {v}
                      </Button>
                    ))}
                  </div>
                </div>
                <div
                  className="relative min-h-0 flex-1"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f) void importFile(f);
                  }}
                >
                  <InterimCanvasHost
                    ref={canvas}
                    session={session}
                    selection={selection}
                    onSelect={onSelect}
                    onStateChange={setHostState}
                    onViewChange={setView}
                    renderSvg={renderSvg}
                    label="Artwork canvas"
                    className="absolute inset-0"
                  />
                  {!session && (
                    <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
                      <div className="pointer-events-auto grid max-w-sm justify-items-center gap-3 rounded-lg border border-dashed border-control-border bg-background/40 px-8 py-10 text-center">
                        <Upload className="size-7 text-muted-foreground" aria-hidden="true" />
                        <h2 className="text-base font-semibold">Import an image to start</h2>
                        <p className="text-xs text-muted-foreground">
                          PNG, JPEG or WebP, traced on this device with the{" "}
                          {PRESETS.find((p) => p.id === preset)!.label} preset. Drop a file here or
                          choose one.
                        </p>
                        <Button
                          disabled={tracing !== null}
                          onClick={() => fileInput.current?.click()}
                        >
                          <Upload data-icon="inline-start" /> Choose image…
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex h-10 shrink-0 items-center gap-1 bg-panel px-2 text-xs">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Zoom out"
                    aria-keyshortcuts="-"
                    disabled={!session}
                    onClick={() => canvas.current?.zoomBy(0.8)}
                  >
                    <Minus />
                  </Button>
                  <span className="w-12 text-center tabular-nums" data-testid="zoom">
                    {session && view ? `${Math.round(view.scale * 100)}%` : "—"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Zoom in"
                    aria-keyshortcuts="+"
                    disabled={!session}
                    onClick={() => canvas.current?.zoomBy(1.25)}
                  >
                    <Plus />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Fit artboard"
                    aria-keyshortcuts="Shift+1"
                    disabled={!session}
                    onClick={() => canvas.current?.fitToView()}
                  >
                    <Maximize />
                  </Button>
                  <div className="flex-1" />
                  <span className="text-muted-foreground tabular-nums">
                    {state
                      ? `Artboard ${state.artboard.width} × ${state.artboard.height} px`
                      : "No artboard"}
                  </span>
                </div>
              </section>
            </ResizablePanel>
            <ResizableHandle
              withHandle
              aria-label="Resize inspector"
              className="w-2 bg-transparent [&>div]:bg-control-border"
            />
            <ResizablePanel id="side" defaultSize={320} minSize={288} maxSize={336}>
              <ResizablePanelGroup orientation="vertical">
                <ResizablePanel id="inspector" minSize={160}>
                  <aside
                    aria-label="Inspector"
                    className="flex h-full flex-col overflow-hidden rounded-md bg-panel"
                  >
                    <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                      <activeTool.icon className="size-4 text-primary" aria-hidden="true" />
                      <h2 className="text-sm font-semibold">{activeTool.label}</h2>
                    </div>
                    <ScrollArea className="min-h-0 flex-1">{inspector}</ScrollArea>
                  </aside>
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  aria-label="Resize layers"
                  className="h-2 bg-transparent [&>div]:bg-control-border"
                />
                <ResizablePanel id="layers" defaultSize="40" minSize={120}>
                  <div className="flex h-full flex-col overflow-hidden rounded-md bg-panel">
                    <LayersPanel
                      state={state}
                      selection={selection}
                      onSelect={onSelect}
                      run={run}
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Status bar */}
        <footer className="flex items-center gap-4 border-t border-border bg-panel px-3 text-xs text-muted-foreground">
          <span>RGB · Vector document</span>
          <span className="tabular-nums" data-testid="complexity">
            {totals ? `${totals.paths} paths · ${totals.anchors} anchors` : "No artwork"}
          </span>
          <span
            role="status"
            data-testid="status"
            className={status.error ? "text-destructive" : "text-foreground/85"}
          >
            {status.error ? "Error: " : ""}
            {tracing ? `Tracing ${tracing.name} (${tracing.stage})…` : status.text}
          </span>
          {tracing && (
            <Button
              variant="outline"
              size="xs"
              className="border-control-border"
              onClick={() => jobs.cancel(tracing.jobId)}
            >
              <X data-icon="inline-start" /> Cancel trace
            </Button>
          )}
          <div className="flex-1" />
          <span data-testid="canvas-state">
            Preview: interim SVG host ({hostState.kind}); production renderer pending
          </span>
          <span>{offline ? "Offline ready" : "Offline not ready"}</span>
        </footer>
      </div>

      {session && (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
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
          <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5 text-sm">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <kbd className="rounded border border-control-border px-1.5 py-0.5 text-xs">
                    {k}
                  </kbd>
                </dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function ExportDialog(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (format: "svg" | "pdf", pdf: { width: number; unit: LengthUnit }, name: string) => void;
}) {
  const [format, setFormat] = useState<"svg" | "pdf">("svg");
  const [name, setName] = useState("artwork");
  const [width, setWidth] = useState(200);
  const [unit, setUnit] = useState<LengthUnit>("mm");
  const valid = name.trim() !== "" && (format === "svg" || width > 0);
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export artwork</DialogTitle>
          <DialogDescription>
            Vector paths only, generated on this device by the engine. Nothing is uploaded.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            p.onOpenChange(false);
            p.onExport(format, { width, unit }, name.trim());
          }}
        >
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-xs text-muted-foreground">Format</legend>
            {(["svg", "pdf"] as const).map((f) => (
              <label key={f} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="format"
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className="accent-primary"
                />
                {f === "svg" ? "SVG (editable vector)" : "PDF (vector, physical size)"}
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1 text-xs text-muted-foreground">
            File name
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-sm" />
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
                  className="text-sm"
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
            <Button type="submit" disabled={!valid}>
              Export {format.toUpperCase()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
