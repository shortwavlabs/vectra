---
version: 1
slug: "prototypes-g-prj-home-index-html"
primary_target: "prototypes/g-prj/home/index.html"
related_targets: []
---

# Surface brief: Vectra project home (G-PRJ-R design prototype)

**Scope and mode.** Operate. A full-screen start screen shown when Vectra opens with nothing to resume, plus the workspace project controls and the persistence dialogs it implies. Design prototype only (`prototypes/g-prj/home/`, dev server); production implementation waits for maintainer approval.

**Audience and job.** Artists returning to work (resume, recover, open a file) or starting (new, import to trace). First launch must teach the three ways in without fictional content.

**Proof and content.** Licensed fixture artwork thumbnails; synthetic demonstration project names and states, labelled as such in the evidence. Real persistence states only: saved to a file, stored in this browser only, file unavailable, recovery available, unsaved changes.

**Constraints.** Existing Vectra world unchanged (DESIGN.md, docs/DESIGN-SYSTEM.md; src/ui tokens and registry components). Strict CSP in production (no inline style in shipped code). No controls for features that do not exist. Statuses in words. Lime only for the primary action and state.

## Direction contract
THESIS: The project home is a resume desk, not a dashboard: the last artwork you touched fills the first viewport with its true save and recovery state beside it, and one lime Resume says what will open. It refuses the category default of a uniform card grid behind a hero banner and analytics.
OWN-WORLD: Vectra's charcoal shell (#191a1c, panel #212224, elevated #292a2c), artwork shown as the ivory artboard (#eee8d8) at its true aspect on the canvas surround (#303134), the brightest surface; 1 px #414347 borders, system type at 11/12/13/15 px; lime #b9e87b on one primary action per view (Resume on the home, "Choose an image…" at first launch, the primary of each dialog, Export in the existing workspace) plus focus and selected state (amended after the finish review; source: the request "lime for the primary action/state" and DESIGN.md "Keep lime for state and the primary action"); Lucide icons at 16 px beside words.
STORY: The artist sees their last piece, reads in words whether it is saved, where, and whether newer unsaved changes exist; chooses Recover changes or Open last save; resumes. Otherwise starts new, opens a .vectra they own, or imports an image to trace; finds older work in the shelf or the full library; understands what lives only in this browser.
FIRST VIEWPORT: 44 px top bar (symbol + vectra, "Projects", a storage icon button that shows words only when storage is at risk; no Open… on the home, amended after the critique: Open… appeared twice and the maintainer chose storage-only-when-at-risk and tracing as the first-launch front door; Open… stays in Start and in All projects). Left, about two-thirds of the content width: the resume panel, the artwork as its ivory artboard at true aspect on the canvas surround, then one top-anchored block of name, save state, the recovery choice and the lime Resume. Right: Start, capped near 26rem (amended after finish-review material fix 2, which removed the dead voids and stopped the Start rows stretching; the resume panel takes the freed width), three outline actions with one-line explanations (New project, Open…, Import image…) and one quiet line on where projects live. Below, full width: Recent shelf of five tiles and "Show all projects".
FORM: Resume hero with shelf, position 3 on my ordered list of 7 (dealt lead, chosen by the user), seed:4dea934f2c506be4. Signature interaction: the recovery choice is a radio pair that rewrites the Resume button's consequence line ("Opens the recovered changes" / "Opens great-wave.vectra as last saved") before you press it.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
