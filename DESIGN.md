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

<!-- impeccable:design-map -->
Normative: docs/DESIGN-SYSTEM.md (§4, §8, §9, §13) and docs/RFC-002.md §16 win over this map and over .impeccable/design-full.md. docs/DESIGN.md is the superseded P0 baseline, not a design authority.
Name: Vectra
Colors: background #191a1c, panel #212224, elevated #292a2c, canvas-surround #303134, paper #eee8d8, foreground #eeeef0, muted-foreground #a9abad, border #414347, control-border #787a7e, primary #b9e87b, primary-foreground #20251a (+3 more in the frontmatter)
Fonts: system-ui (meta, control, body, title)
Radius: sm 4px, md 6px, lg 8px
Don't:
- Show controls for features that do not exist yet.
- Use `border` for control boundaries, or colour alone for status.
- Use print-trade "ink" terminology for palette colours, or put raster imagery in a vector export.
Do:
- Keep lime for state and the primary action; keep the artwork the brightest element.
- Put names, states and shortcuts on the control itself; keep statuses in words.
- Keep the strict CSP: no inline `<style>`, no remote fonts or assets.
Map: src/ui/styles.css
Map: docs/DESIGN-SYSTEM.md
Map: docs/RFC-002.md
Map: docs/DESIGN.md
Map: workspace.html
Full: .impeccable/design-full.md (read a section when you need its detail)
