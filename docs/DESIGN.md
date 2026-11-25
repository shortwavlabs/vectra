# UX and visual direction
> **Superseded (R3, G-0 2026-11-25):** the normative UI is [DESIGN-SYSTEM](DESIGN-SYSTEM.md) and [RFC-002 §16](RFC-002.md): a charcoal/lime studio with a contextual left tool rail, central canvas with an ivory artwork surface, and a right inspector and layers. The preset-gallery shell below is historical. The accessibility and honesty principles below still apply.

Vectra — From pixels to paths. Creative print studio, not a generic converter. Proposed neutral charcoal/ivory interface, strong typography, restrained accent, artwork-first layout; final identity pending owner review.

Desktop: top bar with import/export, left preset gallery grouped Core/Artistic, central synchronized split preview with draggable divider and fit/zoom, right inspector with context-sensitive controls and palette, footer with path count, dimensions, processing status. Mobile: stacked preview and collapsible inspector; support only after performance gates.

Workflow: empty state -> load -> default BW or Full Color based on explicit user choice -> preview -> tune -> final trace -> export. Show preview resolution, final resolution, progress and cancellation; never show old result as current. Error states preserve source and settings. Export dialog includes physical size, units, background, SVG/PDF and warnings. Display path metrics, not misleading quality percentages.

Preset thumbnails must be generated from the same licensed reference input by actual engine once available; label mockups as targets. Keyboard focus, labels, contrast WCAG AA target, reduced motion, no color-only status. Controls have numeric entry, reset and tooltips. Do not introduce paywalls or account prompts.
