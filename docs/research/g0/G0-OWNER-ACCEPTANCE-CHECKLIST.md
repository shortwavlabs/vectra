# G-0 — Owner acceptance checklist

Tick each item to accept, or annotate it. G-0 closes only when the first two items are approved. **P1 does not start automatically.**

## Approve
- [ ] **Reconciled RFC-002** ([RFC-002](../../RFC-002.md)) as the frozen P1 architecture.
- [ ] **Frozen contracts C1–C9** ([G0-ARCHITECTURE-CONTRACTS](G0-ARCHITECTURE-CONTRACTS.md)), so that G-ENG and G-DOC can proceed independently.
- [ ] **Gate plan** ([G0-P1-IMPLEMENTATION-PLAN](G0-P1-IMPLEMENTATION-PLAN.md)): 13 gates, dependencies, the P-CI prerequisite.
- [ ] **Design system** ([DESIGN-SYSTEM](../../DESIGN-SYSTEM.md)): pins, corrected tokens, CSP approach, provisional bundle budgets, accessibility requirements.
- [ ] **Debt register update** ([TECHNICAL-DEBT](../../TECHNICAL-DEBT.md)): 37 items, lifecycle stages, none resolved.
- [ ] **Decision register** ([G0-DECISION-REGISTER](G0-DECISION-REGISTER.md)): matches your intent for all 20 amendments and 12 categories.

## Confirm (interpretations made in reconciliation)
- [ ] **Limits scoping** (RFC §8.8):
  - the 1M-anchor cap applies **per document** (all layers, visible or hidden) and per job;
  - 250k anchors and ~40k paths is a per-rendered-snapshot **performance target, not an editing limit**;
  - history geometry is budgeted in bytes.
- [ ] **Precision version allocation rule** (RFC §12.2, C6):
  - provisional development IDs;
  - you allocate `PRECISION_FIT_VERSION` integers at geometry-gate acceptance;
  - planned v2 = G-GEO fixes + G-SB graph.
- [ ] **Single-build service-worker sessions** (RFC §15.3) and the new debt item TD-PLATFORM-006.
- [ ] **Main-thread renderer fallback** is acceptable when disclosed: same renderer, measured, used where worker OffscreenCanvas presentation fails qualification.
- [ ] **Layered drag cache**: compositing-preserving segmentation must pass the RFC §8.4 matrix in G-R1. Incorrect rendering is never accepted.

## Authorise (separately, when ready)
- [ ] **Merge order:**
  1. PR #6 into `docs/rfc-002-vector-studio` (merge commit);
  2. the reconciliation PR into the same branch (merge commit);
  3. PR #4 into `main`.

  Use merge commits only (no squash or rebase), so review SHAs are preserved and not duplicated.
- [ ] **P-CI creation** after approval: one required lightweight Linux job per the specification. No paid infrastructure.
- [ ] **Real Safari automation:** run `sudo safaridriver --enable` locally yourself, and enable Settings → Advanced → "Show features for web developers" and Develop → "Allow Remote Automation".
- [ ] **Lower-end hardware access** (M1 8 GB; 4c/8t ~8 GB laptop; borrowing is fine) before G-R1 sign-off.

## Deferred, owner decision when it arises
- [ ] Ratify or adjust the provisional budgets after G-UI and G-R1 measurement. In particular, preview ≤ 100 ms is currently met only in Chromium.
- [ ] Allocate a Precision version at G-GEO or G-SB acceptance, and decide if G-SB defers to P2.
- [ ] Approve deployment only once a suitable UI exists (no deployment, domain or DNS work now).

## Facts for your review
- Production code, geometry algorithms, root dependencies and lockfiles are **unchanged** (see G0-FINAL-REPORT, Verification).
- The independent review documents (PR #6) are **unchanged**.
- R03, R04 and R05-A stay **PARTIAL** historically.
