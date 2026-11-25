// WCAG 2.x contrast ratios for the DESIGN-SYSTEM tokens → artifacts/contrast.json (+ self-check).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const T = {
  background: "#191a1c", panel: "#212224", elevated: "#292a2c", canvasSurround: "#303134",
  border: "#414347", foreground: "#eeeef0", muted: "#a9abad", primary: "#b9e87b",
  primaryForeground: "#20251a", paper: "#eee8d8",
  destructive: "#ff8f85", warning: "#f2c14e", controlBorder: "#787a7e", // proposed by this spike
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const [r, g, b] = rgb(h).map((c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
// Source-over blend of fg at alpha over an opaque bg (for Tailwind `/50`-style tokens).
const blend = (fg, a, bg) => "#" + rgb(fg).map((c, i) => Math.round(c * a + rgb(bg)[i] * (1 - a)).toString(16).padStart(2, "0")).join("");

assert.equal(ratio("#000000", "#ffffff"), 21); // self-check against the WCAG endpoints
assert.equal(ratio("#777777", "#ffffff"), 4.48);

const surfaces = ["background", "panel", "elevated", "canvasSurround"];
const rows = [];
const add = (kind, fgName, fg, bgName, bg, min) => rows.push({ kind, fg: fgName, fgHex: fg, bg: bgName, bgHex: bg, ratio: ratio(fg, bg), min, pass: ratio(fg, bg) >= min });
for (const s of surfaces) for (const f of ["foreground", "muted", "primary", "destructive", "warning"]) add("text", f, T[f], s, T[s], 4.5);
add("text", "primaryForeground", T.primaryForeground, "primary", T.primary, 4.5);
add("text", "background", T.background, "primary", T.primary, 4.5);
add("text", "primaryForeground", T.primaryForeground, "paper", T.paper, 4.5);
add("text", "background", T.background, "paper", T.paper, 4.5);
add("text", "background", T.background, "destructive", T.destructive, 4.5);
add("text", "background", T.background, "warning", T.warning, 4.5);
// shadcn destructive button: text-destructive on bg-destructive/10 over the surface
for (const s of ["background", "panel"]) add("text", "destructive on destructive/10", T.destructive, `destructive/10 over ${s}`, blend(T.destructive, 0.1, T[s]), 4.5);
for (const s of [...surfaces]) add("non-text", "border", T.border, s, T[s], 3);
for (const s of [...surfaces, "paper"]) add("non-text", "focus ring (primary, opaque)", T.primary, s, T[s], 3);
for (const s of surfaces) add("non-text", "shadcn focus ring ring/50", blend(T.primary, 0.5, T[s]), s, T[s], 3);
add("non-text", "focus ring on primary fill (no offset)", T.primary, "primary", T.primary, 3);
add("non-text", "selected tool fill (primary)", T.primary, "panel", T.panel, 3);
add("non-text", "selected tool icon (primaryForeground)", T.primaryForeground, "primary", T.primary, 3);
add("non-text", "unselected tool icon (foreground)", T.foreground, "panel", T.panel, 3);
add("non-text", "slider track bg-muted(elevated)", T.elevated, "panel", T.panel, 3);
add("non-text", "slider range (primary)", T.primary, "panel", T.panel, 3);
// Proposed: control-border for input outlines / slider tracks / handles where the boundary identifies the control.
for (const s of surfaces) add("non-text", "proposed controlBorder", T.controlBorder, s, T[s], 3);
add("non-text", "focus ring dark inner (background) on paper", T.background, "paper", T.paper, 3);

const failures = rows.filter((r) => !r.pass);
writeFileSync(resolve(import.meta.dirname, "../../../docs/research/rfc-002-review/artifacts/design-system/contrast.json"), JSON.stringify({ tokens: T, standard: "WCAG 2.x relative luminance; text 4.5:1 (normal), non-text 3:1 (1.4.11)", rows, failures }, null, 2) + "\n");
for (const r of rows) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.kind.padEnd(8)} ${r.ratio.toFixed(2).padStart(6)} ≥${r.min}  ${r.fg} (${r.fgHex}) on ${r.bg} (${r.bgHex})`);
