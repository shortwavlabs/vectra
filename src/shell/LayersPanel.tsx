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
  Layers,
  Lock,
  LockOpen,
  MoreHorizontal,
} from "lucide-react";
import { useState } from "react";
import { type Command, parents } from "../document/commands.ts";
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
import { Tip } from "../ui/tip.tsx";
import { displayName, isLocked, moveCommand, pathCount, stepCommand } from "./document.ts";

export interface LayersPanelProps {
  state: DocState | null;
  selection: readonly NodeId[];
  onSelect: (ids: readonly NodeId[], mode: "replace" | "toggle") => void;
  run: (c: Command | Command[]) => void;
  /** Whether the panel is expanded (it collapses to its header only on request). */
  open: boolean;
  onToggle: () => void;
}

const HEADER = "flex h-9 shrink-0 items-center gap-1.5 border-b border-border pr-1.5 pl-3";

export function LayersPanel({ state, selection, onSelect, run, open, onToggle }: LayersPanelProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<NodeId>>(new Set());
  const [renaming, setRenaming] = useState<NodeId | null>(null);
  // The disclosure: the panel title is the collapse/expand control (a constant name; the state
  // is aria-expanded). Collapsed, the body is hidden, so no row keeps a Tab stop.
  const title = (
    <h2 id="layers-heading" className="text-ui font-semibold">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="layers-body"
        onClick={onToggle}
        className="-ml-1.5 flex items-center gap-1 rounded px-1.5 py-1 hover:bg-elevated"
      >
        <ChevronRight
          className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
        Layers
      </button>
    </h2>
  );
  if (!state)
    return (
      <section aria-labelledby="layers-heading" className="flex min-h-0 flex-1 flex-col">
        <div className={HEADER}>{title}</div>
        <div
          id="layers-body"
          hidden={!open}
          className="grid flex-1 content-center justify-items-center gap-2 px-6 pb-6 text-center"
        >
          <Layers className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-pretty text-muted-foreground">
            No document yet. Imported artwork appears here as layers.
          </p>
        </div>
      </section>
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

  // Move up/down act on one selected layer, group or source (paths are not listed here).
  const one = selection.length === 1 ? selection[0]! : null;
  const selected = one !== null && state.nodesById.get(one)?.kind !== "path" ? one : null;
  const canStep = (step: 1 | -1) =>
    selected !== null && !isLocked(state, selected) && stepCommand(state, selected, step) !== null;

  // Rows that contain a selected path (paths are not listed): marked so the selection has a place.
  const par = parents(state);
  const holdsSelection = new Set<NodeId>();
  for (const id of selection)
    for (let p = par.get(id) ?? null; p !== null; p = par.get(p) ?? null) holdsSelection.add(p);

  const row = (id: NodeId, depth: number, handle: boolean) => {
    const n = state.nodesById.get(id)!;
    const locked = isLocked(state, id);
    const label = name(id);
    const isSel = selection.includes(id);
    const holds = !isSel && holdsSelection.has(id);
    const count = pathCount(state, id);
    const meta = [
      holds && "Contains selection",
      !n.visible && "Hidden",
      n.kind === "source"
        ? "Source image"
        : `${n.kind === "group" ? "Group · " : ""}${count.toLocaleString("en")} ${count === 1 ? "path" : "paths"}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const children = isContainer(n)
      ? n.orderedChildIds.filter((c) => state.nodesById.get(c)?.kind === "group")
      : [];
    const open = expanded.has(id);
    return (
      <div
        data-testid="layer-row"
        data-node={id}
        data-selected={isSel || undefined}
        data-holds-selection={holds || undefined}
        className={`group/row flex h-10 items-center gap-0.5 rounded-md pr-1 ${isSel ? "bg-primary/15 ring-1 ring-primary/60 ring-inset" : holds ? "bg-primary/5 ring-1 ring-primary/25 ring-inset hover:bg-elevated" : "hover:bg-elevated"}`}
        style={{ paddingLeft: 2 + depth * 14 }}
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
            className="h-7 flex-1 rounded-md bg-background text-xs md:text-xs dark:bg-background"
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
            className="grid min-w-0 flex-1 gap-px rounded px-1.5 py-1 text-left"
            onClick={(e) =>
              onSelect([id], e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "replace")
            }
            onDoubleClick={() => !locked && setRenaming(id)}
            onKeyDown={(e) => {
              if (e.key === "F2" && !locked) setRenaming(id);
            }}
          >
            <span
              title={label}
              className={`truncate text-ui leading-4 ${n.visible ? "" : "text-muted-foreground line-through"}`}
            >
              {label}
            </span>
            <span className="truncate text-2xs leading-3.5 text-muted-foreground tabular-nums">
              {meta}
            </span>
          </button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${n.visible ? "Hide" : "Show"} ${label}`}
          className={n.visible ? "text-muted-foreground" : "text-foreground"}
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
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                aria-label={`More actions for ${label}`}
              />
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
      <div className={HEADER}>
        {title}
        <span className="flex-1 text-2xs text-muted-foreground tabular-nums">{roots.length}</span>
        <Tip
          label="Move up"
          side="bottom"
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                selected ? `Move ${name(selected)} up` : "Move up (select a layer or group)"
              }
              disabled={!canStep(1)}
              onClick={() => run(stepCommand(state, selected!, 1)!)}
            />
          }
        >
          <ArrowUp />
        </Tip>
        <Tip
          label="Move down"
          side="bottom"
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                selected ? `Move ${name(selected)} down` : "Move down (select a layer or group)"
              }
              disabled={!canStep(-1)}
              onClick={() => run(stepCommand(state, selected!, -1)!)}
            />
          }
        >
          <ArrowDown />
        </Tip>
      </div>
      <ScrollArea id="layers-body" hidden={!open} className="min-h-0 flex-1">
        {roots.length === 0 ? (
          <p className="px-3 py-3 text-xs text-pretty text-muted-foreground">
            The document has no layers. Import an image to add one.
          </p>
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
            <SortableContent
              render={<ul aria-label="Layers" className="flex flex-col gap-px p-1.5" />}
            >
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
                      <ul aria-label={`Groups in ${name(id)}`} className="flex flex-col gap-0.5">
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
