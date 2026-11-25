# G-0 — Consistency audit

**Scope:**
- PRD and PRD-002; RFC-002 (draft and reconciled); RFC-001;
- DESIGN-SYSTEM and DESIGN; CREATIVE-LAB and VECTOR-STUDIO-TOOLS; PRESETS; VALIDATION; ROADMAP;
- P1-HANDOFF and P0-ACCEPTANCE; the TECHNICAL-DEBT register;
- IMAGE-SOURCES and DEPLOYMENT; README and CONTRIBUTING;
- the independent review (PR #6).

**Method.** Each conflict is listed with the source text location, the resolution, and where the resolution now lives.

**Historical records are not rewritten.** These are the independent review, P0 acceptance, and the phase reports. Superseded statements elsewhere are marked inline ("superseded at G-0") rather than deleted, where history matters.

| # | Inconsistency | Location(s) | Resolution | Where resolved |
|---|---|---|---|---|
| 1 | P1 lists six presets including Line Art | PRD.md "Release scope"; ROADMAP P1 row; PRESETS (line-art P1); VECTOR-STUDIO-TOOLS "Core" | Maintainer order: P1 is B&W, Full Colour, Limited Palette, Grayscale, Silhouette; Line Art moves to P2-A | RFC §18; notes in PRD, ROADMAP, PRESETS, TOOLS |
| 2 | Monolithic P1 vs phased P1-A/B/C | PRD.md vs PRD-002 (R2) | PRD-002 phasing, refined into 13 gates | RFC §19; Plan; ROADMAP "Next" |
| 3 | Charcoal/ivory preset-gallery shell vs charcoal/lime contextual rail | DESIGN.md vs PRD-002 and DESIGN-SYSTEM (R3) | DESIGN-SYSTEM is normative; DESIGN.md marked superseded | DESIGN.md header; DESIGN-SYSTEM §9 |
| 4 | Persistence in P4 | PRD-002 VS-12 and delivery sequence; CREATIVE-LAB sequence | P1: serializer in G-DOC, UI in G-PRJ | RFC §14; PRD-002; CREATIVE-LAB notes |
| 5 | Project format "bounded archive" vs container | VECTOR-STUDIO-TOOLS; draft RFC §11 ("select after R05") | Bounded `.vectra` container v1 | RFC §14; C7 |
| 6 | JSON fallback vs packet-only transport | Draft RFC §6 | Fallback removed | RFC §6 |
| 7 | History byte cap vs undefined geometry granularity | Draft RFC §4–5 | Immutable chunks; cap counted in chunk bytes | RFC §5.2, §7 |
| 8 | Caches and spatial index optional ("first candidate") vs required for viability | Draft RFC §7 | Four mandatory parts plus additional requirements | RFC §8.2 |
| 9 | P1-A forbids renderer structures yet must validate visually (circular dependency) | Draft RFC §14 | G-R0 minimal renderer in P1-A; renderer decided | RFC §19; Plan |
| 10 | "Preview must not cancel export" vs `client.ts` behaviour (export `busy`; trace terminates all) | Draft RFC §8 vs `src/vectorization/client.ts` | Scheduler contract; code change deferred to G-JOB (no code changed at G-0) | RFC §10.3 |
| 11 | "Early estimate after segmentation" vs TD-PERF-002 "report within 2 s" | Draft RFC §13; TECHNICAL-DEBT TD-PERF-002 | Approved two-stage wording; old criterion marked superseded inline | RFC §11.1; TECHNICAL-DEBT |
| 12 | Focus ring "lime or higher contrast where needed" vs measured failures (1.15:1 on paper, 1.00:1 on lime) | Draft DESIGN-SYSTEM | Dual focus ring; control-border token | DESIGN-SYSTEM §4 |
| 13 | "Precision v2" could be defined independently by G-GEO and G-SB | Review A11 vs REVISED-P1-SEQUENCE G-GEO "precision version bump" | Provisional IDs; maintainer allocates integers at acceptance; planned v2 = G-GEO + G-SB | RFC §12.2; C6 |
| 14 | Limits unscoped ("1M anchors", "250k interactive") | Draft RFC §13; review | Per-document and per-job cap; per-rendered-snapshot targets; history in bytes | RFC §8.8 |
| 15 | Service-worker network-first navigation allows version skew vs D10 offline guarantee | `scripts/generate-sw.mjs` (source) vs RFC D10 | Single-build sessions required; tests in G-JOB; recorded as debt | RFC §15.3; TD-PLATFORM-006 |
| 16 | IoU-centred geometric targets vs owner visual rejection of v1 circles | VALIDATION.md vs P0-ACCEPTANCE | IoU is not evidence of accurate circles; two defect classes; owner visual bundle required | RFC §12.1; VALIDATION note |
| 17 | Antialiased sliver metric flags analytic truth; junction criterion assumes a partition | TECHNICAL-DEBT TD-GEO-001 vs R04 §3 | Crisp-sampled metric accepted; antialiased still reported; junctions restated per output | RFC §12.4; TD-GEO-010; inline notes |
| 18 | Held-out fixtures treated as untouched | P0-R-GEO corpus vs R04 use of `h-discs-three` | All 12 recorded as exposed; fresh pre-registered holdout required | RFC §12.5; VALIDATION note |
| 19 | Render worker as an "escape hatch" vs mandatory host | Review DOCUMENT-OWNERSHIP early text (since reconciled inside the review before merge) | Option 1 authority plus render worker for rendering only | RFC §4, §8.2. The review's own text is unchanged |
| 20 | G-R0 depends on G-JOB for live traces (review sequence) | REVISED-P1-SEQUENCE graph | G-R0 depends on G-DOC (plus G-ENG fixtures) only, to avoid unnecessary coupling | Plan |
| 21 | TD-GEO-005 target "P1 Line Art" | TECHNICAL-DEBT; P1-HANDOFF debt table | Moves to P2-A; register note; P1-HANDOFF points to the register and G-0 | TECHNICAL-DEBT; P1-HANDOFF note |
| 22 | RFC-002-REVIEW status "requested; NOT RUN" | docs/RFC-002-REVIEW.md | Status: executed (PR #6); protocol text unchanged | RFC-002-REVIEW header |
| 23 | RFC-001 module structure vs RFC-002 §4 | RFC-001 "Structure" (R9) | Marked superseded for P1 | RFC-001 inline note |
| 24 | LICENSE "lands once the holder line is confirmed" | CONTRIBUTING.md | LICENSE exists with `Copyright (c) 2026 Stephane Pericat`; sentence corrected | CONTRIBUTING |
| 25 | README and P1-HANDOFF "Next: RFC-002" | README; P1-HANDOFF | Status: reconciled, pending approval; P1 not started | README; P1-HANDOFF |
| 26 | Online CSP "only in online builds" without a variant definition (R8) | IMAGE-SOURCES; draft RFC §11 | Build variants required before any adapter | RFC §15.2; IMAGE-SOURCES note |
| 27 | Preview ≤ 100 ms target unmet in Firefox and WebKit (review) vs "retain targets" | Review R02; RFC §17 | Target retained; G-R1 optimises; a miss goes to an owner decision, never a silent change | RFC §17; A17 |
| 28 | Review gate labels (R03, R04, R05-A PARTIAL) vs reconciled acceptance | Review FINAL-REPORT | Historical results preserved as PARTIAL; acceptance of the architecture is not production qualification | G0-FINAL-REPORT; TECHNICAL-DEBT lifecycle stages |
| 29 | Absolute review timings could be read as clean reference measurements | Review artefacts | Background `ngspice` load disclosed in RFC §3, §17 and C9; clean runs must record load | RFC §3, §17; C9 |

### Found during the G-0 self-review (resolved before the PR)
| # | Inconsistency | Location(s) | Resolution | Where resolved |
|---|---|---|---|---|
| 30 | The first reconciled draft dropped unamended draft clauses: export rules (no preview-as-final, no SVG→PDF, no CMYK/PDF-X claims, deterministic edited metadata); decoding and preview-downsampling rules; the arbitrary-clip policy; stack, cache, plate and overprint rules; persistence extras; UI behaviours; P0 guardrails; culling and memory bounds; no domain hard-coding; recipe child-ID stability; dependency candidates; IoU and metric ratification; preset envelope fields; reporting integrity | Draft RFC §6–§14 vs first reconciled text | Restored into the matching sections after a clause-by-clause comparison with `0e32fda` | RFC §4, §5.1, §6.1, §8.2, §10.4, §12.3–12.4, §13, §14, §15.1, §16, §17 |
| 31 | The 24 MP B&W ≤ 2.5 s target was re-scoped from import → visible to worker-job time, a silent loosening | Draft §13 vs first reconciled §17 | Restored to import → visible. The colour 12 MP ≤ 8 s target takes the stricter reading (request → committed result visible). Exact settled frames have explicitly **no numeric target yet** | RFC §17; owner checklist |
| 32 | Precision v2: G-GEO acceptance could allocate v2 alone ("acceptance order"), contradicting v2 = G-GEO + G-SB; the holdout spender was unspecified | First reconciled RFC §12.2, C6, plan | G-GEO allocates no version. Allocation only at a release qualification. The joint v2 qualification at G-SB spends the fresh holdout once. Deferral handled explicitly | RFC §12.2; C6; plan; decision register; checklist |
| 33 | Contract gap: packet style, group and fill-rule tables vs document `styleRef` and tree; export lacked transforms | C2–C5, C7 | C3.1 commit mapping; document authoritative after commit; `PathObject.fillRule`; export via a draw list baked in Rust (`bake_draw_list`) | C3.1, C4, C5, C8; RFC §5.1, §6.1; next-gate brief |
| 34 | Print preset phases conflicted (ROADMAP P2-C vs RFC §18 P3+ vs PRESETS P2) | ROADMAP; RFC §18; PRESETS | The flagship (Old Print, DIY Underground, press, Variation Lab) is P2-C. The other approved Print presets (Halftone, Screen Print, Poster, Comic Ink) stay P2, after the flagship. Advanced styles P3 | RFC §18; ROADMAP; PRESETS |
| 35 | Mockups vs normative tokens | `docs/mockups/*` vs DESIGN-SYSTEM §4 | Compared: palette tokens match. Mockup foreground `#e5e6e7` vs normative `#eeeef0`; mockups predate `control-border` and the dual focus ring; `#e6ddc6` is placeholder artwork. Mockups unchanged (visual references) | DESIGN-SYSTEM §9 |
| 36 | P-CI vs "G-CI" naming; stale "clippy not verified" sentence | RFC §19; plan | Unified to P-CI; baseline clippy exit 0 recorded | RFC §19; plan |
| 37 | Debt dispositions said "closure: As above" with no antecedent (TD-PERF-006) | TECHNICAL-DEBT | Replaced with explicit closure text | TECHNICAL-DEBT |

### Resolved by the G-0 closure clarifications (maintainer-requested, before the freeze)
| # | Inconsistency | Location(s) | Resolution | Where resolved |
|---|---|---|---|---|
| 38 | Commit could accept a packet the caller still aliases, or one mutated after validation | C2 "takes ownership; must be validated and freshly received" | Shape check → detaching move → validate owned bytes → publish; explicit `copyIncoming` only | C2; RFC §5.2, §6 |
| 39 | "Zero geometry copies for structural commands" vs legitimate render copies | C2 rule 4; next-gate brief | Host-driven render copies carved out; copies counted with no renderer attached; G-R0 checks held chunks | C2 rule 9; brief |
| 40 | Declared-bytes formula `16·(pathCount+1)` disagreed with the section table (`16·pathCount + 8`); no checked-arithmetic, layout or manifest-size rule | C3 caps; "offsets recorded in the header" | Exact C3.2 accounting; u64 checked arithmetic; offsets computed, not stored; geometry record; manifest ≤ 16 MiB | C3.0, C3.2 |
| 41 | `bytes().byOwnerKind` vs `total` undefined; shared geometry could bypass the anchor cap | C2; RFC §8.8 | Single-owner attribution (Σ = total); per-reference anchors via `pathAnchors` | C3.2; RFC §8.8 |
| 42 | §10.3 rule 3 superseded *any* pending job, including explicit ones; §7 silently discarded stale results | RFC §7, §10.3; C5 | Supersession for previews and thumbnails only; bounded explicit queue or `busy`; visible stale outcome | RFC §7, §10.3; C5 |
| 43 | Render-worker `ready{workerRaf}` had no build or protocol identity | C5 | Both workers hand-shake identity and generation before any post | C5; RFC §10.2 |
| 44 | "save → load → save byte-identical" and "fixed codec parameters" assumed deterministic native deflate | C7; RFC §14; plan; brief; traceability A14 | Canonical uncompressed content across browsers; whole-container identity within a qualified environment, or everywhere with codec `none` | C7; RFC §14; plan; brief; traceability |
| 45 | Dirty state defined by a content digest per edit, while high-water marks never move back (duplicate + undo would read dirty); chunk counter not persisted | C1; RFC §7 | State-identity dirty; `nextId` and `nextChunkId` persisted outside undoable state | C1, C7; RFC §5.1, §7 |
| 46 | Rect clips under nested groups and transforms had no defined export semantics; scene v1 rejects zero-area clips | RFC §12.3; C8 | P1 rect-clip rules: local space, exact axis-preserving check, intersection, fully clipped omission, one evaluation | C8; RFC §12.3 |
| 47 | Validator ownership was conditional ("if G-ENG lands first…"), with a path inside G-DOC's tree | Next-gate brief | One production validator (G-ENG, `src/geometry/packet/`); G-DOC uses a port and a test-only adapter; integration PR with a shared conformance test | Brief; plan |

**Residual open items** (explicit dispositions, not contradictions):
- lower-end and Safari qualification (owner prerequisites);
- G-SB possible deferral;
- Precision version allocation;
- provisional budgets awaiting G-UI and G-R1 measurement.
