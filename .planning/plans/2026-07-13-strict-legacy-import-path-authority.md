# Strict Legacy Import Path Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require exact trusted enrollment for every desktop legacy import file path.

**Architecture:** Reuse the session-scoped `PathAuthorityStore` as the single import capability
boundary. Remove automatic-root grants, keep file-granular trusted enrollment, and leave web and
database authority in their existing independent layers.

**Tech Stack:** TypeScript 6, Electron IPC, Vitest, Node filesystem APIs

---

### Task 1: Lock the authority contract with failing tests

**Files:**
- Modify: `tests/main/security/import-path-allowlist.test.ts`
- Modify: `tests/main/ipc/handlers/import.test.ts`

- [x] Replace automatic-root acceptance assertions with rejection assertions for unenrolled temp
  and home paths.
- [x] Add table-driven handler tests for `import:start`, `import:startMultiFile`,
  `import:vcfPreview`, and `import:vcfMultiPreview` using an unenrolled temp file.
- [x] Add enrolled-path success tests for those handlers and pinned-symlink acceptance/retarget
  rejection tests at the handler boundary.
- [x] Prove relative and non-normalized enrollment attempts cannot authorize their resolved aliases.
- [x] Run `npx vitest run tests/main/security/import-path-allowlist.test.ts tests/main/ipc/handlers/import.test.ts`
  and confirm failures show the automatic-root bypass.

### Task 2: Remove permissive import authority

**Files:**
- Modify: `src/main/security/import-path-allowlist.ts`
- Modify: `src/main/ipc/handlers/import.ts`
- Modify: tests whose comments or assertions preserve automatic-root access

- [x] Make the import predicate accept only absolute, normalized, enrolled paths whose pinned
  target remains stable.
- [x] Make import enrollment fail closed for relative and non-normalized paths.
- [x] Route every legacy import path check through that strict predicate and remove obsolete
  automatic-root helpers/imports/comments.
- [x] Run the focused authority and handler tests and confirm they pass.

### Task 3: Verify adjacent workflows and release gates

**Files:**
- Verify only: batch import selection/ZIP tests, database authority tests, web-gate handler seam

- [x] Run focused import, batch-import, database-authority, ZIP-enrollment, and web handler tests.
- [x] Run `make ci-full` because the change modifies Electron IPC authority.
- [x] Run `git diff --check`, inspect `git status`, and verify only intended PR311 files changed.
- [x] Commit as a descendant of `bb330d5c` using a Conventional Commit message.
