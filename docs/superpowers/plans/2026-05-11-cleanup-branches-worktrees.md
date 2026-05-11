# Project Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 7 stale Claude-generated branches, clean worktree files, verify no orphaned TODOs exist.

**Architecture:** Three-phase cleanup: (1) enumerate & approve, (2) delete branches, (3) clean worktrees + verify.

**Tech Stack:** Git, bash, npm test

---

## Branch Enumeration Results

All 7 branches from 2026-05-06 (5 days old):

| Branch | Status | Last Commit |
|--------|--------|-------------|
| eloquent-hertz-476dae | ✅ MERGED | docs: embed metrics dashboard screenshot |
| festive-yonath-8075e3 | ✅ MERGED | chore: stability continuation |
| flamboyant-feynman-e18931 | ✅ MERGED | screenshot |
| happy-ptolemy-11f9b9 | ✅ MERGED | docs: embed metrics dashboard screenshot |
| jovial-wilson-182195 | ✅ MERGED | docs(changelog): add post-release fixes |
| festive-wescoff-3439bc | ⚠️ UNMERGED | feat(sse): A2 single SSE hub (closes H4) |
| suspicious-banzai-117fe8 | ⚠️ UNMERGED | fix: load-test bash arith trap + docker-compose |

**TODO scan:** No TODO/TBD/WIP/FIXME/XXX patterns found in `.md` files. No migration needed.

**Recommendation:** Delete all 7 branches. The 2 unmerged branches appear abandoned (5 days old, no follow-up commits). Features referenced (SSE hub, load-test fix) are not mentioned in ROADMAP as in-progress.

---

## Task 1: User Approval Gate

**Files:** None

- [ ] **Step 1: Review branch enumeration above**

Verify the branch list and merge status. The 5 merged branches are safe to delete. The 2 unmerged branches are 5 days old with no active follow-up — safe to delete if you confirm.

- [ ] **Step 2: User confirms deletion**

Proceed only after you explicitly approve deletion of all 7 branches listed above.

---

## Task 2: Delete Branches Locally

**Files:** None (git operations only)

- [ ] **Step 1: Delete 5 merged branches locally**

```bash
git branch -D eloquent-hertz-476dae
git branch -D festive-yonath-8075e3
git branch -D flamboyant-feynman-e18931
git branch -D happy-ptolemy-11f9b9
git branch -D jovial-wilson-182195
```

Expected: 5 deletions reported.

- [ ] **Step 2: Delete 2 unmerged branches locally**

```bash
git branch -D festive-wescoff-3439bc
git branch -D suspicious-banzai-117fe8
```

Expected: 2 deletions reported (or warnings about unmerged, but `-D` forces deletion).

- [ ] **Step 3: Verify local branches cleaned**

```bash
git branch | grep claude/
```

Expected: No output (all claude/* branches gone).

- [ ] **Step 4: Commit local cleanup (intermediate)**

This is an intermediate commit to document local cleanup. Will be squashed later if desired.

```bash
git add -A
git commit -m "chore: delete 7 stale claude/* branches locally

Merged (5):
- eloquent-hertz-476dae
- festive-yonath-8075e3
- flamboyant-feynman-e18931
- happy-ptolemy-11f9b9
- jovial-wilson-182195

Unmerged (2):
- festive-wescoff-3439bc
- suspicious-banzai-117fe8

All branches from 2026-05-06 with no active follow-up."
```

Expected: Commit succeeds.

---

## Task 3: Delete Branches from Remote

**Files:** None (git operations only)

- [ ] **Step 1: Delete from remote origin**

Check which branches exist on remote first:

```bash
git push origin --delete eloquent-hertz-476dae festive-yonath-8075e3 flamboyant-feynman-e18931 happy-ptolemy-11f9b9 jovial-wilson-182195 festive-wescoff-3439bc suspicious-banzai-117fe8 2>&1 | grep -E "deleted|error|refused"
```

Expected: 7 deletions (or "error: remote ref does not exist" for branches not on origin, which is fine).

- [ ] **Step 2: Verify remote branches cleaned**

```bash
git branch -r | grep claude/
```

Expected: No output (all remote claude/* branches gone).

- [ ] **Step 3: Commit remote cleanup**

```bash
git add -A
git commit -m "chore: delete 7 stale claude/* branches from remote origin"
```

Expected: Commit succeeds (or "nothing to commit" if no local changes).

---

## Task 4: Clean Worktree Files

**Files:**
- `.claude/worktrees/` (directory on disk)

- [ ] **Step 1: Run git worktree prune**

```bash
git worktree prune
```

Expected: No output (successful prune).

- [ ] **Step 2: Check worktree status**

```bash
git worktree list
```

Expected: Only primary worktree listed (current directory).

- [ ] **Step 3: Remove stray .claude/worktrees directory**

```bash
if [ -d .claude/worktrees ]; then rm -rf .claude/worktrees; echo "Removed .claude/worktrees"; else echo ".claude/worktrees does not exist or is empty"; fi
```

Expected: Either "Removed" or "does not exist".

- [ ] **Step 4: Verify worktree directory is gone**

```bash
ls -la .claude/worktrees 2>&1 || echo "Directory confirmed deleted"
```

Expected: "No such file or directory" or "Directory confirmed deleted".

- [ ] **Step 5: Commit worktree cleanup**

```bash
git add -A
git commit -m "chore: clean stray .claude/worktrees directory"
```

Expected: Commit succeeds.

---

## Task 5: Verify No Stray TODOs

**Files:** All `.md` files in repo

- [ ] **Step 1: Scan for TODO patterns**

```bash
find . -name "*.md" ! -path "./node_modules/*" ! -path "./.git/*" -exec grep -n "TODO\|TBD\|WIP\|FIXME\|XXX" {} + || echo "No TODO patterns found"
```

Expected: "No TODO patterns found" (already confirmed during enumeration).

- [ ] **Step 2: Log the result**

All docs are clean. No migration to ROADMAP needed.

---

## Task 6: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass. No failures introduced by branch deletion.

- [ ] **Step 2: Verify test output**

Look for:
- ✓ All test suites pass
- ✓ No new errors
- Coverage metric (should remain stable or improve)

---

## Task 7: Final Verification Checklist

**Files:** None (verification only)

- [ ] **Step 1: Branch verification**

```bash
git branch -a
```

Expected output should show ONLY:
```
* develop
  main
  remotes/origin/HEAD -> origin/develop
  remotes/origin/develop
  remotes/origin/main
```

(No `claude/*` branches)

- [ ] **Step 2: Worktree verification**

```bash
git worktree list
```

Expected: Only primary worktree.

- [ ] **Step 3: .claude/worktrees verification**

```bash
ls -la .claude/ | grep worktrees || echo "No worktrees directory"
```

Expected: "No worktrees directory" or not listed.

- [ ] **Step 4: Log cleanup summary**

All three cleanup phases complete:
- ✅ 7 old branches deleted (local + remote)
- ✅ No TODOs migrated (none found)
- ✅ Worktree files cleaned
- ✅ Tests passing
- ✅ Git state clean

---

## Task 8: Create Final Commit

**Files:** None (final cleanup)

- [ ] **Step 1: Squash intermediate commits if desired**

Option A (keep all 3 commits): Skip to Step 2.
Option B (squash into one): 
```bash
git reset --soft HEAD~3
git add -A
git commit -m "chore: cleanup stale branches and worktree files

Deleted branches (7 total):
- eloquent-hertz-476dae (merged)
- festive-yonath-8075e3 (merged)
- flamboyant-feynman-e18931 (merged)
- happy-ptolemy-11f9b9 (merged)
- jovial-wilson-182195 (merged)
- festive-wescoff-3439bc (unmerged)
- suspicious-banzai-117fe8 (unmerged)

All branches from 2026-05-06 session with no active follow-up.

Worktree cleanup:
- Ran git worktree prune
- Removed .claude/worktrees directory

TODO audit:
- Scanned all .md files
- No TODO/TBD/WIP/FIXME/XXX patterns found
- No migration to ROADMAP needed

Tests:
- All tests pass
- No regressions introduced"
```

- [ ] **Step 2: Verify final commit**

```bash
git log -1 --oneline
git show --stat
```

Expected: Single clean commit with branch deletions + worktree cleanup.

- [ ] **Step 3: Ready for PR**

Branch is now clean and ready for PR to `develop`.

---

## Verification Checklist (Before PR)

- [ ] All tests pass (`npm test`)
- [ ] `git branch -a` shows only `main`, `develop`, remotes
- [ ] `git worktree list` shows only primary worktree
- [ ] `.claude/worktrees/` removed from disk
- [ ] No TODO/WIP in `.md` files (none found)
- [ ] Commit message documents all changes
- [ ] Ready to push: `git push origin HEAD:cleanup/stale-branches`
