# G-0 — Next-gate brief: G-ENG and the independent parts of G-DOC

**Status:** PREPARED, NOT EXECUTED.

**Do not start** until all three hold:
1. the maintainer has approved the reconciled RFC-002 (G-0 closed);
2. the merge order is authorised;
3. **P-CI** is configured.

G-ENG and G-DOC run as **two independent review branches and PRs**. Their shared surface is frozen in [G0-ARCHITECTURE-CONTRACTS](G0-ARCHITECTURE-CONTRACTS.md): C1, C2, C3, C6 and C7.

## Common constraints (both gates)
- **Read first:** AGENTS.md, RFC-002 (reconciled), G0-ARCHITECTURE-CONTRACTS, G0-P1-IMPLEMENTATION-PLAN, TECHNICAL-DEBT and P1-HANDOFF.
- **Frozen baselines.**
  - The 326 regression hashes (`docs/research/p0-r-geo/artifacts/regression/a4cf172.sha256`) and the 72 bundle-v2 hashes stay byte-identical.
  - No change to Artistic or Precision v1 output, and no geometry-algorithm changes.
- **Dependencies.**
  - No new runtime dependency without justification, exact pins, a licence check and notices.
  - Dev-only test tooling is pinned too.
  - Lockfiles are preserved.
- **Out of scope:** renderer, product UI, scheduler, deployment, CI changes beyond P-CI.
- **Evidence.** Record commands, versions, timings and **machine load**. Report NOT RUN honestly; never claim unexecuted results.
- **Git.** Focused commits; no force-push; open a PR against `main` (after G-0 merges), or as directed. Do not merge without maintainer instruction.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with the Claude Code line.

## G-ENG — Engine API and GeometryPacket v1
**Objective.** The Rust engine and its WASM adapter produce, validate and consume GeometryPacket v1 (C3), expose the staged estimate API (C4), and keep every frozen output byte-identical.

**Work items.**
1. **`crates/vector-engine::packet`.**
   - The `GeometryPacket` struct (C3 sections and manifest);
   - `GeometryPacket::from_scene(&Scene)`;
   - `Scene::from_packet(&GeometryPacket, &SceneMeta)`;
   - `validate_packet(&GeometryPacket, &Limits) -> Result<Derived, PacketError>`, with the C3 validation order and error codes;
   - little-endian byte serialisation with 8-byte section alignment, plus a parser that checks caps **before allocating**.
2. **Shared adversarial fixtures** (`tests/fixtures/packet-adversarial/`).
   - Port the review's 27 cases (`experiments/rfc-002-review/bench/adversarial.mjs`) into language-neutral fixtures: binary packet plus manifest JSON plus expected error code.
   - Add cases for byte serialisation: misalignment, truncated sections, oversized declared counts, non-zero padding.
3. **TS validator** (`src/document/packet/validate.ts`, or a shared module). It is a C3-conformant port that runs the same fixtures. It is consumed by G-DOC; coordinate placement with G-DOC.
4. **Staged API.**
   - `segment`, `estimate` and `fit`, with an opaque Vectra-owned `Segmentation` and no VTracer types.
   - bw and colour: the boundary-length estimator from R03.
   - limited and halftone: a staged estimator, or an explicit `Estimate::Unavailable`.
5. **Export baking:** `bake_draw_list(&DrawList, &[GeometryPacket]) -> Scene` (C3.1, C4) applies effective transforms (f64), styles, fill rules and clips to visible items. Identity transforms with unchanged styles must reproduce the original coordinates bit for bit. It is consumed by G-EXP.
6. **WASM exports:** `vectorizePacket`, `validatePacket`, `exportDrawList`, `packetToSvg`, `packetToPdf`, plus the segment/estimate handle API. The existing exports stay.
7. **TD-ARCH-004.** Move `segment_layers` and `vectorize_with_precision_options` behind a `diagnostics` cargo feature. The examples enable it.

**Automated acceptance.**
- `cargo test`: Scene → Packet → Scene is lossless for **every** scene of the regression corpus (`regression_corpus` output), compared structurally and by re-serialised JSON bytes.
- Packet-route SVG and PDF are byte-identical to direct `to_svg`/`to_pdf` over the corpus.
- `fit(segment(x))` is byte-identical to `vectorize(x)` over the corpus.
- `bake_draw_list` with identity transforms and unchanged styles reproduces the corpus scenes byte for byte; transformed cases match an f64 reference.
- TS and Rust validators return identical codes on every adversarial fixture.
- Native and WASM packets are byte-identical (extend `scripts/wasm-fingerprint.mjs`).
- `regression_corpus` hashes equal `a4cf172.sha256` (326/326); `geo_bundle` matches the 72 bundle-v2 hashes.
- A public-API check: no `vtracer::` or `visioncortex::` in public signatures, via rustdoc JSON or a grep test.
- `cargo fmt --check`, `cargo clippy -D warnings`, `vp check`, `vp test`, `pnpm run build`.

**Performance** (reference machine, load recorded):
- trace time within noise of the P0-R baseline;
- packet copy-out ≤ 2 ms at 1M anchors;
- estimate time reported separately from segmentation.

**Stop conditions:**
- any frozen hash changes;
- a lossy round trip;
- a VTracer type in the public API;
- a need to change the C3 layout (raise a contract amendment instead).

**Gate report** (`docs/research/g-eng/`): commands, versions, results and hashes, adversarial matrix, API surface, NOT RUN items, debt updates (TD-ARCH-003/004, TD-PERF-002 API part, TD-ARCH-001 check).

## G-DOC (independently executable parts)
**Objective.** An authoritative document model with a GeometryStore, commands and history, plus the container v1 serializer and strict loader. It is independent of G-ENG.

**Independence from G-ENG.**
- G-DOC consumes C3 packets only.
- **Fixture packets come from the regression scenes, encoded with the review's JS encoder** (`experiments/rfc-002-review/bench/packet.mjs`, copied into test fixtures, not production code).
- If G-ENG lands first, G-DOC uses its TS validator; otherwise G-DOC implements the C3 TS validator and G-ENG adopts it. Exactly one copy is kept.

**Work items.**
1. **`src/document/`.** A framework-neutral store with narrow selectors (`useSyncExternalStore`-compatible), Document v1 (RFC §5.1), C1 identifiers, and invariant validators.
2. **GeometryStore (C2).** Private buffers, `commit`, `view`, `derived`, `jobCopy`, `renderCopy`, refcounts by owner kind, `bytes()`.
3. **Commands** (RFC §7): attach source; commit trace (new layer or replace); delete, duplicate, reorder, reparent; visibility, lock, name; transform; fill and palette; group and ungroup; artboard; bake (packet-in). Transactions, revisions, the history budget with visible truncation, and the keyboard coalescing API.
4. **Resource-ledger skeleton** (RFC §11.3): store bytes, history bytes, source bytes; registry hooks for workers and renderer.
5. **Container v1** (C7). Serializer and strict loader using `CompressionStream`/`DecompressionStream`, with streaming inflation caps, per-section SHA-256, atomic load and unknown-version refusal.
6. **`vectra-dump`** (a Node script): header, sections, hashes, manifest and packet summaries.

**Automated acceptance** (`vp test`; Node or browser as appropriate):
- Property and fuzz tests over random command, undo and redo sequences: invariants hold; revisions are monotonic; redo is cleared by new edits.
- Zero geometry allocations for structural commands (instrumented store).
- After N jobs, copies and simulated terminations, no committed buffer is detached.
- Refcounts reach zero exactly when the last owner releases.
- save → load → save is byte-identical over documents built from the regression fixtures.
- The container adversarial suite returns typed errors with the document unchanged. It covers:
  - truncation, bad magic, oversized header, overlapping or out-of-range sections, duplicate IDs;
  - a decompression bomb, a SHA mismatch, unknown kinds, fields or versions;
  - invalid packets (the shared fixtures), dangling references, ID cycles, non-finite transforms, a bad source signature.
- History budget: eviction order and visible truncation.

**Performance** (reference machine):
- committing a 1M-anchor packet ≤ 50 ms on the main thread;
- structural undo and redo ≤ 16 ms;
- opening a 1M-anchor container ≤ 1 s (review primitives ≈ 0.1–0.15 s).

**Stop conditions:**
- the document needs renderer types or worker handles;
- a structural command copies geometry;
- the C1, C2 or C7 contract cannot be met (raise an amendment).

**Gate report** (`docs/research/g-doc/`): as for G-ENG, with debt updates (TD-ARCH-002 document side, TD-ARCH-003, TD-ARCH-005, TD-PERF-003 ledger).

## Handoff to G-JOB and G-R0 (not part of this brief)
G-JOB starts only after both PRs are accepted. G-R0 may start after G-DOC is accepted, using G-ENG packets or the G-DOC fixtures.
