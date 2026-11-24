# Product requirements
Status: proposed | 2026-11-23

## Vision
Make vector conversion accessible without subscriptions, upload queues or professional illustration software. Combine accurate tracing with intentional print aesthetics. Target designers, artists, hobbyists and print-on-demand creators. Not a full Illustrator replacement.

## Release scope
P1 core: import PNG/JPEG/WebP (TIFF deferred until decoder evidence); drag/drop and file picker; preserve alpha and EXIF orientation where applicable; black & white, grayscale, limited color, full color, silhouette and line-art presets; adjustable threshold, palette size, detail, smoothing and speckle removal; synchronized original/vector preview; transparent background; SVG and vector PDF downloads. P2 artistic: Old Print, Halftone, Screen Print, Poster, Comic Ink. P3 experimental: woodcut, engraving, blueprint, stencil. Artistic presets must be implemented before advertising them as available.

## User stories and acceptance
- A logo owner imports a transparent PNG and exports closed paths with holes intact; no opaque background is introduced.
- An illustrator selects black & white and tunes threshold; the preview and export agree.
- A print artist selects Old Print, adjusts ink/paper/dot density, and receives editable geometry with no baked texture bitmap.
- A designer chooses a custom palette; export uses only those colors, except explicitly enabled background.
- A user cancels a long trace, imports a second file and never sees the stale result.
- A privacy-sensitive user completes an import-to-export session offline after the application assets load; no artwork, filename or settings are sent over the network.
- A user on an unsupported or memory-constrained browser gets an actionable error rather than a crash or silent downscale.

## Requirements
Must: genuine vectors only; explicit preview resolution vs final resolution; deterministic presets; keyboard-operable UI; progress/cancel; undo for settings; no telemetry by default; browser feature detection; bounded resource usage; accessible errors; RGB SVG/PDF with configurable physical size and transparent/solid background. Should: palette editing, invert, path inspector, saved presets, offline install. Could: batch, centerline tracing, local subject segmentation, print separations, CMYK/PDF/X after dedicated validation.

Non-goals: semantic reconstruction of photos, editable font recognition, exact Illustrator parity, native app, cloud storage, AI-generated redraws. No claim of print-provider compliance until tested. Photographs are approximations, not lossless vector conversions.

## Success measures
Proposed gates in VALIDATION.md, not measured results. Optimize fidelity, path count, responsiveness and reproducibility together; no single quality score. Public release requires all relevant gates and manual art review.
