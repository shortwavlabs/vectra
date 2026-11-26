# VoiceOver smoke test and stock-Safari keyboard check (owner checklist, G-R1 §9)

These two checks need a person at the Mac. Automated tests cover keyboard behaviour and the announced text (`tests/browser/workspace-a11y.spec.ts`), but they are **not** a screen-reader test. ARIA snapshots and Playwright's accessibility tree do not stand in for VoiceOver.

**Exact build to test (final closure, 2026-11-25).**
- PR #20 (G-UI-R) at the head named in its description, with app source `3a96a8b` (later commits are docs only).
- Build ID **`96221ca763e15c51`**. After `pnpm run build`, `grep BUILD_ID dist/sw.js` must print it. If it differs, you are not testing the qualified build.
- Commands:
  ```bash
  pnpm install --frozen-lockfile && pnpm run build && grep BUILD_ID dist/sw.js
  pnpm exec vp preview --port 4173
  ```
- Record every result against that build ID, with the macOS and Safari versions. Nothing here is marked PASS until a person has run it.

**Setup**
- Use real Safari on macOS with stock settings.
- Open the workspace from the G-R1 build, or from the G-UI-R build stacked on it (E1 and E2 describe the G-UI-R inspector and picker). After the G-UI-R maintainer review the rail holds only Select, Trace and Recolor, there is no view switch, Layers has a collapse button (D1, D4), palette colours are named "Colour N" (E2) and a mixed fill is named as such (E5). After the final closure the tab title is "Vectra" (A7), both splitters are 24 px strips of their own (A6, D5), palette names are unique (E7), and a path without a fill is "None" (E6):
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
| A5 | Option-Tab to the canvas, then click it with the mouse | Keyboard focus shows a 2 px lime ring with a dark inner ring around the whole canvas, drawn over the artwork. Clicking with the mouse shows no ring |
| A6 | Option-Tab on from the inspector fields | "Resize inspector" and "Resize layers" each take a stop, separate from the "Layers" button. Arrow keys resize the focused splitter; its ring (lime, dark inside) is drawn inside the 24 px strip, not over the canvas |
| A7 | Look at the Safari tab title (with VoiceOver on, VO-F2 speaks the window title) | "Vectra" |

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
| C8 | Look at the screen during C2–C7 | A dashed lime box marks the keyboard cursor's object. The lime ring around the canvas edge marks canvas focus, and stays visible over the artwork |

## D. Layers and groups
| # | Step | Expected |
|---|---|---|
| D1 | Navigate to the Layers list | The heading's button is announced as "Layers, expanded" (collapse control). The list name and row names are announced. Hide/Show, Lock/Unlock and More actions are named buttons |
| D2 | Hide the layer, then show it again | The button state changes are announced ("Show nested_rings" / "Hide nested_rings") |
| D2b | Import `tests/fixtures/procedural/adjacent_colors.png` with the Limited Palette preset (a layer that holds groups). In Layers, expand the layer and lock one group. Select the layer, then press Delete (or More actions > Delete) | An alert is announced: Error: Not deleted: "adjacent_colors" contains 1 locked object. Unlock it to delete. Nothing is deleted. After unlocking the group, Delete removes the layer and ⌘Z restores it |
| D3 | Reorder with the drag handle: Space, Down Arrow, Space | The live region announces "… dropped at position 2 of 2" |
| D4 | Activate the "Layers" button, then activate it again | "collapsed", then "expanded" is announced; while collapsed, Tab skips the layer rows. The splitter above the header is a separate stop and still resizes |
| D5 | Move VO to "Resize layers", then to "Resize inspector"; use the arrow keys | Each is announced as a separator (splitter) with its name; the value changes are announced. A click a few pixels inside the canvas edge next to either strip acts on the canvas, never resizes |

## E. Transform controls, colour picker, undo/redo, export
| # | Step | Expected |
|---|---|---|
| E1 | With a path selected, Tab to the inspector: X, Y, Scale value, Scale slider, Rotate 90° counter-clockwise, Rotate 90° clockwise (the G-UI-R order; Reset sits between Scale value and the slider, and is disabled and skipped while the scale is 100 %) | Each control's name and value are announced. Arrow keys change the slider; its value is announced |
| E2 | Fill colour: open the picker | Focus lands on "Saturation and brightness" with its value text. "Hue" is a named slider. "Hex" is a text field. The "Document colours" group holds swatch buttons named "Use Colour 1, #rrggbb" (pressed for the current draft; the engine's `p0`, `c0` or `ink` is spoken as "Colour 1", never by its raw name). Apply and Escape work; focus returns to the trigger |
| E3 | ⌘Z, then ⇧⌘Z | The edit is undone and redone. The Undo and Redo buttons announce disabled or enabled states |
| E4 | Activate Export | The dialog "Export artwork" is announced. Focus stays inside it. Escape closes it and focus returns to Export |
| E5 | Import `tests/fixtures/procedural/adjacent_colors.png` with the Limited Palette preset; select its layer in Layers; move to the Fill trigger | "Fill colour: mixed. Edit colour" (no single hex value); the note below reads exactly "Apply assigns one colour to all unlocked selected paths."; in the picker the status reads "Current mixed" |
| E6 | Only with a document holding a stroked path without a fill (no trace or command makes one today; automated in `ui-document` "no fill"): select it, move to the Fill trigger, open the picker | "Fill colour: none. Edit colour"; never "#000000". The picker reads "Current none"; Hex starts at #808080 |
| E7 | Import the same image twice with Limited Palette, then press R (Recolor) and walk the "Palette colours" list | Every name is distinct: the first trace's "Colour 1"…, the second's "Colour 1 (2)"…; no raw `p0` |

## F. Result
- Recording: macOS ___, Safari ___, VoiceOver default voice. Date ___.
- FAIL lines (exact spoken text): ___
- The owner signs off TD-UI-002 (picker and slider) and the G-R1 accessibility item only after A–E pass, or after a recorded decision on each FAIL.
