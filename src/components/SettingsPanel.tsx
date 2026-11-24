import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, MODE_LABELS } from "../presets/defaults.ts";
import type { FitSettings, Mode, Settings } from "../vectorization/types.ts";

interface NumProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}

function Num({ label, value, min, max, step = 1, disabled = false, onChange }: NumProps) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const v = e.currentTarget.valueAsNumber;
          if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
      />
    </label>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
    </label>
  );
}

function FitControls({ fit, onChange }: { fit: FitSettings; onChange: (f: FitSettings) => void }) {
  return (
    <fieldset>
      <legend>Curve fitting</legend>
      <Select
        label="Fit"
        value={fit.mode}
        options={["spline", "polygon", "pixel", "precision"] as const}
        onChange={(mode) =>
          onChange({ ...fit, mode, simplify: mode === "precision" ? 0 : fit.simplify })
        }
      />
      <Num
        label="Corner threshold (°)"
        value={fit.cornerThreshold}
        min={0}
        max={180}
        onChange={(cornerThreshold) => onChange({ ...fit, cornerThreshold })}
      />
      <Num
        label="Simplify (px, 0 = off)"
        value={fit.simplify}
        min={0}
        max={10}
        step={0.25}
        disabled={fit.mode === "precision"}
        onChange={(simplify) => onChange({ ...fit, simplify })}
      />
    </fieldset>
  );
}

export function SettingsPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const s = settings;
  let controls: ReactNode;
  switch (s.mode) {
    case "bw":
      controls = (
        <>
          <label>
            <span>Threshold ({s.threshold})</span>
            <input
              type="range"
              min={0}
              max={255}
              value={s.threshold}
              onChange={(e) => onChange({ ...s, threshold: e.currentTarget.valueAsNumber })}
            />
          </label>
          <Check
            label="Invert"
            value={s.invert}
            onChange={(invert) => onChange({ ...s, invert })}
          />
          <Num
            label="Speckle area (px²)"
            value={s.speckle}
            min={0}
            max={10000}
            onChange={(speckle) => onChange({ ...s, speckle })}
          />
          <Num
            label="Alpha threshold"
            value={s.alphaThreshold}
            min={0}
            max={255}
            onChange={(alphaThreshold) => onChange({ ...s, alphaThreshold })}
          />
          <FitControls fit={s.fit} onChange={(fit) => onChange({ ...s, fit })} />
        </>
      );
      break;
    case "color":
      controls = (
        <>
          <Num
            label="Colour precision (bits)"
            value={s.colorPrecision}
            min={1}
            max={8}
            onChange={(colorPrecision) => onChange({ ...s, colorPrecision })}
          />
          <Num
            label="Layer difference"
            value={s.layerDifference}
            min={0}
            max={255}
            onChange={(layerDifference) => onChange({ ...s, layerDifference })}
          />
          <Num
            label="Speckle area (px²)"
            value={s.speckle}
            min={0}
            max={10000}
            onChange={(speckle) => onChange({ ...s, speckle })}
          />
          <Select
            label="Compositing"
            value={s.compositing}
            options={["stacked", "mosaic"] as const}
            onChange={(compositing) =>
              // Precision fitting needs stacked compositing; mosaic falls back to spline.
              onChange({
                ...s,
                compositing,
                fit:
                  compositing === "mosaic" && s.fit.mode === "precision"
                    ? { ...s.fit, mode: "spline" }
                    : s.fit,
              })
            }
          />
          <FitControls
            fit={s.fit}
            onChange={(fit) =>
              onChange({
                ...s,
                fit,
                compositing: fit.mode === "precision" ? "stacked" : s.compositing,
              })
            }
          />
        </>
      );
      break;
    case "limited":
      controls = (
        <>
          <Num
            label="Colours"
            value={s.colors}
            min={2}
            max={32}
            onChange={(colors) => onChange({ ...s, colors })}
          />
          <Num
            label="Speckle area (px²)"
            value={s.speckle}
            min={0}
            max={10000}
            onChange={(speckle) => onChange({ ...s, speckle })}
          />
          <Select
            label="Compositing"
            value={s.compositing}
            options={["stacked", "mosaic"] as const}
            onChange={(compositing) =>
              // Precision fitting needs stacked compositing; mosaic falls back to spline.
              onChange({
                ...s,
                compositing,
                fit:
                  compositing === "mosaic" && s.fit.mode === "precision"
                    ? { ...s.fit, mode: "spline" }
                    : s.fit,
              })
            }
          />
          <FitControls
            fit={s.fit}
            onChange={(fit) =>
              onChange({
                ...s,
                fit,
                compositing: fit.mode === "precision" ? "stacked" : s.compositing,
              })
            }
          />
        </>
      );
      break;
    case "halftone":
      controls = (
        <>
          <Num
            label="Pitch (px)"
            value={s.pitch}
            min={2}
            max={200}
            step={0.5}
            onChange={(pitch) => onChange({ ...s, pitch })}
          />
          <Num
            label="Angle (°)"
            value={s.angle}
            min={-90}
            max={90}
            onChange={(angle) => onChange({ ...s, angle })}
          />
          <Num
            label="Gamma"
            value={s.gamma}
            min={0.2}
            max={5}
            step={0.1}
            onChange={(gamma) => onChange({ ...s, gamma })}
          />
          <Num
            label="Contrast"
            value={s.contrast}
            min={-1}
            max={1}
            step={0.05}
            onChange={(contrast) => onChange({ ...s, contrast })}
          />
          <Num
            label="Min coverage"
            value={s.minCoverage}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(minCoverage) => onChange({ ...s, minCoverage })}
          />
          <Color label="Ink" value={s.ink} onChange={(ink) => onChange({ ...s, ink })} />
          <Check
            label="Paper background"
            value={s.paper !== null}
            onChange={(on) => onChange({ ...s, paper: on ? "#f3ead8" : null })}
          />
          {s.paper !== null && (
            <Color label="Paper" value={s.paper} onChange={(paper) => onChange({ ...s, paper })} />
          )}
          <Select
            label="Dot paths"
            value={s.dotPaths}
            options={["compound", "perDot"] as const}
            onChange={(dotPaths) => onChange({ ...s, dotPaths })}
          />
        </>
      );
      break;
  }
  return (
    <section aria-label="Processing settings" className="panel">
      <label>
        <span>Mode</span>
        <select
          data-testid="mode"
          value={s.mode}
          onChange={(e) => onChange(DEFAULT_SETTINGS[e.currentTarget.value as Mode])}
        >
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      {controls}
    </section>
  );
}
