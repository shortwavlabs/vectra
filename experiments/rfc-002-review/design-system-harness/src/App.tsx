// R05-A disposable harness: one representative shell exercising the proposed component stack.
// Not production UI. Counters are exposed as data-testid text for the Playwright suite.
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Eraser,
  GripVertical,
  Lock,
  Minimize2,
  MousePointer2,
  Palette,
  PenTool,
  ScanLine,
  Spline,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ColorPicker,
  ColorPickerAlphaSlider,
  ColorPickerArea,
  ColorPickerContent,
  ColorPickerFormatSelect,
  ColorPickerHueSlider,
  ColorPickerInput,
  ColorPickerSwatch,
  ColorPickerTrigger,
} from "@/components/ui/color-picker";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemMetadata,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
} from "@/components/ui/sortable";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const TOOLS: { id: string; label: string; key: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "select", label: "Select", key: "v", icon: MousePointer2 },
  { id: "trace", label: "Trace", key: "t", icon: ScanLine },
  { id: "pen", label: "Pen", key: "p", icon: PenTool },
  { id: "smooth", label: "Smooth", key: "s", icon: Spline },
  { id: "simplify", label: "Simplify", key: "m", icon: Minimize2 },
  { id: "cleanup", label: "Cleanup", key: "e", icon: Eraser },
  { id: "recolor", label: "Recolor", key: "r", icon: Palette },
];

type Layer = { id: string; name: string; locked?: boolean };

/** Shortcuts must not fire while typing or while focus is inside a dialog/popup. */
function shortcutBlocked(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return true;
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable || t.closest("input, textarea, select")) return true;
  return Boolean(t.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'));
}

function CanvasPlaceholder() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1, bw: 0, bh: 0 });
  useEffect(() => {
    const canvas = ref.current!;
    const ro = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = entry!.contentRect;
      const bw = Math.round(width * dpr);
      const bh = Math.round(height * dpr);
      canvas.width = bw;
      canvas.height = bh;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#eee8d8";
      const pad = 24 * dpr;
      ctx.fillRect(pad, pad, Math.max(0, bw - 2 * pad), Math.max(0, bh - 2 * pad));
      setSize({ w: Math.round(width), h: Math.round(height), dpr, bw, bh });
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="relative h-full w-full bg-canvas-surround">
      <canvas ref={ref} className="block h-full w-full" aria-label="Artwork canvas placeholder" />
      <output
        data-testid="canvas-size"
        className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground tabular-nums"
      >
        CSS {size.w}×{size.h} px · DPR {size.dpr} · backing {size.bw}×{size.bh}
      </output>
    </div>
  );
}

export function App() {
  const [tool, setTool] = useState("select");
  // Slider/numeric transaction: transient previews vs committed value.
  const [detail, setDetail] = useState(50);
  const [committedDetail, setCommittedDetail] = useState(50);
  const [previews, setPreviews] = useState(0);
  const [commits, setCommits] = useState(0);
  const [numText, setNumText] = useState("50");
  // Colour: preview while open, explicit Apply commits, any other close cancels.
  const [colorOpen, setColorOpen] = useState(false);
  const [color, setColor] = useState("#b9e87b");
  const [committedColor, setCommittedColor] = useState("#b9e87b");
  const [colorPreviews, setColorPreviews] = useState(0);
  const [colorCommits, setColorCommits] = useState(0);
  const [layers, setLayers] = useState<Layer[]>([
    { id: "ink-1", name: "Ink 1" },
    { id: "ink-2", name: "Ink 2" },
    { id: "ink-3", name: "Ink 3" },
    { id: "source", name: "Source", locked: true },
  ]);
  const [moves, setMoves] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("Ready");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e)) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (!t) return;
      setTool(t.id);
      setStatus(`${t.label} tool`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commitDetail = (v: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(v)));
    setDetail(clamped);
    setCommittedDetail(clamped);
    setNumText(String(clamped));
    setCommits((c) => c + 1);
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <span className="font-semibold tracking-tight text-primary">Vectra</span>
          <span className="text-xs text-muted-foreground">R05-A harness</span>
          <div className="ml-auto flex items-center gap-2">
            <Popover>
              <PopoverTrigger render={<Button variant="outline" size="sm" />}>View options</PopoverTrigger>
              <PopoverContent className="w-56" data-testid="view-popover">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" defaultChecked className="accent-primary" /> Show paper
                </label>
              </PopoverContent>
            </Popover>
            <Dialog>
              <DialogTrigger render={<Button size="sm" />}>Export…</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Export</DialogTitle>
                  <DialogDescription>Harness dialog: focus trap, Escape and focus return.</DialogDescription>
                </DialogHeader>
                <label className="grid gap-1 text-sm">
                  File name
                  <Input defaultValue="artwork.svg" data-testid="export-name" />
                </label>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                  <DialogClose render={<Button />}>Export</DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav aria-label="Tools" className="flex w-13 shrink-0 flex-col items-center gap-1 border-r bg-panel py-2">
            {TOOLS.map((t) => (
              <Tooltip key={t.id}>
                <TooltipTrigger
                  render={
                    <Button
                      variant={tool === t.id ? "default" : "ghost"}
                      size="icon"
                      aria-label={t.label}
                      aria-pressed={tool === t.id}
                      aria-keyshortcuts={t.key.toUpperCase()}
                      data-testid={`tool-${t.id}`}
                      onClick={() => {
                        setTool(t.id);
                        setStatus(`${t.label} tool`);
                      }}
                    />
                  }
                >
                  <t.icon className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">
                  {t.label} <kbd className="ml-1 text-[10px] uppercase opacity-70">{t.key}</kbd>
                </TooltipContent>
              </Tooltip>
            ))}
          </nav>

          <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
            <ResizablePanel id="canvas" minSize="240px">
              <CanvasPlaceholder />
            </ResizablePanel>
            <ResizableHandle withHandle aria-label="Resize inspector" data-testid="resize-handle" />
            <ResizablePanel id="inspector" defaultSize="320px" minSize="288px" maxSize="480px">
              <aside aria-label="Inspector" className="flex h-full flex-col gap-4 overflow-y-auto bg-panel p-3 text-sm">
                <section className="grid gap-2">
                  <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Detail</h2>
                  <div className="flex items-center gap-3">
                    <Slider
                      aria-label="Detail"
                      value={[detail]}
                      min={0}
                      max={100}
                      onValueChange={(v) => {
                        const n = Array.isArray(v) ? v[0]! : (v as number);
                        setDetail(n);
                        setNumText(String(n));
                        setPreviews((p) => p + 1);
                      }}
                      onValueCommitted={(v) => commitDetail(Array.isArray(v) ? v[0]! : (v as number))}
                      data-testid="detail-slider"
                    />
                    <Input
                      aria-label="Detail value"
                      inputMode="numeric"
                      type="number"
                      min={0}
                      max={100}
                      className="w-16 tabular-nums"
                      value={numText}
                      onChange={(e) => setNumText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitDetail(Number(numText));
                        if (e.key === "Escape") setNumText(String(committedDetail));
                      }}
                      onBlur={() => {
                        const n = Number(numText);
                        if (numText.trim() !== "" && Number.isFinite(n) && n !== committedDetail) commitDetail(n);
                        else setNumText(String(committedDetail));
                      }}
                      data-testid="detail-input"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    previews <span data-testid="previews">{previews}</span> · commits{" "}
                    <span data-testid="commits">{commits}</span> · committed{" "}
                    <span data-testid="committed">{committedDetail}</span>
                  </p>
                </section>

                <section className="grid gap-2">
                  <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Ink colour</h2>
                  <ColorPicker
                    value={color}
                    open={colorOpen}
                    onOpenChange={(open) => {
                      if (!open) setColor(committedColor); // close without Apply = cancel
                      setColorOpen(open);
                    }}
                    onValueChange={(v) => {
                      setColor(v);
                      setColorPreviews((p) => p + 1);
                    }}
                  >
                    <ColorPickerTrigger
                      render={<Button variant="outline" className="justify-start gap-2" data-testid="color-trigger" />}
                    >
                      <ColorPickerSwatch className="size-4" />
                      <span className="font-mono">{committedColor}</span>
                    </ColorPickerTrigger>
                    <ColorPickerContent data-testid="color-content">
                      <ColorPickerArea data-testid="color-area" />
                      <ColorPickerHueSlider aria-label="Hue" />
                      <ColorPickerAlphaSlider aria-label="Alpha" />
                      <div className="flex gap-2">
                        <ColorPickerFormatSelect />
                        <ColorPickerInput />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setColorOpen(false)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          data-testid="color-apply"
                          onClick={() => {
                            setCommittedColor(color);
                            setColorCommits((c) => c + 1);
                            setColorOpen(false);
                          }}
                        >
                          Apply
                        </Button>
                      </div>
                    </ColorPickerContent>
                  </ColorPicker>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    previews <span data-testid="color-previews">{colorPreviews}</span> · commits{" "}
                    <span data-testid="color-commits">{colorCommits}</span> · committed{" "}
                    <span data-testid="color-committed">{committedColor}</span>
                  </p>
                </section>

                <section className="grid gap-2">
                  <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Layers <span className="normal-case">(moves <span data-testid="moves">{moves}</span>)</span>
                  </h2>
                  <ScrollArea className="h-40 rounded-md border">
                    <Sortable
                      value={layers}
                      getItemValue={(l) => l.id}
                      onMove={({ activeIndex, overIndex }) => {
                        // One atomic domain command per move; the locked source layer stays last.
                        if (layers[overIndex]?.locked) return;
                        setLayers((ls) => {
                          const next = [...ls];
                          const [item] = next.splice(activeIndex, 1);
                          next.splice(overIndex, 0, item!);
                          return next;
                        });
                        setMoves((m) => m + 1);
                      }}
                    >
                      <SortableContent render={<ul aria-label="Layers" data-testid="layers" className="grid gap-1 p-1" />}>
                        {layers.map((l) => (
                          <SortableItem
                            key={l.id}
                            value={l.id}
                            disabled={l.locked}
                            render={<li className="flex items-center gap-2 rounded bg-elevated px-2 py-1.5" />}
                          >
                            <SortableItemHandle
                              aria-label={`Reorder ${l.name}`}
                              className="rounded p-0.5 text-muted-foreground"
                              data-testid={`handle-${l.id}`}
                            >
                              {l.locked ? <Lock className="size-4" /> : <GripVertical className="size-4" />}
                            </SortableItemHandle>
                            <span data-testid="layer-name">{l.name}</span>
                          </SortableItem>
                        ))}
                      </SortableContent>
                    </Sortable>
                  </ScrollArea>
                </section>

                <section className="grid gap-2">
                  <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Import</h2>
                  <FileUpload
                    value={files}
                    onValueChange={setFiles}
                    accept="image/png,image/jpeg,image/webp"
                    maxFiles={1}
                    maxSize={20 * 1024 * 1024}
                    label="Import image"
                  >
                    <FileUploadDropzone className="grid place-items-center gap-1 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      <Upload className="size-4" />
                      Drop an image or
                      <FileUploadTrigger render={<Button variant="outline" size="sm" data-testid="file-trigger" />}>
                        Choose file
                      </FileUploadTrigger>
                    </FileUploadDropzone>
                    <FileUploadList>
                      {files.map((f) => (
                        <FileUploadItem key={f.name} value={f} className="rounded border p-2" data-testid="file-item">
                          <FileUploadItemMetadata />
                        </FileUploadItem>
                      ))}
                    </FileUploadList>
                  </FileUpload>
                </section>
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
          <span>
            Tool: <span data-testid="active-tool">{tool}</span>
          </span>
          <span role="status" aria-live="polite" data-testid="status">
            {status}
          </span>
        </footer>
      </div>
    </TooltipProvider>
  );
}
