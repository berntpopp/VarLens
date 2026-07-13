# PR310 Final Blocker Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept legitimate high-ratio cohort VCFs while retaining bounded gzip protection, and stream BED rows atomically into both storage backends without full-array materialization.

**Architecture:** Add a bounded VCF-prefix/sample-count classifier to the decompression stream policy. Move BED file consumption behind a storage task carrying file path and strictness so each backend owns a single transaction and bounded insert chunks.

**Tech Stack:** TypeScript 6, Node streams/zlib/readline, better-sqlite3, PostgreSQL `pg`, Vitest

---

### Task 1: VCF-aware gzip ratio regression

**Files:**
- Modify: `tests/main/import/stream-utils-caps.test.ts`
- Modify: `src/main/import/stream-utils.ts`

- [x] Add a test that builds a valid 500-sample, >64 MiB VCF gzip and consumes it through `createCappedLineStream` with production defaults; assert every line is accepted.
- [x] Run the focused test and confirm it fails with `DecompressionRatioExceededError`.
- [x] Add a bounded prefix classifier and sample-aware VCF allowance, based on the configured stream ratio and capped by a hard maximum.
- [x] Add a short-line non-VCF gzip bomb test and assert ratio rejection before the absolute cap.
- [x] Run `npx vitest run tests/main/import/stream-utils-caps.test.ts`; require both acceptance and rejection tests to pass.

### Task 2: Streaming BED storage contract tests

**Files:**
- Modify: `src/main/storage/write-executor.ts`
- Modify: `tests/main/storage/postgres-panels-repository.test.ts`
- Modify: `tests/main/database/GeneListRepository.test.ts`
- Modify: representative desktop/web handler tests

- [x] Change failing handler tests to require `region-files:importBed` tasks with `[fileId, filePath, { rejectMalformedRows }]`, never `entries[]`.
- [x] Add PostgreSQL tests with a BED file larger than one chunk; assert bounded `UNNEST` calls, exact count/total bases, one transaction, and rollback on parser failure.
- [x] Add SQLite repository tests for streamed import, exact metadata, rollback preserving prior rows, and concurrent imports without leaked staging tables.
- [x] Run focused tests and confirm failures are contract/implementation failures, not fixture errors.

### Task 3: Implement backend-owned streaming BED persistence

**Files:**
- Modify: `src/main/database/GeneListRepository.ts`
- Modify: `src/main/storage/postgres/PostgresPanelsRepository.ts`
- Modify: `src/main/storage/sqlite/SqliteWriteExecutor.ts`
- Modify: `src/main/storage/postgres/PostgresWriteExecutor.ts`
- Modify: `src/main/storage/write-executor.ts`
- Modify: `src/main/ipc/handlers/gene-lists.ts`
- Modify: `src/web/server/routes/region-files.ts`

- [x] Define a path/policy write task and route it through both executors.
- [x] Implement SQLite bounded staging chunks with a reusable statement, bounded parser, safe metadata accumulation, and a short atomic replacement transaction.
- [x] Implement one-transaction PostgreSQL streaming insert with fixed-size arrays, bounded parser, safe metadata accumulation, and rollback.
- [x] Remove handler `collectBedEntries` arrays while preserving desktop path validation and web upload ownership.
- [x] Run all focused desktop/web/repository tests and require green.

### Task 4: Verification and commit

**Files:**
- Verify all modified source, tests, spec, and plan.

- [x] Run focused import, storage, desktop handler, and web route tests.
- [x] Run `make typecheck`, `make lint-check`, `make format-check`, and `make agent-check`.
- [x] Run `git diff --check` and inspect the branch/worktree diff and status.
- [x] Commit with `fix(import): stream BED persistence and tune gzip guards`.
