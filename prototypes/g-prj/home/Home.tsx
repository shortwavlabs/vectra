// Project home (empty, populated, recovery), All projects and the Projects and storage dialog.
import {
  Check,
  ChevronRight,
  File,
  FileX,
  FolderOpen,
  HardDrive,
  History,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { FIELD } from "../../../src/ui/numeric-field.tsx";
import { Button } from "../../../src/ui/registry/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../src/ui/registry/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../src/ui/registry/dropdown-menu";
import { Input } from "../../../src/ui/registry/input";
import {
  backingWords,
  fileSlug,
  INDEX_BYTES,
  LAST_SAVED,
  mb,
  projects,
  storageTotals,
  type Project,
  type StateName,
} from "./data.ts";
import {
  BackingLine,
  Brand,
  Confirm,
  Divider,
  note,
  OUTLINE,
  RecoveryLine,
  WORD,
} from "./parts.tsx";
import type { Go } from "./main.tsx";

type Ask = Omit<Parameters<typeof Confirm>[0], "open" | "onOpenChange">;
const SECTION = "text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase";

export function Home(p: { state: StateName; go: Go; recovery?: boolean }) {
  const empty = p.state === "empty";
  const withRecovery = p.recovery ?? p.state !== "populated";
  const [list, setList] = useState<Project[]>(() => (empty ? [] : projects(withRecovery)));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState("");
  const [storageOpen, setStorageOpen] = useState(p.state === "storage");
  const [ask, setAsk] = useState<Ask | null>(null);
  const focusAfter = useRef<HTMLElement>(null);
  const library = p.state === "library";
  const totals = storageTotals(list);
  const sorted = [...list].sort((a, b) => a.age - b.age);
  const recent = sorted.filter((x) => !hidden.has(x.id));
  const [hero, ...shelf] = recent;

  const open = (x: Project) => {
    if (x.backing.kind === "unavailable")
      return setStatus(
        `${x.backing.file} is unavailable: it was moved or renamed, or permission expired. Use Locate file… in its menu.`,
      );
    p.go("workspace", { project: { name: x.name, file: fileOf(x) } });
  };
  const actions: TileActions = {
    open,
    locate: (x) => note(`Locate file… shows the file picker to choose ${fileOf(x)} again.`),
    rename: (x, name) => {
      setList((l) =>
        l.map((y) =>
          y.id !== x.id
            ? y
            : {
                ...y,
                name,
                ...(y.backing.kind === "file" && {
                  backing: { kind: "file" as const, file: fileSlug(name) },
                }),
              },
        ),
      );
      setStatus(
        x.backing.kind === "file"
          ? `Saved as ${fileSlug(name)} (Save As). ${x.backing.file} stays as it is.`
          : `Renamed to “${name}” in this browser.`,
      );
    },
    duplicate: (x) => {
      const copy: Project = {
        ...x,
        id: `${x.id}-${Date.now()}`,
        name: `${x.name} copy`,
        backing: { kind: "browser" },
        stored: x.stored ?? 400_000,
        edited: "just now",
        age: 0,
        recovery: undefined,
      };
      setList((l) => [...l, copy]);
      setStatus(`Duplicated as “${copy.name}”, stored in this browser.`);
    },
    download: (x) => setStatus(`Downloaded a copy (${fileOf(x)}).`),
    remove: (x) => {
      setHidden((h) => new Set(h).add(x.id));
      if (!x.stored) setList((l) => l.filter((y) => y.id !== x.id));
      setStatus(
        x.stored
          ? `Removed “${x.name}” from Recent. It is still stored in this browser.`
          : `Removed “${x.name}” from Recent. ${fileOf(x)} was not deleted.`,
      );
    },
    del: (x) => setAsk(deleteAsk(x, setList, setStatus)),
  };

  // Enter resumes the most recent project when nothing has focus (the page's one primary action).
  useEffect(() => {
    if (!hero || library) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && document.activeElement === document.body)
        document.getElementById("resume")?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hero, library]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-panel px-3">
        <Brand />
        <Divider />
        {library ? (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-ui">
            <button
              type="button"
              className="rounded-sm text-muted-foreground transition-colors hover:text-foreground active:opacity-70"
              onClick={() => p.go(withRecovery ? "recovery" : "populated")}
            >
              Projects
            </button>
            <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <h1 className="truncate">All projects</h1>
          </nav>
        ) : (
          <h1 className="text-ui">Projects</h1>
        )}
        <p
          role="status"
          aria-live="polite"
          title={status || undefined}
          className="ml-auto min-w-0 truncate text-right text-xs text-foreground/85"
        >
          {status}
        </p>
        {!empty && (
          <>
            <Button
              variant="ghost"
              className="h-8 shrink-0 text-xs text-muted-foreground max-sm:px-2"
              aria-label={`Projects and storage: ${mb(totals.total)} in this browser`}
              onClick={() => setStorageOpen(true)}
            >
              <HardDrive data-icon="inline-start" />
              <span className="max-sm:hidden">{mb(totals.total)} in this browser</span>
            </Button>
            <Divider />
            <Button
              variant="outline"
              className={`${OUTLINE} shrink-0`}
              onClick={() => note("Open… shows the system file picker for .vectra files.")}
            >
              <FolderOpen data-icon="inline-start" /> Open…
            </Button>
          </>
        )}
      </header>

      {library ? (
        <Library list={list} actions={actions} searchRef={focusAfter} />
      ) : (
        <main className="w-full px-4 py-4 md:px-8 md:py-6">
          <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {hero ? (
              <ResumePanel
                project={hero}
                onResume={(choice) =>
                  choice === "last"
                    ? p.go("workspace-recovery-kept")
                    : p.go("workspace", {
                        project: { name: hero.name, file: fileOf(hero) },
                        recovered: !!hero.recovery,
                      })
                }
              />
            ) : (
              <DropSheet />
            )}
            <section aria-labelledby="start-h" className="flex flex-col">
              <h2 id="start-h" className="text-ui font-semibold">
                Start
              </h2>
              <div className="mt-2.5 grid gap-2">
                <Action
                  icon={Plus}
                  title="New project"
                  desc="Start from a blank ivory artboard."
                  onClick={() =>
                    p.go("workspace", { project: { name: "Untitled project", file: null } })
                  }
                />
                <Action
                  icon={FolderOpen}
                  title="Open…"
                  desc="Open a .vectra project file from this device."
                  onClick={() => note("Open… shows the system file picker for .vectra files.")}
                />
                <Action
                  icon={Upload}
                  title="Import image…"
                  desc="Trace a PNG, JPEG or WebP into vectors on this device."
                  onClick={() => note("Import image… shows the system file picker for images.")}
                />
              </div>
              {empty ? (
                <p className="mt-auto pt-4 text-xs text-pretty text-muted-foreground">
                  Projects are .vectra files you own. This browser keeps copies and recovery data on
                  this device; nothing is uploaded.
                </p>
              ) : (
                <ul
                  aria-label="Where projects live"
                  className="mt-auto grid gap-1.5 pt-5 text-xs text-pretty text-muted-foreground"
                >
                  <Tier icon={File}>
                    <span className="text-foreground">.vectra files</span> you save, wherever you
                    keep them
                  </Tier>
                  <Tier icon={HardDrive}>
                    <span className="text-foreground">This browser:</span>{" "}
                    {plural(list.filter((x) => x.stored).length, "project")} and the recent list ·{" "}
                    {mb(totals.stored + INDEX_BYTES)}
                  </Tier>
                  <Tier icon={History}>
                    <span className="text-foreground">Recovery data:</span> unsaved changes for{" "}
                    {plural(list.filter((x) => x.recovery).length, "project")} ·{" "}
                    {mb(totals.recovery)} · kept 14 days
                  </Tier>
                  <li className="pl-5.5">
                    Nothing is uploaded.{" "}
                    <button type="button" className={WORD} onClick={() => setStorageOpen(true)}>
                      Projects and storage
                    </button>
                  </li>
                </ul>
              )}
            </section>
          </div>

          <section aria-labelledby="recent-h" className="mt-7">
            <div className="flex h-6 items-center justify-between">
              <h2 id="recent-h" className="text-ui font-semibold">
                Recent
              </h2>
              {list.length > 0 && (
                <button
                  ref={(el) => {
                    focusAfter.current = el;
                  }}
                  type="button"
                  className={`${WORD} flex items-center gap-0.5 text-xs no-underline hover:underline`}
                  onClick={() => p.go("library", { recovery: withRecovery })}
                >
                  Show all projects
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            {shelf.length ? (
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 md:grid-cols-5">
                {shelf.slice(0, 5).map((x) => (
                  <Tile key={x.id} project={x} actions={actions} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {empty
                  ? "Projects you create, open or save appear here, newest first."
                  : "No other recent projects."}
              </p>
            )}
          </section>
        </main>
      )}

      <StorageDialog
        open={storageOpen}
        onOpenChange={setStorageOpen}
        list={list}
        setList={setList}
        recentCount={recent.length}
        clearRecent={() => setHidden(new Set(list.map((x) => x.id)))}
      />
      <Confirm
        open={!!ask}
        onOpenChange={(o) => !o && setAsk(null)}
        afterConfirm={focusAfter}
        {...(ask ?? EMPTY_ASK)}
      />
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const EMPTY_ASK: Ask = { title: "", children: null, confirm: "", onConfirm: () => {} };

function fileOf(x: Project) {
  return x.backing.kind === "browser" ? fileSlug(x.name) : x.backing.file;
}

function deleteAsk(
  x: Project,
  setList: (f: (l: Project[]) => Project[]) => void,
  setStatus: (s: string) => void,
): Ask {
  const only = x.backing.kind !== "file";
  return {
    title: only ? `Delete ${x.name} from this browser?` : `Delete the browser copy of ${x.name}?`,
    children: only ? (
      <p>
        This is the only copy: {x.name} has no file copy. Download a copy first if you may need it.
        This cannot be undone.
      </p>
    ) : (
      <p>
        {x.backing.kind === "file" ? x.backing.file : "The file"} on your device is not affected.
        This cannot be undone.
      </p>
    ),
    confirm: "Delete",
    destructive: true,
    extra: only ? (
      <Button
        variant="outline"
        className={OUTLINE}
        onClick={() => setStatus(`Downloaded a copy (${fileOf(x)}).`)}
      >
        Download a copy
      </Button>
    ) : undefined,
    onConfirm: () => {
      setList((l) =>
        only
          ? l.filter((y) => y.id !== x.id)
          : l.map((y) => (y.id === x.id ? { ...y, stored: undefined } : y)),
      );
      setStatus(
        only
          ? `Deleted “${x.name}” from this browser.`
          : `Deleted the browser copy of “${x.name}”.`,
      );
    },
  };
}

function Action(p: { icon: LucideIcon; title: string; desc: string; onClick: () => void }) {
  const Icon = p.icon;
  return (
    <button
      type="button"
      onClick={p.onClick}
      className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 rounded-lg border border-control-border px-4 py-3 text-left transition-colors hover:bg-elevated active:translate-y-px active:bg-elevated/70 disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon className="row-span-2 mt-px size-4 text-muted-foreground" aria-hidden="true" />
      <span className="text-ui font-semibold">{p.title}</span>
      <span className="mt-0.5 text-xs text-muted-foreground">{p.desc}</span>
    </button>
  );
}

/** First launch: the approved empty-state sheet (paper as an onboarding surface), as a drop target. */
function DropSheet() {
  return (
    <div className="grid aspect-[4/3] rounded-[3px] bg-paper p-4 text-background md:aspect-auto md:min-h-[var(--hero-h)]">
      <div className="grid place-content-center justify-items-center gap-2.5 border border-dashed border-background/30 px-6 text-center">
        <Upload className="size-6" aria-hidden="true" />
        <h2 className="text-lg font-semibold tracking-tight">Drop an image or a .vectra file</h2>
        <p className="max-w-[24rem] text-xs text-pretty text-ink-muted">
          Images are traced into vectors on this device. Project files open as they were saved.
          Nothing is uploaded.
        </p>
      </div>
    </div>
  );
}

function ResumePanel(p: { project: Project; onResume: (choice: "recover" | "last") => void }) {
  const x = p.project;
  const rec = x.recovery;
  const file = fileOf(x);
  const [choice, setChoice] = useState<"recover" | "last">("recover");
  const consequence = !rec
    ? `Opens ${file} as last saved`
    : choice === "recover"
      ? `Opens the recovered changes · save to keep them in ${file}`
      : `Opens ${file} as last saved · your unsaved changes stay available`;
  return (
    <section
      aria-labelledby="resume-name"
      className="@container rounded-lg border border-border bg-panel p-4"
    >
      <div className="grid gap-4 @[30rem]:grid-cols-[minmax(0,1fr)_clamp(15rem,40%,22rem)] @[30rem]:gap-5">
        <div className="relative aspect-[4/3] overflow-hidden rounded-[4px] bg-paper @[30rem]:aspect-auto @[30rem]:min-h-[var(--hero-h)]">
          <img
            src={x.thumb}
            alt={`${x.name}: preview of the ${rec && choice === "recover" ? "recovered changes" : "last save"}`}
            className="absolute inset-0 size-full object-contain"
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <h2 id="resume-name" className="text-title font-semibold text-balance">
            {x.name}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Edited {x.edited}</p>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
            <File className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {rec ? "Last saved to " : "Saved to "}
              <span className="text-foreground">{file}</span>
              {rec && ` ${LAST_SAVED}`}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">{x.size}</p>
          {/* The decision sits together at the foot of the panel: the choice, then the Resume it
              rewrites. */}
          <div className="mt-auto grid gap-3 pt-4">
            {rec && (
              <div
                role="radiogroup"
                aria-labelledby="recovery-note"
                className="rounded-md bg-elevated px-3 pt-2.5 pb-1.5"
              >
                <p id="recovery-note" className="flex gap-2 text-xs text-foreground">
                  <History
                    className="mt-px size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="text-pretty">
                    Unsaved changes from {rec.when} can be recovered. Undo history is not restored.
                  </span>
                </p>
                <div className="mt-1 grid">
                  {(
                    [
                      ["recover", "Recover changes"],
                      ["last", "Open last save"],
                    ] as const
                  ).map(([v, label]) => (
                    <label
                      key={v}
                      className="-mx-1.5 flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 pl-[1.4rem] text-ui transition-colors hover:bg-background/40"
                    >
                      <input
                        type="radio"
                        name="resume-choice"
                        value={v}
                        checked={choice === v}
                        onChange={() => setChoice(v)}
                        className="size-3.5 accent-primary"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Button
                id="resume"
                className="h-9 w-full font-semibold"
                aria-describedby="resume-consequence"
                aria-keyshortcuts="Enter"
                onClick={() => p.onResume(rec ? choice : "last")}
              >
                Resume
              </Button>
              <p
                id="resume-consequence"
                aria-live="polite"
                className="mt-1.5 text-xs text-pretty text-muted-foreground"
              >
                {consequence}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface TileActions {
  open: (x: Project) => void;
  locate: (x: Project) => void;
  rename: (x: Project, name: string) => void;
  duplicate: (x: Project) => void;
  download: (x: Project) => void;
  remove: (x: Project) => void;
  del: (x: Project) => void;
}

/** One project: a stretched open button (the whole tile) and a sibling "…" menu. */
function Tile(p: { project: Project; actions: TileActions; row?: boolean }) {
  const x = p.project;
  const [renaming, setRenaming] = useState(false);
  const openBtn = useRef<HTMLButtonElement>(null);
  const name = renaming ? (
    <RenameField
      project={x}
      onDone={(v) => {
        setRenaming(false);
        if (v) p.actions.rename(x, v);
        requestAnimationFrame(() => openBtn.current?.focus());
      }}
    />
  ) : (
    <button
      ref={openBtn}
      type="button"
      className="tile-open block max-w-full truncate text-left after:absolute after:inset-0 after:rounded-lg"
      aria-describedby={`state-${x.id}`}
      onClick={() => p.actions.open(x)}
    >
      {x.name}
    </button>
  );
  const thumb = (
    <div className="overflow-hidden rounded-[4px] bg-paper">
      <img src={x.thumb} alt="" className="size-full object-contain" />
    </div>
  );
  const menu = <ProjectMenu project={x} actions={p.actions} onRename={() => setRenaming(true)} />;
  if (p.row)
    return (
      <li className="relative grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-4 rounded-lg px-2 py-2 transition-colors hover:bg-elevated/70 has-[.tile-open:active]:bg-elevated md:grid-cols-[4rem_minmax(0,3fr)_minmax(0,3fr)_5rem_auto]">
        <div className="h-10 [&>div]:h-full">{thumb}</div>
        <div className="min-w-0">
          <h3 className="text-ui font-medium">{name}</h3>
          <p className="text-xs text-muted-foreground">Edited {x.edited}</p>
        </div>
        <div id={`state-${x.id}`} className="min-w-0 max-md:hidden">
          <BackingLine project={x} />
          <RecoveryLine project={x} />
        </div>
        <p className="text-right text-xs text-muted-foreground tabular-nums max-md:hidden">
          {x.stored ? mb(x.stored) : "—"}
          <span className="sr-only"> in this browser</span>
        </p>
        {menu}
      </li>
    );
  return (
    <li className="relative -m-1.5 rounded-lg p-1.5 transition-colors hover:bg-elevated/70 has-[.tile-open:active]:bg-elevated">
      <div className="aspect-[16/10] [&>div]:h-full">{thumb}</div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1">
        <div className="min-w-0">
          <h3 className="text-ui font-medium">{name}</h3>
          <p className="text-xs text-muted-foreground">Edited {x.edited}</p>
          <div id={`state-${x.id}`} className="mt-0.5">
            <BackingLine project={x} />
            <RecoveryLine project={x} />
          </div>
        </div>
        {menu}
      </div>
    </li>
  );
}

function RenameField(p: { project: Project; onDone: (name: string | null) => void }) {
  const file = p.project.backing.kind === "file";
  return (
    <span className="relative z-10 grid gap-0.5">
      <Input
        autoFocus
        aria-label={`Name of ${p.project.name}`}
        aria-describedby={file ? `rename-note-${p.project.id}` : undefined}
        defaultValue={p.project.name}
        className={`${FIELD} text-ui md:text-ui`}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = p.project.name;
            p.onDone(null);
          }
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          p.onDone(v && v !== p.project.name ? v : null);
        }}
      />
      {file && (
        <span
          id={`rename-note-${p.project.id}`}
          className="text-xs font-normal text-muted-foreground"
        >
          Saves a renamed copy (Save As)
        </span>
      )}
    </span>
  );
}

function ProjectMenu(p: { project: Project; actions: TileActions; onRename: () => void }) {
  const x = p.project;
  const gone = x.backing.kind === "unavailable" && !x.stored;
  const Icon =
    x.backing.kind === "file" ? File : x.backing.kind === "unavailable" ? FileX : HardDrive;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative z-10 -mr-1 text-muted-foreground hover:text-foreground"
            aria-label={`More actions for ${x.name}`}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex gap-2 py-1.5 font-normal text-muted-foreground">
            <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="grid gap-1 text-pretty">
              <span>{backingWords(x).long}</span>
              {x.recovery && (
                <span className="text-foreground">
                  Unsaved changes from {x.recovery.when} can be recovered when you open it.
                </span>
              )}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {x.backing.kind === "unavailable" ? (
            <DropdownMenuItem onClick={() => p.actions.locate(x)}>Locate file…</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => p.actions.open(x)}>Open</DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={gone} onClick={p.onRename}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={gone} onClick={() => p.actions.duplicate(x)}>
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem disabled={gone} onClick={() => p.actions.download(x)}>
            Download a copy (.vectra)
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="items-start" onClick={() => p.actions.remove(x)}>
          <span className="grid">
            Remove from recent
            <span className="text-xs text-muted-foreground">Does not delete the artwork</span>
          </span>
        </DropdownMenuItem>
        {x.stored !== undefined && (
          <DropdownMenuItem variant="destructive" onClick={() => p.actions.del(x)}>
            Delete from this browser…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Library(p: {
  list: Project[];
  actions: TileActions;
  searchRef: RefObject<HTMLElement | null>;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"edited" | "name">("edited");
  const [view, setView] = useState<"grid" | "list">("grid");
  const shown = p.list
    .filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : a.age - b.age));
  return (
    <main className="w-full px-4 py-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="text-xs text-muted-foreground tabular-nums">
          {p.list.length} {p.list.length === 1 ? "project" : "projects"}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search projects</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={(el) => {
                p.searchRef.current = el;
              }}
              type="search"
              placeholder="Search projects"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={`${FIELD} w-56 pl-7`}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "edited" | "name")}
              className="h-7 rounded-md border border-control-border bg-background px-2 text-xs text-foreground transition-colors hover:bg-elevated"
            >
              <option value="edited">Last edited</option>
              <option value="name">Name</option>
            </select>
          </label>
          <div role="group" aria-label="View" className="flex gap-0.5">
            {(
              [
                ["grid", "Grid", LayoutGrid],
                ["list", "List", List],
              ] as const
            ).map(([v, label, Icon]) => (
              <Button
                key={v}
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={
                  view === v
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-primary/90"
                    : "text-muted-foreground hover:text-foreground"
                }
              >
                <Icon />
              </Button>
            ))}
          </div>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="mt-10 text-center text-xs text-muted-foreground">
          {q ? (
            <>
              No projects match “{q.trim()}”.{" "}
              <button type="button" className={WORD} onClick={() => setQ("")}>
                Clear search
              </button>
            </>
          ) : (
            "No projects yet. Projects you create, open or save appear here."
          )}
        </p>
      ) : view === "grid" ? (
        <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-4 gap-y-5">
          {shown.map((x) => (
            <Tile key={x.id} project={x} actions={p.actions} />
          ))}
        </ul>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {shown.map((x) => (
            <Tile key={x.id} project={x} actions={p.actions} row />
          ))}
        </ul>
      )}
    </main>
  );
}

function StorageDialog(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: Project[];
  setList: (f: (l: Project[]) => Project[]) => void;
  recentCount: number;
  clearRecent: () => void;
}) {
  const [kept, setKept] = useState(false);
  const [note, setNote] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const done = useRef<HTMLButtonElement>(null);
  const t = storageTotals(p.list);
  const stored = p.list.filter((x) => x.stored);
  const snaps = p.list.filter((x) => x.recovery);
  const onlyHere = p.list.filter((x) => x.backing.kind === "browser");
  const names = (xs: Project[]) =>
    xs.length === 1
      ? xs[0]!.name
      : `${xs
          .slice(0, -1)
          .map((x) => x.name)
          .join(", ")} and ${xs.at(-1)!.name}`;
  const discard = (xs: Project[]): Ask => ({
    title:
      xs.length === 1
        ? `Discard unsaved changes from ${xs[0]!.recovery!.when}?`
        : "Remove all recovery data?",
    children: (
      <p>
        {xs.length === 1
          ? `${xs[0]!.name} will open as last saved to ${fileOf(xs[0]!)}.`
          : `Deletes the unsaved changes ${xs.map((x) => `from ${x.recovery!.when} (${x.name})`).join(" and ")}. Saved files and projects stored in this browser are not affected.`}{" "}
        This cannot be undone.
      </p>
    ),
    confirm: xs.length === 1 ? "Discard" : "Remove recovery data",
    destructive: true,
    onConfirm: () => {
      const ids = new Set(xs.map((x) => x.id));
      p.setList((l) => l.map((x) => (ids.has(x.id) ? { ...x, recovery: undefined } : x)));
      setNote(
        xs.length === 1
          ? `Discarded unsaved changes for ${xs[0]!.name}.`
          : "Removed all recovery data.",
      );
    },
  });
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent
        initialFocus={done}
        className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>Projects and storage</DialogTitle>
          <DialogDescription>
            Everything stays on this device. Nothing is uploaded.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 grid content-start gap-x-8 gap-y-5 overflow-y-auto px-4 text-xs md:grid-cols-2">
          <div className="grid content-start gap-5">
            <section className="grid gap-2">
              <h3 className={SECTION}>Where projects live</h3>
              <Fact icon={File}>
                <b className="font-medium text-foreground">Files you save:</b> .vectra files on your
                device, wherever you choose. Vectra never deletes them.
              </Fact>
              <Fact icon={HardDrive}>
                <b className="font-medium text-foreground">This browser:</b> copies of some
                projects, the recent list and thumbnails.{" "}
                <button
                  type="button"
                  className={WORD}
                  disabled={p.recentCount === 0}
                  onClick={() =>
                    setAsk({
                      title: "Clear the recent list?",
                      children: (
                        <p>
                          Removes {p.recentCount} projects from Recent. Files on your device,
                          projects stored in this browser and recovery data are not deleted. You can
                          reopen files with Open….
                        </p>
                      ),
                      confirm: "Clear recent list",
                      destructive: true,
                      onConfirm: () => {
                        p.clearRecent();
                        setNote("Cleared the recent list. No artwork was deleted.");
                      },
                    })
                  }
                >
                  Clear recent list…
                </button>
              </Fact>
              <Fact icon={History}>
                <b className="font-medium text-foreground">Recovery data:</b> unsaved changes, kept
                in case the tab closes or the browser stops. It is never your saved project.
              </Fact>
            </section>
            <section className="grid gap-2">
              <h3 className={SECTION}>Keep data in this browser</h3>
              {kept ? (
                <p className="flex gap-2 text-foreground">
                  <Check className="mt-px size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  Kept. This browser will not clear Vectra’s data on its own.
                </p>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    Best effort: the browser may clear Vectra’s data when the disk is nearly full.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-self-start border-control-border text-xs"
                    onClick={() => {
                      setKept(true);
                      setNote("The browser agreed to keep Vectra’s data.");
                    }}
                  >
                    Keep data in this browser
                  </Button>
                </>
              )}
            </section>
            <section className="grid gap-2">
              <h3 className={SECTION}>If browser data is cleared</h3>
              <p className="text-pretty text-muted-foreground">
                Clearing this site’s data in your browser settings deletes{" "}
                {onlyHere.length ? (
                  <span className="text-foreground">{names(onlyHere)} (no file copy), </span>
                ) : null}
                all recovery data and the recent list. Your .vectra files are not affected.
              </p>
              <p className="flex gap-2 text-pretty text-warning">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                Safari may remove projects kept only in this browser after 7 days without use.
                Download a copy of anything you want to keep.
              </p>
            </section>
          </div>
          <div className="grid content-start gap-5">
            <section className="grid gap-1.5">
              <h3 className={`${SECTION} flex justify-between`}>
                Stored in this browser <span className="tabular-nums">{mb(t.stored)}</span>
              </h3>
              <ul className="divide-y divide-border">
                {stored.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-foreground">{x.name}</p>
                      <p
                        className={
                          x.backing.kind === "file" ? "text-muted-foreground" : "text-warning"
                        }
                      >
                        {x.backing.kind === "file"
                          ? `File copy: ${x.backing.file}`
                          : "No file copy"}
                      </p>
                    </div>
                    <span className="text-muted-foreground tabular-nums">{mb(x.stored!)}</span>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-destructive focus-visible:text-destructive"
                      aria-label={`Delete ${x.name} from this browser`}
                      onClick={() => setAsk(deleteAsk(x, p.setList, setNote))}
                    >
                      Delete…
                    </Button>
                  </li>
                ))}
              </ul>
              {stored.length === 0 && (
                <p className="text-muted-foreground">No projects stored here.</p>
              )}
            </section>
            <section className="grid gap-1.5">
              <h3 className={`${SECTION} flex justify-between`}>
                Recovery data <span className="tabular-nums">{mb(t.recovery)}</span>
              </h3>
              <ul className="divide-y divide-border">
                {snaps.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-foreground">{x.name}</p>
                      <p className="text-muted-foreground">
                        Unsaved changes from {x.recovery!.when} · removed after{" "}
                        {x.recovery!.expires}
                      </p>
                    </div>
                    <span className="text-muted-foreground tabular-nums">
                      {mb(x.recovery!.bytes)}
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-destructive focus-visible:text-destructive"
                      aria-label={`Discard unsaved changes for ${x.name}`}
                      onClick={() => setAsk(discard([x]))}
                    >
                      Discard…
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-pretty text-muted-foreground">
                {snaps.length === 0 && "No recovery data. "}Kept for 14 days after the last change,
                then removed. Opening the last save keeps it.{" "}
                <button
                  type="button"
                  className={WORD}
                  disabled={snaps.length === 0}
                  onClick={() => setAsk(discard(snaps))}
                >
                  Remove recovery data…
                </button>
              </p>
            </section>
            <p className="text-muted-foreground tabular-nums">
              Total in this browser: <span className="text-foreground">{mb(t.total)}</span>{" "}
              (including thumbnails and the recent list).
            </p>
          </div>
        </div>
        <DialogFooter className="items-center">
          <p
            role="status"
            aria-live="polite"
            className="min-w-0 truncate text-xs text-foreground/85 sm:mr-auto"
          >
            {note}
          </p>
          <Button
            ref={done}
            variant="outline"
            className={OUTLINE}
            onClick={() => p.onOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
        <Confirm
          open={!!ask}
          onOpenChange={(o) => !o && setAsk(null)}
          afterConfirm={done}
          {...(ask ?? EMPTY_ASK)}
        />
      </DialogContent>
    </Dialog>
  );
}

function Tier(p: { icon: LucideIcon; children: ReactNode }) {
  const Icon = p.icon;
  return (
    <li className="flex gap-2">
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{p.children}</span>
    </li>
  );
}

function Fact(p: { icon: LucideIcon; children: ReactNode }) {
  const Icon = p.icon;
  return (
    <p className="flex gap-2 text-pretty text-muted-foreground">
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{p.children}</span>
    </p>
  );
}
