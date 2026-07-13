# PR309 Transcript Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate transcript semantic mismatches across VCF/JSON import, legacy migration, transcript switching, and renderer ordering.

**Architecture:** Centralize IMPACT/SO repair in the shared transcript canonicalizer. Keep format-specific annotation ranking in the VCF parser, and mirror explicit-null denormalization plus selected-row migration recovery across SQLite and PostgreSQL.

**Tech Stack:** TypeScript 6, Vitest, SQLite, PostgreSQL, Vue renderer utilities.

---

### Task 1: Canonicalization and import validation

**Files:**
- Modify: `src/shared/types/transcript.ts`
- Modify: `src/main/import/transforms/FieldMapper.ts`
- Test: `tests/main/import/ObjectFormatMapper.test.ts`
- Test: `tests/main/import/FieldMapper.test.ts`

- [ ] Add failing tests proving swapped `{ consequence: SO, func: IMPACT }` becomes `{ consequence: IMPACT, func: SO }` and unknown columnar IMPACT becomes `null`.
- [ ] Run the two test files and confirm the expected assertion failures.
- [ ] Update `canonicalizeTranscriptSemantics` to detect IMPACT in either input and update `FieldMapper` to canonicalize its mapped IMPACT/FUNC pair.
- [ ] Run the two test files and confirm they pass.

### Task 2: Highest-impact VCF transcript rows

**Files:**
- Modify: `src/main/import/vcf/vcf-annotation-parser.ts`
- Test: `tests/main/import/vcf/vcf-annotation-parser.test.ts`

- [ ] Add failing CSQ and ANN tests with duplicate feature IDs whose later annotation has higher impact.
- [ ] Run the parser test and confirm selected transcript rows disagree with the parent before the fix.
- [ ] Rank annotations per transcript using the existing CSQ/ANN scoring functions before constructing each row.
- [ ] Run the parser test and confirm parent and selected transcript semantics agree.

### Task 3: Legacy impact recovery and explicit-null switching

**Files:**
- Modify: `src/main/database/migrations.ts`
- Modify: `src/main/storage/postgres/migrations/sql/0014_variant_transcripts_func.sql`
- Modify: `src/main/database/TranscriptRepository.ts`
- Modify: `src/main/storage/postgres/PostgresTranscriptsRepository.ts`
- Test: `tests/main/database/migrations.test.ts`
- Test: `tests/main/storage/postgres-migration-definitions.test.ts`
- Test: `tests/main/storage/transcript-switch-denormalization.test.ts`
- Test: `tests/main/storage/postgres-transcripts-repository.test.ts`

- [ ] Add failing migration tests proving the selected matching legacy transcript recovers parent IMPACT while non-selected/nonmatching rows remain null.
- [ ] Add failing switch tests proving an impact-unknown target clears the parent consequence on both repository paths.
- [ ] Run the focused migration/storage tests and confirm expected failures.
- [ ] Change migrations to preserve original SO in `func` and conditionally recover selected matching IMPACT; make both repositories always set consequence, including null.
- [ ] Run the focused migration/storage tests and confirm they pass.

### Task 4: DB-only renderer severity

**Files:**
- Modify: `src/renderer/src/utils/mergeTranscripts.ts`
- Test: `tests/renderer/utils/mergeTranscripts.test.ts`

- [ ] Add a failing test proving DB-only HIGH sorts before DB-only MODERATE.
- [ ] Run the test and confirm alphabetical ordering causes failure.
- [ ] Initialize unified DB rows with `impact` from canonical `db.consequence`.
- [ ] Run the renderer utility test and confirm it passes.

### Task 5: Verification and commit

- [ ] Run all focused suites touched above.
- [ ] Run `make typecheck`, `make agent-check`, and `make ci`.
- [ ] Inspect `git diff --check` and the final diff.
- [ ] Commit with `fix(import): close transcript semantic edge cases`.
