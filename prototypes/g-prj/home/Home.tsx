// Project home (empty, populated, recovery), All projects, the pre-open recovery choice and the
// Projects and storage dialog.
import {
  Check,
  ChevronRight,
  File,
  FileX,
  FolderOpen,
  HardDrive,
  History,
  ImageUp,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { Tip } from "../../../src/ui/tip.tsx";
import {
  backingWords,
  fileOf,
  fileSlug,
  mb,
  NEW_PROJECT,
  projects,
  SAFARI,
  STORAGE_FULL,
  storageTotals,
  toOpen,
  type Project,
  type StateName,
} from "./data.ts";
import type { Go } from "./main.tsx";
import {
  Artboard,
  BackingLine,
  Brand,
  ChoiceGroup,
  consequence,
  Confirm,
  Divider,
  note,
  OUTLINE,
  Preview,
  RecoveryDialog,
  RecoveryLine,
  RenameField,
  WORD,
  type Choice,
} from "./parts.tsx";

type Ask = Omit<Parameters<typeof Confirm>[0], "open" | "onOpenChange">;
const SECTION = "text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase";
const EMPTY_ASK: Ask = { title: "", children: null, confirm: "", onConfirm: () => {} };
const names = (xs: Project[]) =>
  xs.length === 1
    ? xs[0]!.name
    : `${xs
        .slice(0, -1)
        .map((x) => x.name)
        .join(", ")} and ${xs.at(-1)!.name}`;

export function Home(p: { state: StateName; go: Go; recovery?: boolean }) {
  const empty = p.state === "empty";
  const withRecovery = p.recovery ?? p.state !== "populated";
  const [list, setList] = useState<Project[]>(() => (empty ? [] : projects(withRecovery)));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState("");
  const [storageOpen, setStorageOpen] = useState(p.state === "storage");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [preOpen, setPreOpen] = useState<{ project: Project; initial?: Choice } | null>(() =>
    p.state === "recovery-other"
      ? { project: projects(true).find((x) => x.id === "poster")! }
      : null,
  );
  const focusAfter = useRef<HTMLElement>(null);
  /** After deleting a project, focus moves to its neighbour (its own menu trigger is gone). */
  const nextFocus = useRef<HTMLElement | null>(null);
  const library = p.state === "library";
  const totals = storageTotals(list);
  const sorted = [...list].sort((a, b) => a.age - b.age);
  const recent = sorted.filter((x) => !hidden.has(x.id));
  const [hero, ...shelf] = recent;
  // Storage speaks only when something is at risk (nearly full, or Safari's 7-day rule).
  const atRisk = STORAGE_FULL || (SAFARI && list.some((x) => x.backing.kind === "browser"));

  /** After a tile disappears, focus the tile that took its place (never the page body). */
  const focusNear = (id: string) => {
    const ids = [...document.querySelectorAll<HTMLElement>("[data-tile-id]")].map(
      (el) => el.dataset.tileId,
    );
    const i = ids.indexOf(id);
    requestAnimationFrame(() => {
      if (document.querySelector(`[data-tile-id="${id}"]`)) return;
      const open = [...document.querySelectorAll<HTMLButtonElement>("[data-tile-id] .tile-open")];
      (open[Math.min(i, open.length - 1)] ?? focusAfter.current)?.focus();
    });
  };
  const openProject = (x: Project, choice?: Choice) => {
    if (!x.recovery) return p.go("workspace", { project: toOpen(x), opened: "plain" });
    if (!choice) return setPreOpen({ project: x });
    if (choice === "recover") p.go("workspace", { project: toOpen(x), opened: "recovered" });
    else p.go("workspace-recovery-kept", { project: toOpen(x), opened: "last" });
  };
  const actions: TileActions = {
    open: (x) => openProject(x),
    recover: (x) => setPreOpen({ project: x, initial: "recover" }),
    locate: (x) => note(`Locate… shows the file picker to choose ${fileOf(x)} again.`),
    rename: (x, name) => {
      setList((l) => l.map((y) => (y.id === x.id ? { ...y, name } : y)));
      setStatus(
        x.backing.kind === "file"
          ? `Renamed to “${name}”. The file is still ${x.backing.file}.`
          : `Renamed to “${name}”.`,
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
        saved: "just now",
        age: 0,
        recovery: undefined,
      };
      setList((l) => [...l, copy]);
      setStatus(`Duplicated as “${copy.name}”, stored in this browser.`);
    },
    download: (x) => setStatus(`Downloaded a copy (${fileOf(x) ?? fileSlug(x.name)}).`),
    remove: (x) => {
      focusNear(x.id);
      setHidden((h) => new Set(h).add(x.id));
      if (!x.stored) setList((l) => l.filter((y) => y.id !== x.id));
      setStatus(
        x.stored
          ? `Removed “${x.name}” from Recent. It is still stored in this browser.`
          : `Removed “${x.name}” from Recent. ${fileOf(x)} stays where it is.`,
      );
    },
    del: (x) => {
      const open = [...document.querySelectorAll<HTMLElement>("[data-tile-id] .tile-open")];
      const i = open.findIndex(
        (el) => el.closest<HTMLElement>("[data-tile-id]")?.dataset.tileId === x.id,
      );
      nextFocus.current =
        x.backing.kind === "file" ? null : (open[i + 1] ?? open[i - 1] ?? focusAfter.current);
      setAsk(deleteAsk(x, setList, setStatus));
    },
  };

  return (
    <div className="home-root flex min-h-full flex-col">
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
          className="ml-auto line-clamp-2 min-w-0 text-right text-xs text-pretty text-foreground/85"
        >
          {status}
        </p>
        {!empty &&
          (atRisk ? (
            <Button
              variant="ghost"
              className="h-8 shrink-0 text-xs text-warning hover:text-warning max-sm:px-2"
              aria-label={`Projects and storage · ${mb(totals.total)} in this browser · ${STORAGE_FULL ? "nearly full" : "at risk in Safari"}`}
              onClick={() => setStorageOpen(true)}
            >
              <TriangleAlert data-icon="inline-start" />
              <span className="max-sm:hidden">
                {STORAGE_FULL
                  ? `Storage nearly full · ${mb(totals.total)}`
                  : "Projects at risk in Safari"}
              </span>
            </Button>
          ) : (
            <Tip
              side="bottom"
              label={`Projects and storage · ${mb(totals.total)} in this browser`}
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Projects and storage · ${mb(totals.total)} in this browser`}
                  onClick={() => setStorageOpen(true)}
                />
              }
            >
              <HardDrive />
            </Tip>
          ))}
        {library && (
          <>
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
        <Library
          list={list}
          actions={actions}
          onSearchEl={(el) => {
            focusAfter.current = el;
          }}
        />
      ) : (
        <main className="w-full px-4 py-4 md:px-8 md:py-6">
          <div className="grid items-start gap-6 min-[56.25rem]:grid-cols-[minmax(0,1fr)_clamp(18rem,30%,26rem)]">
            {hero ? (
              <ResumePanel project={hero} onResume={(c) => openProject(hero, c)} />
            ) : (
              <TraceSheet />
            )}
            {empty ? (
              <section aria-labelledby="start-h" className="flex flex-col">
                <h2 id="start-h" className="text-ui font-semibold">
                  Other ways to start
                </h2>
                <div className="mt-2 grid gap-0.5">
                  <QuietAction
                    icon={Plus}
                    title="New project"
                    desc="Start from an empty artboard."
                    onClick={() => p.go("workspace", { project: NEW_PROJECT, opened: "plain" })}
                  />
                  <QuietAction
                    icon={FolderOpen}
                    title="Open…"
                    desc="Open a .vectra file from this device."
                    onClick={() => note("Open… shows the system file picker for .vectra files.")}
                  />
                </div>
                <p className="mt-4 max-w-[62ch] text-xs text-pretty text-muted-foreground">
                  A .vectra file is a whole Vectra project: the artwork, its layers and palette, in
                  one file you keep and can move to another device. This browser also keeps copies
                  and recovery data on this device; nothing is uploaded.
                </p>
              </section>
            ) : (
              <section aria-labelledby="start-h" className="flex flex-col">
                <h2 id="start-h" className="text-ui font-semibold">
                  Start
                </h2>
                <div className="mt-2.5 grid gap-2">
                  <Action
                    icon={Plus}
                    title="New project"
                    desc="Start from an empty artboard."
                    onClick={() => p.go("workspace", { project: NEW_PROJECT, opened: "plain" })}
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
                <StorageLine list={list} onOpen={() => setStorageOpen(true)} />
              </section>
            )}
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
      <RecoveryDialog
        key={preOpen?.project.id ?? "none"}
        project={preOpen?.project ?? null}
        initial={preOpen?.initial}
        onOpenChange={(o) => !o && setPreOpen(null)}
        onOpen={(c) => preOpen && openProject(preOpen.project, c)}
      />
      <Confirm
        open={!!ask}
        onOpenChange={(o) => !o && setAsk(null)}
        afterConfirm={nextFocus}
        {...(ask ?? EMPTY_ASK)}
      />
    </div>
  );
}

/** Storage speaks only when something is at risk; otherwise one quiet line. */
function StorageLine(p: { list: Project[]; onOpen: () => void }) {
  const onlyHere = p.list.filter((x) => x.backing.kind === "browser");
  const link = (
    <button type="button" className={WORD} onClick={p.onOpen}>
      Projects and storage
    </button>
  );
  if (STORAGE_FULL || (SAFARI && onlyHere.length))
    return (
      <p className="mt-5 flex gap-2 text-xs text-pretty text-warning">
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {STORAGE_FULL
            ? "Browser storage is nearly full: recovery data may stop being saved. Save projects as files, or free space in "
            : `Safari may remove ${names(onlyHere)} after 7 days without use: they have no file copy. Download copies in `}
          {link}.
        </span>
      </p>
    );
  return (
    <p className="mt-5 text-xs text-pretty text-muted-foreground">
      Projects are .vectra files you keep · this browser keeps copies and recovery data · nothing is
      uploaded · {link}
    </p>
  );
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
      <p>{fileOf(x)} on your device is not affected. This cannot be undone.</p>
    ),
    confirm: "Delete",
    destructive: true,
    extra: only ? (
      <Button
        variant="outline"
        className={OUTLINE}
        onClick={() => setStatus(`Downloaded a copy (${fileSlug(x.name)}).`)}
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

/** A secondary way in on first launch: no border, no lime. */
function QuietAction(p: { icon: LucideIcon; title: string; desc: string; onClick: () => void }) {
  const Icon = p.icon;
  return (
    <button
      type="button"
      onClick={p.onClick}
      className="-mx-3 grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-elevated active:translate-y-px active:bg-elevated/70 disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon className="row-span-2 mt-px size-4 text-muted-foreground" aria-hidden="true" />
      <span className="text-ui font-medium">{p.title}</span>
      <span className="text-xs text-muted-foreground">{p.desc}</span>
    </button>
  );
}

/**
 * First launch: tracing is the front door. The approved empty-state sheet (paper as an onboarding
 * surface) is one large Import control and a drop target; the lime label carries the dark ink
 * outline so it holds its edge on paper (DESIGN-SYSTEM §13).
 */
function TraceSheet() {
  const [over, setOver] = useState(false);
  const choose = () => note("Choose an image… shows the file picker for PNG, JPEG or WebP.");
  return (
    <button
      type="button"
      aria-label="Choose an image to trace…"
      aria-describedby="trace-desc"
      onClick={choose}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        note("A dropped image is traced on this device.");
      }}
      className="group grid aspect-[4/3] rounded-sm bg-paper p-4 text-background min-[56.25rem]:aspect-auto min-[56.25rem]:min-h-[max(18rem,var(--art-h))]"
    >
      <span
        className={`grid place-content-center justify-items-center gap-2.5 rounded-xs border border-dashed px-6 text-center transition-colors ${over ? "border-solid border-background bg-background/5" : "border-background/30 group-hover:border-background/60"}`}
      >
        <Upload className="size-6" aria-hidden="true" />
        <span className="text-title font-semibold">Trace an image</span>
        <span id="trace-desc" className="max-w-[24rem] text-xs text-pretty text-ink-muted">
          Drop a PNG, JPEG or WebP here, or choose one. It is traced into vectors on this device;
          nothing is uploaded.
        </span>
        <span className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground ring-1 ring-background transition-colors group-hover:bg-primary/80 group-active:translate-y-px">
          <ImageUp className="size-4" aria-hidden="true" /> Choose an image…
        </span>
      </span>
    </button>
  );
}

function ResumePanel(p: { project: Project; onResume: (choice: Choice) => void }) {
  const x = p.project;
  const rec = x.recovery;
  const file = fileOf(x);
  const [choice, setChoice] = useState<Choice>("recover");
  return (
    <section
      aria-labelledby="resume-name"
      className="@container rounded-lg border border-border bg-panel p-4"
    >
      <div className="grid items-start gap-4 @[30rem]:grid-cols-[minmax(0,1fr)_clamp(15rem,36%,20rem)] @[30rem]:gap-5">
        <Preview project={x} choice={choice} />
        <div className="flex min-w-0 flex-col">
          <h2 id="resume-name" className="text-title font-semibold text-balance">
            {x.name}
          </h2>
          {!rec && <p className="mt-1 text-xs text-muted-foreground">Edited {x.edited}</p>}
          <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
            <File className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {rec ? "Last saved to " : "Saved to "}
              <span className="text-foreground">{file ?? "this browser"}</span>
              {rec && (
                <>
                  {" "}
                  <span className="whitespace-nowrap">{x.saved}</span>
                </>
              )}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">{x.size}</p>
          {/* One top-anchored block: the choice, then the Resume it rewrites. */}
          <div className="mt-4 grid gap-3">
            {rec && (
              <ChoiceGroup id="resume" project={x} choice={choice} onChoice={setChoice} withNote />
            )}
            <div>
              <Button
                className="h-9 w-full font-semibold"
                aria-describedby="resume-consequence"
                onClick={() => p.onResume(choice)}
              >
                Resume
              </Button>
              <p
                id="resume-consequence"
                aria-live="polite"
                className="mt-1.5 text-xs text-pretty text-muted-foreground"
              >
                {consequence(x, choice)}
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
  recover: (x: Project) => void;
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
  const [locating, setLocating] = useState(false);
  const openBtn = useRef<HTMLButtonElement>(null);
  const locateBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (locating) locateBtn.current?.focus();
  }, [locating]);
  const meta = x.recovery ? `Last saved ${x.saved}` : `Edited ${x.edited}`;
  const name = renaming ? (
    <RenameField
      id={`rename-${x.id}`}
      name={x.name}
      file={fileOf(x)}
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
      onClick={() => (x.backing.kind === "unavailable" ? setLocating(true) : p.actions.open(x))}
    >
      {x.name}
    </button>
  );
  // A missing file is offered in place: Locate… or Remove from recent, never a header message.
  const offer = locating && x.backing.kind === "unavailable" && (
    <div
      role="group"
      aria-label={`${x.backing.file} is unavailable`}
      className="relative z-10 mt-1.5 grid gap-1.5 rounded-md bg-elevated p-2 text-xs"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        setLocating(false);
        openBtn.current?.focus();
      }}
    >
      <p className="text-pretty text-muted-foreground">
        {x.backing.file} was moved or renamed, or permission expired.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          ref={locateBtn}
          variant="outline"
          size="xs"
          className="border-control-border"
          onClick={() => p.actions.locate(x)}
        >
          Locate…
        </Button>
        <Button
          variant="outline"
          size="xs"
          className="border-control-border"
          onClick={() => p.actions.remove(x)}
        >
          Remove from recent
        </Button>
      </div>
    </div>
  );
  const thumb = (cls: string) => <Artboard src={x.thumb} className={cls} />;
  const menu = (
    <ProjectMenu
      project={x}
      actions={p.actions}
      onRename={() => setRenaming(true)}
      onLocate={() => setLocating(true)}
    />
  );
  if (p.row)
    return (
      <li
        data-tile-id={x.id}
        className="relative grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-4 rounded-lg px-2 py-2 transition-colors hover:bg-elevated/70 has-[.tile-open:active]:bg-elevated md:grid-cols-[4.5rem_minmax(0,3fr)_minmax(0,3fr)_5rem_auto]"
      >
        {thumb("h-12")}
        <div className="min-w-0">
          <h3 className="text-ui font-medium">{name}</h3>
          <p className="text-xs text-muted-foreground">{meta}</p>
          {offer}
        </div>
        <div id={`state-${x.id}`} className="min-w-0 max-md:hidden">
          <BackingLine project={x} />
          <RecoveryLine project={x} />
        </div>
        <p className="text-right text-xs text-muted-foreground tabular-nums max-md:hidden">
          {x.stored ? mb(x.stored) : "—"}
          <span className="sr-only"> stored in this browser</span>
        </p>
        {menu}
      </li>
    );
  return (
    <li
      data-tile-id={x.id}
      className="relative -m-1.5 rounded-lg p-1.5 transition-colors hover:bg-elevated/70 has-[.tile-open:active]:bg-elevated"
    >
      {thumb("aspect-[16/10]")}
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1">
        <div className="min-w-0">
          <h3 className="text-ui font-medium">{name}</h3>
          <p className="text-xs text-muted-foreground">{meta}</p>
          <div id={`state-${x.id}`} className="mt-0.5">
            <BackingLine project={x} />
            <RecoveryLine project={x} />
          </div>
          {offer}
        </div>
        {menu}
      </div>
    </li>
  );
}

function ProjectMenu(p: {
  project: Project;
  actions: TileActions;
  onRename: () => void;
  onLocate: () => void;
}) {
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
                  Unsaved changes from {x.recovery.when} can be recovered.
                </span>
              )}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {x.backing.kind === "unavailable" ? (
            <DropdownMenuItem onClick={p.onLocate}>Locate…</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => p.actions.open(x)}>Open</DropdownMenuItem>
          )}
          {x.recovery && (
            <DropdownMenuItem onClick={() => p.actions.recover(x)}>
              Recover changes…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={gone} onClick={p.onRename}>
            Rename project
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
            <span className="text-xs text-muted-foreground">The project stays where it is</span>
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
  onSearchEl: (el: HTMLElement | null) => void;
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
          {/* Search appears once the list is long enough to need it (UX spec §5: 7 or more). */}
          {p.list.length >= 7 && (
            <label className="relative">
              <span className="sr-only">Search projects</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                ref={p.onSearchEl}
                type="search"
                placeholder="Search projects"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className={`${FIELD} w-56 pl-7`}
              />
            </label>
          )}
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
      <h2 className="sr-only">Projects</h2>
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
        <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-4 gap-y-5">
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
  const [msg, setMsg] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const done = useRef<HTMLButtonElement>(null);
  const t = storageTotals(p.list);
  const stored = p.list.filter((x) => x.stored);
  const snaps = p.list.filter((x) => x.recovery);
  const onlyHere = p.list.filter((x) => x.backing.kind === "browser");
  const discard = (xs: Project[]): Ask => ({
    title:
      xs.length === 1
        ? `Discard unsaved changes from ${xs[0]!.recovery!.when}?`
        : "Remove all recovery data?",
    children: (
      <p>
        {xs.length === 1
          ? `${xs[0]!.name} will open as last saved${fileOf(xs[0]!) ? ` to ${fileOf(xs[0]!)}` : ""}.`
          : `Deletes the unsaved changes ${xs.map((x) => `from ${x.recovery!.when} (${x.name})`).join(" and ")}. Saved files and projects stored in this browser are not affected.`}{" "}
        This cannot be undone.
      </p>
    ),
    confirm: xs.length === 1 ? "Discard" : "Remove recovery data",
    destructive: true,
    onConfirm: () => {
      const ids = new Set(xs.map((x) => x.id));
      p.setList((l) => l.map((x) => (ids.has(x.id) ? { ...x, recovery: undefined } : x)));
      setMsg(
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
          <DialogDescription className="tabular-nums">
            {mb(t.total)} stored in this browser: projects {mb(t.stored)}, recovery data{" "}
            {mb(t.recovery)}. Nothing is uploaded.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 grid content-start gap-x-8 gap-y-5 overflow-y-auto px-4 text-xs md:grid-cols-2">
          <div className="grid content-start gap-5">
            {STORAGE_FULL && (
              <p className="flex gap-2 text-pretty text-warning">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                Browser storage is nearly full. Recovery data may stop being saved, and projects
                without a file copy are at risk.
              </p>
            )}
            <section className="grid gap-2">
              <h3 className={SECTION}>Where projects live</h3>
              <Fact icon={File}>
                <b className="font-medium text-foreground">Files you save:</b> .vectra files on your
                device, wherever you choose. Vectra never deletes them.
              </Fact>
              <Fact icon={HardDrive}>
                <b className="font-medium text-foreground">This browser:</b> copies of some
                projects, their thumbnails and the recent list.{" "}
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
                        setMsg("Cleared the recent list. No artwork was deleted.");
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
                      setMsg("The browser agreed to keep Vectra’s data.");
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
              {SAFARI && (
                <p className="flex gap-2 text-pretty text-warning">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  Safari may remove projects kept only in this browser after 7 days without use.
                  Download a copy of anything you want to keep.
                </p>
              )}
            </section>
          </div>
          <div className="grid content-start gap-5">
            <section className="grid gap-1.5">
              <h3 className={`${SECTION} flex justify-between`}>
                Projects in this browser <span className="tabular-nums">{mb(t.stored)}</span>
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
                          : "No file copy yet"}
                      </p>
                    </div>
                    <span className="text-muted-foreground tabular-nums">{mb(x.stored!)}</span>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-destructive focus-visible:text-destructive"
                      aria-label={`Delete ${x.name} from this browser`}
                      onClick={() => setAsk(deleteAsk(x, p.setList, setMsg))}
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
          </div>
        </div>
        <DialogFooter className="items-center">
          <p
            role="status"
            aria-live="polite"
            className="min-w-0 text-xs text-pretty text-foreground/85 sm:mr-auto"
          >
            {msg}
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

function Fact(p: { icon: LucideIcon; children: ReactNode }) {
  const Icon = p.icon;
  return (
    <p className="flex gap-2 text-pretty text-muted-foreground">
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{p.children}</span>
    </p>
  );
}
