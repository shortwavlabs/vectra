# Inter (branding generation only)

**Use.** These files are used only by `branding/generate.mjs`, to set the wordmark and tagline in the social banners as vector outlines (HarfBuzz `hb-view` SVG output, then rasterized with resvg). They are never part of the application: not in `public/`, not in `dist`, not in the service-worker precache. `scripts/check-dist.mjs` fails the build if any font file reaches `dist`.

**Source.** The official release of Inter by The Inter Project Authors (Rasmus Andersson et al.):
- Release: **v4.1**, published 2024-11-16.
- Download: <https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip>, 33,707,794 bytes. The SHA-256 of the archive as downloaded on 2026-11-26 was `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`.
- Files vendored here (from `extras/ttf/` and the archive root):

| File | Bytes | SHA-256 |
|---|---|---|
| `Inter-Regular.ttf` | 411,640 | `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82` |
| `Inter-SemiBold.ttf` | 419,744 | `78a843fade9d4612a5567302fb595b56976eb5fcebf4fea5a5912d638bafcde3` |
| `LICENSE.txt` | — | `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a` |

**Copyright and licence.** Copyright (c) 2016 The Inter Project Authors (<https://github.com/rsms/inter>). Licensed under the **SIL Open Font License, Version 1.1**; the full text is in `LICENSE.txt`, unmodified. The fonts are unmodified: no subsetting or renaming, so no Reserved Font Name issue arises. The banners contain glyph outlines, not the font software.

**Approval.** The maintainer authorised an OFL typeface, preferably Inter, for deterministic offline branding generation only, and approved this download on 2026-11-26.
