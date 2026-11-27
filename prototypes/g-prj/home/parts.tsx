/// <reference types="vite/client" />
// Shared pieces for the prototype. The shell's own helpers (BrandMark, Divider) are private to
// src/shell/Workspace.tsx, so their look is copied here, not their code.
import { File, FileX, HardDrive, History } from "lucide-react";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import markUrl from "../../../branding/vectra-symbol-ivory.svg";
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
import { Input } from "../../../src/ui/registry/input";
import { backingWords, fileOf, type Project } from "./data.ts";

/** A prototype limitation, shown in the state switcher (hidden in captures), never as product status. */
export const note = (text: string) =>
  window.dispatchEvent(new CustomEvent("proto-note", { detail: text }));

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const key = (k: string, shift = false) =>
  isMac ? `${shift ? "⇧" : ""}⌘${k}` : `Ctrl+${shift ? "Shift+" : ""}${k}`;
export const ariaKey = (k: string, shift = false) =>
  `${isMac ? "Meta" : "Control"}+${shift ? "Shift+" : ""}${k}`;

/** The approved symbol (ivory + lime master file, used as supplied) beside the system-font name. */
export function Brand() {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <img src={markUrl} alt="" className="h-6 w-8" />
      <span className="text-title font-bold tracking-tight">vectra</span>
    </div>
  );
}

export const Divider = () => <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />;

/** Outline control look of the shell (Import): registry outline + control-border. */
export const OUTLINE = "h-8 border-control-border";
/** Destructive buttons: the registry tint is below 4.5:1 (TD-UI-008); home.css owns a lighter one. */
export const DESTRUCTIVE = "vx-destructive";
/** A word control: text with an underline, for quiet actions inside a sentence or status. */
export const WORD =
  "rounded-sm text-foreground underline decoration-control-border underline-offset-[3px] transition-colors hover:decoration-foreground active:opacity-70 disabled:pointer-events-none disabled:opacity-50";

export function BackingLine(p: { project: Project }) {
  const b = p.project.backing;
  const Icon = b.kind === "file" ? File : b.kind === "unavailable" ? FileX : HardDrive;
  return (
    <p
      className={`flex min-w-0 items-center gap-1.5 text-xs ${b.kind === "file" ? "text-muted-foreground" : "text-warning"}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate" title={backingWords(p.project).long}>
        {b.kind === "file" ? (
          <>
            Saved to <span className="text-foreground">{b.file}</span>
          </>
        ) : (
          backingWords(p.project).short
        )}
      </span>
    </p>
  );
}

export function RecoveryLine(p: { project: Project }) {
  const r = p.project.recovery;
  if (!r) return null;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
      <History className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">Recovery available</span>
    </p>
  );
}

/** Inline rename. A saved file keeps its name: renaming changes the title in Vectra only. */
export function RenameField(p: {
  id: string;
  name: string;
  file: string | null;
  onDone: (name: string | null) => void;
  /** Float the note below the field (the top bar) instead of flowing it (a tile). */
  float?: boolean;
  className?: string;
}) {
  return (
    <span className={`relative z-10 grid gap-1 ${p.className ?? ""}`}>
      <Input
        autoFocus
        aria-label="Project name"
        aria-describedby={p.file ? `${p.id}-note` : undefined}
        defaultValue={p.name}
        className={`${FIELD} text-ui md:text-ui`}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
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
        <span
          id={`${p.id}-note`}
          className={
            p.float
              ? "absolute top-full left-0 mt-1.5 w-[18rem] rounded-md bg-elevated px-2.5 py-1.5 text-xs font-normal text-pretty text-muted-foreground shadow-md ring-1 ring-foreground/10"
              : "text-xs font-normal text-pretty text-muted-foreground"
          }
        >
          Renames the project in Vectra; {p.file} keeps its name. Save As… gives a new file name.
        </span>
      )}
    </span>
  );
}

/**
 * A confirmation (alert dialog): Cancel is the default focus and the safe choice; the confirming
 * action is never lime when it destroys something.
 */
export function Confirm(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirm: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Extra actions, placed first (left) in the footer. */
  extra?: ReactNode;
  /** Where focus goes after confirming, when the confirmation removed its own trigger. */
  afterConfirm?: RefObject<HTMLElement | null>;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent
        role="alertdialog"
        className="sm:max-w-md"
        showCloseButton={false}
        initialFocus={cancel}
        finalFocus={() => {
          const after = confirmed.current && p.afterConfirm?.current;
          confirmed.current = false;
          return after || true;
        }}
      >
        <DialogHeader>
          <DialogTitle className="leading-snug">{p.title}</DialogTitle>
          <DialogDescription render={<div />} className="grid gap-2">
            {p.children}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {p.extra}
          <Button
            ref={cancel}
            variant="outline"
            className={`${OUTLINE} sm:ml-auto`}
            onClick={() => p.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant={p.destructive ? "destructive" : "default"}
            className={p.destructive ? `h-8 ${DESTRUCTIVE}` : "h-8 font-semibold"}
            onClick={() => {
              confirmed.current = true;
              p.onOpenChange(false);
              p.onConfirm();
            }}
          >
            {p.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --- The recovery choice (the signature interaction), shared by the resume panel and the
       pre-open dialog for any other project with recovery data. --------------------------- */

export type Choice = "recover" | "last";

export function consequence(x: Project, choice: Choice): string {
  const file = fileOf(x);
  if (!x.recovery)
    return file ? `Opens ${file} as last saved` : "Opens it as last saved in this browser";
  return choice === "recover"
    ? "Opens your recovered changes (unsaved)"
    : `Opens ${file ?? "the last save"} as last saved · your unsaved changes stay available`;
}

/** The artwork preview: it shows the version the choice opens, and says which in its caption. */
export function Preview(p: { project: Project; choice: Choice; className?: string }) {
  const x = p.project;
  const r = x.recovery;
  const recovered = !!r && p.choice === "recover";
  const caption = r ? (recovered ? `Recovered changes · ${r.when}` : `Last save · ${x.saved}`) : "";
  return (
    <figure className={`flex min-w-0 flex-col gap-1.5 ${p.className ?? ""}`}>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-sm bg-paper">
        <img
          src={recovered ? r.thumb : x.thumb}
          alt={`${x.name}: ${recovered ? `the recovered changes from ${r.when}` : `as last saved${r ? `, ${x.saved}` : ""}`}`}
          className="absolute inset-0 size-full object-contain"
        />
      </div>
      {r && (
        <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {recovered ? (
            <History className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <File className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export function ChoiceGroup(p: {
  id: string;
  project: Project;
  choice: Choice;
  onChoice: (c: Choice) => void;
  /** Show the recovery sentence (the dialog says it in its description instead). */
  withNote?: boolean;
}) {
  const r = p.project.recovery!;
  return (
    <div
      role="radiogroup"
      aria-labelledby={p.withNote ? `${p.id}-note` : undefined}
      aria-label={p.withNote ? undefined : "Open"}
      className="rounded-md bg-elevated px-3 pt-2.5 pb-1.5"
    >
      {p.withNote && (
        <p id={`${p.id}-note`} className="flex gap-2 text-xs text-foreground">
          <History className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-pretty">
            Unsaved changes from {r.when} can be recovered. Undo history is not restored.
          </span>
        </p>
      )}
      <div className={p.withNote ? "mt-1 grid" : "-mt-1 grid"}>
        {(
          [
            ["recover", "Recover changes"],
            ["last", "Open last save"],
          ] as const
        ).map(([v, label]) => (
          <label
            key={v}
            className={`-mx-1.5 flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 text-ui transition-colors hover:bg-background/40 ${p.withNote ? "pl-[1.4rem]" : ""}`}
          >
            <input
              type="radio"
              name={`${p.id}-choice`}
              value={v}
              checked={p.choice === v}
              onChange={() => p.onChoice(v)}
              className="size-3.5 accent-primary"
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Opening any project that has recovery data goes through the same choice first. */
export function RecoveryDialog(p: {
  project: Project | null;
  initial?: Choice;
  onOpenChange: (open: boolean) => void;
  onOpen: (choice: Choice) => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const [choice, setChoice] = useState<Choice>(p.initial ?? "recover");
  const x = p.project;
  return (
    <Dialog open={!!x} onOpenChange={p.onOpenChange}>
      {x?.recovery && (
        <DialogContent initialFocus={cancel} showCloseButton={false} className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Open {x.name}</DialogTitle>
            <DialogDescription className="text-xs">
              Unsaved changes from {x.recovery.when} can be recovered. Undo history is not restored.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <Preview
              project={x}
              choice={choice}
              className="aspect-[4/3] sm:aspect-auto sm:min-h-48"
            />
            <div className="grid content-start gap-2 text-xs">
              <p className="text-muted-foreground">
                Last saved {x.saved} to{" "}
                <span className="text-foreground">{fileOf(x) ?? "this browser"}</span>
              </p>
              <ChoiceGroup id="pre-open" project={x} choice={choice} onChoice={setChoice} />
              <p id="pre-open-consequence" aria-live="polite" className="text-muted-foreground">
                {consequence(x, choice)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              ref={cancel}
              variant="outline"
              className={OUTLINE}
              onClick={() => p.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="h-8 font-semibold"
              aria-describedby="pre-open-consequence"
              onClick={() => p.onOpen(choice)}
            >
              Open
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
