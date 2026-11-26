# Evidence preservation and worktree cleanup (permanent policy)

**Status:** maintainer policy, adopted 2026-11-26 after an evidence loss (below). It applies to every person and agent working in this repository.

Qualification evidence includes reports, screenshots, measurements, raw logs, Playwright and Safari result files, and benchmark outputs. Much of it lives in **gitignored** paths: `tests/output/`, the outputs of opt-in specs, and scratch captures. Git tracks none of it, so Git cannot protect it.

## Rules
1. **A clean working tree is not proof that a worktree holds nothing of value.** `git status` hides ignored files, and `git worktree remove` deletes them without warning: it refuses only modified or untracked tracked-path files.
2. **Inventory before cleanup.** For every worktree or checkout to be removed, list three kinds of files:
   - **tracked** changes: `git -C <wt> status --porcelain`, plus this worktree's commits not on any remote branch (`git -C <wt> log HEAD --not --remotes --oneline`);
   - **untracked** files: `git -C <wt> ls-files --others --exclude-standard`;
   - **ignored** files: `git -C <wt> ls-files --others --ignored --exclude-standard --directory`, then inspect `tests/output/`, `docs/research/**/scratch`, `dist/` and the like.
3. **Archive** every relevant item into the main checkout under `tests/output/archive/<worktree-name>-<YYYYMMDD>/`. Relevant means reports, screenshots, measurements, raw logs, test results and generated evidence. Build products that can be regenerated (`dist/`, `target/`, `node_modules/`) need not be copied; record their absence instead.
4. **Record provenance** in `ARCHIVE.md` inside the archive:
   - the source worktree path, branch and commit (`git rev-parse HEAD`);
   - the build ID (`grep BUILD_ID dist/sw.js`) when a build exists;
   - the environment (OS, Node, browser versions);
   - the date;
   - what each directory contains.
5. **Checksum** the archive:
   - Write: `(cd <archive> && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS)`.
   - Verify the copy: `(cd <archive> && shasum -a 256 -c SHA256SUMS)`.
   - Compare the file count with the source inventory.
6. **Only after the archive verifies**, remove the worktree with `git worktree remove <path>`, never `--force`, and delete merged branches with `git branch -d` (never `-D`). A locked worktree stays until its owner unlocks it. Never remove a worktree that holds user-owned changes or belongs to an open PR or another session.
7. **Never reconstruct lost evidence and present it as original.** If evidence is lost:
   - record the loss;
   - attempt recovery only from genuine backups;
   - if a measurement is still needed, re-run it as a new, dated result.

## Incident: 2026-11-25 (G-UI-R closure)
- **What happened.** During cleanup after the #19 and #20 merges, two agent worktrees with clean Git status were removed: the G-UI-R review agent's, and the earlier G-UI shell agent's. Their branches were fully merged. `git worktree remove` deleted their gitignored files as well.
- **What was lost.**
  - The raw evidence behind `docs/research/g-ui-r/FINAL-AUDIT.md` (`tests/output/g-ui-r-audit/`: detector output and probe captures).
  - The G-UI-R agent's local closure screenshots (`tests/output/g-ui-r-review/`).
  - Unidentified local outputs of the older G-UI shell worktree.
- **What survived.** Every committed report, including `FINAL-AUDIT.md` itself with its findings and scores. Every real-Safari run directory and the final-closure evidence, which were already in the main checkout.
- **Recovery attempted on 2026-11-26.** Time Machine has no destination configured. The only local APFS snapshots are macOS update snapshots (`com.apple.os.update-*`), not user-data backups covering these files. **Nothing was recoverable.**
- **Handling.** The lost raw files are not reconstructed. `FINAL-AUDIT.md` stands as the committed record of that audit; its raw inputs are marked as lost.
