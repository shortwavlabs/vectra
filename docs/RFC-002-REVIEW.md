# RFC-002 independent engineering review

Status: requested; NOT RUN. Baseline baf1d17972f8a06d46c0538030e2eeba75cf4354. Parent [RFC-002](RFC-002.md), [design system](DESIGN-SYSTEM.md).

## Purpose and constraints
Challenge the proposed design, not rubber-stamp it. Claude should review the actual code and all handoff/debt documents, identify correctness gaps, and perform only targeted feasibility experiments on an isolated review branch or disposable worktree. No P1 implementation, engine rewrite, broad dependency changes, public deployment, paid infrastructure or merge. Preserve P0 hashes, exact dependency pins, privacy/CSP and notices. Use local verification; no expensive CI matrix. Record explicit NOT RUN where unavailable. Do not modify frozen evaluation thresholds after seeing results without owner review.

## R00 — architecture critique
Map D01–D10 and R1–R9 to current source and debt IDs. Examine invariants, ownership, revision semantics, schema migrations, worker teardown, style/clip semantics, and P1-A dependencies. Identify contradictions and alternatives, particularly whether history/geometry lives outside disposable workers. Check how trace compound paths map to IDs and independent editing. Record proposed RFC redlines, risks, and unresolved owner decisions. Distinguish source inspection from executed evidence.

## R01 — document/transport/lifecycle spike
Use synthetic scenes and recorded P0 geometry at 10k, 100k, 250k, 500k and 1M anchors; many small paths, single large compound path, holes and overlapping colors. Compare existing scene JSON/SVG string path versus typed buffers with offsets. Measure WASM/JS/worker copy count, byte size, encode/decode, transfer, validation and peak memory. Demonstrate immutable committed buffers survive transfer, worker terminate/recycle/crash, stale result and error, undo/redo and frozen export. Include adversarial malformed offsets/arity/non-finite/oversize cases. Keep unedited export hashes. No production protocol replacement in spike. Determine whether binary bridge is necessary for P1-A and propose minimal schema.

## R02 — renderer bake-off (critical)
Compare P0 SVG-image baseline, SVG DOM, retained Canvas 2D and small WebGL candidate only if feasible. Use equivalent scenes, dimensions, DPR, fill rules, alpha, clipping, draw order and representative P0 outputs. Include large compound halftone, fragmented photo, limited color, circles/holes, ink overlap. Do not benchmark synthetic rectangles alone or omit tessellation/path build. Record cold snapshot to visible, parse/prepare/index/tessellation, pan/zoom frame p50/p95/max, hit-test p95, selection/transform latency, memory (including GPU estimate), context loss/recovery, correctness against independent render. Same workload, at least 5 warm repetitions plus cold, exact browser/device versions, raw data and screenshots. Measure 250k interactive target, 500k and 1M stress; flag frame gaps >50 ms and preview >100 ms at ≤250k. Explicitly test single path worst case and no false hit inside hole. Candidate raster display cache is acceptable; export stays vector and unchanged. Evaluate constrained device if actually available; CPU throttle is not evidence of worker speed. Recommend one backend and minimal fallback or revised cap, not three implementations. Do not select WebGL merely on frame rate if tessellation/edge correctness fails.

## R03 — scheduling and memory review
Analyze existing one-pending-job client, latest-wins behavior and generation checks. Simulate preview → Apply → export → preview, undo during job, cancel, crash, offline recreate, service-worker update and memory recycle. Prove immutable snapshot and no committed state lost; new preview cannot cancel export. Estimate aggregate source, history, geometry, JS/WASM copies, render cache and output memory. Propose early complexity estimation using available segmentation info, record false rejects/late failures on corpus. Progress honest, no fake percent. Recommend queue and limits, no worker pool/SAB unless evidence requires it.

## R04 — geometry boundary strategy
Reproduce TD-GEO-001 on 04 and 22, record exact source and settings. Inspect feasibility of label-level blended pixel correction plus local edge fitting versus trace-local shared boundary graph. Discuss stacked occlusion vs mosaic partition, face adjacency, opposite edge orientation, triple junctions, transparent holes, anti-alias seams versus geometric leaks. Minimal analytic prototype only if necessary, not a production correction. Identify how scene/export/document representations support shared boundaries without locking independently editable objects together or forcing future plate registration constraints. Preserve Artistic and Precision defaults and compare known hashes. Retain existing analytic metrics and negative controls; report proof requirements and staged migration. No full new tracer/boolean library implementation.

## R05 — design system and persistence/dependency feasibility
Follow [DESIGN-SYSTEM](DESIGN-SYSTEM.md) R05. Verify shadcn/ui + Dice UI compatibility, common Base UI variant availability, Tailwind/Vite+ integration, Lucide, accessible interactions, copied source licenses and build notices; propose exact pins and minimal component list. No runtime external assets or unsafe CSP exceptions. If a required component is not available in chosen primitive family, document and choose minimal alternative. Evaluate proposed explicit project Save/Open scope: safe bounded container vs zip with manifest, source opt-in, unknown versions, memory limits, round-trip without re-trace. No full project implementation. Review any geometry-library candidates only as needed for P1, with license and measurable rationale. Do not add speculative dependencies.

## Deliverables and stop conditions
Create reports under docs/research/rfc-002-review/ (one per gate or combined with clear sections), raw reproducible measurements, commands, fixtures and concise decision matrix:
- D01–D10: ACCEPT AS PROPOSED / REVISE / BLOCKED, rationale and evidence.
- R00–R05: PASS/PARTIAL/FAIL/NOT RUN, exact limits.
- Prioritized changes to RFC and P1 phase gates.
- Owner decisions: provisional budget and lower-end device, metric amendments, minimal Save/Open, core preset order, CI cost policy, canonical Linux build hashes.
- No claimed debt closure unless explicitly tested and approved.
- Identify any runtime/experiment changes separately; do not mix speculative spike code into production or merge.

Stop once enough evidence exists to decide P1 architecture; do not turn this into another P0. Reviewer recommends, RFC author reconciles, owner approves. Do not start P1 or merge without explicit maintainer instruction.
