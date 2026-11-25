// Owned numeric field (DESIGN-SYSTEM §3 "owned numeric input"): a free-text draft committed on
// Enter or blur, reverted on Escape, clamped to [min, max]; Arrow Up/Down step the committed
// value (Shift ×10) and report `step: true` so the caller can coalesce them (RFC-002 §7).
import { useId, useState } from "react";
import { Input } from "./registry/input";

export interface NumericFieldProps {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  /** Decimal places shown and committed. */
  precision?: number;
  disabled?: boolean;
  onCommit: (value: number, o: { step: boolean }) => void;
  /** Focus left the field (callers end keyboard coalescing here). */
  onBlur?: () => void;
}

export function NumericField(p: NumericFieldProps) {
  const { step = 1, min = -Infinity, max = Infinity, precision = 1 } = p;
  const id = useId();
  const fmt = (v: number) => String(Number(v.toFixed(precision)));
  const [text, setText] = useState<string | null>(null); // null: not editing
  const clamp = (v: number) => Number(Math.min(max, Math.max(min, v)).toFixed(precision));
  const commitText = (t: string) => {
    const n = Number(t);
    if (t.trim() !== "" && Number.isFinite(n) && clamp(n) !== clamp(p.value))
      p.onCommit(clamp(n), { step: false });
    setText(null);
  };
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {p.label}
      </label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          aria-label={p.unit ? `${p.label} (${p.unit})` : p.label}
          disabled={p.disabled}
          value={text ?? fmt(p.value)}
          className="h-8 pr-7 text-xs tabular-nums"
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => {
            commitText(e.target.value);
            p.onBlur?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitText(e.currentTarget.value);
            else if (e.key === "Escape") setText(null);
            else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const d = (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1);
              const v = clamp(p.value + d);
              if (v !== clamp(p.value)) p.onCommit(v, { step: true });
              setText(null);
            }
          }}
        />
        {p.unit && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground"
          >
            {p.unit}
          </span>
        )}
      </div>
    </div>
  );
}
