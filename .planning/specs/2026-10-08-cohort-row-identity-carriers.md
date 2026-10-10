# Cohort Row Identity and Carrier Lookup Spec

Date: 2026-10-08

Status: proposed

Issue: #503 (remaining item: `getCarriers` ignores `genome_build` / `variant_type`)

Checked against `main` at `bcbc86cf` (v0.81.0).

## Summary

A cohort row is identified by six fields in the database and by four in the API. The carrier
lookup, the row key, the expansion state and the carriers cache all use the four-field form, so
two summary rows at one coordinate share carriers and UI state. This spec carries the six-field
identity through the API. It needs no migration.

## Evidence

- Both backends key `cohort_variant_summary` on
  `(chr, pos, ref, alt, variant_type, genome_build)`: SQLite `src/main/database/migrations.ts`
  (v25), Postgres `migrations/sql/0010_cohort_summary.sql:33`. The issue comment "SQLite is not
  affected" is wrong.
- The stored and returned `variant_key` is `chr:pos:ref:alt`
  (`src/shared/sql/cohort-summary-rebuild.ts:48`, `PostgresCohortSummaryRepository.ts:161,269`).
- `getCarriers` filters on four fields on both backends: `src/main/database/cohort.ts:414-429`,
  `PostgresCohortRepository.ts:290-318`. A row with `carrier_count` 1 can list 2 carriers.
- `CohortVariant` (`src/shared/types/cohort.ts:12-55`) has neither `variant_type` nor
  `genome_build`.
- One coordinate can hold two types: the same `<DEL>` is stored as `sv` or `cnv` depending on
  caller metadata (`src/main/import/vcf/variant-type-detector.ts:38`).
- The cohort view already filters by one build, but the carriers cache key
  (`src/renderer/src/queries/carriers.ts:9`) is the four-part key, so a build switch can reuse
  another build's entry.

## Design

1. `CohortVariant` gains `genome_build` and `variant_type`. Both backends project them.
2. `variant_key` is built at read time from all six fields by one shared helper in `src/shared/`.
   It is opaque: nothing parses it. The stored `variant_key` column is left as it is.
3. `getCarriers` takes the six fields as a typed object and both backends add
   `variant_type = ?` and `genome_build = ?` to the `WHERE`. A request without them is rejected by
   the schema; there is no default.
4. The contract change is carried through every adapter: shared IPC domain, request schema,
   preload, read executors, worker dispatch, web route, OpenAPI, renderer query and mock API.
5. Renderer row key, selection, expansion and the carriers cache keep using `variant_key`; they
   become correct because its content changes.

## Out of scope

- Structural events that differ only in `END` are already merged upstream (`end_pos` is not in the
  key). This spec does not separate them.
- The summary's annotation join is four-coordinate
  (`src/shared/sql/cohort-summary-rebuild.ts:75`), so stars and ACMG flags are shared across
  builds and types. Separate decision.
- No canonical allele identity (VRS / SPDI). `genome_build` is a coarser, local scope.

## Files

- Shared: `src/shared/types/cohort.ts`, `src/shared/types/api.ts`,
  `src/shared/ipc/domains/cohort.ts`, `src/shared/api/schemas/cohort.ts`,
  `src/shared/types/db-task.ts`, new key helper.
- Preload / IPC: `src/preload/domains/cohort.ts`, `src/preload/window-api/core-api.ts`,
  `src/main/ipc/handlers/cohort.ts`, `src/main/ipc/handlers/cohort-logic.ts`.
- Executors: `src/main/storage/read-executor.ts`, `postgres/PostgresReadExecutor.ts`,
  `sqlite/SqliteReadExecutor.ts`, `src/main/workers/db-worker-dispatch.ts`.
- Queries: `src/main/database/cohort.ts`, `postgres/PostgresCohortRepository.ts`,
  `postgres/postgres-cohort-summary-query.ts`.
- Web: `src/web/server/routes/cohort.ts`, `src/web/server/routes/openapi-paths/cohort.ts`.
- Renderer: `queries/carriers.ts`, `components/cohort/CohortDataTable.vue`,
  `components/CohortTable.vue`, `components/cohort/CarrierExpandedRow.vue`, `mocks/mockApi.ts`.

## Tests

- Same coordinate in GRCh37 and GRCh38: distinct keys and distinct carrier lists, both backends.
- Same coordinate as `sv` and `cnv`: distinct keys, exact carrier membership.
- Carrier count of a row equals the number of carriers returned for it.
- A carriers request without build or type is rejected over IPC and over the web route.
- A breakend ALT (`]13:123456]T`) produces a key that does not collide with another row.
- Renderer: after a build switch the carriers query does not reuse the previous build's entry.
- Update `tests/fixtures/ipc-parity/manifest.json`, the cohort handler snapshot and
  `tests/web-gate/parity/ipc/cohort.ts`.

Gate: `make rebuild-node && make test`, `VARLENS_WEB=1 make test`, `npx vitest run tests/shared/ipc`.
