# G-0 — Next-gate brief: G-ENG and the independent parts of G-DOC

**Status:** AUTHORISED by the maintainer at G-0 closure. Work starts after:
1. G-0 is merged (PR #6 → PR #7 → PR #4, merge commits);
2. the **P-CI** workflow is configured and verified.

G-ENG and G-DOC run as **two independent review branches and PRs** from the approved `main` baseline. Their shared surface is frozen in [G0-ARCHITECTURE-CONTRACTS](G0-ARCHITECTURE-CONTRACTS.md): C1, C2, C3, C6 and C7.

## Shared-file ownership and integration (normative for P1-A)
Every shared file and interface has **exactly one owner**. A gate never edits a file the other gate owns.

| Path or interface | Owner | The other gate |
|---|---|---|
| `crates/vector-engine/**`, `Cargo.toml`, `Cargo.lock` | G-ENG | no changes |
| `packages/vector-engine-wasm/**`, `scripts/build-wasm.mjs`, `scripts/wasm-fingerprint.mjs` | G-ENG | no changes |
| `tests/fixtures/packet-conformance/**` (language-neutral fixtures: binary block, manifest JSON, expected code) | G-ENG | reads them only after the integration step |
| `src/geometry/packet/**`: C3 TypeScript types, the **production TS validator**, and the C3.0 byte codec | G-ENG | imports them only after the integration step |
| `src/document/**`: model, GeometryStore, commands, transactions, history, revisions, evaluation, ledger | G-DOC | no changes |
| `src/persistence/**`: container v1 serializer and strict loader | G-DOC | no changes |
| `src/document/testing/**`: the **test-only** C3 adapter (encoder and minimal validator from the review's `bench/packet.mjs`). Never imported by production code; an architectural test enforces this; deleted at integration | G-DOC | no changes |
| `scripts/vectra-dump.mjs` | G-DOC | no changes |
| `docs/research/g-eng/**` · `docs/research/g-doc/**` | G-ENG · G-DOC | no changes |
| `docs/TECHNICAL-DEBT.md` | shared by line: each gate appends dated disposition lines **only** to its own items. G-ENG: TD-ARCH-001, TD-ARCH-004, TD-PERF-002, and the engine/validator half of TD-ARCH-003. G-DOC: TD-ARCH-002, TD-ARCH-005, TD-PERF-003, and the document half of TD-ARCH-003 | never edits the other gate's lines |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | **neither** (no new dependency is planned). A gate that needs one stops and asks first; it then owns the change, and the other gate does not touch these files | — |
| `vite.config.ts`, `tsconfig*.json` | **neither** (test globs already cover `src/**/*.test.ts` and `tests/unit/**`) | — |
| README, ROADMAP status lines | the integration step | — |

**How G-DOC stays independent without a second production validator.**
- G-DOC production code depends on a narrow **validator port** (`src/document/packet-port.ts`): a function type plus the minimal C3 shapes it consumes.
- The store receives the validator at construction.
- G-DOC tests inject the test-only adapter.
- There is exactly **one production validator**, owned by G-ENG.

**Integration procedure** (a separate small PR after **both** gate PRs are accepted and merged):
1. Merge `main` into the integration branch. No rebase and no force-push.
2. Wire the G-ENG production validator and types into the G-DOC store as the default. Delete the port's duplicated shapes in favour of imports from `src/geometry/packet`, and delete `src/document/testing/` along with its architectural exemption.
3. Run the **final shared conformance test** (`tests/unit/p1a-conformance.test.ts`, written in the integration PR):
   - for every fixture in `tests/fixtures/packet-conformance`, the Rust validator, the TS validator **and** `GeometryStore.commit` return the same code;
   - for every regression scene, Rust `from_scene` → `to_bytes` → TS decode → `commit` → container save → load → TS encode yields bytes identical to Rust's `to_bytes`, and Rust `from_bytes` → `Scene::from_packet` reproduces the scene JSON byte for byte.
4. Re-run the 326 and 72 hashes and all local checks. Record the results in a short integration note under `docs/research/g-doc/`.
5. A required contract change stops the affected work and goes to a maintainer amendment. It is never patched in integration.

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
   - C3.0 byte serialisation (`to_bytes`/`from_bytes`): little-endian, 8-byte section alignment, offsets computed from counts, zero padding;
   - C3.2 checked accounting in `u64` (wasm32 `usize` is 32-bit), with caps checked **before allocating**; per-path `pathAnchors` in the derived metadata.
2. **Shared adversarial fixtures** (`tests/fixtures/packet-adversarial/`).
   - Port the review's 27 cases (`experiments/rfc-002-review/bench/adversarial.mjs`) into language-neutral fixtures: binary packet plus manifest JSON plus expected error code.
   - Add cases for byte serialisation: misalignment, truncated sections, oversized declared counts, non-zero padding.
3. **Production TS validator and codec** (`src/geometry/packet/`): C3 types, `validatePacket` with the C3 order, codes and checked accounting, and the C3.0 byte encoder/decoder. It runs the same fixtures as Rust. It is the **only** production validator; G-DOC adopts it at integration.
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
- TS and Rust validators return identical codes on every adversarial fixture, including byte-serialisation cases (`length`, `padding`) and overflow declarations (counts near 2³²−1 return `budget` before any allocation, in native and wasm32 builds).
- Derived and serialized sizes equal the C3.2 formulas on every corpus packet.
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
- **Fixture packets come from the regression scenes, encoded with the review's JS encoder** (`experiments/rfc-002-review/bench/packet.mjs`). It is copied into `src/document/testing/` as a test-only adapter, not production code.
- G-DOC never ships a production validator. Its store uses the validator port, and the integration step wires G-ENG's validator in (see the ownership section).

**Work items.**
1. **`src/document/`.** A framework-neutral store with narrow selectors (`useSyncExternalStore`-compatible), Document v1 (RFC §5.1), C1 identifiers, and invariant validators.
2. **GeometryStore (C2).** The commit sequence (shape check → move by detaching transfer → validate the owned bytes → publish); explicit `copyIncoming`; private views; `jobCopy` and `renderCopy`; refcounts by owner kind; exact C3.2 `bytes()`.
3. **Commands** (RFC §7): attach source; commit trace (new layer or replace); delete, duplicate, reorder, reparent; visibility, lock, name; transform; fill and palette; group and ungroup; artboard; bake (packet-in). Transactions, revisions, the history budget with visible truncation, and the keyboard coalescing API.
4. **Resource-ledger skeleton** (RFC §11.3): store bytes, history bytes, source bytes; registry hooks for workers and renderer.
5. **Container v1** (C7). Serializer and strict loader using `CompressionStream`/`DecompressionStream`, with:
   - RFC 8785 canonical JSON;
   - C3.0 geometry records;
   - streaming inflation caps and per-section SHA-256 over uncompressed bytes;
   - atomic load and unknown-version refusal;
   - persisted `nextId` and `nextChunkId`;
   - state-identity dirty tracking.
6. **`vectra-dump`** (a Node script): header, sections, hashes, manifest and packet summaries.

**Automated acceptance** (`vp test`; Node or browser as appropriate):
- Property and fuzz tests over random command, undo and redo sequences: invariants hold; revisions are monotonic; redo is cleared by new edits.
- Zero geometry allocations for structural commands: an instrumented store with no renderer attached sees no `commit`, `copyIncoming`, `jobCopy` or `renderCopy` calls. Render copies for initial population and recovery are G-R0's concern (C2 rule 9).
- C2 ownership tests: aliases detached after commit; validate–mutate–commit stores only the moved bytes; non-exclusive inputs are rejected with `ownership`; the runtime property walk finds no buffer exposure.
- Anchor cap counted per reference: duplicate beyond the cap is rejected with `budget`, and the document is unchanged.
- Dirty state: edit then undo is clean; duplicate then undo is clean; save then edit is dirty.
- After N jobs, copies and simulated terminations, no committed buffer is detached.
- Refcounts reach zero exactly when the last owner releases.
- C7 determinism, over documents built from the regression fixtures:
  - whole-container save → load → save is byte-identical in Node 24.22.1 (the qualified environment);
  - with codec `none`, the container bytes equal a committed golden;
  - uncompressed section bytes and `sha256` values are independent of the codec.
- The container adversarial suite returns typed errors with the document unchanged. It covers:
  - truncation, bad magic, oversized header, overlapping or out-of-range sections, duplicate IDs;
  - a decompression bomb, a SHA mismatch, unknown kinds, fields or versions;
  - invalid packets (the shared fixtures), dangling references, ID cycles, non-finite transforms, a bad source signature.
- History budget: eviction order and visible truncation.

**Performance** (reference machine):
- committing a 1M-anchor packet ≤ 50 ms on the main thread, **including** the ownership move and the validation of owned bytes, with each step reported separately; any `copyIncoming` cost is reported separately and is not in the 50 ms;
- structural undo and redo ≤ 16 ms;
- opening a 1M-anchor container ≤ 1 s (review primitives ≈ 0.1–0.15 s).

**Stop conditions:**
- the document needs renderer types or worker handles;
- a structural command copies geometry;
- the C1, C2 or C7 contract cannot be met (raise an amendment).

**Gate report** (`docs/research/g-doc/`): as for G-ENG, with debt updates (TD-ARCH-002 document side, TD-ARCH-003, TD-ARCH-005, TD-PERF-003 ledger).

## Handoff to G-JOB and G-R0 (not part of this brief)
G-JOB starts only after both PRs are accepted. G-R0 may start after G-DOC is accepted, using G-ENG packets or the G-DOC fixtures.
