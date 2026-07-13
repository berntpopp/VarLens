# PR307 ZIP Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ZIP password checks exhaustive and bounded, and reject flattened extraction collisions before any output is written.

**Architecture:** Keep the behavior in `ZipExtractor`: aggregate password outcomes in one pass, enforce injectable pre/post-decode byte budgets, and preflight extraction destinations before the write loop. Keep batch-import cleanup at its existing ownership boundary and lock it with regression tests.

**Tech Stack:** TypeScript 6, adm-zip, Vitest, Electron main-process services.

---

### Task 1: Exhaustive bounded password validation

**Files:**
- Modify: `tests/main/import/ZipExtractor.test.ts`
- Modify: `src/main/import/ZipExtractor.ts`

- [ ] Add failing real-fixture tests proving a leading wrong-password entry cannot hide later corruption, unencrypted-only archives return false, per-entry and cumulative limits reject before excessive decoding, and logger arguments never contain a sentinel password.
- [ ] Run `npx vitest run tests/main/import/ZipExtractor.test.ts` and confirm the regressions fail for the current early return/unbounded implementation.
- [ ] Add constructor-injectable `ZipPasswordValidationLimits`, validate declared and actual byte counts, aggregate wrong-password state, and return `encryptedEntryCount > 0 && !passwordRejected` only after the full pass.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Collision-free extraction and cleanup

**Files:**
- Modify: `tests/main/import/ZipExtractor.test.ts`
- Modify: `tests/main/handlers/batch-import-logic.test.ts`
- Modify: `src/main/import/ZipExtractor.ts`

- [ ] Add failing tests for nested entries with the same case-insensitive basename, asserting zero extracted files and an unchanged target directory.
- [ ] Add a batch-boundary regression asserting rejected partial extraction invokes cleanup and leaves no VarLens ZIP temp directory behind.
- [ ] Run both focused test files and confirm the collision regression fails.
- [ ] Preflight importable entries for path safety and flattened-basename uniqueness before the write loop; return preflight errors without writing.
- [ ] Re-run both focused test files and confirm they pass.

### Task 3: Verification and commit

**Files:**
- Verify all files above plus `.planning/specs/2026-07-13-pr307-zip-hardening.md` and this plan.

- [ ] Run `npx vitest run tests/main/import/ZipExtractor.test.ts tests/main/handlers/batch-import-logic.test.ts`.
- [ ] Run `make typecheck`, `make lint-check`, `make format-check`, and `make agent-check`.
- [ ] Inspect `git diff --check`, confirm no unrelated changes, and commit with `fix(import): harden zip validation and extraction`.
