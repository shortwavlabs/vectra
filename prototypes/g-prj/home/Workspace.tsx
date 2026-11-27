/// <reference types="vite/client" />
// The workspace with the proposed project controls in the existing 44 px top bar. The body below
// the bar is a COMPOSITE: a screenshot of the real workspace from the production build (the
// multi-layer renderer fixture), with its own top bar cropped off, written by
// scripts/g-prj/capture-mockups.mjs into ./composite/. Only the top bar, its menus, popovers and
// dialogs are prototype code.
import {
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  History,
  Keyboard,
  Redo2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FIELD } from "../../../src/ui/numeric-field.tsx";
import { Button } from "../../../src/ui/registry/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../../../src/ui/registry/dropdown-menu";
import { Input } from "../../../src/ui/registry/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../../../src/ui/registry/popover";
import { Tip } from "../../../src/ui/tip.tsx";
import { fileSlug, GREAT_WAVE_FILE, LAST_SAVED, type StateName } from "./data.ts";
import type { Go, Nav } from "./main.tsx";
import { ariaKey, Brand, Confirm, Divider, key, note, OUTLINE, WORD } from "./parts.tsx";

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
    const [, w, h] = /(\d+)x(\d+)\.png$/.exec(path)!;
    return { w: Number(w), h: Number(h), url };
  });
  return (
    entries.find((e) => e.w === size[0] && e.h + 44 === size[1]) ??
    entries.sort((a, b) => Math.abs(a.w - size[0]) - Math.abs(b.w - size[0]))[0]
  );
}

type Save =
  | { kind: "saved"; text: ReactNode; plain: string }
  | { kind: "dirty"; note?: string }
  | { kind: "new" }
  | { kind: "failed" }
  | { kind: "downloaded" }
  | { kind: "kept" };
type Target = "open" | "new" | "home" | "close";
type Dialog = { kind: "unsaved"; target: Target } | { kind: "history" } | { kind: "conflict" };

const saved = (where: string, when: string, file = true): Save => ({
  kind: "saved",
  plain: `${file ? "Saved to" : "Saved"} ${where} · ${when}`,
  text: (
    <>
      {file ? "Saved to " : "Saved "}
      <span className="text-foreground">{where}</span> · {when}
    </>
  ),
});

function initial(state: StateName, recovered?: boolean, never?: boolean): Save {
  if (never) return { kind: "new" };
  if (recovered) return { kind: "dirty", note: "recovered from 12 min ago" };
  switch (state) {
    case "save-failed":
      return { kind: "failed" };
    case "download-saved":
      return { kind: "downloaded" };
    case "workspace-recovery-kept":
      return { kind: "kept" };
    case "unsaved":
    case "history-budget":
    case "conflict":
      return { kind: "dirty" };
    default:
      return saved(GREAT_WAVE_FILE, "2 min ago");
  }
}

export function WorkspaceProto(p: {
  state: StateName;
  go: Go;
  project?: Nav["project"];
  recovered?: boolean;
}) {
  const body = useBody();
  const downloads = p.state === "download-saved"; // Firefox and Safari: Save is a download
  const [name, setName] = useState(p.project?.name ?? "Great Wave — limited palette");
  const [file, setFile] = useState<string | null>(p.project ? p.project.file : GREAT_WAVE_FILE);
  const [save, setSave] = useState<Save>(() =>
    initial(p.state, p.recovered, p.project?.file === null),
  );
  const [message, setMessage] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [canUndo, setCanUndo] = useState(
    !["workspace-recovery-kept"].includes(p.state) && !p.recovered && p.project?.file !== null,
  );
  const [touched, setTouched] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(() =>
    p.state === "unsaved"
      ? { kind: "unsaved", target: "open" }
      : p.state === "history-budget"
        ? { kind: "history" }
        : p.state === "conflict"
          ? { kind: "conflict" }
          : null,
  );
  const [copied, setCopied] = useState(false);
  const nameBtn = useRef<HTMLButtonElement>(null);
  const short = name.split(" — ")[0]!;
  const dirty = save.kind !== "saved" && save.kind !== "kept";

  const update = (s: Save, msg = "") => {
    setSave(s);
    setMessage(msg);
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
    if (t === "home") return p.go("populated");
    if (t === "new")
      return p.go("workspace", { project: { name: "Untitled project", file: null } });
    if (t === "open") return note("Open… shows the system file picker for .vectra files.");
    note("Close project leaves the empty workspace (today’s empty canvas sheet).");
  };
  const guard = (t: Target) => (dirty ? setDialog({ kind: "unsaved", target: t }) : perform(t));

  // File shortcuts (never in fields, menus or dialogs, like the shell's own handler).
  const live = useRef({ doSave, guard });
  useEffect(() => {
    live.current = { doSave, guard };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = navigator.platform.includes("Mac") ? e.metaKey : e.ctrlKey;
      const t = e.target as HTMLElement;
      if (
        !mod ||
        e.altKey ||
        t.closest("input, textarea, select, [role=dialog], [role=alertdialog], [role=menu]")
      )
        return;
      const k = e.key.toLowerCase();
      if (k === "s" && !e.shiftKey) live.current.doSave();
      else if (k === "s") note("Save As… shows the system save dialog.");
      else if (k === "o") live.current.guard("open");
      else if (k === "n") live.current.guard("new");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid h-full grid-rows-[44px_minmax(0,1fr)] bg-background">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-panel px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Brand />
          <Divider />
          <FileMenu
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
          <div className="relative flex min-w-[8.5rem] shrink items-center">
            {renaming ? (
              <RenameField
                name={name}
                file={file}
                onDone={(v) => {
                  setRenaming(false);
                  requestAnimationFrame(() => nameBtn.current?.focus());
                  if (!v) return;
                  setName(v);
                  if (file) {
                    const f = fileSlug(v);
                    setFile(f);
                    update(saved(f, "just now"), "");
                    note(`Rename of a saved file is Save As: the save dialog suggests ${f}.`);
                  }
                }}
              />
            ) : (
              <Tip
                side="bottom"
                label="Rename project"
                render={
                  <Button
                    ref={nameBtn}
                    variant="ghost"
                    className="h-8 max-w-[18rem] min-w-0 justify-start px-2 text-ui font-normal"
                    aria-label={`Rename project ${name}`}
                    onClick={() => setRenaming(true)}
                  />
                }
              >
                <span className="truncate">{name}</span>
              </Tip>
            )}
          </div>
          <SaveSlot
            key={save.kind}
            save={save}
            message={message}
            shortName={short}
            file={file}
            touched={touched}
            onRetry={() => update(saved(file!, "just now"))}
            onDownload={() =>
              update({ kind: "dirty", note: "copy downloaded" }, `Downloaded a copy (${file})`)
            }
            onMark={() => update(saved(`Downloads as ${file}`, "just now"))}
            onKeep={() => update({ kind: "dirty", note: "copy downloaded" })}
            onRecover={() => {
              if (touched) {
                setName(`${short} (recovered)`);
                setFile(null);
                update({ kind: "new" }, "Opened the recovered changes as a copy");
              } else update({ kind: "dirty", note: "recovered from 12 min ago" });
              setCanUndo(false);
            }}
            onDiscarded={() =>
              update(saved(file!, LAST_SAVED), "Discarded the unsaved changes from 12 min ago")
            }
          />
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
            className={OUTLINE}
            onClick={() => note("Import adds a traced layer, as today.")}
          >
            <Upload data-icon="inline-start" /> Import
          </Button>
          <Button
            className="h-8 px-3.5 font-semibold"
            onClick={() => note("Export opens the existing Export artwork dialog.")}
          >
            <Download data-icon="inline-start" /> Export
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 overflow-hidden bg-canvas-surround">
        {body ? (
          <img
            src={body.url}
            alt="Composite: the current workspace from the production build (multi-layer renderer fixture), below the proposed top bar"
            className="absolute inset-0 size-full object-cover object-left-bottom"
          />
        ) : (
          <p className="p-6 text-xs text-muted-foreground">
            No workspace capture yet: run node scripts/g-prj/capture-mockups.mjs.
          </p>
        )}
      </div>

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
              }[dialog.target]
            : ""
        }?`}
        confirm="Save"
        onConfirm={() => {
          const t = dialog?.kind === "unsaved" ? dialog.target : "open";
          if (doSave()) perform(t);
        }}
        extra={
          <Button
            variant="outline"
            className={OUTLINE}
            onClick={() => {
              const t = dialog?.kind === "unsaved" ? dialog.target : "open";
              setDialog(null);
              perform(t);
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
          <p role="status" className="flex items-center gap-1.5 text-foreground">
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
            className="h-8"
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
          <kbd className="ml-1 rounded bg-background/15 px-1 font-sans text-[11px]">{p.kbd}</kbd>
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
          <DropdownMenuItem aria-keyshortcuts={ariaKey("N")} onClick={() => p.onGuard("new")}>
            New project <DropdownMenuShortcut>{key("N")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem aria-keyshortcuts={ariaKey("O")} onClick={() => p.onGuard("open")}>
            Open… <DropdownMenuShortcut>{key("O")}</DropdownMenuShortcut>
          </DropdownMenuItem>
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
          <DropdownMenuItem onClick={() => p.onGuard("home")}>Project home</DropdownMenuItem>
          <DropdownMenuItem onClick={() => p.onGuard("close")}>Close project</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RenameField(p: { name: string; file: string | null; onDone: (v: string | null) => void }) {
  return (
    <>
      <Input
        autoFocus
        aria-label="Project name"
        aria-describedby={p.file ? "rename-note" : undefined}
        defaultValue={p.name}
        className={`${FIELD} w-[18rem] text-ui md:text-ui`}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = p.name;
            p.onDone(null);
          }
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          p.onDone(v && v !== p.name ? v : null);
        }}
      />
      {p.file && (
        <p
          id="rename-note"
          className="absolute top-full left-0 z-20 mt-1.5 w-[18rem] rounded-md bg-elevated px-2.5 py-1.5 text-xs text-muted-foreground shadow-md ring-1 ring-foreground/10"
        >
          Enter saves a renamed copy (Save As). {p.file} stays as it is.
        </p>
      )}
    </>
  );
}

function SaveSlot(p: {
  save: Save;
  message: string;
  shortName: string;
  file: string | null;
  touched: boolean;
  onRetry: () => void;
  onDownload: () => void;
  onMark: () => void;
  onKeep: () => void;
  onRecover: () => void;
  onDiscarded: () => void;
}) {
  const s = p.save;
  // A save that needs an answer (failed, downloaded) opens its popover without taking focus; the
  // slot is remounted per save kind (key), so this starts fresh each time.
  const [open, setOpen] = useState(s.kind === "failed" || s.kind === "downloaded");
  const [byUser, setByUser] = useState(false);
  const [discard, setDiscard] = useState(false);
  const notNow = useRef<HTMLButtonElement>(null);

  const text =
    p.message ||
    (s.kind === "saved"
      ? s.plain
      : s.kind === "dirty"
        ? `Unsaved changes${s.note ? ` · ${s.note}` : ""}`
        : s.kind === "new"
          ? "Not saved yet"
          : s.kind === "failed"
            ? "Not saved: the last save failed"
            : s.kind === "downloaded"
              ? `Downloaded a copy (${p.file})`
              : "Unsaved changes from 12 min ago are still available");
  // The kept-recovery words lose their tail below 1180 px so the name and Review stay readable.
  const shown =
    s.kind === "kept" && !p.message ? (
      <>
        Unsaved changes from 12 min ago
        <span className="max-[1180px]:hidden"> are still available</span>
      </>
    ) : s.kind === "saved" && !p.message ? (
      s.text
    ) : (
      text
    );

  const word =
    s.kind === "failed" ? "Details" : s.kind === "downloaded" ? "Did it save?" : "Review";
  const pop =
    s.kind === "failed" ? (
      <>
        <PopoverHeader>
          <PopoverTitle>Couldn’t save {p.file}</PopoverTitle>
          <PopoverDescription className="text-xs text-pretty">
            This browser’s permission to change the file has expired. Your changes are still here,
            and recovery data keeps them if the tab closes.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-control-border"
            onClick={p.onDownload}
          >
            Download a copy
          </Button>
          <Button variant="outline" size="sm" className="border-control-border" onClick={p.onRetry}>
            Try again
          </Button>
        </div>
      </>
    ) : s.kind === "downloaded" ? (
      <>
        <PopoverHeader>
          <PopoverTitle>Did the file save to your Downloads?</PopoverTitle>
          <PopoverDescription className="text-xs text-pretty">
            Browsers don’t tell Vectra whether a download finished. Until you confirm, {p.shortName}{" "}
            keeps showing unsaved changes.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" className="border-control-border" onClick={p.onKeep}>
            Keep as unsaved
          </Button>
          <Button variant="outline" size="sm" className="border-control-border" onClick={p.onMark}>
            Mark as saved
          </Button>
        </div>
      </>
    ) : (
      <>
        <PopoverHeader>
          <PopoverTitle>Unsaved changes from 12 min ago</PopoverTitle>
          <PopoverDescription className="grid gap-1.5 text-xs text-pretty">
            <span>
              You opened the last save, so these changes were kept. Undo history is not restored.
            </span>
            <span>
              {p.touched
                ? "You have saved since, so Recover opens them as a copy; neither version overwrites the other."
                : "Recover opens them in place of the last save. Once you edit or save, it opens them as a copy instead."}
            </span>
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" onClick={() => setDiscard(true)}>
            Discard…
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto border-control-border"
            ref={notNow}
            onClick={() => setOpen(false)}
          >
            Not now
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-control-border"
            onClick={p.onRecover}
          >
            Recover
          </Button>
        </div>
      </>
    );
  const control = s.kind === "failed" || s.kind === "downloaded" || s.kind === "kept";
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      {s.kind === "failed" && !p.message && (
        <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
      )}
      {s.kind === "kept" && !p.message && (
        <History className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span
        role="status"
        aria-live="polite"
        title={text}
        className={`min-w-0 truncate ${
          s.kind === "failed" && !p.message
            ? "text-destructive"
            : s.kind === "saved" && !p.message
              ? "text-muted-foreground"
              : "text-foreground/85"
        }`}
      >
        {shown}
      </span>
      {control && (
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            // Opened by the artist: focus moves in and returns to Review on close.
            if (o) setByUser(true);
          }}
        >
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <PopoverTrigger render={<button type="button" className={`${WORD} shrink-0`} />}>
            {word}
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80"
            initialFocus={byUser && (s.kind === "kept" ? notNow : true)}
            finalFocus={byUser}
          >
            {pop}
          </PopoverContent>
        </Popover>
      )}
      <Confirm
        open={discard}
        onOpenChange={setDiscard}
        title="Discard unsaved changes from 12 min ago?"
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
