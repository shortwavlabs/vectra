# Product

<!-- impeccable:product-schema 1 -->

This record is drawn from the approved project documents and adds nothing to them: [docs/PRD.md](docs/PRD.md), [docs/PRD-002-VECTOR-STUDIO.md](docs/PRD-002-VECTOR-STUDIO.md) (P1 scope as amended at G-0), [docs/RFC-002.md](docs/RFC-002.md) and [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md). Where they disagree with this file, they win.

## Platform

web

## Users

Designers, illustrators, zine makers, independent musicians and labels, merch and print-on-demand creators, and privacy-sensitive users who want to refine artwork without uploading it (PRD-002 business analysis).

## Product Purpose

Vectra imports raster artwork, traces it into genuine vectors, lets the artist edit the result and exports SVG or vector PDF. Tracing is the beginning of the workflow, not the deliverable. Success is editable, print-ready vector artwork made entirely on the artist's device.

## Positioning

A local-first, open-source browser studio for fast image-to-vector-to-artwork iteration with strong print character. It is intentionally narrower than a general-purpose editor and is not an Illustrator replacement. It is an artist-controlled instrument, not an AI image generator.

## Operating Context

A desktop browser workspace (`workspace.html`): import a PNG, JPEG or WebP, choose a preset (Black & White, Full Colour, Limited Palette), select and transform objects, edit fills and the document palette, manage layers, export. Everything runs on the device; it works offline once the assets have loaded.

## Capabilities and Constraints

- Genuine vectors only: no raster imagery in vector exports, no raster fallback.
- No account, upload, server processing, subscription or telemetry; the core is free and open source.
- No AI or generative models in the creative runtime; deterministic conventional algorithms only.
- A strict Content Security Policy (no inline styles or scripts, no remote assets or fonts).
- Features ship only when implemented: unavailable tools and views are not shown.
- Photographs are approximations; no print-provider compliance is claimed until tested.

## Brand Commitments

The name Vectra and the line "From pixels to paths". The approved charcoal, lime and ivory print-studio identity and the workspace layout in docs/DESIGN-SYSTEM.md §9 and §13; DESIGN.md at the project root maps them for Impeccable.

## Evidence on Hand

Licensed test fixtures only (`tests/fixtures`, with their provenance). No testimonials, customers, benchmarks or pricing exist; none may be invented.

## Product Principles

1. Local and private by construction: the artwork never leaves the device.
2. Honest output: real vectors, real engine results, no pretend controls.
3. The artwork leads; the chrome recedes.
4. Every edit is a command: undoable, with explicit Apply and Cancel.

## Accessibility & Inclusion

WCAG 2.x AA contrast, full keyboard operation (including the canvas and layer reordering), visible dual focus ring, reduced motion respected, live status for processing, and a VoiceOver smoke test on macOS (docs/DESIGN-SYSTEM.md §8).
