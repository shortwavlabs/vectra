/// <reference types="vite/client" />
// Small shared pieces for the prototype. The shell's own helpers (BrandMark, Divider) are private
// to src/shell/Workspace.tsx, so their look is copied here, not their code.
import { File, FileX, HardDrive, History } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";
import markUrl from "../../../branding/vectra-symbol-ivory.svg";
import { Button } from "../../../src/ui/registry/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../src/ui/registry/dialog";
import { backingWords, type Project } from "./data.ts";

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
      <span className="text-[15px] font-bold tracking-tight">vectra</span>
    </div>
  );
}

export const Divider = () => <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />;

/** Outline control look of the shell (Import): registry outline + control-border. */
export const OUTLINE = "h-8 border-control-border";
/** A word control: text with an underline, for quiet actions inside a sentence or status. */
export const WORD =
  "rounded-sm text-foreground underline decoration-control-border underline-offset-[3px] transition-colors hover:decoration-foreground active:opacity-70 disabled:pointer-events-none disabled:opacity-50";

export function BackingLine(p: { project: Project; className?: string }) {
  const b = p.project.backing;
  const Icon = b.kind === "file" ? File : b.kind === "unavailable" ? FileX : HardDrive;
  const w = backingWords(p.project).short;
  return (
    <p
      className={`flex min-w-0 items-center gap-1.5 text-xs ${b.kind === "unavailable" ? "text-warning" : "text-muted-foreground"} ${p.className ?? ""}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate" title={backingWords(p.project).long}>
        {b.kind === "file" ? (
          <>
            Saved to <span className="text-foreground">{b.file}</span>
          </>
        ) : (
          w
        )}
      </span>
    </p>
  );
}

export function RecoveryLine(p: { project: Project }) {
  if (!p.project.recovery) return null;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
      <History className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">Recovery available</span>
    </p>
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
            className={p.destructive ? "h-8" : "h-8 font-semibold"}
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
