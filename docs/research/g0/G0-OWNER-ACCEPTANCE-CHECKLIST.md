# G-0 — Owner acceptance record

**Outcome (maintainer, 2026-11-25): APPROVED.** The reconciled architecture is accepted, subject to a narrow contract clarification pass (C2, C3, C5, C7, C8). That pass is integrated in [G0-ARCHITECTURE-CONTRACTS](G0-ARCHITECTURE-CONTRACTS.md) and recorded in [G0-DECISION-REGISTER §5](G0-DECISION-REGISTER.md).
- G-0 closes when PR #7 merges in the authorised order.
- All historical PARTIAL and NOT RUN results remain unchanged.

## Approved
- [x] **Reconciled RFC-002** ([RFC-002](../../RFC-002.md)) as the frozen P1 architecture.
- [x] **Contracts C1–C9** ([G0-ARCHITECTURE-CONTRACTS](G0-ARCHITECTURE-CONTRACTS.md)), subject to the clarifications. These are integrated before the freeze, so the contract versions are unchanged.
- [x] **All 20 amendment dispositions** ([G0-DECISION-REGISTER](G0-DECISION-REGISTER.md)).
- [x] **Gate plan** ([G0-P1-IMPLEMENTATION-PLAN](G0-P1-IMPLEMENTATION-PLAN.md)): 13 gates, dependencies, the P-CI prerequisite.
- [x] **Design system** ([DESIGN-SYSTEM](../../DESIGN-SYSTEM.md)).
- [x] **Debt register** ([TECHNICAL-DEBT](../../TECHNICAL-DEBT.md)): 37 open items.
- [x] **Provisional performance and resource budgets.**
- [x] **Core preset order.**
- [x] **Minimal CI specification** (P-CI).

## Confirmed interpretations
- [x] **Limits:**
  - the 1M-anchor product cap applies per document (hidden layers included) and per job;
  - 250k anchors and ~40k paths are rendered-snapshot performance targets, not editing limits;
  - history is budgeted by retained bytes.
- [x] **Precision versions:**
  - G-GEO acceptance does not allocate a Precision version;
  - v2 is planned as the combined G-GEO and G-SB qualification;
  - if G-SB defers, a separate maintainer decision governs a G-GEO-only release.
- [x] **Authority after commit:** the document is authoritative for effective style, fill rule, transforms, visibility, order and clipping.
- [x] **Single-build service-worker sessions** are mandatory.
- [x] **Main-thread renderer fallback:** disclosed and acceptable, subject to qualification.
- [x] **Layered drag caches** must preserve compositing semantics.
- [x] **Performance scopes:**
  - the 24 MP B&W target stays import → visible;
  - the colour final target includes committed-and-visible output;
  - the exact settled-frame target is set only after G-R1 measurement.

## Contract clarifications requested at closure
- [x] **C2:** buffer ownership (detaching move, validation of owned bytes, explicit defensive copy, runtime tests, budget) and the render-copy carve-out.
- [x] **C3:** exact checked resource accounting; serialized vs in-memory vs derived vs ledger sizes; caps before allocation; anchors per reference.
- [x] **C5:** explicit-job preservation (bounded queue or `busy` before acceptance; visible outcomes); handshake identity for both workers.
- [x] **C7:** determinism scope, canonical JSON, high-water marks, dirty state vs digests.
- [x] **C8:** P1 rectangular clipping semantics for nested and transformed nodes.

Each is integrated; see CL-1 to CL-9 in the decision register. They introduce **no architectural departure and no unresolved blocker**.

## Authorised
- [x] **Merge sequence**, merge commits only (no squash, rebase or force-push), with heads and bases verified before each merge, stopping on any divergence:
  1. PR #6 into `docs/rfc-002-vector-studio`;
  2. PR #7 into `docs/rfc-002-vector-studio`;
  3. PR #4 into `main`.
- [x] **P-CI** as a separate focused PR: one lightweight Linux job, with no paid infrastructure, macOS runners or matrices.
- [x] **G-ENG and G-DOC** after P-CI: two independent PRs from the approved `main`, neither merged without further acceptance.

## Still required from the owner
- [ ] **Real Safari automation:** run `sudo safaridriver --enable` locally yourself, then enable Settings → Advanced → "Show features for web developers" and Develop → "Allow Remote Automation". Needed before Safari-dependent gate sign-off.
- [ ] **Lower-end hardware access** (an M1 with 8 GB; a 4-core/8-thread laptop with ~8 GB; borrowing is fine) before G-R1 sign-off. Not a blocker for G-ENG or G-DOC.
- [ ] **Branch protection** making P-CI a required check, if wanted. Repository administration is the maintainer's; see the P-CI PR.

## Deferred: owner decisions when they arise
- [ ] Ratify or adjust the provisional budgets after G-UI and G-R1 measurement. In particular, preview ≤ 100 ms is currently met only in Chromium.
- [ ] Allocate a Precision version at a release qualification, and decide if G-SB defers to P2.
- [ ] Approve deployment only once a suitable UI exists. No deployment, domain or DNS work now.

## Facts recorded at closure
- Production code, geometry algorithms, root dependencies and lockfiles are **unchanged** by G-0 (see G0-FINAL-REPORT, Verification).
- The independent review documents (PR #6) are **unchanged**.
- R03, R04 and R05-A stay **PARTIAL** historically.
