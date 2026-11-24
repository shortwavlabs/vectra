# Vectra Press — provisional brand and sustainable funding
Status: proposal | 2026-11-23 | Post-V1 commercial exploration
Parent: [PRD-002](PRD-002-VECTOR-STUDIO.md)
Related: [Creative Lab](CREATIVE-LAB.md), [Image sources and community](IMAGE-SOURCES-AND-COMMUNITY.md).

## Provisional identity and domains
- Application: Vectra.
- Website/community ecosystem: Vectra Press.
- Tagline: From pixels to paths. From paths to art.
- Positioning: open-source vector creation and digital printmaking studio; no AI, no mandatory accounts or subscriptions.
- Domain candidates: **vectrapress.ink** (preferred creative identity, subject to renewal cost and clearance) and **vectrapress.com** (conventional alternative or optional redirect).
- Both were reported available by the maintainer during discussion, not independently verified. Neither is confirmed purchased or reserved. Availability can change.
- Before commitment: check registration and recurring renewal costs, registrar support, confusingly similar names (including Vectr), relevant trademark records and existing software/creative brands. No legal clearance is implied.
- Keep hostnames configurable; do not hardcode either domain in runtime, CSP, callbacks, documentation deployment links or build configuration before selection. Proposed structure: root marketing/showcase, app subdomain, presets subdomain and docs subdomain (or paths if simpler). If both domains are acquired, choose one canonical origin and redirect the other. No domain purchase, DNS changes or deployment is authorized by this document.

## Business principle: free tools, paid artistry
The complete open-source editor, tracing, procedural effects, recipe builder, local project/preset import/export and vector SVG/PDF exports remain free. No paid-only engine operations, artificial limitations, watermarking, export quotas, license checks, account requirements or subscription gates in the core. All premium recipe parameters can be recreated using the same free tools. Monetization sells original curation, artistic expertise, convenience and inspiration, not privileged access to the engine.

Official factory presets and the free community catalog remain genuinely useful; do not withhold essential styles to pressure users into purchases. Paid collections are optional downloadable content with perpetual use of the purchased version, no DRM or online activation. Offer transparent compatibility and support terms; no promise of indefinite updates. Self-hosted builds can import the same compatible files offline. No AI inference, paid inference services or private artwork uploads.

## Potential offerings (illustrative, not commitments)
| Offering | Proposed model |
|---|---|
| Core application and factory presets | Free, open source |
| Community recipes | Free, governed by explicit contributor licenses |
| Underground Vol. 1 | 20 curated Xerox, punk and hardcore recipes; $4.99 |
| Riso Sessions | 25 multicolor print recipes; $6.99 |
| The Engraver's Collection | 30 engraving/woodcut recipes; $9.99 |
| Signal Corruption | 20 glitch/geometric recipes; $4.99 |
| Artist bundles | Optional one-time purchase of recipes, palettes and compatible templates |
| Supporter contributions | Voluntary donations, no exclusive core tools |
| Artist marketplace | Later, optional revenue share on third-party packs |

All names, quantities and USD prices are hypotheses. Only sell collections after their underlying operations ship and are validated. Test willingness to pay with a small curated pack rather than a large speculative catalog. No subscription offering planned.

## Fulfillment and licensing
Initial pilot: a hosted storefront such as Gumroad (candidate, not selected), downloadable archive with manifest, versioned .vectra-preset recipes, README, compatibility requirements, license, previews and attribution. Reuse the existing schema and parser; archive handling must reject traversal, duplicate entries, unsupported versions, oversized/unbounded inputs, scripts, and unexpected executable content. If archive import is not implemented, provide ordinary downloadable preset files; no special paid format. Purchase occurs outside the editor; local import must work without network, receipt verification or customer identity. Commerce availability must never affect editing.

Separate the eventual software license from content distribution terms. Keep premium assets outside freely redistributed source bundles, public community directories and repositories unless intentionally released under an applicable license. Specify commercial use of resulting artwork, recipe modification, sharing/resale restrictions on paid pack files, and attribution requirements clearly; obtain contributor consent and review terms before sales. Do not claim ownership of customer output or exclusivity over algorithms or independently recreated settings. Third-party fonts/photos/illustrations, licenses and derivative rights need separate review. No unlicensed assets, misleading previews or repackaging community presets without permission and attribution. Assume recipes can be copied and recreated; compete on value and trust, not DRM.

## Future creator marketplace
Only consider after free sharing and official sales demonstrate demand. Artists may voluntarily offer free or paid packs. Example revenue split: 85% creator / 15% platform on a clearly defined distributable base. Decide payment fees, tax treatment, refunds, chargebacks, payout timing and currency treatment before advertising a split. Validate creator rights, consent, moderation, licensing, security, compatibility, reporting/removal, dispute and refund workflows. Use a suitable hosted payment/marketplace service; never store card data directly. Review applicable tax, consumer and payout obligations before launch. Free community contribution is separate from paid seller participation; no forced conversion. Creator profiles and commerce accounts remain optional website features, not editor requirements.

## Validation and sequence
1. Build and validate the free V1 editor and flagship creative features. No commerce in P0 or V1 scope.
2. Mature recipe schema, deterministic rendering, offline import and export, compatibility and free community catalog.
3. Evaluate demand through optional feedback, gallery usage and supporter interest; no tracking of private artwork and no mandatory telemetry.
4. Pilot one official pack with rights-cleared previews, transparent pricing and hosted fulfillment. Verify offline import, reproducible output, no gated engine features, and purchase/refund experience.
5. Evaluate repeat demand, net revenue, creator/support workload and refund rate before adding more collections or marketplace infrastructure.

Illustrative economics only: gross pack sales = buyers × average spend. A hypothetical 10,000 monthly active users × 3% monthly buyer conversion × $10 monthly spend yields $3,000/month gross; not a forecast. Net revenue depends on fees, taxes, refunds, creator shares and operating costs. No revenue target or infrastructure expenditure is approved here.

## Non-negotiable acceptance criteria (NOT RUN)
- A fresh unconfigured open-source build can recreate a paid recipe manually, import the purchased file offline and export genuine vectors with no watermark, activation or feature restriction.
- Purchased files remain usable without storefront availability or login, for supported engine versions.
- Free and paid recipes undergo the same safety, determinism, compatibility and vector export checks.
- Licensing and marketing distinguish recipe distribution rights from generated artwork rights, without promising third-party clearance.
- No changes to P0, no checkout implementation, no purchase or deployment in this documentation PR.
