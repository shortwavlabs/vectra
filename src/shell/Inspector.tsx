// Contextual inspector. Every edit is a document command; keyboard steps (slider and numeric
// arrows) carry a coalesce key so a run of steps is one undo entry (RFC-002 §7), and focus
// leaving a control ends the run. Locked selections are read-only here.
// G-UI-R layout: a property sheet. Each section is a titled group of rows; each row has a fixed
// label column and its controls, so values line up down the panel.
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
import { Tip } from "../ui/tip.tsx";
import {
  type Box,
  containsLocked,
  displayName,
  isLocked,
  paletteLabel,
  pathCount,
  pathFill,
  fillTargets,
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
const paths = (n: number) => `${n.toLocaleString("en")} ${n === 1 ? "path" : "paths"}`;

export function Section(p: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2 border-t border-border px-3 pt-2.5 pb-3 first:border-t-0">
      <div className="flex min-h-4 items-center justify-between gap-2">
        <h3 className="text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {p.title}
        </h3>
        {p.meta && (
          <span className="min-w-0 truncate text-2xs text-muted-foreground tabular-nums">
            {p.meta}
          </span>
        )}
      </div>
      {p.children}
    </section>
  );
}

/** One property row: a fixed label column, then the controls. */
const ROW = "grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2";
function Row(p: { label: string; children: ReactNode }) {
  return (
    <div className={ROW}>
      <span className="text-xs text-muted-foreground">{p.label}</span>
      {p.children}
    </div>
  );
}

/** Inspector content before any document exists. */
export function EmptyInspector() {
  return (
    <div className="grid gap-1.5 px-3 py-4">
      <p className="text-ui font-medium">Nothing to inspect yet</p>
      <p className="text-xs text-pretty text-muted-foreground">
        Import an image to create a document. It is traced on this device and added as a layer; what
        you select then shows its properties here.
      </p>
    </div>
  );
}

export function DocumentInspector({ snap }: { snap: SessionSnapshot }) {
  const s = snap.state;
  return (
    <>
      <div className="grid gap-0.5 px-3 pt-3 pb-2.5">
        <p className="text-title font-semibold">Document</p>
        <p className="text-2xs text-muted-foreground">Nothing selected</p>
      </div>
      <Section title="Artboard">
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Size</dt>
          <dd className="tabular-nums">
            {s.artboard.width} × {s.artboard.height} px
          </dd>
          <dt className="text-muted-foreground">Background</dt>
          <dd>
            {s.artboard.background === null ? "Transparent" : rgbaToHex(s.artboard.background)}
          </dd>
          <dt className="text-muted-foreground">Colour</dt>
          <dd>RGB</dd>
          <dt className="text-muted-foreground">Layers</dt>
          <dd className="tabular-nums">{s.orderedRootIds.length}</dd>
          <dt className="text-muted-foreground">Palette</dt>
          <dd className="tabular-nums">{s.paletteById.size} colours</dd>
        </dl>
        <p className="text-xs text-pretty text-muted-foreground">
          Select an object on the canvas, or a layer in Layers, to edit it.
        </p>
      </Section>
    </>
  );
}

export function SelectionInspector(p: {
  session: DocumentSession;
  snap: SessionSnapshot;
  ids: readonly NodeId[];
  /** The box of what the selection draws (the canvas overlay's box). When it draws nothing
   *  (hidden), the document geometry's box is used, so the fields still edit. */
  bounds: Box | null;
  run: Run;
}) {
  const { session, snap, ids, run } = p;
  const s = snap.state;
  const top = topLevel(s, ids);
  const key = top.join(",");
  const locked = ids.some((id) => isLocked(s, id));
  // A transform never moves a locked object: a locked descendant freezes the transform too.
  const frozen = locked || top.some((id) => containsLocked(s, id));
  const b = p.bounds ?? selectionBounds(s, session.store, top);
  const first = s.nodesById.get(ids[0]!)!;
  const targets = fillTargets(s, ids);
  const fill = targets.length ? pathFill(s, targets[0]!) : null;
  const mixed = fill !== null && targets.some((t) => pathFill(s, t).color !== fill.color);
  const scalePct = Math.round(uniformScale(worldMatrix(s, top[0]!)) * 1000) / 10;
  const [draftScale, setDraftScale] = useState<number | null>(null);
  const drag = useRef({ active: false, cancelled: false });
  const end = () => session.endCoalescing();
  const swatches = [...s.paletteById.values()].map((e) => ({
    name: paletteLabel(e.name),
    hex: rgbHex(e.color),
  }));

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

  const kind =
    ids.length > 1
      ? `Mixed selection · ${paths(targets.length)}`
      : first.kind === "path"
        ? "Path"
        : `${first.kind[0]!.toUpperCase()}${first.kind.slice(1)} · ${paths(pathCount(s, first.id))}`;

  return (
    <>
      <div className="grid gap-0.5 px-3 pt-3 pb-2.5">
        <p className="truncate text-title font-semibold" data-testid="selection-name">
          {ids.length === 1 ? displayName(first, s) : `${ids.length} objects`}
        </p>
        <p className="truncate text-2xs text-muted-foreground">
          {kind}
          {locked && " · Locked"}
        </p>
        {locked && (
          <p
            className="mt-1.5 rounded-md border border-warning/50 px-2 py-1.5 text-xs text-warning"
            role="note"
          >
            Locked: unlock it in Layers to edit.
          </p>
        )}
      </div>
      {b && (
        <Section title="Transform">
          {frozen && !locked && (
            <p className="text-xs text-pretty text-warning" role="note">
              Contains locked objects: unlock them to move or scale this selection.
            </p>
          )}
          <Row label="Position">
            <div className="grid grid-cols-2 gap-1.5">
              <NumericField
                label="X"
                prefix="X"
                unit="px"
                value={b.x}
                disabled={frozen}
                onCommit={(v, o) => move(v - b.x, 0, o.step, "x")}
                onBlur={end}
              />
              <NumericField
                label="Y"
                prefix="Y"
                unit="px"
                value={b.y}
                disabled={frozen}
                onCommit={(v, o) => move(0, v - b.y, o.step, "y")}
                onBlur={end}
              />
            </div>
          </Row>
          <p className={`${ROW} text-xs`}>
            <span className="text-muted-foreground">Size</span>{" "}
            <span className="tabular-nums">
              {Number(b.width.toFixed(1))} × {Number(b.height.toFixed(1))} px
            </span>
          </p>
          <Row label="Scale">
            <div className="flex items-center gap-1.5">
              <NumericField
                className="w-[4.5rem] shrink-0"
                label="Scale value"
                unit="%"
                value={draftScale ?? scalePct}
                min={10}
                max={400}
                disabled={frozen}
                onCommit={(v, o) => scaleTo(v, o.step)}
                onBlur={end}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={frozen || scalePct === 100}
                onClick={() => scaleTo(100, false)}
              >
                Reset
              </Button>
            </div>
          </Row>
          <div className={ROW}>
            <span aria-hidden="true" />
            <Slider
              aria-label="Scale"
              min={10}
              max={400}
              format={{ style: "unit", unit: "percent" }}
              step={1}
              disabled={frozen}
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
          </div>
          <Row label="Rotate">
            <div className="flex items-center gap-1">
              <Tip
                label="Rotate 90° counter-clockwise"
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="border-control-border"
                    aria-label="Rotate 90° counter-clockwise"
                    disabled={frozen}
                    onClick={() => turn(3)}
                  />
                }
              >
                <RotateCcw />
              </Tip>
              <Tip
                label="Rotate 90° clockwise"
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="border-control-border"
                    aria-label="Rotate 90° clockwise"
                    disabled={frozen}
                    onClick={() => turn(1)}
                  />
                }
              >
                <RotateCw />
              </Tip>
            </div>
          </Row>
        </Section>
      )}
      <Section
        title="Fill"
        meta={
          fill &&
          (mixed ? `Mixed · ${paths(targets.length)}` : targets.length > 1 && paths(targets.length))
        }
      >
        {fill ? (
          <>
            <ColorPicker
              label="Fill colour"
              value={fill.color === null ? "#000000" : rgbHex(fill.color)}
              mixed={mixed}
              disabled={locked}
              swatches={swatches}
              onCommit={(hex) =>
                run({
                  type: "setFill",
                  ids: targets,
                  fill: { color: withAlpha(hex, fill.color ?? 0xff) },
                })
              }
            />
            <p className="text-2xs text-pretty text-muted-foreground" data-testid="fill-note">
              {targets.length > 1 &&
                `Applies to ${paths(targets.length)}; locked paths are skipped. `}
              {mixed && "Their fills differ: Apply gives them all this colour. "}
              {fill.color === null && "No fill. "}
              {fill.paletteName !== null &&
                !mixed &&
                `Uses ${paletteLabel(fill.paletteName)} from the palette; Apply sets a custom fill instead. `}
              To edit a palette colour everywhere, use Recolor (R).
            </p>
          </>
        ) : (
          <p className="text-xs text-pretty text-muted-foreground">
            No unlocked paths in this selection. To edit palette colours, use Recolor (R).
          </p>
        )}
      </Section>
    </>
  );
}

export function RecolorInspector({ snap, run }: { snap: SessionSnapshot; run: Run }) {
  const entries = [...snap.state.paletteById.values()];
  const swatches = entries.map((e) => ({ name: paletteLabel(e.name), hex: rgbHex(e.color) }));
  return (
    <>
      <div className="grid gap-0.5 px-3 pt-3 pb-2.5">
        <p className="text-title font-semibold">Palette</p>
        <p className="text-2xs text-muted-foreground">
          {entries.length} {entries.length === 1 ? "colour" : "colours"} in this document
        </p>
      </div>
      <Section title="Colours">
        {/* Locks do not apply here: a palette colour is shared by every path that uses it. */}
        {entries.length > 0 && (
          <p className="text-xs text-pretty text-muted-foreground" data-testid="recolor-note">
            A palette edit recolours every path that uses that colour,{" "}
            <span className="text-foreground">including locked paths</span>: locks prevent
            transforms and deletion, not palette edits.
          </p>
        )}
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">This document has no palette colours.</p>
        ) : (
          <ul className="grid gap-1" aria-label="Palette colours">
            {entries.map((e) => (
              <li key={e.id}>
                <ColorPicker
                  label={paletteLabel(e.name)}
                  name={paletteLabel(e.name)}
                  value={rgbHex(e.color)}
                  swatches={swatches}
                  onCommit={(hex) =>
                    run({
                      type: "setPaletteColor",
                      paletteRef: e.id,
                      color: withAlpha(hex, e.color),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
