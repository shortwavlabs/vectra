# G-PRJ-R — UX specification: project home and workspace project controls

**Status:** design proposal for maintainer acceptance (D-PRJ-13).

**Visual authority:** unchanged. `DESIGN.md` and `docs/DESIGN-SYSTEM.md` (§4, §8, §9, §13 normative), with tokens in `src/ui/styles.css`.

**Evidence:**
- interactive prototype `prototypes/g-prj/home/` (dev server; `?state=…`);
- captures in [`mockups/`](mockups/);
- design process and reviews: [Impeccable review](G-PRJ-IMPECCABLE-REVIEW.md);
- direction contract: `.impeccable/surfaces/prototypes-g-prj-home-index-html.md`.

## 1. Principles for this surface (Operate mode)
- **Artwork leads.** Thumbnails on ivory paper are the brightest elements. The chrome is charcoal and quiet.
- **One lime action per screen:** Resume in the home. Lime is otherwise only for focus and selection.
- **States are words.** "Saved to great-wave.vectra", "Stored in this browser only", "File unavailable", "Recovery available", "Unsaved changes". An icon may accompany a word; colour alone never carries a state.
- **No controls for features that do not exist** (DESIGN.md).
- **Healthy background work is silent.** Failures, important transitions and decisions are shown.

## 2. Project home: layout (direction A, "Resume hero with shelf")
**Top bar (44 px, like the workspace's):**
- the symbol and "vectra", then "Projects";
- on the right, storage use as a button that opens "Projects and storage" (§8), then **Open…**.

**Resume panel (left, about 58 % width):**
- a large artwork preview of the most recent project;
- its name, "Edited 12 min ago", and its file state in words;
- when a recovery snapshot is newer than the last save, the recovery choice (§4);
- the lime **Resume** button, with a consequence line that says exactly what will open.

**Start (right column):** three outline actions with one-line explanations:
- **New project:** "Start from an empty artboard";
- **Open…:** "Open a .vectra project file from this device";
- **Import image…:** "Trace a PNG, JPEG or WebP into vectors on this device".

A two-line note below them says where projects live (files you keep, copies and recovery data in this browser; nothing is uploaded).

**Recent shelf (full width, below):**
- up to five tiles, each with the artwork, the name, the edited date, and the file state in words with a small icon;
- "Show all projects" opens the library view (§5).

**Responsive:**
- At 1024 × 640 the resume panel and the Start column stay side by side, with smaller artwork, and the shelf scrolls.
- Below about 900 px wide, Start stacks under the resume panel.
- Narrow viewports (390 px) stack everything: the artwork first, then Resume, Start and Recent. They are shown in the mockups, but no mobile qualification is claimed.

## 3. First launch (empty state)
- **No fictional projects.** The screen teaches three ways in, each a large outline action with one sentence: New project, Open a .vectra file, Import an image to trace.
- **Below:** the line "Your projects are files you keep. Vectra also keeps copies and recovery data in this browser, on this device. Nothing is uploaded."
- **When storage access fails** (for example, private browsing without OPFS), the line says what is unavailable ("This browser won't keep projects between visits. Save your work as a file.") and the library sections are not shown.

## 4. Recovery in the home (the signature interaction)
- **When:** a recovery snapshot exists that is newer than the project's last explicit save.
- **What the resume panel shows:**
  - "Unsaved changes from 12 min ago can be recovered. Undo history isn't restored."
  - A radio pair:
    - **Recover changes** (default): the Resume consequence line reads "Opens your recovered changes (unsaved)";
    - **Open last save**: the consequence line reads "Opens great-wave.vectra as last saved · your unsaved changes stay available".
- **Open last save never discards the snapshot** (maintainer requirement M-4):
  - the project's tile keeps "Recovery available";
  - the workspace shows the quiet control "Unsaved changes from 12 min ago are still available · Review".
- **Review:** a small popover offering **Recover**, **Discard…** and **Not now**. Recover opens the snapshot as a copy if the last save has since been edited. Discard asks for confirmation naming the time, and says it cannot be undone.
- **Recovery for a project other than the most recent** appears on its tile ("Recovery available") and in its "…" menu.

## 5. Library ("All projects")
- **Header:** "Projects", search (shown when there are 7 or more projects), sort (Last edited / Name), and a grid/list toggle.
- **Grid tile:** artwork (4:3, contain, on ivory), the name, the edited time, and the file state.
- **List row:** a 72 px thumbnail, the name, the location or state, the edited time, and the "…" menu.
- **"…" menu:**
  - Open
  - Rename
  - Duplicate
  - Download a copy (.vectra)
  - Remove from recent: "Removes it from this list. The project stays where it is."
  - Delete from this browser…: only for browser-stored projects. Its confirmation names the project, says a file copy elsewhere is not affected, and says the action cannot be undone.
- **Unavailable files:** "File unavailable: moved or permission expired", with **Locate…** (Chromium re-grant) or **Remove from recent**.

## 6. Workspace project controls (top bar; the canvas is untouched)
**Left of the existing top bar:**
- the symbol and "vectra";
- the **project name** as a button: click to rename, Enter commits, Esc reverts;
- the **File** menu.

**File menu** (shortcut hints per §9), in groups:
1. New project · Open… · Open recent ▸
2. Save · Save As… · Download a copy · Save to this browser
3. Export SVG / PDF…: its own group, with the words "Export"; never next to Save
4. Project home · Close project

**Save status** (a quiet word control after the name):

| State | Text |
|---|---|
| Saved to a file | "Saved to great-wave.vectra · 2 min ago" |
| Saved in the library | "Saved in this browser · 2 min ago" |
| Dirty | "Unsaved changes" |
| Download flavour (Firefox, Safari) | "Downloaded a copy (great-wave.vectra) · Mark as saved?" (D-PRJ-4) |
| Failure | "Couldn't save: [reason] · Try again · Download a copy" (not a toast; it stays until resolved) |
| Recovery paused | "Recovery paused: browser storage is full · Manage" |
| Recovery kept | "Unsaved changes from 12 min ago are still available · Review" (§4) |
| Healthy autosave | Nothing: never shown |

## 7. Dialogs
All follow the existing dialog pattern: title, one-sentence description, a footer with an outline Cancel and one primary. Focus is trapped, Esc means Cancel, and focus returns to the trigger.

| Dialog | Words | Default focus |
|---|---|---|
| **Unsaved changes** (Open, New, Project home, replace) | "Save changes to Great Wave before opening another project?" Save (primary), Don't save, Cancel | **Cancel** |
| **Close or reload the tab** | The browser's generic prompt only, when dirty and after user activation. No custom text is possible, and iOS shows none, so recovery is the safety net | — |
| **File changed on disk** (Chromium) | "great-wave.vectra changed on disk since you opened it." Save As…, Overwrite, Cancel | **Cancel** |
| **Permission expired** (Chromium) | "Vectra can't write to great-wave.vectra any more." Allow (re-grant), Save As…, Download a copy | Allow |
| **Discard recovery** | "Discard unsaved changes from 12 min ago? This can't be undone." Discard (outline, not lime), Cancel | **Cancel** |
| **Delete from this browser** | "Delete Rings study from this browser? A file copy elsewhere isn't affected. This can't be undone." | **Cancel** |
| **TD-UI-006: commit without history** | "This change is too large to keep in undo history." "Continuing clears all undo and redo steps for this project, and can't be undone. You can save a copy first." Save a copy first (Download a copy), Continue without undo (outline, never lime), Cancel | **Cancel** |

TD-UI-006 details: `withoutHistory` is never invoked automatically. After confirmation, the document revision is re-validated before commit; a stale confirmation is discarded with "The project changed; try again".

## 8. Projects and storage (dialog)
**Sections:**
- **Where your projects are:** files you keep (portable, safe from browser clearing); this browser (convenient, on this device only).
- **List:** each project with size, location, and whether a file copy exists.
- **Recovery data:** its size; the retention ("kept 14 days", D-PRJ-6).
- **Storage:** use against the estimated quota; persistent storage status, with **Keep data in this browser** (requests `persist()`; Firefox prompts).
- **Consequences:** "Clearing this browser's data removes projects stored only here. Save them as files to keep them." In Safari tabs: "Safari may remove data kept only in this browser after 7 days without use."

**Separate actions**, each with its own confirmation:
- Clear recent list (never deletes artwork);
- Remove recovery data;
- Delete a browser-stored project (per project, in the list).

Deleting or overwriting a portable file is not available here; that happens only through the operating system or Save. There is no bulk delete without an explicit list and confirmation.

## 9. Keyboard shortcut contract (proposed; D-PRJ-8)
`Mod` is ⌘ on macOS and Ctrl elsewhere. The handlers run only when focus is in the workspace or the home, not in text fields, except Save, which works everywhere in the workspace.

| Action | Shortcut | Note |
|---|---|---|
| Save | Mod+S | Interceptable in all engines; prevents the browser's Save Page |
| Save As | Mod+Shift+S | Verify per engine in G-PRJ-1: Firefox may reserve it for screenshots. Menu fallback |
| Open | Mod+O | Interceptable; prevents the browser's Open File |
| New project | none in tabs; menu | Mod+N is reserved by browsers (new window) and not interceptable. The installed app keeps the menu too |
| Project home or close project | none; menu or the vectra mark | Mod+W is reserved (close tab or window) and never overridden |
| Resume (in the home) | Enter on the focused Resume | — |
| Rename project | F2 on the name button | Matches desktop conventions |

Browser-reserved combinations (Mod+N, T, W, Q, Shift+N, Tab) are never intercepted. The shortcuts dialog (`?`) lists the contract.

## 10. Accessibility
- **Landmarks:** banner (top bar), main (the home), navigation for the shelf and library lists. The home has an `h1` ("Projects"), visually small.
- **Lists:** the shelf and library are lists of links or buttons; arrow keys move within the grid in G-PRJ-4.
- **Live region:** the save status is `aria-live="polite"`; failures are `role="alert"` once.
- **Dialogs:** labelled by title and described by the description sentence.
- **Focus:** a visible lime focus ring (2 px plus a 2 px dark inner ring) everywhere; nothing is reachable only by pointer.
- **VoiceOver** is an owner check in G-PRJ-Q.

## 11. Navigation and launch
- **The installed app** (`start_url` `./workspace.html`) and the workspace entry show **the project home** when nothing is open (M-1).
- **Opening a project** moves into the workspace, and the URL records the project, for example `workspace.html#project=<id>`, so a reload returns to the same project. Direct workspace access remains possible:
  - an explicit "New project" link, `workspace.html#new`;
  - the debug hooks.
- **Returning** is via File → Project home or the vectra mark.
- **The public product landing page** (future; today `/` is the P0 engineering workbench) is a different surface and is never conflated with the home: no marketing copy in the home, no project list on the landing page.
