/// <reference types="vite/client" />
// The workspace with the proposed project controls in the existing 44 px top bar. The body below
// the bar is a COMPOSITE of a different fixture: a screenshot of the real workspace from the
// production build showing the multi-layer renderer fixture (not Great Wave), with its own top bar
// cropped off, written by scripts/g-prj/capture-mockups.mjs into ./composite/. Only the top bar,
// its menus, popovers and dialogs are prototype code.
import {
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  History,
  Keyboard,
  Redo2,
  Save as SaveIcon,
  Undo2,
  Upload,
} from "lucide-react";
import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "../../../src/ui/registry/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../src/ui/registry/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../../../src/ui/registry/popover";
import { Tip } from "../../../src/ui/tip.tsx";
import {
  fileSlug,
  GREAT_WAVE,
  GREAT_WAVE_FILE,
  LAST_SAVED,
  NEW_PROJECT,
  projects,
  toOpen,
  type OpenProject,
  type Project,
  type StateName,
} from "./data.ts";
import type { Go, Nav } from "./main.tsx";
import {
  ariaKey,
  Brand,
  Confirm,
  DESTRUCTIVE,
  Divider,
  key,
  note,
  OUTLINE,
  RecoveryDialog,
  RenameField,
  WORD,
} from "./parts.tsx";

const bodies = import.meta.glob("./composite/workspace-*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** The composite body for this window: the exact capture size, else the nearest width. */
function useBody() {
  const [size, setSize] = useState(() => [innerWidth, innerHeight] as const);
  useEffect(() => {
    const on = () => setSize([innerWidth, innerHeight]);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const entries = Object.entries(bodies).map(([path, url]) => {
    const [, w, h] = /(\d+)x(\d+)(?:@2x)?\.png$/.exec(path)!;
    return { w: Number(w), h: Number(h), url };
  });
  return (
    entries.find((e) => e.w === size[0] && e.h + 44 === size[1]) ??
    entries.sort((a, b) => Math.abs(a.w - size[0]) - Math.abs(b.w - size[0]))[0]
  );
}

type Save =
  | { kind: "saved"; where: string; when: string; inFile: boolean }
  | { kind: "dirty"; note?: string }
  | { kind: "new" }
  | { kind: "failed" }
  | { kind: "downloaded" }
  | { kind: "kept"; when: string };
type Verb = "open" | "new" | "home" | "close" | "library" | "recent";
type Target = { verb: Verb; project?: Project };
type Dialog = { kind: "unsaved"; target: Target } | { kind: "history" } | { kind: "conflict" };

const saved = (where: string, when: string, inFile = true): Save => ({
  kind: "saved",
  where,
  when,
  inFile,
});

/** The Great Wave defaults for the states that do not come from opening a project. */
function defaults(state: StateName): OpenProject {
  return {
    name: GREAT_WAVE,
    file: GREAT_WAVE_FILE,
    where: "file",
    saved: state === "workspace" ? "2 min ago" : LAST_SAVED,
    recoveryWhen: "12 min ago",
  };
}

/** The opened project's own words: name, file and state (never another project's). */
function initial(state: StateName, pj: OpenProject, opened?: Nav["opened"]): Save {
  if (opened === "recovered") return { kind: "dirty", note: `recovered from ${pj.recoveryWhen}` };
  if (opened === "last" || state === "workspace-recovery-kept")
    return { kind: "kept", when: pj.recoveryWhen ?? "12 min ago" };
  if (opened === "plain" || state === "workspace") {
    if (pj.where === "none") return { kind: "new" };
    if (pj.where === "browser") return saved("in this browser", pj.saved, false);
    return saved(pj.file!, pj.saved);
  }
  if (state === "save-failed") return { kind: "failed" };
  if (state === "download-saved") return { kind: "downloaded" };
  return { kind: "dirty" };
}

export function WorkspaceProto(p: {
  state: StateName;
  go: Go;
  project?: OpenProject;
  opened?: Nav["opened"];
}) {
  const body = useBody();
  const start = p.project ?? defaults(p.state);
  const downloads = p.state === "download-saved"; // Firefox and Safari: Save is a download
  const [name, setName] = useState(start.name);
  const [file, setFile] = useState(start.file);
  const [save, setSave] = useState<Save>(() => initial(p.state, start, p.opened));
  const [message, setMessage] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [canUndo, setCanUndo] = useState(
    !["workspace-recovery-kept"].includes(p.state) && p.opened === undefined,
  );
  const [touched, setTouched] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(() =>
    p.state === "unsaved"
      ? { kind: "unsaved", target: { verb: "open" } }
      : p.state === "history-budget"
        ? { kind: "history" }
        : p.state === "conflict"
          ? { kind: "conflict" }
          : null,
  );
  const [preOpen, setPreOpen] = useState<Project | null>(null);
  const [copied, setCopied] = useState(false);
  const nameBtn = useRef<HTMLButtonElement>(null);
  const statusBox = useRef<HTMLDivElement>(null);
  const short = name.split(" — ")[0]!;
  const dirty = save.kind !== "saved" && save.kind !== "kept";
  const recoveryWhen = save.kind === "kept" ? save.when : (start.recoveryWhen ?? "12 min ago");

  /** After a status action, focus stays in the status area (its control, else the area itself). */
  const focusStatus = () =>
    requestAnimationFrame(() =>
      (statusBox.current?.querySelector<HTMLElement>("button") ?? statusBox.current)?.focus(),
    );
  const update = (s: Save, msg = "", focus = false) => {
    setSave(s);
    setMessage(msg);
    if (focus) focusStatus();
  };
  const doSave = (): boolean => {
    setTouched(true);
    if (!file) {
      const f = fileSlug(name);
      note(`Save shows the system save dialog first; this prototype saves as ${f}.`);
      setFile(f);
      update(saved(f, "just now"));
      return true;
    }
    if (downloads) {
      update({ kind: "downloaded" });
      return false;
    }
    update(saved(file, "just now"));
    return true;
  };
  const perform = (t: Target) => {
    if (t.verb === "home" || t.verb === "close")
      return p.go(save.kind === "kept" && name === GREAT_WAVE ? "recovery" : "populated");
    if (t.verb === "library") return p.go("library", { recovery: true });
    if (t.verb === "new") return p.go("workspace", { project: NEW_PROJECT, opened: "plain" });
    if (t.verb === "recent" && t.project) {
      if (t.project.recovery) return setPreOpen(t.project);
      return p.go("workspace", { project: toOpen(t.project), opened: "plain" });
    }
    note("Open… shows the system file picker for .vectra files.");
  };
  const guard = (t: Target) => (dirty ? setDialog({ kind: "unsaved", target: t }) : perform(t));

  // File shortcuts (UX spec §9): Save everywhere in the workspace; Save As, Open and F2 (rename)
  // not in fields; nothing in dialogs or menus. Mod+N is the browser's and is never taken.
  const live = useRef({ doSave, guard });
  useEffect(() => {
    live.current = { doSave, guard };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[role=dialog], [role=alertdialog], [role=menu]")) return;
      const field = !!t.closest("input, textarea, select, [contenteditable]");
      const mod = navigator.platform.includes("Mac") ? e.metaKey : e.ctrlKey;
      const k = e.key.toLowerCase();
      if (e.key === "F2" && !field) setRenaming(true);
      else if (!mod || e.altKey) return;
      else if (k === "s" && !e.shiftKey) live.current.doSave();
      else if (k === "s" && !field) note("Save As… shows the system save dialog.");
      else if (k === "o" && !field) live.current.guard({ verb: "open" });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Status priority: the status shows in full when it fits beside the name (kept at 8 rem);
  // otherwise it collapses to a labelled button whose popover holds the full words.
  const left = useRef<HTMLDivElement>(null);
  const fixed = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const check = () => {
      if (!left.current || !fixed.current || !measure.current) return;
      const avail = left.current.clientWidth - fixed.current.offsetWidth - 20 - 128;
      setCompact(measure.current.offsetWidth > avail);
    };
    const ro = new ResizeObserver(check);
    if (left.current) ro.observe(left.current);
    if (measure.current) ro.observe(measure.current);
    check();
    return () => ro.disconnect();
  }, []);

  const status = {
    save,
    message,
    file,
    short,
    recoveryWhen,
  };

  return (
    <div className="grid h-full grid-rows-[44px_minmax(0,1fr)] bg-background">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-panel px-3">
        <div ref={left} className="relative flex min-w-0 items-center gap-2.5">
          <div ref={fixed} className="flex shrink-0 items-center gap-2.5">
            <Brand />
            <Divider />
            <FileMenu
              current={name}
              downloads={downloads}
              canSave={dirty || !file}
              onSave={doSave}
              onSaveAs={() => note("Save As… shows the system save dialog.")}
              onDownload={() => setMessage(`Downloaded a copy (${file ?? fileSlug(name)})`)}
              onBrowser={() => {
                setTouched(true);
                update(saved("in this browser", "just now", false));
              }}
              onExport={() => note("Export SVG / PDF… opens the existing Export artwork dialog.")}
              onGuard={guard}
            />
          </div>
          <div className="relative flex min-w-[4rem] shrink items-center">
            {renaming ? (
              <RenameField
                id="project-rename"
                name={name}
                file={file}
                float
                className="w-[18rem] max-w-full"
                onDone={(v) => {
                  setRenaming(false);
                  requestAnimationFrame(() => nameBtn.current?.focus());
                  if (!v) return;
                  setName(v);
                  if (file) setMessage(`Renamed to “${v}”; the file is still ${file}`);
                }}
              />
            ) : (
              <Tip
                side="bottom"
                label={
                  <>
                    Rename project
                    <kbd className="ml-1 rounded bg-background/15 px-1 font-sans text-2xs">F2</kbd>
                  </>
                }
                render={
                  <Button
                    ref={nameBtn}
                    variant="ghost"
                    className="h-8 max-w-[18rem] min-w-0 shrink justify-start px-2 text-ui font-normal max-md:max-w-[8rem]"
                    aria-label={`Rename project ${name}`}
                    aria-keyshortcuts="F2"
                    onClick={() => setRenaming(true)}
                  />
                }
              >
                <span className="truncate">{name}</span>
              </Tip>
            )}
          </div>
          <StatusArea
            ref={statusBox}
            {...status}
            compact={compact}
            touched={touched}
            onSave={() => {
              doSave();
              focusStatus();
            }}
            onRetry={() => update(saved(file!, "just now"), "", true)}
            onSaveAs={() => note("Save As… shows the system save dialog.")}
            onDownload={() =>
              update(
                { kind: "dirty", note: "copy downloaded" },
                `Downloaded a copy (${file})`,
                true,
              )
            }
            onMark={() => update(saved(`Downloads as ${file}`, "just now"), "", true)}
            onKeep={() => update({ kind: "dirty", note: "copy downloaded" }, "", true)}
            onRecover={() => {
              if (touched) {
                setName(`${short} (recovered)`);
                setFile(null);
                update({ kind: "new" }, "Opened the recovered changes as a copy", true);
              } else update({ kind: "dirty", note: `recovered from ${recoveryWhen}` }, "", true);
              setCanUndo(false);
            }}
            onDiscarded={() =>
              update(
                saved(file!, start.saved),
                `Discarded the unsaved changes from ${recoveryWhen}`,
                true,
              )
            }
          />
          {/* An invisible copy of the full status, measured to decide whether it fits. */}
          <div
            ref={measure}
            aria-hidden="true"
            inert
            className="pointer-events-none invisible absolute top-0 left-0 flex items-center gap-1.5 text-xs whitespace-nowrap"
          >
            <FullStatus {...status} control={<span>{controlWord(save)}</span>} />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center" role="group" aria-label="History">
            <Icon label="Undo" kbd={key("Z")} aria={ariaKey("Z")} disabled={!canUndo}>
              <Undo2 />
            </Icon>
            <Icon label="Redo" kbd={key("Z", true)} aria={ariaKey("Z", true)} disabled>
              <Redo2 />
            </Icon>
            <Icon label="Keyboard shortcuts" kbd="?" aria="Shift+?">
              <Keyboard />
            </Icon>
          </div>
          <Divider />
          <Button
            variant="outline"
            className={`${OUTLINE} max-md:px-2`}
            onClick={() => note("Import adds a traced layer, as today.")}
          >
            <Upload data-icon="inline-start" /> <span className="max-md:sr-only">Import</span>
          </Button>
          <Button
            className="h-8 px-3.5 font-semibold max-md:px-2.5"
            onClick={() => note("Export opens the existing Export artwork dialog.")}
          >
            <Download data-icon="inline-start" /> Export
          </Button>
        </div>
      </header>

      <main className="relative min-h-0 overflow-hidden bg-canvas-surround">
        <h1 className="sr-only">{name}</h1>
        {body ? (
          <img
            src={body.url}
            alt="Composite: the current workspace from the production build, showing a different fixture (the multi-layer renderer fixture), below the proposed top bar"
            className="absolute inset-0 size-full object-cover object-left-bottom"
          />
        ) : (
          <p className="p-6 text-xs text-muted-foreground">
            No workspace capture yet: run node scripts/g-prj/capture-mockups.mjs.
          </p>
        )}
      </main>

      <Confirm
        open={dialog?.kind === "unsaved"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Save changes to ${short} before ${
          dialog?.kind === "unsaved"
            ? {
                open: "opening another project",
                new: "starting a new project",
                home: "going to Project home",
                close: "closing it",
                library: "going to All projects",
                recent: `opening ${dialog.target.project?.name ?? "another project"}`,
              }[dialog.target.verb]
            : ""
        }?`}
        confirm="Save"
        onConfirm={() => {
          if (dialog?.kind === "unsaved" && doSave()) perform(dialog.target);
        }}
        extra={
          <Button
            variant="outline"
            className={OUTLINE}
            onClick={() => {
              setDialog(null);
              if (dialog?.kind === "unsaved") perform(dialog.target);
            }}
          >
            Don’t save
          </Button>
        }
      >
        <p>
          {file
            ? `Your changes since the last save to ${file} are discarded if you don’t save.`
            : `${short} has never been saved. If you don’t save, it is discarded.`}
        </p>
      </Confirm>

      <Confirm
        open={dialog?.kind === "history"}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
        title="This edit can’t be kept in undo history"
        confirm="Continue without undo"
        destructive
        onConfirm={() => {
          setCanUndo(false);
          update({ kind: "dirty" }, "Deleted “Waves” without undo; undo and redo history cleared");
        }}
        extra={
          <Button
            variant="outline"
            className={OUTLINE}
            disabled={copied}
            onClick={() => {
              setCopied(true);
              setMessage(`Downloaded a copy (${file ?? fileSlug(name)})`);
            }}
          >
            {copied ? (
              <>
                <Check data-icon="inline-start" /> Copy downloaded
              </>
            ) : (
              "Save a copy first"
            )}
          </Button>
        }
      >
        <p>
          Deleting the layer “Waves” (482,116 paths) needs more memory than undo history allows.
        </p>
        <p className="text-foreground">
          If you continue, the edit is applied and the existing undo and redo history is cleared.
          This cannot be undone.
        </p>
        {copied && (
          <p className="flex items-center gap-1.5 text-foreground">
            <Check className="size-3.5 text-primary" aria-hidden="true" />
            Downloaded a copy ({file ?? fileSlug(name)}).
          </p>
        )}
      </Confirm>

      <Confirm
        open={dialog?.kind === "conflict"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`${file ?? "The file"} changed on disk since you opened it`}
        confirm="Save As…"
        onConfirm={() => note("Save As… shows the system save dialog; both versions are kept.")}
        extra={
          <Button
            variant="destructive"
            className={`h-8 ${DESTRUCTIVE}`}
            onClick={() => {
              setDialog(null);
              update(saved(file!, "just now"));
            }}
          >
            Overwrite
          </Button>
        }
      >
        <p>
          Another app or browser tab saved it at 14:31. Overwrite replaces that version with yours;
          Save As keeps both.
        </p>
      </Confirm>

      <RecoveryDialog
        key={preOpen?.id ?? "none"}
        project={preOpen}
        onOpenChange={(o) => !o && setPreOpen(null)}
        onOpen={(c) => {
          if (!preOpen) return;
          if (c === "recover") p.go("workspace", { project: toOpen(preOpen), opened: "recovered" });
          else p.go("workspace-recovery-kept", { project: toOpen(preOpen), opened: "last" });
        }}
      />
    </div>
  );
}

function Icon(p: {
  label: string;
  kbd: string;
  aria: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tip
      side="bottom"
      label={
        <>
          {p.label}
          <kbd className="ml-1 rounded bg-background/15 px-1 font-sans text-2xs">{p.kbd}</kbd>
        </>
      }
      render={
        <Button
          variant="ghost"
          size="icon"
          aria-label={p.label}
          aria-keyshortcuts={p.aria}
          aria-disabled={p.disabled ? true : undefined}
          className={
            p.disabled
              ? "text-muted-foreground opacity-40 hover:bg-transparent hover:text-muted-foreground"
              : "text-muted-foreground hover:text-foreground"
          }
        />
      }
    >
      {p.children}
    </Tip>
  );
}

function FileMenu(p: {
  current: string;
  downloads: boolean;
  canSave: boolean;
  onSave: () => void;
  onSaveAs: () => void;
  onDownload: () => void;
  onBrowser: () => void;
  onExport: () => void;
  onGuard: (t: Target) => void;
}) {
  const sub = (main: string, hint: string) => (
    <span className="grid">
      {main}
      <span className="text-xs text-muted-foreground">{hint}</span>
    </span>
  );
  const recent = projects(true)
    .filter((x) => x.name !== p.current && x.backing.kind !== "unavailable")
    .slice(0, 5);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="h-8 shrink-0 gap-1 px-2 text-ui font-normal" />}
      >
        File
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          {/* No shortcut: Mod+N belongs to the browser (UX spec §9). */}
          <DropdownMenuItem onClick={() => p.onGuard({ verb: "new" })}>
            New project
          </DropdownMenuItem>
          <DropdownMenuItem
            aria-keyshortcuts={ariaKey("O")}
            onClick={() => p.onGuard({ verb: "open" })}
          >
            Open… <DropdownMenuShortcut>{key("O")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Open recent</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {recent.map((x) => (
                <DropdownMenuItem
                  key={x.id}
                  className="items-start"
                  onClick={() => p.onGuard({ verb: "recent", project: x })}
                >
                  {x.recovery ? sub(x.name, `Recovery available · ${x.recovery.when}`) : x.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => p.onGuard({ verb: "library" })}>
                Show all projects
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Save the project (.vectra)</DropdownMenuLabel>
          <DropdownMenuItem
            className="items-start"
            disabled={!p.canSave}
            aria-keyshortcuts={ariaKey("S")}
            onClick={p.onSave}
          >
            {p.downloads ? sub("Save", "Downloads a new copy each time") : "Save"}
            <DropdownMenuShortcut>{key("S")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem aria-keyshortcuts={ariaKey("S", true)} onClick={p.onSaveAs}>
            Save As… <DropdownMenuShortcut>{key("S", true)}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={p.onDownload}>
            {sub("Download a copy", "A .vectra file in your Downloads")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={p.onBrowser}>
            {sub("Save to this browser", "Keeps a copy here, not a file")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Export artwork</DropdownMenuLabel>
          <DropdownMenuItem onClick={p.onExport}>
            {sub("Export SVG / PDF…", "For other apps; does not save the project")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => p.onGuard({ verb: "home" })}>
            Project home
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => p.onGuard({ verb: "close" })}>
            {sub("Close project", "Returns to Project home")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface StatusWords {
  save: Save;
  message: string;
  file: string | null;
  short: string;
  recoveryWhen: string;
}

/** The status as one sentence (the live region, the compact popover, tooltips). */
function sentence(s: StatusWords): string {
  if (s.message) return s.message;
  const v = s.save;
  switch (v.kind) {
    case "saved":
      return `${v.inFile ? "Saved to" : "Saved"} ${v.where} · ${v.when}`;
    case "dirty":
      return `Unsaved changes${v.note ? ` · ${v.note}` : ""}`;
    case "new":
      return "Not saved yet";
    case "failed":
      return `Couldn’t save ${s.file}: this browser’s permission to change the file expired`;
    case "downloaded":
      return `Downloaded a copy (${s.file}); not yet confirmed as saved`;
    case "kept":
      return `Recovery from ${v.when} kept`;
  }
}

const controlWord = (v: Save) =>
  ({
    saved: "",
    dirty: "Save",
    new: "Save…",
    failed: "Details",
    downloaded: "Did it save?",
    kept: "Review",
  })[v.kind];

/** The full status: a noun-first phrase and its one control. Visual only (aria-hidden text). */
function FullStatus(p: StatusWords & { control: ReactNode }) {
  const v = p.save;
  const tone =
    v.kind === "failed"
      ? "text-destructive"
      : v.kind === "saved" && !p.message
        ? "text-muted-foreground"
        : "text-foreground/85";
  return (
    <>
      {v.kind === "failed" && !p.message && (
        <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
      )}
      {v.kind === "kept" && !p.message && (
        <History className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span aria-hidden="true" className={`whitespace-nowrap ${tone}`}>
        {p.message ? (
          p.message
        ) : v.kind === "saved" ? (
          <>
            {v.inFile ? "Saved to " : "Saved "}
            <span className="text-foreground">{v.where}</span> · {v.when}
          </>
        ) : v.kind === "failed" ? (
          `Couldn’t save ${p.file}`
        ) : v.kind === "downloaded" ? (
          `Downloaded a copy (${p.file})`
        ) : (
          sentence({ ...p, message: "" })
        )}
      </span>
      {controlWord(v) && (
        <>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          {p.control}
        </>
      )}
    </>
  );
}

function StatusArea({
  ref,
  ...p
}: StatusWords & {
  ref: RefObject<HTMLDivElement | null>;
  compact: boolean;
  touched: boolean;
  onSave: () => void;
  onRetry: () => void;
  onSaveAs: () => void;
  onDownload: () => void;
  onMark: () => void;
  onKeep: () => void;
  onRecover: () => void;
  onDiscarded: () => void;
}) {
  const v = p.save;
  const [open, setOpen] = useState(false);
  const [discard, setDiscard] = useState(false);
  const notNow = useRef<HTMLButtonElement>(null);
  const words = sentence(p);
  // An action that changes the status may remove its own trigger: focus then returns to the
  // status area's new control, else the area itself (never the page body).
  const acted = useRef(false);
  const close = (then: () => void) => () => {
    acted.current = true;
    setOpen(false);
    then();
  };
  const sm = "border-control-border";
  const pop =
    v.kind === "failed" ? (
      <>
        <PopoverHeader>
          <PopoverTitle>Couldn’t save {p.file}</PopoverTitle>
          <PopoverDescription className="text-xs text-pretty">
            This browser’s permission to change the file has expired. Your changes are still here,
            and recovery data keeps them if the tab closes. Try again asks the browser for
            permission again.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" className={sm} onClick={close(p.onSaveAs)}>
            Save As…
          </Button>
          <Button variant="outline" size="sm" className={sm} onClick={close(p.onDownload)}>
            Download a copy
          </Button>
          <Button variant="outline" size="sm" className={sm} onClick={close(p.onRetry)}>
            Try again
          </Button>
        </div>
      </>
    ) : v.kind === "downloaded" ? (
      <>
        <PopoverHeader>
          <PopoverTitle>Did the file save to your Downloads?</PopoverTitle>
          <PopoverDescription className="text-xs text-pretty">
            Browsers don’t tell Vectra whether a download finished. Until you confirm, {p.short}{" "}
            keeps showing unsaved changes.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" className={sm} onClick={close(p.onKeep)}>
            Keep as unsaved
          </Button>
          <Button variant="outline" size="sm" className={sm} onClick={close(p.onMark)}>
            Mark as saved
          </Button>
        </div>
      </>
    ) : v.kind === "kept" ? (
      <>
        <PopoverHeader>
          <PopoverTitle>Recovery from {v.when} kept</PopoverTitle>
          <PopoverDescription className="grid gap-1.5 text-xs text-pretty">
            <span>
              You opened the last save, so the unsaved changes from {v.when} were kept. Undo history
              is not restored.
            </span>
            <span>
              {p.touched
                ? "You have saved since, so Recover opens them as a copy; neither version overwrites the other."
                : "Recover opens them in place of the last save. Once you edit or save, it opens them as a copy instead."}
            </span>
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            className={DESTRUCTIVE}
            onClick={() => setDiscard(true)}
          >
            Discard…
          </Button>
          <Button
            ref={notNow}
            variant="outline"
            size="sm"
            className={`ml-auto ${sm}`}
            onClick={() => setOpen(false)}
          >
            Not now
          </Button>
          <Button variant="outline" size="sm" className={sm} onClick={close(p.onRecover)}>
            Recover
          </Button>
        </div>
      </>
    ) : (
      <p className="text-xs">{words}</p>
    );

  // The control: a word control in full, a labelled button when compact. Dirty and new states
  // save directly; the others open the popover above.
  const saves = v.kind === "dirty" || v.kind === "new";
  const compactLabel = {
    saved: ["Saved", Check, "Saved, details"],
    dirty: ["Save", SaveIcon, "Save, unsaved changes"],
    new: ["Save…", SaveIcon, "Save…, not saved yet"],
    failed: ["Not saved", CircleAlert, "Not saved, details"],
    downloaded: ["Did it save?", Download, "Did it save? Downloaded a copy"],
    kept: ["Recovery kept", History, "Recovery kept, review"],
  } as const;
  const [label, CIcon, aria] = compactLabel[v.kind];
  const kids = p.compact ? (
    <>
      <CIcon className="size-3.5" aria-hidden="true" />
      {label}
    </>
  ) : (
    controlWord(v)
  );
  const el: ReactElement<{ children?: ReactNode }> = p.compact ? (
    <Button
      variant="ghost"
      size="sm"
      aria-label={aria}
      aria-keyshortcuts={saves ? ariaKey("S") : undefined}
      onClick={saves ? p.onSave : undefined}
      className={`h-7 shrink-0 gap-1.5 px-2 text-xs ${v.kind === "failed" ? "text-destructive hover:text-destructive" : "text-foreground/85"}`}
    />
  ) : (
    <button
      type="button"
      className={`${WORD} shrink-0`}
      aria-keyshortcuts={saves ? ariaKey("S") : undefined}
      onClick={saves ? p.onSave : undefined}
    />
  );
  const trigger = saves ? (
    cloneElement(el, undefined, kids)
  ) : (
    <PopoverTrigger render={el}>{kids}</PopoverTrigger>
  );
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-sm text-xs"
    >
      {/* One persistent live region (and one for failures), whatever the width or state. */}
      <span role="status" aria-live="polite" className="sr-only">
        {v.kind === "failed" && !p.message ? "" : words}
      </span>
      <span role="alert" className="sr-only">
        {v.kind === "failed" && !p.message ? words : ""}
      </span>
      {saves ? (
        p.compact ? (
          trigger
        ) : (
          <FullStatus {...p} control={trigger} />
        )
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          {p.compact ? (
            trigger
          ) : (
            <FullStatus {...p} control={v.kind === "saved" ? null : trigger} />
          )}
          <PopoverContent
            align="start"
            className={`${v.kind === "failed" ? "w-96" : "w-80"} max-w-[calc(100vw-1.5rem)]`}
            initialFocus={v.kind === "kept" ? notNow : true}
            finalFocus={() => {
              if (!acted.current) return true;
              acted.current = false;
              return ref.current?.querySelector<HTMLElement>("button") ?? ref.current ?? true;
            }}
          >
            {pop}
          </PopoverContent>
        </Popover>
      )}
      <Confirm
        open={discard}
        onOpenChange={setDiscard}
        title={`Discard unsaved changes from ${p.recoveryWhen}?`}
        confirm="Discard"
        destructive
        onConfirm={() => {
          setOpen(false);
          p.onDiscarded();
        }}
      >
        <p>
          They are deleted from this browser. {p.file ?? "The saved project"} is not affected. This
          cannot be undone.
        </p>
      </Confirm>
    </div>
  );
}
