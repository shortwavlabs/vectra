// Layers panel: root layers (top-most first) with their groups. Every action is a document
// command: visibility, lock, rename, reorder (drag, keyboard drag, Move up/down), duplicate and
// delete. Locked items cannot be moved, renamed, duplicated or deleted. Paths are not listed
// (a trace has thousands; DESIGN-SYSTEM §3): select them on the canvas.
import type { Announcements } from "@dnd-kit/core";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  LockOpen,
  MoreHorizontal,
} from "lucide-react";
import { useState } from "react";
import type { Command } from "../document/commands.ts";
import { type DocState, isContainer, type NodeId } from "../document/model.ts";
import { Button } from "../ui/registry/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/registry/dropdown-menu";
import { Input } from "../ui/registry/input";
import { ScrollArea } from "../ui/registry/scroll-area";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
} from "../ui/registry/sortable";
import { displayName, isLocked, moveCommand, pathCount, stepCommand } from "./document.ts";

export interface LayersPanelProps {
  state: DocState | null;
  selection: readonly NodeId[];
  onSelect: (ids: readonly NodeId[], mode: "replace" | "toggle") => void;
  run: (c: Command | Command[]) => void;
}

export function LayersPanel({ state, selection, onSelect, run }: LayersPanelProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<NodeId>>(new Set());
  const [renaming, setRenaming] = useState<NodeId | null>(null);
  if (!state)
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No document. Imported artwork appears here as layers.
      </p>
    );
  const roots = [...state.orderedRootIds].reverse();
  const name = (id: NodeId) => displayName(state.nodesById.get(id)!, state);
  const position = (id: NodeId) => roots.indexOf(id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${name(String(active.id))}, position ${position(String(active.id))} of ${roots.length}. Use the arrow keys to move, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${name(String(active.id))} is over position ${position(String(over.id))} of ${roots.length}.`
        : `${name(String(active.id))} is not over a position.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${name(String(active.id))} dropped at position ${position(String(over.id))} of ${roots.length}.`
        : `${name(String(active.id))} dropped; order unchanged.`,
    onDragCancel: ({ active }) => `Move cancelled; ${name(String(active.id))} returned.`,
  };

  const selected = selection.length === 1 ? selection[0]! : null;
  const canStep = (step: 1 | -1) =>
    selected !== null &&
    state.nodesById.get(selected)?.kind !== "path" &&
    !isLocked(state, selected) &&
    stepCommand(state, selected, step) !== null;

  const row = (id: NodeId, depth: number, handle: boolean) => {
    const n = state.nodesById.get(id)!;
    const locked = isLocked(state, id);
    const label = name(id);
    const isSel = selection.includes(id);
    const children = isContainer(n)
      ? n.orderedChildIds.filter((c) => state.nodesById.get(c)?.kind === "group")
      : [];
    const open = expanded.has(id);
    return (
      <div
        data-testid="layer-row"
        data-node={id}
        data-selected={isSel || undefined}
        className={`group/row flex h-9 items-center gap-1 rounded-md pr-1 ${isSel ? "bg-primary/15 ring-1 ring-primary/60 ring-inset" : "hover:bg-elevated"}`}
        style={{ paddingLeft: 4 + depth * 16 }}
      >
        {handle ? (
          <SortableItemHandle
            aria-label={`Reorder ${label}`}
            disabled={locked}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <GripVertical className="size-3.5" aria-hidden="true" />
          </SortableItemHandle>
        ) : (
          <span className="size-6" aria-hidden="true" />
        )}
        {children.length > 0 ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
            aria-expanded={open}
            onClick={() => {
              const next = new Set(expanded);
              if (open) next.delete(id);
              else next.add(id);
              setExpanded(next);
            }}
          >
            <ChevronRight className={`transition-transform ${open ? "rotate-90" : ""}`} />
          </Button>
        ) : (
          <span className="size-6" aria-hidden="true" />
        )}
        {renaming === id ? (
          <Input
            autoFocus
            aria-label={`Name of ${label}`}
            defaultValue={n.name}
            className="h-7 flex-1 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = n.name;
                setRenaming(null);
              }
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (v && v !== n.name) run({ type: "rename", id, name: v });
              setRenaming(null);
            }}
          />
        ) : (
          <button
            type="button"
            aria-pressed={isSel}
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left"
            onClick={(e) =>
              onSelect([id], e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "replace")
            }
            onDoubleClick={() => !locked && setRenaming(id)}
            onKeyDown={(e) => {
              if (e.key === "F2" && !locked) setRenaming(id);
            }}
          >
            <span className={`truncate ${n.visible ? "" : "text-muted-foreground line-through"}`}>
              {label}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {n.kind === "source" ? "source" : `${pathCount(state, id)} paths`}
            </span>
          </button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${n.visible ? "Hide" : "Show"} ${label}`}
          onClick={() => run({ type: "setVisible", ids: [id], visible: !n.visible })}
        >
          {n.visible ? <Eye /> : <EyeOff />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${n.locked ? "Unlock" : "Lock"} ${label}`}
          className={n.locked ? "text-warning" : "text-muted-foreground"}
          onClick={() => run({ type: "setLocked", ids: [id], locked: !n.locked })}
        >
          {n.locked ? <Lock /> : <LockOpen />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label={`More actions for ${label}`} />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={locked} onClick={() => setRenaming(id)}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={locked || !stepCommand(state, id, 1)}
              onClick={() => run(stepCommand(state, id, 1)!)}
            >
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={locked || !stepCommand(state, id, -1)}
              onClick={() => run(stepCommand(state, id, -1)!)}
            >
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={locked}
              onClick={() => run({ type: "duplicate", ids: [id] })}
            >
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={locked}
              variant="destructive"
              onClick={() => run({ type: "delete", ids: [id] })}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <section aria-labelledby="layers-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-3">
        <h2 id="layers-heading" className="flex-1 text-sm font-semibold">
          Layers
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={selected ? `Move ${name(selected)} up` : "Move up (select a layer or group)"}
          disabled={!canStep(1)}
          onClick={() => run(stepCommand(state, selected!, 1)!)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={
            selected ? `Move ${name(selected)} down` : "Move down (select a layer or group)"
          }
          disabled={!canStep(-1)}
          onClick={() => run(stepCommand(state, selected!, -1)!)}
        >
          <ArrowDown />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {roots.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">The document has no layers.</p>
        ) : (
          <Sortable
            value={roots}
            onMove={({ activeIndex, overIndex }) => {
              const c = moveCommand(state, roots[activeIndex]!, activeIndex, overIndex);
              if (c) run(c);
            }}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable:
                  "To reorder, press Space or Enter, move with the Up and Down arrow keys, then press Space or Enter to drop, or Escape to cancel.",
              },
            }}
          >
            <SortableContent render={<ul aria-label="Layers" className="grid gap-0.5 p-1.5" />}>
              {roots.map((id) => {
                const n = state.nodesById.get(id)!;
                const groups =
                  isContainer(n) && expanded.has(id)
                    ? [...n.orderedChildIds]
                        .reverse()
                        .filter((c) => state.nodesById.get(c)?.kind === "group")
                    : [];
                return (
                  <SortableItem key={id} value={id} render={<li />}>
                    {row(id, 0, true)}
                    {groups.length > 0 && (
                      <ul aria-label={`Groups in ${name(id)}`} className="grid gap-0.5">
                        {groups.map((g) => (
                          <li key={g}>{row(g, 1, false)}</li>
                        ))}
                      </ul>
                    )}
                  </SortableItem>
                );
              })}
            </SortableContent>
          </Sortable>
        )}
      </ScrollArea>
    </section>
  );
}
