// Contextual inspector. Every edit is a document command; keyboard steps (slider and numeric
// arrows) carry a coalesce key so a run of steps is one undo entry (RFC-002 §7), and focus
// leaving a control ends the run. Locked selections are read-only here.
import { RotateCcw, RotateCw } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { Command } from "../document/commands.ts";
import type { NodeId } from "../document/model.ts";
import { hexToRgba, rgbaToHex } from "../document/provenance.ts";
import type { DispatchOptions, DocumentSession, SessionSnapshot } from "../document/session.ts";
import { ColorPicker } from "../ui/color-picker.tsx";
import { NumericField } from "../ui/numeric-field.tsx";
import { Button } from "../ui/registry/button";
import { Slider } from "../ui/registry/slider";
import {
  displayName,
  isLocked,
  pathFill,
  pathIds,
  quarterTurnAbout,
  scalingAbout,
  selectionBounds,
  topLevel,
  translation,
  uniformScale,
  worldMatrix,
  worldTransformCommands,
} from "./document.ts";

export type Run = (c: Command | Command[], o?: DispatchOptions) => void;

/** `#rrggbb` of an RGBA8888 colour, ignoring alpha. */
const rgbHex = (c: number) => rgbaToHex((c | 0xff) >>> 0);
/** `#rrggbb` with the alpha byte of `keep` (the picker edits colour, not opacity). */
const withAlpha = (hex: string, keep: number) =>
  hexToRgba(hex + (keep & 0xff).toString(16).padStart(2, "0"));

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5 border-t border-border px-4 py-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function DocumentInspector({ snap }: { snap: SessionSnapshot }) {
  const s = snap.state;
  return (
    <Section title="Document">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Artboard</dt>
        <dd className="tabular-nums">
          {s.artboard.width} × {s.artboard.height} px
        </dd>
        <dt className="text-muted-foreground">Background</dt>
        <dd>{s.artboard.background === null ? "Transparent" : rgbaToHex(s.artboard.background)}</dd>
        <dt className="text-muted-foreground">Layers</dt>
        <dd className="tabular-nums">{s.orderedRootIds.length}</dd>
        <dt className="text-muted-foreground">Palette</dt>
        <dd className="tabular-nums">{s.paletteById.size} colours</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        Select an object on the canvas, or a layer in the Layers panel, to edit it.
      </p>
    </Section>
  );
}

export function SelectionInspector(p: {
  session: DocumentSession;
  snap: SessionSnapshot;
  ids: readonly NodeId[];
  run: Run;
}) {
  const { session, snap, ids, run } = p;
  const s = snap.state;
  const top = topLevel(s, ids);
  const key = top.join(",");
  const locked = ids.some((id) => isLocked(s, id));
  const b = selectionBounds(s, session.store, top);
  const first = s.nodesById.get(ids[0]!)!;
  const paths = pathIds(s, ids);
  const fill = paths.length ? pathFill(s, paths[0]!) : null;
  const scalePct = Math.round(uniformScale(worldMatrix(s, top[0]!)) * 1000) / 10;
  const [draftScale, setDraftScale] = useState<number | null>(null);
  const drag = useRef({ active: false, cancelled: false });
  const end = () => session.endCoalescing();

  const move = (dx: number, dy: number, step: boolean, axis: string) =>
    run(
      worldTransformCommands(s, top, translation(dx, dy)),
      step ? { coalesceKey: `move-${axis}:${key}` } : {},
    );
  const scaleTo = (pct: number, coalesce: boolean) => {
    if (!b || pct === scalePct) return;
    const f = pct / 100 / uniformScale(worldMatrix(s, top[0]!));
    run(
      worldTransformCommands(s, top, scalingAbout(f, b.x + b.width / 2, b.y + b.height / 2)),
      coalesce ? { coalesceKey: `scale:${key}` } : {},
    );
  };
  const turn = (t: 1 | 3) =>
    b &&
    run(worldTransformCommands(s, top, quarterTurnAbout(t, b.x + b.width / 2, b.y + b.height / 2)));

  return (
    <>
      <div className="grid gap-0.5 px-4 pt-3 pb-3">
        <p className="truncate text-base font-semibold" data-testid="selection-name">
          {ids.length === 1 ? displayName(first, s) : `${ids.length} objects`}
        </p>
        <p className="text-xs text-muted-foreground">
          {ids.length === 1
            ? first.kind[0]!.toUpperCase() + first.kind.slice(1)
            : "Mixed selection"}
          {locked && " · Locked"}
        </p>
        {locked && (
          <p
            className="mt-1 rounded-md border border-warning/50 px-2 py-1.5 text-xs text-warning"
            role="note"
          >
            Locked: unlock it in Layers to edit.
          </p>
        )}
      </div>
      {b && (
        <Section title="Transform">
          <div className="grid grid-cols-2 gap-2">
            <NumericField
              label="X"
              unit="px"
              value={b.x}
              disabled={locked}
              onCommit={(v, o) => move(v - b.x, 0, o.step, "x")}
              onBlur={end}
            />
            <NumericField
              label="Y"
              unit="px"
              value={b.y}
              disabled={locked}
              onCommit={(v, o) => move(0, v - b.y, o.step, "y")}
              onBlur={end}
            />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            Size {Number(b.width.toFixed(1))} × {Number(b.height.toFixed(1))} px
          </p>
          <div className="grid gap-2">
            <div className="flex items-center justify-between text-xs">
              <span id="scale-label" className="text-muted-foreground">
                Scale
              </span>
              <output aria-hidden="true" className="tabular-nums">
                {draftScale ?? scalePct}%
              </output>
            </div>
            <Slider
              aria-label="Scale"
              min={10}
              max={400}
              step={1}
              disabled={locked}
              value={[Math.round(draftScale ?? scalePct)]}
              onPointerDown={() => {
                drag.current = { active: true, cancelled: false };
                // Escape cancels the drag (RFC §7) wherever focus is (WebKit does not focus the
                // thumb on click); it is consumed so it does not also clear the selection.
                const onKey = (e: KeyboardEvent) => {
                  if (e.key !== "Escape" || !drag.current.active) return;
                  e.preventDefault();
                  e.stopPropagation();
                  drag.current.cancelled = true;
                  setDraftScale(null);
                };
                window.addEventListener("keydown", onKey, true);
                window.addEventListener(
                  "pointerup",
                  () => window.removeEventListener("keydown", onKey, true),
                  { once: true },
                );
              }}
              onValueChange={(v) => {
                if (!drag.current.cancelled)
                  setDraftScale(Array.isArray(v) ? v[0]! : (v as number));
              }}
              onValueCommitted={(v) => {
                const was = drag.current;
                drag.current = { active: false, cancelled: false };
                setDraftScale(null);
                if (was.cancelled) return;
                // Pointer drags commit once on release; keyboard steps commit per key, coalesced.
                scaleTo(Array.isArray(v) ? v[0]! : (v as number), !was.active);
              }}
              onBlur={end}
            />
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-1">
              <NumericField
                label="Scale value"
                unit="%"
                value={scalePct}
                min={10}
                max={400}
                disabled={locked}
                onCommit={(v, o) => scaleTo(v, o.step)}
                onBlur={end}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={locked || scalePct === 100}
                onClick={() => scaleTo(100, false)}
              >
                Reset
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Rotate 90° counter-clockwise"
                disabled={locked}
                onClick={() => turn(3)}
              >
                <RotateCcw />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Rotate 90° clockwise"
                disabled={locked}
                onClick={() => turn(1)}
              >
                <RotateCw />
              </Button>
            </div>
          </div>
        </Section>
      )}
      <Section title="Fill">
        {fill ? (
          <>
            <ColorPicker
              label="Fill colour"
              value={fill.color === null ? "#000000" : rgbHex(fill.color)}
              disabled={locked}
              onCommit={(hex) =>
                run({
                  type: "setFill",
                  ids: paths,
                  fill: { color: withAlpha(hex, fill.color ?? 0xff) },
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              {fill.color === null && "No fill. "}
              {fill.paletteName !== null &&
                `Uses palette colour ${fill.paletteName}; Apply sets a custom fill on the selected paths. Recolor (R) edits the palette colour everywhere. `}
              {paths.length > 1 && `Applies to ${paths.length} paths.`}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Fill applies to paths: select a path on the canvas, or use Recolor (R) to edit palette
            colours.
          </p>
        )}
      </Section>
    </>
  );
}

export function RecolorInspector({ snap, run }: { snap: SessionSnapshot; run: Run }) {
  const entries = [...snap.state.paletteById.values()];
  return (
    <Section title="Palette">
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">This document has no palette colours.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Palette colours">
          {entries.map((e) => (
            <li key={e.id} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
              <span className="truncate text-xs text-muted-foreground">{e.name}</span>
              <ColorPicker
                label={`Palette colour ${e.name}`}
                value={rgbHex(e.color)}
                onCommit={(hex) =>
                  run({ type: "setPaletteColor", paletteRef: e.id, color: withAlpha(hex, e.color) })
                }
              />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        A palette edit recolours every path that uses that colour, including locked ones.
      </p>
    </Section>
  );
}
