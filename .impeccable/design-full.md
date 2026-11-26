---
name: Vectra
description: From pixels to paths. A local-first vector creation studio in a charcoal, lime and ivory print-studio identity.
colors:
  background: "#191a1c"
  panel: "#212224"
  elevated: "#292a2c"
  canvas-surround: "#303134"
  paper: "#eee8d8"
  foreground: "#eeeef0"
  muted-foreground: "#a9abad"
  border: "#414347"
  control-border: "#787a7e"
  primary: "#b9e87b"
  primary-foreground: "#20251a"
  destructive: "#ff8f85"
  warning: "#f2c14e"
  ink-muted: "#5c5a54"
typography:
  meta:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
    lineHeight: "16px"
  control:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    lineHeight: "16px"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    lineHeight: "18px"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "20px"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "32px"
  field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "28px"
  tool-rail-button-pressed:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    size: "36px"
  empty-state-sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.background}"
---

# Design System: Vectra

## Overview

This file is Impeccable's machine-readable map of the approved design system. It invents nothing. The normative sources are [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) (with its §13 G-UI-R refinement) and [docs/RFC-002.md §16](docs/RFC-002.md); where this file and they disagree, they win and this file is corrected. The token values live in `src/ui/styles.css`. [docs/DESIGN.md](docs/DESIGN.md) is the superseded P0 baseline and is not a design authority.

The workspace (`workspace.html`) is an **Operate** surface: a docked creative editor in a charcoal/lime print-studio identity. The ivory artwork is the brightest thing on screen; chrome recedes. It must not become a generic dashboard.

## Colors

Dark only and deterministic: the OS colour scheme never changes the UI. Artwork colours are never themed.

- **Surfaces:** `background` (app chrome and field wells), `panel` (inspector, rail, bars), `elevated` (menus, popovers), `canvas-surround` (around the artboard).
- **Text:** `foreground` (11.2–15.0:1 on every surface), `muted-foreground` (secondary, 5.65–7.56:1).
- **Accent:** `primary` lime marks state and the one primary action (Export, a pressed tool). `primary-foreground` on it is 11.11:1.
- **Status:** `destructive` for errors, `warning` for warnings and disclosures. Never colour alone: every status has words.
- **Lines:** `border` is for decorative dividers only (1.31–1.76:1). Input outlines, slider tracks and resize grips use `control-border` (3.02–4.05:1).
- **Paper:** `paper` is the artwork surface and, as an onboarding surface, the empty-state sheet. Display only, never exported. Text on it uses `background` (14.24:1) and `ink-muted` (5.6:1).
- **Focus:** a dual ring everywhere: lime `primary` outer outline, `background` inner ring (lime alone fails on paper at 1.15:1).

## Typography

The system font stack, no web fonts. A fixed role scale: 11 px meta, units and section titles (uppercase, `muted-foreground`, tracking 0.06 em); 12 px controls and values; 13 px body, panel titles (semibold) and layer names; 15 px semibold selection name. Numbers use tabular figures and thousands separators (1,613 paths).

## Layout

Docked panels separated by `border` hairlines, no floating cards or outer gutter. Top bar 44 px (wordmark, document title, history, Import, Export), a 48 px left tool rail, the central canvas, a right column of 296 px below 1440 px of viewport width and 320 px above (288–336 px when resized) holding the inspector over Layers, and a 28 px status bar (activity and message; document size, complexity, zoom; renderer disclosure; offline state). Layers start at 30 % of the column, keep their pixel height when the window resizes, and collapse only on request (their header's disclosure, or a drag of the split), never by viewport height. **Splitters** are 24 px resize strips of their own (panel colour, a `border` hairline on the canvas or Layers side, a `control-border` grip): outside the canvas, clear of every control, no pointer overlay, keyboard-resizable, focus ring drawn inside the strip. The browser tab title is "Vectra".

## Shapes

Radius `md` (6 px) for controls and fields, `sm` for small chips and swatches, square or near-square (3 px) for the paper sheet. The empty-state drop guide is a squared dashed print margin.

## Components

- **Tool rail:** icon buttons with the name and shortcut on the trigger (`aria-label`, `aria-keyshortcuts`); tooltips are visual only. Only working tools are shown.
- **Inspector:** a property sheet of titled sections; rows have a 3.25 rem label column. One field style for every value (`field`): a 28 px `background` well with a `control-border` outline, the short label inside (X, Y, Hex) and the unit at the right.
- **Colour picker:** opens below its trigger, over the inspector column; keyboard 2-D area, named hue slider, hex draft, the document palette as swatches; one commit on Apply, none on Cancel or Escape. A selection whose fills differ shows a hatched "Mixed" swatch and no single colour; its note is exactly "Apply assigns one colour to all unlocked selected paths." No fill is "None" (a struck-through swatch), never black, and its draft starts from a neutral grey.
- **Layers:** two-line rows (name, then state and count); a row that contains the selection is tinted and says "Contains selection".
- **Palette colours** whose names trace provenance records as engine-generated are shown as "Colour N" (N + 1 from the name); custom names are never renamed; a generated label already taken gets " (2)", " (3)" in palette order. Display only: the document and exports keep the stored names.
- **Modal dialogs:** a flat 60 % scrim without blur.

## Do's and Don'ts

### Do:
- Keep lime for state and the primary action; keep the artwork the brightest element.
- Put names, states and shortcuts on the control itself; keep statuses in words.
- Keep the strict CSP: no inline `<style>`, no remote fonts or assets.

### Don't:
- Show controls for features that do not exist yet.
- Use `border` for control boundaries, or colour alone for status.
- Use print-trade "ink" terminology for palette colours, or put raster imagery in a vector export.
