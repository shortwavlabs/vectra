# VoiceOver smoke test and stock-Safari keyboard check (owner checklist, G-R1 §9)

These two checks need a person at the Mac. Automated tests cover keyboard behaviour and the announced text (`tests/browser/workspace-a11y.spec.ts`), but they are **not** a screen-reader test. ARIA snapshots and Playwright's accessibility tree do not stand in for VoiceOver.

**Setup**
- Use real Safari on macOS with stock settings.
- Open the workspace from the G-R1 build, or from the G-UI-R build stacked on it (E1 and E2 describe the G-UI-R inspector and picker). After the G-UI-R maintainer review the rail holds only Select, Trace and Recolor, there is no view switch, Layers has a collapse button (D1, D4), palette colours are named "Colour N" (E2) and a mixed fill is named as such (E5):
  ```bash
  pnpm run build && pnpm exec vp preview --port 4173
  ```
  then open `http://127.0.0.1:4173/workspace.html`.
- Turn VoiceOver on and off with ⌘F5. VO = Control+Option.
- Fixture: `tests/fixtures/procedural/nested_rings.png`, imported with the Black & White preset (3 paths).

Record PASS or FAIL for each line, the exact spoken text where it differs, and the macOS and Safari versions.

## A. Stock-Safari keyboard (VoiceOver off)
In Safari's default settings, "Press Tab to highlight each item on a webpage" is **off**.

| # | Step | Expected |
|---|---|---|
| A1 | Press Tab repeatedly from the address bar | Text fields and the preset radio group get focus. Buttons are skipped (Safari default) |
| A2 | Press Option-Tab repeatedly | Every control gets focus, including the tool rail, Import and Export, the **canvas**, and the inspector |
| A3 | With the canvas focused, use the arrow keys and Enter (section C) | Works the same as with full keyboard access |
| A4 | Open and close the shortcuts dialog (`?`, then Escape) | Focus returns to the trigger |

## B. Import and processing announcements
| # | Step | Expected (spoken) |
|---|---|---|
| B1 | VO on. Navigate to **Import** and activate it, then choose the fixture | The file chooser opens. Then "Reading nested_rings.png…", "Tracing…" and "Traced nested_rings.png: 3 paths, 50 anchors in N ms" are announced (polite) |
| B2 | Import a non-image file renamed `.png` | "Error: Import failed: …" is announced as an alert |
| B3 | Start a second import while one is running | "<name> was not imported: another import is in progress" is announced |

## C. Canvas navigation and single-object selection
| # | Step | Expected (spoken) |
|---|---|---|
| C1 | Move VO to the canvas, then interact (VO-Shift-Down) or Tab to it | "Artwork canvas, canvas", followed by the hint: "Arrow keys move between objects…" |
| C2 | Down Arrow | "nested_rings, layer, 3 paths, 1 of 1" |
| C3 | Right Arrow | The layer's top-most object, for example "Path 3, fill #000000, 1 of 3" |
| C4 | Down Arrow, twice | "Path 2…, 2 of 3", then "Path 1…, 3 of 3" |
| C5 | Enter | "Path 1, fill #000000 selected". The inspector shows "Path 1" |
| C6 | Up Arrow, then Shift+Enter | "… selected" announced for the second path; the inspector shows "2 objects" |
| C7 | Left Arrow | Back to the layer: "nested_rings, layer, 3 paths, 1 of 1, …" |
| C8 | Look at the screen during C2–C7 | A dashed lime box marks the keyboard cursor's object; a lime ring marks canvas focus |

## D. Layers and groups
| # | Step | Expected |
|---|---|---|
| D1 | Navigate to the Layers list | The heading's button is announced as "Layers, expanded" (collapse control). The list name and row names are announced. Hide/Show, Lock/Unlock and More actions are named buttons |
| D2 | Hide the layer, then show it again | The button state changes are announced ("Show nested_rings" / "Hide nested_rings") |
| D3 | Reorder with the drag handle: Space, Down Arrow, Space | The live region announces "… dropped at position 2 of 2" |
| D4 | Activate the "Layers" button, then activate it again | "collapsed", then "expanded" is announced; while collapsed, Tab skips the layer rows |

## E. Transform controls, colour picker, undo/redo, export
| # | Step | Expected |
|---|---|---|
| E1 | With a path selected, Tab to the inspector: X, Y, Scale value, Scale slider, Rotate 90° counter-clockwise, Rotate 90° clockwise (the G-UI-R order; Reset sits between Scale value and the slider, and is disabled and skipped while the scale is 100 %) | Each control's name and value are announced. Arrow keys change the slider; its value is announced |
| E2 | Fill colour: open the picker | Focus lands on "Saturation and brightness" with its value text. "Hue" is a named slider. "Hex" is a text field. The "Document colours" group holds swatch buttons named "Use Colour 1, #rrggbb" (pressed for the current draft; the engine's `p0`, `c0` or `ink` is spoken as "Colour 1", never by its raw name). Apply and Escape work; focus returns to the trigger |
| E3 | ⌘Z, then ⇧⌘Z | The edit is undone and redone. The Undo and Redo buttons announce disabled or enabled states |
| E4 | Activate Export | The dialog "Export artwork" is announced. Focus stays inside it. Escape closes it and focus returns to Export |
| E5 | Import `tests/fixtures/procedural/adjacent_colors.png` with the Limited Palette preset; select its layer in Layers; move to the Fill trigger | "Fill colour: mixed. Edit colour" (no single hex value); in the picker the status reads "Current mixed" |

## F. Result
- Recording: macOS ___, Safari ___, VoiceOver default voice. Date ___.
- FAIL lines (exact spoken text): ___
- The owner signs off TD-UI-002 (picker and slider) and the G-R1 accessibility item only after A–E pass, or after a recorded decision on each FAIL.
