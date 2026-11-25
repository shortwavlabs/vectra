// Owned colour picker (DESIGN-SYSTEM §3: "an owned picker built from Base UI sliders"). It
// replaces the Dice picker and fixes R05-A D3–D6 by construction:
// - D3: every thumb is named ("Saturation and brightness", "Hue");
// - D4: the hex field is a free-text draft committed on Enter or blur, never reverted per key;
// - D5: the saturation/brightness area is a keyboard-operable 2-D slider;
// - D6: edits stay in a local draft; `onCommit` fires once on Apply, never on Cancel, Escape
//   or an outside click, and never for an unchanged colour.
// G-UI-R: the popover opens below its trigger (over the inspector column, not over the artwork),
// offers the document's colours as swatches (they set the draft, nothing else), and shows the
// current and new colour side by side.
// Maintainer review: a selection whose fills differ is shown as mixed (a hatched swatch, "Mixed",
// and "mixed" in the name), never as one of its colours. The draft starts from `value`, and
// Apply always commits then, since any colour makes the fills uniform.
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { type Hsv, hexToHsv, hsvToHex, parseHex } from "./color.ts";
import { FIELD } from "./numeric-field.tsx";
import { Button } from "./registry/button";
import { Input } from "./registry/input";
import { Popover, PopoverContent, PopoverTrigger } from "./registry/popover";
import { Slider } from "./registry/slider";

export interface ColorPickerProps {
  /** The committed colour, `#rrggbb`; with `mixed`, only where the draft starts. */
  value: string;
  /** The targets' colours differ: no single current colour is shown or named. */
  mixed?: boolean;
  /** What is being coloured, e.g. "Fill colour". */
  label: string;
  onCommit: (hex: string) => void;
  disabled?: boolean;
  /** A visible name shown in the trigger before the hex value (e.g. a palette colour's name). */
  name?: string;
  /** Colours offered as one-click swatches (the document palette). */
  swatches?: readonly { name: string; hex: string }[];
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

export function ColorPicker({
  value,
  mixed,
  label,
  onCommit,
  disabled,
  name,
  swatches,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value);
  const [hexError, setHexError] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const hexId = useId();
  const draft = hsvToHex(hsv);

  const setDraft = (next: Hsv) => {
    setHsv(next);
    setHexText(hsvToHex(next));
    setHexError(false);
  };
  /** A typed or picked hex becomes the draft; greys keep the current hue. */
  const setDraftHex = (hex: string) => {
    const next = hexToHsv(hex);
    setDraft(next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next);
  };
  const onOpenChange = (next: boolean) => {
    if (next) {
      setHsv(hexToHsv(value));
      setHexText(value);
      setHexError(false);
    }
    setOpen(next); // any close without Apply discards the draft
  };
  const commitHexText = () => {
    const hex = parseHex(hexText);
    if (!hex) return setHexError(true);
    setDraftHex(hex);
  };
  const apply = () => {
    if (mixed || draft !== value) onCommit(draft);
    setOpen(false);
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = area.current!.getBoundingClientRect();
    setDraft({
      h: hsv.h,
      s: clamp(((e.clientX - r.left) / r.width) * 100),
      v: clamp(100 - ((e.clientY - r.top) / r.height) * 100),
    });
  };
  const onAreaKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.shiftKey ? 10 : 1;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-k, 0],
      ArrowRight: [k, 0],
      ArrowUp: [0, k],
      ArrowDown: [0, -k],
      PageUp: [0, 10],
      PageDown: [0, -10],
      Home: [-100, 0],
      End: [100, 0],
    };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    setDraft({ h: hsv.h, s: clamp(Math.round(hsv.s) + d[0]), v: clamp(Math.round(hsv.v) + d[1]) });
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={`${label}: ${mixed ? "mixed" : value}. Edit colour`}
        className={`${FIELD} flex w-full min-w-0 items-center gap-2 border px-1.5 text-left text-foreground transition-colors hover:border-foreground/55 disabled:pointer-events-none disabled:opacity-50 data-popup-open:border-primary`}
      >
        <span
          aria-hidden="true"
          className={`size-4 shrink-0 rounded-[3px] ring-1 ring-foreground/25 ring-inset ${mixed ? "vx-swatch-mixed" : ""}`}
          style={mixed ? undefined : { backgroundColor: value }}
        />
        {name && <span className="min-w-0 flex-1 truncate">{name}</span>}
        <span className={name ? "shrink-0 text-muted-foreground" : "min-w-0 truncate"}>
          {mixed ? "Mixed" : value}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-64 gap-2.5 p-2.5"
        aria-label={`${label} picker`}
        initialFocus={thumb}
      >
        <div
          ref={area}
          className="vx-sv-area relative h-32 touch-none rounded-md ring-1 ring-foreground/10 ring-inset"
          style={{ backgroundColor: hsvToHex({ h: hsv.h, s: 100, v: 100 }) }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
            thumb.current?.focus();
          }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && fromPointer(e)}
        >
          <div
            ref={thumb}
            role="slider"
            tabIndex={0}
            aria-label="Saturation and brightness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s)}
            aria-valuetext={`Saturation ${Math.round(hsv.s)}%, brightness ${Math.round(hsv.v)}%`}
            onKeyDown={onAreaKey}
            className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ring-1 ring-black/60"
            style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: draft }}
          />
        </div>
        <Slider
          className="vx-hue"
          aria-label="Hue"
          min={0}
          max={359}
          step={1}
          value={[Math.round(hsv.h) % 360]}
          onValueChange={(v) => setDraft({ ...hsv, h: Array.isArray(v) ? v[0]! : (v as number) })}
        />
        {swatches && swatches.length > 0 && (
          <div role="group" aria-label="Document colours" className="grid gap-1.5">
            <span aria-hidden="true" className="text-2xs text-muted-foreground">
              Document colours
            </span>
            <div className="flex flex-wrap gap-1.5">
              {swatches.map((s) => (
                <button
                  key={`${s.name}${s.hex}`}
                  type="button"
                  aria-label={`Use ${s.name}, ${s.hex}`}
                  aria-pressed={draft === s.hex}
                  className="size-6 rounded-[4px] ring-1 ring-control-border ring-inset transition-shadow hover:ring-foreground aria-pressed:ring-2 aria-pressed:ring-primary"
                  style={{ backgroundColor: s.hex }}
                  onClick={() => setDraftHex(s.hex)}
                />
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="relative">
            <label
              htmlFor={hexId}
              className="absolute inset-y-0 left-0 flex w-9 items-center justify-center text-2xs font-medium text-muted-foreground"
            >
              Hex
            </label>
            <Input
              id={hexId}
              value={hexText}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={hexError || undefined}
              aria-describedby={hexError ? `${hexId}-error` : undefined}
              className={`${FIELD} pl-9`}
              onChange={(e) => setHexText(e.target.value)}
              onBlur={commitHexText}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitHexText();
                }
              }}
            />
          </div>
          <div
            className="flex h-7 overflow-hidden rounded-md ring-1 ring-foreground/25 ring-inset"
            aria-hidden="true"
          >
            <span
              className={`block w-7 ${mixed ? "vx-swatch-mixed" : ""}`}
              style={mixed ? undefined : { backgroundColor: value }}
            />
            <span className="block w-7" style={{ backgroundColor: draft }} />
          </div>
        </div>
        <p className="min-h-4 text-2xs text-muted-foreground tabular-nums" aria-live="polite">
          {hexError ? (
            <span id={`${hexId}-error`} className="text-destructive">
              Enter a colour as #rrggbb.
            </span>
          ) : (
            <>
              Current {mixed ? "mixed" : value} · New <span data-testid="color-draft">{draft}</span>
            </>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply} disabled={hexError}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
