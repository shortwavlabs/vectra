# Optional image sources and community preset ecosystem
Status: proposed | 2026-11-23 | Post-core expansion; not P0 scope
Parent: [PRD-002](PRD-002-VECTOR-STUDIO.md)

## Product opportunity
Enable users to start a creative project without owning a suitable image, and share reusable creative recipes rather than artwork. The two features complement the image-to-editable-vector workflow. Neither is required to use Vectra. Core local import, tracing, editing and export remain offline-capable after application assets load, with no account, credentials, upload or server-side artwork processing.

## Image import UX
Import opens a modal or contextual panel with Local file, Clipboard and Browse images tabs. Local file remains default. Clipboard access is explicit, with paste/file-picker fallback. Browse images is an optional online feature: show provider, network disclosure, search field, paginated results, dimensions, thumbnail, photographer/creator credit, license summary and source link. Selecting a result opens a preview and import-size choice subject to existing decoded pixel limits. An explicit Use image action initiates the local import. Show loading, no results, offline, rate limit, failed import and unavailable-provider states; preserve current project on failure. Do not expose image search as a standalone download service.

## Unsplash first — verified policy inputs
Primary sources reviewed 2026-11-23:
- [API documentation](https://unsplash.com/documentation): photo search and metadata, demo 50 API requests/hour, production 1,000/hour subject to approval; recheck limits before launch.
- [API guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines) and [API terms](https://unsplash.com/api-terms): protect application credentials, use returned image URLs directly, credit photographers and Unsplash, notify Unsplash when a user imports a photo, avoid selling unaltered photos or replicating Unsplash.
- [Hotlinking](https://help.unsplash.com/en/articles/2511271-guideline-hotlinking-images), [attribution](https://help.unsplash.com/en/articles/2511315-guideline-attribution), [download event](https://help.unsplash.com/en/articles/2511258-guideline-triggering-a-download).
- [General terms](https://unsplash.com/terms): copyright permission is not blanket clearance for identifiable people, trademarks, artwork or property; communicate use restrictions without promising universal commercial clearance.

Integration proposal (subject to provider approval):
1. Search via a narrowly scoped same-origin Cloudflare Pages Function or Worker. Access key remains a server-side secret; no keys in Git, browser bundles or client logs.
2. Return normalized search metadata with the provider's image URLs and credits. Directly hotlink result thumbnails and source previews per provider guidance, preserving tracking parameters. Include attribution links to creator and Unsplash with required referral parameters.
3. On explicit import, notify the download-location endpoint through the proxy for that photo ID, using the returned location and validating destination. No tracking on mere search/preview; avoid duplicate automatic retries. Confirm exact event semantics with provider.
4. Fetch allowed image URL directly from provider CDN into browser; decode locally into existing RGBA input pipeline. Test CORS and canvas readability in supported browsers; never bypass provider policy using an image proxy. If unsupported, offer local file import or disable provider.
5. Retain source provenance locally: provider, photo ID, creator, canonical URL, license reference, import date, dimensions. Keep credit in source inspector; export derivative vectors only. Offer optional attribution text/metadata without silently adding printable artwork.
6. Confirm with Unsplash that local decode, transformation, display of imported raster, offline project storage and later reopen are compatible with hotlinking/terms; gate feature on written clarification if needed. Do not ship offline caching or persist original provider images until permitted. Apply for production access before public launch.

## Provider abstraction and boundaries
Provider adapter: search(query, cursor, signal) -> results/pageInfo; resolve(assetId) -> metadata/allowed image URLs; recordImport(assetId) -> status (if required); capability flags for sizes, pagination, licenses, attribution, import tracking and local persistence. Normalize errors without hiding provider-specific restrictions. Initial provider: Unsplash; future candidates Pexels, Wikimedia Commons, Smithsonian Open Access, The Met Open Access, Library of Congress. Each requires separate API, CORS, licensing and attribution review; do not assume all assets are public domain. No scraping.

Online adapter must be optional, disabled by default on unconfigured self-hosted builds. Configure CSP with explicit provider origins only in online builds; offline core retains its current restrictive policy. *(G-0: before any online adapter, specify offline-only and online-enabled build variants, their CSP and `_headers`, secret management, attribution obligations and network boundaries — RFC-002 §15.2.)* Debounce or submit searches explicitly, cancel stale requests, bound query length, response sizes, pagination and concurrency; enforce server-side rate caps and reject arbitrary proxy URLs, redirects and unsupported endpoints. Keep API credentials out of errors; do not log user artwork, filenames, editor settings or export bytes. Disclose that searches, provider image requests and required import tracking are network activity visible to respective services. Never send existing user images to providers. No paid infrastructure commitment: evaluate Cloudflare quotas and abuse risk before launch.

## Community preset library
Goal: discover, import, customize, remix and submit preset recipes; no mandatory account for browsing/importing. Initially a GitHub-backed static catalog on Cloudflare Pages. The editor can export a versioned .vectra-preset JSON file; contributors submit a PR through GitHub with recipe, title, description, tags, creator attribution, license, engine compatibility, example provenance and permitted preview thumbnail. A static index is built from approved entries. Later: optional in-editor browsing/import, website submission form (authenticated or moderated with abuse controls), collections/favorites and creator profiles only if justified. Website submissions must never directly publish executable or unreviewed content; separate optional service from core editor.

Preset contract: schemaVersion, stable preset ID/version, compatible engine range, title, author, license, optional parent/remix attribution, ordered allowlisted operations and bounded parameters, deterministic seeds. Reject unknown operations/versions, scripts, external URLs as executable inputs, unsafe parameter ranges, oversized recipes and unsupported compatibility. No source raster, API credentials, private paths or project data in preset export. Preserve existing project on import failure. Recipe licensing and thumbnail/artwork rights are separate; select a clear contribution policy before publishing. Use shared procedural/rights-cleared fixtures for previews where possible. Do not reuse Unsplash photos in a public thumbnail library without verifying rights and API terms; no automatic bulk provider downloads.

Submission validation: schema + size limits, compatible operations, deterministic fixture render, complexity/runtime caps, vector-only export check, creator/license metadata, moderated thumbnail safety and rights review. Run cheap checks on PR; expensive rendering only on demand. Require maintainer approval before catalog publication; provide reporting/removal process. Catalog and app remain independently deployable; no DB or user account in first iteration. Direct form later requires spam/rate limits, moderation, credential protection and explicit consent to publish metadata.

## Acceptance gates (all NOT RUN)
- Online integration is opt-in; core local workflow passes network-blocked test, including if provider or catalog unavailable.
- Search, attribution, import tracking and direct image loading comply with reviewed provider rules; production approval and CORS tests recorded.
- API keys never appear in browser bundle, request URLs sent by browser, or public logs; proxy rejects arbitrary URLs and abusive requests.
- Imported image can be traced and edited locally; SVG/PDF contain no raster image resources; failures do not modify existing scene.
- Preset file round-trip reproduces parameters and seed, validates compatibility, rejects invalid inputs, carries no private artwork; gallery previews clearly labeled and licensed.
- Community submissions remain unpublished until review; approved recipe available through static build and imports without executing code.

## Delivery order
Design preset import/export and provider boundary early enough to avoid schema lock-in, without changing P0. After core editor and effects are stable: (A) local preset sharing, (B) static community gallery with PR submissions, (C) Unsplash provider spike and approval, (D) optional online integrations and direct submission form after evidence and owner approval. No provisioning, API registration, secret creation, live integration or deploy in this documentation PR.

## Future optional paid collections
The free community library remains separate from optional commercial packs. Both use the same declarative preset schema, local parser and safety/compatibility gates. Paid packs contain curated recipes, not exclusive engine operations, and must work offline without activation. No paid content enters the public community repository without an explicit distribution license; never repurpose contributor recipes without permission. See [Brand and business strategy](BRAND-AND-BUSINESS.md) for proposed licensing, fulfillment and later marketplace policy. No commerce in V1.
