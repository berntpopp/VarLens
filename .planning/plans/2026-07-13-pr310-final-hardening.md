# PR 310 Final Import Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final PR310 denial-of-service and malformed-record blockers without rejecting legitimate WGS imports or weakening path authority.

**Architecture:** Add a shared gzip expansion-ratio monitor alongside the existing byte and line caps. Bound valid BED objects at the shared streaming reader, retain filter interval merging, route web BED imports through that reader, and chunk PostgreSQL persistence. Tighten VCF parsing at the source so unsafe POS and malformed non-dot QUAL become reasoned skips in every importer.

**Tech Stack:** TypeScript 6, Node streams/zlib, Electron workers, PostgreSQL, SQLite, Vitest

---

### Task 1: Practical gzip expansion guard

**Files:**
- Modify: `tests/main/import/stream-utils-caps.test.ts`
- Modify: `src/main/import/stream-utils.ts`

- [x] Add failing tests proving a highly compressible gzip is rejected by a ratio override before the large decompressed-byte cap, while a gzip below the ratio and the ratio-check floor are accepted.
- [x] Run `npx vitest run tests/main/import/stream-utils-caps.test.ts` and confirm the new ratio tests fail.
- [x] Add `DecompressionRatioExceededError` and a gzip-only transform that rejects after output exceeds both a 64 MiB floor and 100 times the consumed compressed bytes. This leaves almost 4x headroom over the most compressible shipped VCF fixture while retaining the 256 GiB worker-capable total budget. Add test-only option overrides.
- [x] Re-run the focused test and require success.

### Task 2: Bounded BED collection and web streaming

**Files:**
- Modify: `tests/main/import/vcf/bed-filter.test.ts`
- Modify: `tests/web-gate/dispatcher-adapters-assets-annotations-export.test.ts`
- Modify: `src/main/import/vcf/bed-reader.ts`
- Modify: `src/main/import/vcf/bed-filter.ts`
- Modify: `src/web/server/routes/region-files.ts`

- [x] Add failing tests for the one-million-entry guard through a small override, safe BED coordinates, gzip/resource rejection in the web adapter, strict malformed-row behavior on web, and successful staged gzip BED streaming.
- [x] Run both focused test files and confirm the new cases fail.
- [x] Add `BedEntryLimitExceededError`, safe-integer validation, an optional entry-limit override, and optional strict malformed-row rejection to the shared async BED reader. Keep desktop filtering permissive for malformed rows and keep `BedFilter`'s per-chromosome sort/merge behavior.
- [x] Replace the web route's `readFile`/split path with the shared capped reader while preserving upload-reference resolution and raw server-path rejection.
- [x] Re-run the focused desktop and web tests and require success.

### Task 3: Chunk region persistence

**Files:**
- Modify: `tests/main/storage/postgres-panels-repository.test.ts`
- Modify: `src/main/storage/postgres/PostgresPanelsRepository.ts`

- [x] Add a failing repository test with more than one 10,000-row logical chunk and assert multiple bounded `UNNEST` inserts plus one transactional metadata update.
- [x] Run `npx vitest run tests/main/storage/postgres-panels-repository.test.ts` and confirm the new assertion fails.
- [x] Slice entries into 10,000-row chunks before constructing PostgreSQL parameter arrays, accumulating counts and total bases without allocating arrays for the entire BED at once.
- [x] Re-run the focused repository test and require success.

### Task 4: Exact VCF numeric validation

**Files:**
- Modify: `tests/main/import/vcf/vcf-line-parser.test.ts`
- Modify: representative worker/strategy tests that assert counted skip reasons
- Modify: `src/main/import/vcf/vcf-line-parser.ts`

- [x] Change/add failing tests proving POS above `Number.MAX_SAFE_INTEGER` is rejected with a reason, malformed finite-looking/non-finite non-dot QUAL returns `null` with a QUAL reason, dot QUAL remains a valid missing value, and strategy/worker skip counters receive the QUAL rejection.
- [x] Run the focused parser and import tests and confirm the new expectations fail.
- [x] Parse digit-only POS with `Number()` and require a positive safe integer. For QUAL, accept only dot or a finite number matching the complete numeric grammar; otherwise invoke `onSkip` and reject the row.
- [x] Re-run the focused tests and require success.

### Task 5: Final verification and commit

**Files:**
- Verify all modified source, tests, and this plan.

- [x] Run combined focused desktop and web tests.
- [x] Run `make typecheck`, `make lint-check`, `make format-check`, and `make agent-check`.
- [x] Run `make ci` and `VARLENS_WEB=1 make ci` on the final snapshot.
- [x] Inspect the diff and source sizes, commit with a Conventional Commit message, keep the worktree, and do not push.
