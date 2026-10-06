# Track 11 — import data correctness

Branch `fix/import-data-correctness` (built on `perf/non-blocking-desktop`). Three bugs that
already exist on `main`, found by other tracks.

## 1. `case_data_info` never written by desktop imports

- **Cause:** `src/main/workers/import-pipeline.ts` inserted into `case_data_info` without the
  `NOT NULL created_at/updated_at` columns (since the worker pipeline landed in b309d939,
  2026-03). The import worker logged `NOT NULL constraint failed: case_data_info.created_at` and
  swallowed it, so every desktop import (JSON and VCF) left the case with no data-info row. The
  statement was also `INSERT OR REPLACE`, which would have erased user-entered platform/filter
  fields on a re-import.
- **Fix:** upsert with timestamps; a re-import refreshes only file name, file type and `updated_at`.
- **Existing databases:** SQLite migration **v35** backfills a row for each case that has none.
  The file name is the basename of `cases.file_path` and `created_at` comes from the case. The
  file type is filled in only for an unambiguous `.vcf`, `.vcf.gz` or `.vcf.bgz` path; JSON
  `object` and `columnar` files cannot be told apart, so their type stays NULL. Existing rows are
  not touched. **v33 and v34 are reserved** for parallel branches (v33 chromosome natural order,
  v34 possible 5b work), so the v35 block must stay after them when those branches merge. A
  database that has already reached v35 on this branch skips a v33 or v34 merged later. Use
  throwaway dev databases only.
- **Postgres:** every writer already supplied the timestamps
  (`tests/main/storage/postgres-case-data-info.e2e.test.ts`). It needs no Postgres migration.

## 2. Frequencies under-counted after SQLite multi-file append

- **Cause:** `startMultiFileImportSqlite` decremented the whole merged case and then re-added it.
  The worker had counted only the first file's coordinates. Decrementing coordinates that came
  only from appended files took a count away from other cases, and the re-add only restored it,
  so the merged case was not counted at those positions.
- **Fix:** `VariantFrequencyService.caseVariantWatermark` runs after the first file.
  `updateFrequenciesForAppend` then runs after the appends and increments only coordinates that
  are new to the case.
- **Proof:** `tests/main/database/variant-frequency-property.test.ts` runs 25 seeded random
  sequences of import, multi-file append, replace, delete and delete-all. After each step it
  asserts that the incremental table equals `recomputeAllFrequencies()`. All 25 seeds fail with
  the old algorithm. Postgres was not affected, because it counts once after all files.

## 3. Postgres prepared-statement name collisions

- **Cause:** effective names `${name}@${schemaToken}` exceed 63 bytes for long names, and the
  server truncates them. Two schemas that share a prefix then map to one statement name, and the
  second Parse fails with 42P05 `prepared statement ... already exists`. A real-PG test with two
  60-character schemas reproduced this.
- **Fix:** `boundStatementName` in `named-query.ts` leaves names that fit unchanged. A longer name
  becomes a 46-byte readable prefix, then `~`, then a 64-bit sha1 of the untruncated logical key
  and the raw schema name.
