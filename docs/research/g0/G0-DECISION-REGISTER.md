# G-0 — Decision register

**Sources.**
- Maintainer G-0 brief (2026-11-25).
- Maintainer G-0 closure and P1-A authorisation (2026-11-25), recorded in §5.
- Independent review [RFC-002-PROPOSED-AMENDMENTS](../rfc-002-review/RFC-002-PROPOSED-AMENDMENTS.md) and [FINAL-REPORT](../rfc-002-review/FINAL-REPORT.md).

The review's recommendation ("RFC-002 READY SUBJECT TO SPECIFIED AMENDMENTS") is **accepted**, and all 20 amendments are accepted in principle with the qualifications below.

**Status of these decisions.** Each records an **accepted architecture**, not a validated production implementation. The maintainer **approved** the reconciled RFC at G-0 closure (§5). All historical PARTIAL and NOT RUN results are unchanged.

## 1. Amendment dispositions
| # | Amendment | Disposition | Qualification (maintainer) | Rationale | Implementation consequence |
|---|---|---|---|---|---|
| A1 | Immutable geometry chunks | **ACCEPT** | — | Granularity was undefined. Per-object buffers make transfers expensive; per-layer buffers make edits copy whole layers | `(chunkId, pathIndex)` references; new chunks only for traces, bakes and geometry ops (RFC §5.2, C2) |
| A2 | Copy-out-only GeometryStore | **ACCEPT** | — | Typed arrays cannot be frozen; a mistaken transfer destroys committed artwork (demonstrated) | Store API with `jobCopy`/`renderCopy` only; refcounts by owner kind; tests assert no detachment (G-DOC) |
| A3 | Packet-only editor transport | **ACCEPT** | JSON fallback removed; scene v1 JSON kept for interchange and export adapters | Equal size, but 97–198 ms parse vs 8–20 ms validate at ~1M anchors | One editor transport (RFC §6, C3); export via packet → scene v1 adapter (G-ENG) |
| A4 | Derived geometry metadata | **ACCEPT** | — | The single validation pass derives bounds and subpath starts cheaply | Never transport bounds, subpath starts or anchor counts (C3) |
| A5 | Shared adversarial validation suite | **ACCEPT** | — | The review found a real validator gap on its first adversarial run | Shared fixture directory; TS and Rust agree case by case (G-ENG) |
| A6 | Canvas 2D renderer architecture | **ACCEPT WITH QUALIFICATIONS** | The four parts are mandatory (display cache, OffscreenCanvas host with a measured and disclosed main-thread fallback, linear Path2D, geometric hit testing), plus a progressive first frame, layered drag caches, immutable snapshots, revision-aware invalidation, worker recovery, bounded cache memory, DPR correctness, and interaction vs exact frames. **The layered drag cache is not qualified:** it must preserve compositing (RFC §8.4). Limits accepted and scoped (§8.8). WebGL2/WebGPU are revisit paths only, with no new comparison project | Measured: gestures 17–23 ms and main thread 17–19 ms with worker plus cache (3 engines); exact redraw misses budget in Firefox and WebKit | G-R0 (architecture, worker host, cache, index), G-R1 (layered caches, qualification matrix, lower-end, Safari) |
| A7 | Linear Path2D construction | **ACCEPT** | — | Chromium builds paths incrementally in quadratic time (16.9 s at 250k anchors) | Path data or qualified chunked `addPath`; scaling regression benchmark (G-R0) |
| A8 | Scheduler cancellation contract | **ACCEPT** | Bounded start-up timeout and recovery; requeue eligible jobs once; G-JOB reproduces the WebKit churn against the **production build** (offline, service-worker updates). The prototype is evidence, not proof | Previews could cancel exports; termination during module load broke WebKit offline | RFC §10.3; production client replaces `client.ts` (G-JOB) |
| A9 | Fail-closed worker protocol | **ACCEPT** | Protocol version, generation, job ID, revision; discarded messages counted and exposed | Stale results and errors must not commit | Protocol v2 (C5); diagnostics counters (G-JOB) |
| A10 | Two-stage complexity estimation | **ACCEPT WITH QUALIFICATIONS** | Approved TD-PERF-002 wording (RFC §11.1). The forecast is approximate, with a range and choices, never auto-rejects and never downsamples. The post-segmentation decision rejects before fitting with typed errors, using the ledger. False-positive and false-negative rates are validated on a separately reserved corpus. The 2 s forecast is a qualification requirement, not a guarantee | Segmentation is 66–99 % of colour trace time, so no pre-segmentation decision meets 2 s | Staged API (G-ENG); forecast UI and FP/FN validation (G-TRACE) |
| A11 | Shared-boundary graph | **ACCEPT WITH QUALIFICATIONS** | Precision v2 is opt-in; Artistic and v1 are frozen (326 and 72 hashes). Version ownership: provisional identifiers. G-GEO acceptance allocates no version; the integer is allocated by the maintainer only at a release qualification (planned v2 at G-SB acceptance, jointly with G-GEO; the fresh holdout is spent once there) (C6). Crisp-sampled sliver metric accepted; the antialiased metric is still reported. Thresholds retained. Emitted-geometry validation. **Fresh, pre-registered, untouched holdout**; `h-discs-three` and all 12 held-out fixtures recorded as exposed. Visual owner bundle. G-SB may defer to P2, visibly | Oracle labels remove only 76–81 % of slivers; the graph prototype is exact on 6 synthetic fixtures only | G-GEO then G-SB; RFC §12 |
| A12 | Typed recipe extensions | **ACCEPT** | No plugin or arbitrary-code runtime | Side inputs, composite outputs and stable seeds are needed by the Creative Lab | RFC §13; P1 seam only (descriptors); full stacks in P2-B |
| A13 | Keyboard history coalescing | **ACCEPT** | — | Base UI commits on every arrow key (5 commits for 5 keys) | Command-layer coalescing (G-DOC API, G-UI qualification) |
| A14 | Early project serialization | **ACCEPT** | Serializer and strict loader in G-DOC (P1-A); Save/Open UI in G-PRJ (P1-C). Sources embedded only with opt-in. Integrity is distinct from authentication. Dump utility. No autosave, libraries, recent files, OPFS/IndexedDB or cloud | The serializer is the best document-model oracle; artists must not lose work | Container v1 (C7) |
| A15 | Required source digest | **ACCEPT** | — | Needed for relinking, provenance and integrity | `SourceAsset.digest` required (RFC §5.1) |
| A16 | Design-system fixes | **ACCEPT WITH QUALIFICATIONS** | Exact R05-A pins as the initial baseline; no Radix; owned patches accepted; strict CSP with `CSPProvider disableStyleElements`; provenance and notices; provisional bundle budgets (150 / 15 / 250 KiB gz); mandatory accessibility incl. screen-reader smoke tests. 42/42 does **not** close the gaps. Visual identity preserved | R05-A qualified the direction and identified specific blockers | DESIGN-SYSTEM (normative); G-UI |
| A17 | Performance budgets | **ACCEPT PROVISIONALLY** | Targets unchanged and never silently lowered. Measurement scopes defined (C9). Profiles provisional, with measured values distinguished from extrapolated ones. Unknown hardware ≠ high-end. Lower-end qualification required before broad claims (borrowing acceptable; it does not block G-ENG or G-DOC). Background `ngspice` load disclosed | Review timings ran under load; no lower-end device | RFC §17, §11.4; G-R1 sign-off needs lower-end hardware |
| A18 | Revised P1 gate sequence | **ACCEPT** | 13 gates incl. G-0; G-ENG and G-DOC independent after contracts freeze; owner prerequisites attached per gate | The original had a circular dependency and an oversized P1-B | [G0-P1-IMPLEMENTATION-PLAN](G0-P1-IMPLEMENTATION-PLAN.md) |
| A19 | Online build variants | **ACCEPT** | Before any online adapter: variants, CSP and `_headers`, secrets, attribution, network boundaries. No upload. No deployment, domain or DNS work now | R8 was deferred, not designed | RFC §15.2; post-core prerequisite |
| A20 | Read-only renderer boundary | **ACCEPT** | Enforced by an architectural test or lint rule | Renderer must never become a geometry authority | RFC §8.7, C8; G-R0 |

## 2. The review's unresolved decision categories (all 12 addressed)
| # | Category (review FINAL-REPORT) | Maintainer decision (G-0) | Consequence |
|---|---|---|---|
| 1 | Amendments A1–A20 | All accepted in principle, with qualifications (§1) | Integrated into RFC-002 |
| 2 | Performance budget and lower-end hardware | Targets retained, provisional. Lower-end qualification on an M1 8 GB and a 4c/8t ~8 GB laptop; borrowing acceptable; no broad claims before G-R1 qualification; does not block G-ENG or G-DOC | RFC §17; TD-PLATFORM-003; G-R1 owner prerequisite |
| 3 | TD-PERF-002 wording | **Approved:** "Provide a complexity forecast within two seconds on qualified workloads, followed by a definitive resource-budget decision after segmentation and before expensive fitting." | RFC §11.1; debt register |
| 4 | TD-GEO-001 metric restatement | Crisp-sampled metric accepted (4×, 0.25 px²); the antialiased metric still reported; thresholds retained | RFC §12.4; TD-GEO-010 |
| 5 | Save/Open scope | Serializer in P1-A (G-DOC), UI in P1-C (G-PRJ); source opt-in; P1 exclusions as listed | RFC §14; C7 |
| 6 | Core preset order | P1: B&W, Full Colour, Limited Palette, Grayscale, Silhouette. P2-A: Line Art (+ TD-GEO-005). P2-C: Old Print, DIY Underground, Virtual Printing Press, Variation Lab | RFC §18; PRD, ROADMAP and PRESETS updated |
| 7 | Real Safari | Approved in principle; `sudo safaridriver --enable` documented, to be run by the maintainer locally only; Playwright WebKit never reported as Safari | Plan "Platform qualification"; TD-PLATFORM-002 |
| 8 | CI policy | One required lightweight Linux job before P1-A PRs merge; heavy suites local; **specification only at G-0** | Plan "P-CI"; TD-PROCESS-001 |
| 9 | Canonical Linux builds | Approved for future published artefacts and hashes; native amd64 preferred; amd64 unqualified until recorded | TD-PLATFORM-001 |
| 10 | Design-system bundle budget and owned patches | Budgets 150 KiB JS / 15 KiB CSS additional and 250 KiB total initial UI JS (gzip), provisional; owned patches accepted | DESIGN-SYSTEM §7, §1 |
| 11 | Online build variants | A19 accepted; required before any online adapter | RFC §15.2 |
| 12 | Renderer scope | Canvas 2D with the mandatory parts; the extra worker copy (45–52 MB per 1M anchors); the 250k interactive target (not a hard limit); ~40k paths; 500k–1M stress; 1M cap | RFC §8.8 |

## 3. Additional decisions recorded at G-0
- **Principles reaffirmed** (RFC §2). MIT holder `Copyright (c) 2026 Stephane Pericat`, verified in `LICENSE`. The stale `CONTRIBUTING.md` sentence was corrected.
- **Geometry authority.** The P0 visual findings stand: circles were not approved in v1. Curve-fitting and shared-boundary defects are qualified independently (RFC §12.1).
- **Limits scoping** (RFC §8.8):
  - the 1M cap applies per document (all layers, visible or hidden) and per job;
  - the interactive target and stress workloads apply per rendered snapshot;
  - history-retained geometry is budgeted in bytes.
- **Single-build service-worker sessions** (RFC §15.3), adding TD-PLATFORM-006 (source inspection).
- **Merge order** (**authorised** at G-0 closure, §5):
  1. PR #6 into `docs/rfc-002-vector-studio` (merge commit);
  2. the reconciliation PR into the same branch (merge commit);
  3. PR #4 into `main`.

  Merge commits only, with no squash or rebase, to preserve review SHAs.
- **No deployment, domain, DNS, Cloudflare, CI or runner changes during G-0.**

## 4. Decisions still pending the maintainer
See [G0-OWNER-ACCEPTANCE-CHECKLIST](G0-OWNER-ACCEPTANCE-CHECKLIST.md):
- lower-end hardware access;
- local Safari automation authorisation;
- Precision version allocation at geometry-gate acceptance;
- the G-SB deferral decision if it arises;
- ratification of the provisional budgets after measurement.

## 5. G-0 closure (maintainer, 2026-11-25)
**Approved:**
- the reconciled RFC-002;
- contracts C1–C9, subject to the clarifications below;
- all 20 amendment dispositions;
- the 13-gate plan;
- the design-system specification;
- the debt register (37 open items);
- the provisional performance and resource budgets;
- the core preset order;
- the minimal CI specification.

**Confirmed interpretations:**
- the 1M-anchor cap applies per document (hidden layers included) and per job;
- 250k anchors and ~40k paths are rendered-snapshot performance targets, not editing limits;
- history is budgeted by retained bytes;
- G-GEO allocates no Precision version, and v2 is the joint G-GEO + G-SB qualification. If G-SB defers, a separate maintainer decision governs a G-GEO-only release;
- after commit, the document is authoritative for effective style, fill rule, transforms, visibility, order and clipping;
- single-build service-worker sessions are mandatory;
- the disclosed main-thread renderer fallback is acceptable, subject to qualification;
- layered drag caches must preserve compositing;
- the 24 MP B&W target is import → visible;
- the colour final target includes committed-and-visible output;
- the exact settled-frame target is set only after G-R1 measurement.

**Authorised:**
- the merge sequence (PR #6, PR #7, PR #4, merge commits only);
- P-CI as a separate PR;
- G-ENG and G-DOC after P-CI, as two independent PRs, neither merged without further acceptance.

### 5.1 Contract clarifications (before the freeze; contract versions unchanged)
These resolve implementation-level ambiguities named by the maintainer. **None departs from an accepted architectural decision.** They landed before the freeze, so C2, C3, C5, C7 and C8 stay at their initial versions.

| ID | Ambiguity | Clarification | Rationale | Where |
|---|---|---|---|---|
| CL-1 | C2: a caller could keep a typed-array alias and mutate committed geometry. "Validated and freshly received" allowed validate → mutate → commit | Commit is a fixed sequence: shape check (whole-buffer, distinct, non-shared, non-resizable) → **move** with `structuredClone(…, {transfer})`, detaching every alias → **validate the store-owned bytes** (no pre-validated fast path) → publish. Commit consumes its input. Explicit `copyIncoming()` is the only copy; commit never copies implicitly. A fail-closed startup check covers endianness and detaching transfer. Runtime tests, not TypeScript `readonly` | A move is zero-copy, so it fits the 50 ms commit budget alongside the 8–20 ms validation (R01). Re-validating after the move removes the TOCTOU window. Detachment is observable and testable. No browser versions are frozen | C2; RFC §5.2, §6 |
| CL-2 | C2: "no copies for structural commands" vs render copies | Commands never copy. Render copies are host-driven: initial population, recovery, a new chunk entering a snapshot. G-DOC tests count copies with no renderer attached; G-R0 asserts zero render copies for structural edits of held chunks | Separates command purity from renderer lifecycle | C2 rule 9; brief |
| CL-3 | C3: inexact size formula, unchecked arithmetic, unspecified serialized layout | Exact section sizes; `M_mem = V + 8C + 16P + 8` (the old formula overstated by 8 bytes); derived `D = 36P + 4S`; ledger cost `M_mem + manifestBytes + D`; caps on `M_mem + D_max`, P, V ≤ 2A, C ≤ 6A, a manifest ≤ 16 MiB, table and string caps — all **before allocation**. Rust uses `u64` checked arithmetic (wasm32 `usize` is 32-bit); TS uses integer and range checks plus `isSafeInteger`. C3.0 block: offsets computed from counts (not stored), zero padding, `padding` code; geometry record layout | Overflow safety on wasm32; one unambiguous byte layout; the bounds follow from the scene-v1 grammar | C3.0, C3.2 |
| CL-4 | C3: `byOwnerKind` vs `total`; shared geometry vs the anchor cap | Each chunk is counted once and attributed to its highest owner (document > snapshot > job > history), so Σ = total; history-only bytes = `byOwnerKind.history`. Anchors are counted **per PathObject reference** (`pathAnchors` added to the derived metadata). Commands that raise the count are checked before commit; exports re-validate | Storage deduplication must not bypass the product cap | C3.2; RFC §8.8 |
| CL-5 | C5: "a newer submission supersedes the pending one" vs never cancelling explicit jobs; RFC §7 silently discarded stale results | Supersession for previews and thumbnails only. Explicit jobs are accepted into a bounded queue (capacity 4, provisional) or rejected with `busy` **before** acceptance. An accepted job always ends in a visible outcome (committed, delivered, failed, stale, cancelled). Stale explicit results offer "commit as a new layer" or "discard"; exports never go stale | Never silently discard an accepted explicit operation | C5; RFC §7, §10.3 |
| CL-6 | C5: the render worker's `ready` carried no identity | Both workers post `ready` with `{protocolVersion, buildId, packetVersion}` (+ `engineVersion` for compute) at startup and on every recreation. `generation` is bound by main and echoed. Nothing is posted before the handshake passes, which is the R03 prototype's ordering, so its WebKit evidence applies. A mismatch is fatal build skew (no requeue; `build_mismatch`; reload) | Build skew is possible through the service worker (TD-PLATFORM-006) | C5; RFC §10.2 |
| CL-7 | C7: "byte-identical save/load/save" assumed deterministic native compression | Canonical content = uncompressed sections (RFC 8785 JSON with ID maps in JCS order; C3.0 records), identical across browsers along with `sha256`. Cross-browser files are semantically equal. Whole-container byte identity is required within one qualified environment (same build, engine and version) and across all environments with codec `none`. A deterministic compressed codec would be a new codec id | `CompressionStream` has no parameters and is not specified to be deterministic | C7; RFC §14 |
| CL-8 | C7: high-water marks and dirty state | `nextId` and `nextChunkId` are persisted and sit outside undoable state. Dirty state is state identity (`currentState !== savedState`), with no per-edit hashing. Digests are computed at save time, for integrity, relink and "unchanged since save" | Duplicate followed by undo must be clean; hashing large documents per edit is too costly | C1, C7; RFC §5.1, §7 |
| CL-9 | C8: nested and transformed rect clips through the scene-v1 adapter | One rect clip per Layer or Group, in local coordinates. Axis-preserving composed transforms only, checked exactly; anything else is rejected at command validation (`clip_transform_unsupported`) with Release clip offered. Nested clips intersect; an empty intersection is fully clipped (not drawn, hit or exported). One evaluation feeds preview, hit testing and export. Export runs may be empty, so empty groups round-trip. No bounding-box approximation. Arbitrary and rotated clips need scene v2 (before Halftone ships, P2) | Scene v1 holds one axis-aligned clip per group and rejects zero-area clips; P1 presets emit no clips | C8; RFC §12.3 |

**Blockers introduced:** none. **Architectural departures:** none.

## 6. Amendment set AM-1 (P1-A corrective review, maintainer, 2026-11-25)
**Accepted and processed through change control** (contract revisions in the [contracts](G0-ARCHITECTURE-CONTRACTS.md) table and §AM-1). No serialized version changed.

| ID | Decision | Contract revision | Rationale |
|---|---|---|---|
| AR-1 | Byte streams: steps 1–2 on the manifest, then block `length`/`padding`, then steps 3–12 | C3 r2 | The block length depends on validated counts |
| AR-2 | Export draw list carries `paletteId`, the artboard size and packet-set indices | C5 r2, C8 r2 | Unedited P0 exports need palette ids to keep their hashes |
| AR-3 (qualified) | Identical validated scenes produce byte-identical packets across Rust, WASM and TS. Native/WASM tracing identity stays an unresolved requirement (TD-PLATFORM-007) | C3 r2 | Packet encoding is deterministic. The tracing difference exists on the frozen G-0 baseline and is not changed in this gate |
| A1 | `derived()` returns a frozen accessor view | C2 r2 | Store arrays must never be detachable |
| A2 | Empty run only when a container's whole subtree emits nothing; `run-<k>-<n>` on collision | C8 r2 | The literal rule broke the unedited-export guarantee |
| A3 | Clip origin = minimum transformed corner, extent = `|scale|` × size; contained intervals keep exact extents | C8 r2 | Corner min/max is not bit-exact |
| Schema | `stylesById`, palette names, artboard background; TraceProvenance v1; export metadata semantics; effect stacks absent in v1; source provenance `local-file`; closed `decodePolicy` enum | C10 r1 | Missing provenance blocked G-DOC acceptance |
| Container | Header-relative offsets; contiguous sections | C7 r2 | Absolute offsets would make the header length self-referential |
| Tolerance | Transform entries `|v| ≤ 1e9`; condition number ≤ 1e8 | C10 r1 | Bounded non-singularity |

**Version dispositions:**
- `packetVersion` 1, `protocolVersion` 2 and container `formatVersion` 1 are unchanged.
- `documentSchemaVersion` stays 1, because no file has been released (finalised before first release).
- `provenanceVersion` 1 is new.
- After the first public release, any change to these needs a version bump and a forward-only migration.

**Shared by both gates.** This set lives on one branch, merged with merge commits into G-ENG (PR #10), G-DOC (PR #11) and the integration branch, so both gates implement the same text.


## 7. P1-A foundation acceptance (maintainer, 2026-11-25)
**Disposition.** The integrated G-ENG and G-DOC foundation is accepted for merge with explicit performance exceptions. Correctness, ownership, persistence, provenance, packet integration and end-to-end export evidence are accepted. Historical dispositions are preserved: **G-ENG PARTIAL, G-DOC PARTIAL**; P1-A integration correctness accepted. Unmet performance requirements are not marked PASS. No further broad architecture review is required. The P1-A phase is not complete until its remaining gates are accepted.

**Merges** (merge commits only; heads verified before each merge):

| PR | Approved head | Merge commit |
|---|---|---|
| #13 AM-1 | `801155523adbd028ea00d93417fc4eb018fc24a0` | `cb6646feb651e73bdbd387069a59c7976698b1b9` |
| #10 G-ENG | `ed3994efd0334cebce4ce2b7ebd29789da7fb3e1` | `f83f880895a1939574ade8ecc9e620f5ed27bf67` |
| #14 Integration | `bb95b1694a9f7a6da690aa17eb3c67927b87b142` | `80a1d1ad8a1ddad8ae2218bf5a86897f1b7d4ebd` |
| #11 G-DOC | `38afd35c18e87e7fac97543b5e1d8d65780a54f8` | accepted as part of #14; GitHub marked it merged (recorded merge commit `b7f3580`, the integration branch's merge of `38afd35`) |

**Integrated P1-A baseline:** `80a1d1ad8a1ddad8ae2218bf5a86897f1b7d4ebd` (tree identical to #14's head `bb95b16`).

**Branch protection (`main`).** Tightened as approved: `strict: true`, `enforce_admins: true`; required GitHub Actions check `ci` (app 15368) retained; force pushes and deletions prohibited (already so); every other setting preserved. No external approval requirement.

**Accepted performance exceptions** (non-blocking for G-JOB; targets retained, never lowered):

| Exception | Decision | Obligation | Owner gate |
|---|---|---|---|
| WASM copy-out at 1M anchors above 2 ms (TD-PERF-008) | Keep the single-copy implementation. Do not redesign GeometryPacket v1, reduce coordinate precision or weaken buffer ownership | Re-run the existing benchmark on a quiet reference machine when available: median, p95, workload hashes, byte counts, runtime, timer resolution | performance follow-up |
| Project open at 250k paths above 1 s (TD-PERF-009) | Bounded compact Document v1 serialization follow-up, before public release: omit canonical default-valued node properties without changing the in-memory model | Pre-registered workloads; the original representation kept as a benchmark control; unambiguous canonical defaults; strict schema validation, deterministic canonical sections, integrity checks and decompression limits, project semantics, export hashes, provenance and ID high-water marks preserved; cross-browser interchange; explicit compatibility with development fixtures; frozen-contract amendment for any adopted schema change; no binary format or new dependency without approval. Measure 50k and 250k paths at 1M anchors against ≤ 1 s, and explain the single-pass profile vs repeated end-to-end gap (allocation, GC, warm-up, instrumentation boundaries). The earlier scratch experiment is preliminary evidence only | before G-PRJ qualification and public Document v1 release; independent of G-JOB |
| Structural transactions O(nodes) (TD-PERF-007) | Closure criteria approved: median ≤ 16.7 ms and p95 ≤ 33 ms at the interactive target; ≤ 50 ms at the designated 1M-anchor stress workloads; incremental and full validation agree over ≥ 10,000 randomized transactions; full validation stays mandatory for untrusted loads | Investigate structural sharing and incremental validation during G-R1; no document-store rewrite during G-JOB | qualification before G-EDIT acceptance |
| Main-thread responsiveness | G-TRACE and G-PRJ must qualify ≤ 50 ms attributable main-thread blocking; total wall-clock time does not establish responsiveness | Bounded scheduling, time slicing or worker preparation, preserving atomic commits and loads; real browser task durations | G-TRACE, G-PRJ |

**Other accepted exceptions:**
- **TD-PLATFORM-007** stays open. Identical validated scenes must keep producing identical packets across Rust, WASM and TS; native/WASM Artistic differences remain a separate unresolved issue. Artistic and Precision v1 are not modified.
- **Malformed-manifest-text error codes** (G-ENG corrective finding 5): accepted as a bounded exception to cross-runtime error-code equivalence. Scope and the pinned regression test: `tests/fixtures/packet-conformance/README.md`. Malformed inputs must remain rejected by every runtime.

**Benchmark conditions.** Never terminate or interfere with unrelated Shortwav Labs processes. A run is labelled quiet only when its recorded machine conditions support it; otherwise quiet runs stay NOT RUN and independent work continues.

## 8. G-JOB conditional acceptance (maintainer, 2026-11-25)
**Disposition.** G-JOB is accepted in principle for downstream engineering, subject to bounded service-worker corrections (template-only update regression; never serving another build's shell when the controlling cache lacks it; first-install claiming and non-hashed fallbacks reviewed). Historical dispositions are preserved: **G-ENG PARTIAL, G-DOC PARTIAL, G-JOB PARTIAL**; P1-A integration correctness accepted. Merging PR #15 with a merge commit is authorised once the corrections pass, the report is updated, the required check passes and the regression evidence and final diff are verified.

**TD-PERF-010 accepted as a temporary, non-blocking performance exception for G-JOB.** The ≤ 50 ms attributable main-thread blocking target is unchanged; the measured misses stay in the debt register. No document-store rewrite or broad optimisation inside G-JOB.

**Corrective-work ownership:**

| Gate | Obligation |
|---|---|
| G-R1 | Investigate TD-PERF-007: structural sharing, incremental invariant validation, efficient immutable state preparation, no unnecessary full-document traversals. Keep the approved thresholds and the independent full-state validation oracle |
| G-TRACE | Qualify responsive trace-result preparation and atomic commit (off-thread preparation or bounded time slicing). Publication is atomic, revalidates revisions, preserves source and geometry provenance, rejects stale prepared results, preserves undo/redo, and leaves committed artwork unchanged on failure or cancel; covers cancellation and revision changes during preparation |
| G-EXP | Qualify responsive frozen-snapshot construction and geometry copy-out; an accepted export stays independent of later edits; snapshot ownership and immutable geometry are not weakened |
| G-PRJ | Qualify responsive project opening, including the compact Document v1 follow-up; ≤ 1 s open and ≤ 50 ms blocking are separate requirements |

**General.** No performance threshold is lowered. Quiet-machine measurements remain required, never obtained by terminating unrelated processes. Performance debt is not closed merely because an implementation merged.

**Real Safari.** The maintainer enabled `safaridriver` on the reference Mac (2026-11-25); real Safari qualification is authorised for G-JOB, G-R0 and G-UI.

## 9. G-R0/G-UI acceptance and G-R1 integration (maintainer, 2026-11-25)
**Disposition.**
- The G-R0 renderer foundation and the G-UI visual direction are accepted in principle.
- Historical dispositions are preserved: **G-ENG PARTIAL, G-DOC PARTIAL, G-JOB PARTIAL, G-R0 PARTIAL, G-UI PARTIAL**.
- The real Safari qualification results are accepted within their documented scope.

**Temporary exceptions; no target lowered.** G-R0's outstanding preview (≤ 100 ms complete preview at the interactive target) and cold hit-index (≤ 50 ms blocking) requirements are accepted as temporary exceptions for downstream integration. No numerical target is lowered.

**G-UI.**
- The visual direction is approved: charcoal workspace, lime accent, ivory artboard, professional creative-software density.
- Still outstanding: final visual polish, keyboard path selection and VoiceOver qualification.
- Accessibility requirements are not waived.

**Merge.** PR #16 and PR #17 were authorised to merge with merge commits only, after verification of the combined tree. That verification covered:
- the build, `vp check` and `vp test`;
- the shared canvas-host contract;
- third-party notices;
- the browser regression suites;
- service-worker precache and build identity for both entry points;
- duplicate dependencies.

Record of execution:

| Step | Result |
|---|---|
| Integration branch | `integration/g-r0-g-ui` (`3755bcd`, tree `36cb205`) |
| Static checks | Frozen install; `pnpm dedupe --check` clean (one React 19.3.1); `vp check` clean on tracked files; `vp test` 372/372; build passes; notices verified (55 components), and regenerating them gives no diff; `types.ts` identical (`c9a30060…`) |
| Build identity | One build ID (`77059d538db122e8`) across both entries, both workers and `sw.js`. Every asset either page references is among the 11 precached files |
| Browser suites | 225 passed, 0 failed, 0 flaky (24 opt-in skips), Chromium, Firefox and Playwright WebKit |
| Real Safari 26.6.2 | G-JOB 10/10, G-R0 7/7, G-UI 14/14, persistence 23/23 |
| #16 | Merged as `d975855` |
| #17 | Updated from `main` by a merge (`34b6a9f`, tree `36cb205`); `ci` run 45672878965 passed; merged as `7f57dd7` |

**Resulting baseline: `main` = `7f57dd716bdbec0a6160da3585b445852f464859`.** Its tree is `36cb205`, the tree verified above.

**Debt.**
- TD-REN-001 is closed.
- TD-REN-002: real Safari worker-canvas feasibility is demonstrated; end-to-end presentation-latency qualification stays in G-R1.
- TD-REN-003, TD-REN-004, TD-PERF-001, TD-PERF-007 and TD-PERF-010 remain open.
- The strict-CSP (TD-UI-001) and third-party-notice (TD-UI-004) solutions are approved, subject to regression verification on the combined application. That verification passed (above).
- Accessibility debt stays open while VoiceOver and keyboard path selection are unqualified.
- Mobile and the remaining platform qualifications are preserved.

**G-R1 scope.**
- Integrate the actual G-R0 `VectorCanvas` into the workspace and remove the temporary SVG preview.
- Targeted reviews:
  - build-aware offline status;
  - selection semantics;
  - import concurrency;
  - renderer lifecycle, including StrictMode.
- Transform handles and compositing-preserving layered drag caches; the RFC §8.4 matrix is mandatory.
- Bounded hit-index construction, qualified on the 977k-anchor halftone.
- The TD-PERF-007 investigation: the full validator stays the independent oracle, and at least 10,000 randomized comparisons are required before an incremental validator is accepted.
- Performance qualification with stages separated, including Safari presentation.
- Keyboard path selection and a real VoiceOver smoke test, or an owner checklist.

**G-UI-R** follows the renderer integration, as a separate PR using the installed Impeccable skill.

**R-COLOR** (issue #5) is an independent research track; no production colour-management implementation is authorised.

**Git policy.**
- The 17 G-UI screenshots (2.8 MB) are a one-time visual-baseline exception. From now on, only representative milestone screenshots go in Git.
- Amending unpublished local commits is acceptable.
- Git or worktree safety guards are never circumvented with alternative commands or plumbing.

## 10. G-R1 and G-UI-R maintainer review (maintainer, 2026-11-25)
**Disposition.**
- The integrated workspace and the refined visual direction are accepted in principle.
- All historical PARTIAL dispositions stay unchanged.
- The G-UI-R direction is preserved: the docked workspace, the compact property inspector, the expanded canvas, the typography and the charcoal/lime/ivory identity. G-UI-R's binding design decisions are recorded in its report (§14) and DESIGN-SYSTEM §13.

**G-R1 architecture: accepted.**
- The additive canvas-host contract amendment: `transformable` and `onTransform`.
- The pointer model:
  - click selects;
  - dragging selected objects moves them;
  - Space-drag and the middle button pan;
  - corner handles scale uniformly, edge handles along one axis;
  - Alt scales about the centre;
  - Escape cancels;
  - one completed gesture is one undo transaction.
- The compositing-preserving layered drag-cache architecture.

**Locks.**
- A transform never moves a locked object.
- The protection extends to destructive operations. Deleting a container must not silently delete its locked descendants: the deletion is refused, with an actionable explanation, until those descendants are unlocked.
- Global palette edits may keep affecting locked objects that reference the edited entry, provided this is clearly communicated.
- Lock semantics are tested across pointer interaction, keyboard commands, inspector operations and undo/redo.
- Implementation (#19):
  - Locks stay a shell policy (`planDeletion` in `src/shell/document.ts`). Document commands do not enforce locks, so the frozen document architecture is unchanged.
  - Directly locked items in a deletion are kept and reported.

**Canvas focus indicator (#19).**
- Fixed at the canvas-host level, not through a shell workaround. A visible ring is drawn above every canvas layer and follows `:focus-visible`.
- It is verified from rendered pixels in Chromium, Firefox, Playwright WebKit and real Safari.
- The G-UI-R shell workaround is removed after #20 takes the corrected #19 head.

**Test races.** The two race fixes found on the G-UI-R branch, including the bounded diagnostic read, are brought into #19 as cherry-picks.

**Performance disposition.**
- G-R1's complete-preview miss at the interactive target is accepted temporarily for downstream engineering. TD-PERF-001 and every numerical target are retained.
- Grading distinguishes interactive and stress workloads (RFC-002 §8.8):
  - ≤ 250k anchors and ~40k paths: the interactive target, which carries the preview ≤ 100 ms target;
  - 500k–1M anchors: stress workloads for qualification.
- The 977k-anchor halftone stays measured. No identical 100 ms threshold is invented for stress workloads where the RFC specifies the interactive target.
- The quiet-machine and lower-end-hardware qualifications are retained.

**G-DOC-R authorised (TD-PERF-007, TD-PERF-011).** The investigation's options B, C and D are authorised, in that order, as a dedicated follow-up gate, separate from visual refinement. Scope and requirements: [G-DOC-R-SCOPE.md](../g-doc-r/G-DOC-R-SCOPE.md).

**Accessibility and owner acceptance.**
- VoiceOver remains mandatory.
- The exact build and the updated owner checklist are provided for manual testing. The stock-Safari keyboard check is kept.
- Neither is marked PASS until executed.

**Workflow.**
- #19 is updated first. Its corrected head is then merged forward into #20.
- Both CI checks are verified, and the applicable browser suites, stress tests, real-Safari harnesses and bundle measurements are re-run.
- The three PRs (#18, #19, #20) stay independently reviewable. None is merged automatically.
- Not started: production CMYK, Precision v2, new creative tools, deployment. R-COLOR (#18) receives a separate research review.

## 11. G-DOC-R stage B/C acceptance and AM-2 authorisation (maintainer, 2026-11-26)
**Dispositions.**
- G-BRAND integration is accepted (#21, merged as `0e95737`).
- G-DOC-R stages B and C are accepted as **implementation checkpoints** at `9ae294f`, including the validator correction in `fd06b5a`.
- The G-DOC-R gate as a whole remains open and unqualified.
- The interactive dispatch improvement is accepted. The 756k-anchor borderline result and the 996k-anchor stress misses stay recorded.
- No qualification threshold is relaxed.

**AM-2 is approved** (recorded in [G0-ARCHITECTURE-CONTRACTS §AM-2](G0-ARCHITECTURE-CONTRACTS.md)):
- **AM-2.1.** C3 r2 → r3: document-structure accounting covers every materially retained structural allocation. It uses deterministic, checked integer costs, reported as accounted bytes distinct from measured heap, with no double counting of geometry or source bytes.
- **AM-2.2.** RFC-002 §7 is amended. The limits are kept (100 transactions; 128 / 64 MiB). Earlier oldest-first eviction is authorised, the visible truncation is kept, and serialized versions are unchanged.
- **Shared allocations:** the highest-precedence ownership rule. Ownership transitions are to be verified for:
  - an edit;
  - a state entering history;
  - undo and redo;
  - discarded redo;
  - eviction;
  - a replaced or closed document.
- **Map ordering:** deterministic bucket iteration, with no insertion-order index. Persistence, export, rendering, layer order and user-visible behaviour stay unchanged. A different first error for a document with several defects is acceptable; single-defect rejections must be equivalent.

**Stage D is authorised** under these requirements:
- calibration of the cost model against the integrated implementation, with separate validation workloads;
- an expanded adversarial corpus;
- a reference accounting oracle;
- an independent adversarial review;
- palette and renderer measurements against the verified G-BRAND `main` baseline;
- final qualification at all three workloads.

No new dependency, serialized-format change, unrelated UI change, vectorization change or colour-management work is authorised. R-COLOR is left untouched. Do not merge without maintainer acceptance.

## 12. G-DOC-R maintainer acceptance and final closure (maintainer, 2026-11-26)
**Disposition.** Stage D is accepted **as an implementation, subject to the final accounting closure**. Reviewed head `1a7b45f1caea8f06490653f79908773d07a29a8e`; CI run 45895279690 independently verified. The overall G-DOC-R disposition remains **PARTIAL**.

**Accepted:**
- the ID-ordered chunked persistent NodeMap, replacing hash buckets;
- the persistent parent index;
- the AM-2 deterministic accounting architecture;
- the history delta ledger and the reference oracle;
- the documented conservative over-counts;
- review fixes C1, C2 and C4, and the recorded C3 and C5 limitations;
- the deterministic test-infrastructure fixes;
- Node dispatch qualification at all three workloads;
- the existing privacy exclusions and reduced regression counts.

The temporary renderer performance regressions are accepted and must stay explicitly tracked (TD-PERF-012). No threshold is relaxed.

**Final accounting closure required:**
- investigate the 0.987 residual (the suspected geometry typed-array header overhead);
- correct the term through the appropriate contract procedure, or justify a conservative deterministic margin;
- do not conceal the original result or change the 128 / 64 MiB budgets;
- preserve the GeometryStore contract unless an amendment is required, and avoid double counting;
- freeze constants before a fresh validation that includes traced-layer replacement and large structural deletions;
- report uncertainty, and do not tune against the inconclusive small eviction case;
- claim no universal conservative browser heap accounting from Chromium alone;
- re-qualify the accounting, ownership, eviction and retention tests.

**Browser dispatch:** measure production session dispatch in Chromium, Firefox and WebKit, separately from renderer scheduling, on the incremental path, for all 12 types (median and p95), or report the precise blocker and stay PARTIAL.

**M-7.** Stage D implementation accepted, subject to the accounting closure.

**M-8 (TD-UI-006).** A future explicit commit-without-history confirmation is authorised but not implemented in G-DOC-R. The existing refusal stays until that UI is qualified. Requirements:
- the confirmation discloses that the current implementation clears the existing undo and redo history;
- Cancel is the safe default;
- users can save a project copy before proceeding.

It is recorded as a follow-up associated with G-PRJ.

**M-9.** Incremental `paletteLabels()` with Recolor virtualisation is approved for a separate G-COLOR-UI gate, not this PR. Strict provenance and palette semantics are preserved, and retained usage indexes are accounted under AM-2.

**G-PRJ, the next product milestone** (recorded in [ROADMAP](../../ROADMAP.md)):
- **Scope:**
  - Save, Save As and Open for portable `.vectra` projects;
  - complete artwork and editable-document restoration;
  - unsaved-change tracking;
  - local autosave and crash recovery;
  - recent projects;
  - browser storage quotas and eviction;
  - safe atomic writes where supported;
  - a download/upload fallback;
  - version compatibility and malformed-file rejection;
  - project replacement and save-failure recovery;
  - integration with the oversized-edit confirmation.
- **Constraints:** the existing `.vectra` format is the starting point; local-first, offline and no-account use are preserved; autosave is not a substitute for portable files.
- **Not begun.**

**Not started:** G-PRJ, G-COLOR-UI, Precision v2, production CMYK, deployment. R-COLOR is left untouched. PR #22 stays unmerged until the final closure is reviewed.

**Closure outcome** ([G-DOC-R report §7.1, §11.1, §13](../g-doc-r/G-DOC-R-REPORT.md)):
- **Accounting.**
  - The residual was the store's per-chunk record: a fixed part of about 3.1 KB (1.8 KB of typed-array headers), plus the manifest's style and group tables beyond their JSON length.
  - It is now accounted under term 3, with C3.2's chunk cost and C2 unchanged; M-10 asks for confirmation.
  - The first, fixed-size correction was superseded after review found it under-counted chunks with many styles.
  - Fresh validation with the re-frozen model: 1.001–1.252 at the median.
- **Browser dispatch.**
  - Met in all three engines at the interactive target and at 756k anchors.
  - Met in Chromium and Firefox at 996k anchors.
  - Missed in Playwright WebKit at 996k for applyTransformLayer (59 / 68 ms; reproduced).
  - The gate stays PARTIAL.

## 13. G-DOC-R final acceptance (maintainer, 2026-11-26)
**M-10: approved.** The geometry store's per-chunk record is counted under AM-2 term 3 as an additional retained structural resource. **No C3 r4 amendment is required.**

The model frozen at `729e63a` is accepted:
- the fixed 3,136-byte record cost;
- the manifest's structural cost beyond its already-accounted JSON length;
- the typed-array header cost of 216 bytes;
- the existing C3.2 owner precedence;
- no duplicate charging of chunk payloads or manifest JSON bytes.

The original calibration results, the superseded flat-cost correction and the fresh validations stay recorded. The small eviction measurement remains inconclusive. No further cost-model tuning is requested.

**Implementation acceptance.** G-DOC-R is accepted as an implementation suitable for downstream integration, with its historical PARTIAL disposition retained.
- Reviewed head: `06fd71361e35a4f451709fadc774aba677307887`; CI run 45924593291 independently verified.
- **The WebKit stress miss is temporarily accepted:** 996k anchors, applyTransformLayer 58–59 ms. The 50 ms stress threshold is unchanged.
- A potential future subtree-summary optimisation is recorded against TD-PERF-007.
- The renderer regressions stay tracked under TD-PERF-012.
- No further architectural redesign is authorised.

**Final integration checks, before merging:**
- record M-10 as approved here and in the AM-2 explanatory note;
- run the outstanding real-Safari gui, G-R1, G-JOB and G-R0 harnesses on the final application build, with the screen unlocked and visibility verified;
- keep the passing persistence result on that same build;
- record F-16 as a known WebKit test failure that predates G-DOC-R. Its reproduction on the baseline supports the temporary exception. The assertion is not suppressed, and the failed run is not reported as clean;
- verify the required CI on the exact final head.

Then merge PR #22 with a merge commit, and verify main CI, ancestry and the resulting tree. Follow the evidence-preservation policy before removing worktrees.

**Open; none blocks internal integration:**
- real Safari dispatch;
- lower-end hardware;
- quiet-machine qualification;
- heap evidence from engines other than Chromium;
- the owner accessibility checks.

**G-PRJ** stays the next product milestone, followed by G-COLOR-UI. Its roadmap entry now carries the persistence limit found here, which the 330k-path, 996k-anchor workload exceeds (C7's 64 MiB document-section cap), and the requirements that follow from it ([ROADMAP](../../ROADMAP.md)). Any C7 amendment requires explicit change control. G-PRJ implementation is not begun.

**Integration checks run (2026-11-26):**
- real Safari 26.6.2 on the final application build `cdced0f2b2791fd7`, with the screen unlocked and the page visible before and after each harness: gui 14/14, gr1 7/7, gjob 10/10, gr0 7/7, persistence 23/23;
- CI run 45926294978 succeeded on `b37f87c`;
- F-16 recorded as TD-UI-007.

R-COLOR is left untouched. No deployment or release tag.

