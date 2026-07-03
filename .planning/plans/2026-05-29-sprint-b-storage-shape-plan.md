# Sprint B — Storage shape — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dispatch a fresh implementer per task; run two-stage review (spec compliance, then code quality) before marking a task complete. Do not start the next task while either review has open issues.

**Spec:** [.planning/specs/2026-05-29-sprint-b-storage-shape.md](../specs/2026-05-29-sprint-b-storage-shape.md)
**Template plan:** [.planning/plans/2026-05-28-sprint-a-foundations-plan.md](2026-05-28-sprint-a-foundations-plan.md) (Sprint A four-PR shape mirrored here)

**Goal:** Reshape the PG storage layer for 1000-WGS scale across a validate-first spike (PR-0) + three sequenced feature PRs: PR-1 (partition `variants` by chr + `info_json`→JSONB + partition-local BRIN, one heap rewrite), PR-2 (materialise PG `gene_burden_summary`), PR-3 (server-paginated gene-burden surface + cohort parity). Sprint exit is a minor version tag (e.g. `0.69.0`).

**Architecture:** Sequenced PRs (NOT parallel-independent — F1/F2/F3 are one heap rewrite; the gene-burden renderer depends on its backend). Each task is atomic (≤ one file's worth of changes plus its test), TDD where a behaviour gate exists, ends with one Conventional Commit. **Run `make format` as part of every task's verification** (Sprint A learned implementers ran typecheck+tests but not prettier, forcing controller fix-ups).

**Tech Stack:** Electron 40, Vue 3 + Vuetify 4, TypeScript 6 strict, Vitest, Playwright `_electron`, better-sqlite3-multiple-ciphers, PostgreSQL 18 (pg + pg-copy-streams), Zod, electron-log, GitHub Actions.

**Codebase reality checks (verified against `main @ ed203e4e` this session — re-verify line numbers at task time, they drift):**
1. **PG migration head is `0011_projects_registry.sql`**; SQLite head is `PRAGMA user_version = 31`. PR-1's partition migration is **`0012`**, PR-2's gene-burden is **`0013`**. **Re-verify with `ls src/main/storage/postgres/migrations/sql/ | sort | tail -3` at each migration task.** Migrations are manually registered in `MIGRATION_FILES` at `src/main/storage/postgres/migrations/definitions.ts:18` (NOT auto-discovered) — missing the registration silently skips the migration.
2. **Migration runner = one transaction, no statement splitting, 30 s statement_timeout** (`PostgresMigrationRunner.ts:29-68,:56`; `config.ts:26-31`). A data-rewriting migration MUST open with `SET LOCAL statement_timeout = 0; SET LOCAL lock_timeout = '0'; SET LOCAL idle_in_transaction_session_timeout = 0;` and must NOT use `CREATE INDEX CONCURRENTLY`. Checksum (`sha256` of file) is validated on startup — the SQL file is immutable once shipped.
3. **`variants.id` is a single-column PK** (`0003_create_variants.sql:5`) referenced by SIX `ON DELETE CASCADE` FKs: `variant_transcripts`, `variant_sv`, `variant_cnv`, `variant_str` (`0003:52,85,106,116`), `case_variant_annotations`, `variant_tags` (`0005_create_workflow_tables.sql:19,39`). None of the six children carry a `chr` column.
4. **`cohort_variant_summary` PK leads with `chr`** (`0010_cohort_summary.sql`) — partition-ready, no PK change. Indexes `idx_cvs_*` carry no chr.
5. **BRIN + gene-trgm already exist**: `variants_brin_chr_pos USING BRIN (chr, pos)` and `variants_gene_trgm USING GIN (gene_symbol gin_trgm_ops)` at `0007_perf_indexes.sql:14,18`.
6. **`info_json` is opaque** — `JSON.stringify`-written (`VcfMapper.ts:127`), COPY-encoded via `encodeText` at `postgres-import-columns.ts:191`; a reserved `encodeJsonb` exists unused at `copy-text-encoder.ts:106`. Zero runtime read sites. SQLite mirror is `TEXT` (`migrations.ts:1313`).
7. **`getGeneBurden`**: contract `src/shared/ipc/domains/cohort.ts:28` (param-less, returns full `GeneBurden[]`); SQLite reads `gene_burden_summary` (`cohort.ts:440`); PG does live `GROUP BY variants` with NO `genome_build` grouping (`PostgresCohortRepository.ts:486`); web route `src/web/server/routes/cohort.ts:84`. SQLite `gene_burden_summary` schema at `migrations.ts:1558`, rebuild SQL `src/shared/sql/cohort-summary-rebuild.ts:101`, NOT incrementally maintained (`CohortSummaryService.ts:75,99`).
8. **`GeneBurdenTable.vue` is imported nowhere**; live cohort gene-burden tab is `src/renderer/src/components/association/GeneBurdenView.vue` (association, unrelated). `GeneBurden` type at `src/shared/types/cohort.ts:98`.
9. **WGS harness imports 1 case** (`tests/perf/postgres-vcf-wgs-import.perf.test.ts`); query harness `tests/perf/postgres-wgs-query.perf.test.ts` (gated by `VARLENS_RUN_WGS_QUERY_PERF=1`); 3/5 budgets `unavailable` on the unannotated fixture; artifacts → `.planning/artifacts/perf/postgres-query/` via `scripts/perf/compare-postgres-query.mjs`. Fixture downloaded by `scripts/postgres/download-wgs-fixture.sh`.
10. **Cohort summary materialisation pattern** (mirror for F8): `PostgresCohortSummaryRepository` (`rebuild`/`incrementalAdd`/`incrementalRemove`/`refreshColumnMetas`/`removeColumnMetas`/`getState`/`markStale`); import wiring `postgres-import-worker.ts:243-256` (SAVEPOINT); delete wiring inlines SQL in `PostgresCaseLifecycleRepository`; SQLite rebuild path `rebuild-summary-worker.ts:112` / `CohortSummaryService.rebuild()`.
11. **Test schema setup** is inline per test (unique `varlens_test_*` schema, `createPostgresStorageSession` runs migrations, `DROP SCHEMA … CASCADE` cleanup) — no shared pool helper; copy an existing `tests/main/storage/postgres-*.test.ts` pattern. Env: PG @ port **55434** (`.env.postgres.local`).
12. **IPC domain-module checklist (8 steps)** for PR-3: contract `src/shared/ipc/domains/cohort.ts`, handler `src/main/ipc/handlers/cohort.ts` + delegator `src/main/ipc/domains/cohort.ts`, preload `src/preload/domains/cohort.ts`, factory `src/preload/window-api/domains.ts`, assembly `src/preload/window-api/create-window-api.ts`/`core-api.ts`, interface `src/shared/types/api.ts`, mock `tests/utils/mock-api.ts`, assertion `tests/shared/types/preload-contract.test.ts`. Web route `src/web/server/routes/cohort.ts` + `openapi-paths/cohort.ts` + `task-types.ts`.
13. **agent-health**: `scripts/check-agent-health.mjs` ignores `migrations`/`migration` paths (`:152-165`); PG-baseline `scripts/agent-health-postgres-baseline.json` (monotonic decrease) + `runNamed :vN` suffix gate apply to new repo code.

**Branch discipline:** never commit feature work to `main` (`AGENTS.md`). Each PR on its own branch. Worktrees optional (PRs are sequenced, so parallelism is limited).

---

## Pre-flight (controller, before dispatching any subagent)

- [ ] **Branch hygiene.** From `main`: `git status` clean; `git fetch origin && git rev-list --left-right --count origin/main...main` → `0 0`.
- [ ] **Read the spec.** Note PR-0 (S1–S6), PR-1 (P1–P10), PR-2 (G1–G5), PR-3 (R1–R5), the 14 acceptance gates, and the 7 Open Questions. Settled spec decisions must not be re-litigated mid-execution.
- [ ] **Verify clean baseline.**
  ```bash
  git checkout main && git pull --ff-only
  make ci
  VARLENS_WEB=1 make ci
  ```
  Expected: both exit 0. (Verified green this session.) Surface failures before starting.
- [ ] **PG up + fixture present.**
  ```bash
  make pg-reset && make pg-up        # PG @ 55434 per .env.postgres.local
  scripts/postgres/download-wgs-fixture.sh   # idempotent; writes tests/.cache/wgs/ (gitignored)
  ```
- [ ] **Confirm the migration head** before any migration task: `ls src/main/storage/postgres/migrations/sql/ | sort | tail -3`.

---

## Branch convention

| PR | Branch | Tasks | Depends on | Tag target |
|---|---|---|---|---|
| PR-0 | `spike/storage-shape-validation` | S1–S6 | — | none |
| PR-1 | `feat/pg-partition-jsonb-brin` | P1–P10 | PR-0 merged | minor bump |
| PR-2 | `feat/pg-gene-burden-summary` | G1–G5 | PR-1 merged | minor bump |
| PR-3 | `feat/gene-burden-server-pagination` | R1–R5 | PR-2 merged | sprint-exit tag |

```bash
git checkout main && git pull --ff-only
git checkout -b spike/storage-shape-validation
```

---

# PR-0 — `chore(perf): WGS multicase fixture + partition/jsonb spike + vacuum bench`

**Branch:** `spike/storage-shape-validation`. **Purpose:** convert the audit's three unconfirmed items into measured numbers and freeze PR-1's design parameters (OQ-1/2/3/6/7). Tooling merges; the prototype schema is throwaway.

### Task PR0-1 (S1): N-case annotated WGS fixture builder

**Files:** Create `scripts/perf/build-wgs-multicase-fixture.mjs`; create `tests/perf/wgs-multicase-fixture.test.ts` (manifest-shape unit test, not gated).

- [ ] **Step 1 — resolve OQ-1 (annotation strategy) first.** Try, in order, and record which worked in the spike report: (a) VEP with a local offline cache on the HG002 WGS VCF; (b) SnpEff; (c) if both exceed the dev-box budget, synthesise plausible `gene_symbol`/`consequence`/`func`/`clinvar` onto a documented fraction of rows so `search_document` populates. The chr22 GIAB Chinese-Trio data in `tests/test-data/vcf/` is already annotated (per `AGENTS.md`) — usable as a scaling seed.
- [ ] **Step 2 — implement the builder.** Reads the base fixture (`tests/.cache/wgs/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz`), produces `N` (default 8, `--cases N`) distinct annotated single-sample VCFs (or one VCF imported under N case names), output to `tests/.cache/wgs/multicase/` (gitignored), idempotent + content-addressed, writes `manifest.json` (case count, per-case row count, annotation-coverage %). Use structured logging (no `console.*` in any code under `src/`; a standalone `scripts/` mjs may print, but match the style of existing `scripts/perf/*.mjs`).
- [ ] **Step 3 — verify.** `node scripts/perf/build-wgs-multicase-fixture.mjs --cases 8`; assert manifest bounds; `npx vitest run tests/perf/wgs-multicase-fixture.test.ts`. `make format`.
- [ ] **Step 4 — commit.** `chore(perf): N-case annotated WGS fixture builder for storage-shape spike`.

### Task PR0-2 (S1): Generalise the WGS query harness to N cases against an annotated fixture

**Files:** Modify `tests/perf/postgres-wgs-query.perf.test.ts` (allow `VARLENS_WGS_FIXTURE` to point at the multicase manifest / import N cases before benchmarking); possibly a small helper in `src/main/storage/postgres/postgres-query-benchmark.ts`.

- [ ] **Step 1 — make the harness import N cases** (the multicase fixture) before running the five budgeted queries, OR document that PR-0 imports them via `window.api.import.start` in a setup step. Keep the existing 1-case path working (default).
- [ ] **Step 2 — confirm gate 4.** With the annotated fixture loaded, run `VARLENS_RUN_WGS_QUERY_PERF=1 npx vitest run tests/perf/postgres-wgs-query.perf.test.ts` and confirm `gene query`, `impact/pathogenicity filter`, `text search` now report `representative: true` (rows > 0) — no longer `unavailable`. Capture the artifact under `.planning/artifacts/perf/postgres-query/`.
- [ ] **Step 3 — verify + format + commit.** `test(perf): drive WGS query harness against annotated N-case fixture`.

### Task PR0-3 (S2): Prototype partition+JSONB+BRIN schema benchmark (throwaway)

**Files:** A throwaway prototype migration SQL (do NOT register in `definitions.ts`; apply manually via `psql`) + a benchmark script `scripts/perf/spike-partition-bench.mjs` (may merge as a one-off bench tool, or stay branch-local — controller decides).

- [ ] **Step 1 — build the candidate `0012` schema by hand** in a scratch schema: partitioned `variants` (PK `(id, chr)`, `LIST (chr) DEFAULT`, explicit chr1–22/X/Y/M partitions), `info_json JSONB`, partition-local BRIN, `chr` + composite FK on the six children. Use `SET statement_timeout = 0` for the `psql` session.
- [ ] **Step 2 — load + measure.** Load the S1 fixture into both the current and prototype schemas. Run the query harness against each. Capture per-query p50/p95/max, rewrite/load wall-time, and `EXPLAIN (ANALYZE, BUFFERS)` for each of the five queries on the prototype — confirm partition pruning, BRIN usage, and whether the GIN index is ever chosen.
- [ ] **Step 3 — record in the spike report** (PR0-6). No production commit of the prototype schema.

### Task PR0-4 (S3): 100-case import wall-time

- [ ] **Step 1 — import ~100 cases** of the S1 fixture (loop `window.api.import.start`, distinct names) into a fresh schema; time it. Run `VARLENS_PG_IMPORT_PROFILE=1` to capture the per-phase breakdown (and whether `digest`/coord_hash is hot, informing Sprint C's F12).
- [ ] **Step 2 — record** throughput, total wall-time, and whether scaling is linear or degrades (autovacuum, `variant_frequency` upsert contention) in the spike report.

### Task PR0-5 (S4): VACUUM / bloat experiment

- [ ] **Step 1 — on a ~50–100-case schema** (current, unpartitioned): `DELETE FROM cases WHERE id IN (… 50 …)`; `VACUUM (VERBOSE) variants;`; record `pg_stat_user_tables.n_dead_tup`, bloat (`pgstattuple` if the extension is available), and wall-time.
- [ ] **Step 2 — repeat on the partitioned prototype** (partition-local VACUUM) and compare. This is the empirical justification for F1.
- [ ] **Step 3 — record** the before/after in the spike report.

### Task PR0-6 (S5+S6): Spike go/no-go report

**Files:** Create `.planning/docs/2026-05-29-sprint-b-storage-shape-spike.md`.

- [ ] **Step 1 — write the report**: S2 query-perf + plan diffs; S3 100-case wall-time; S4 VACUUM before/after; S5 note (no 1000-case renderer fixture; S1 generator is the precursor; Sprint D dependency). **Freeze the PR-1 parameters:** OQ-1 (annotation method used), OQ-2 (GIN ship/defer), OQ-3 (generated-column field or "mechanism-only"), OQ-6 (partition list, PK order, `pages_per_range`), OQ-7 (`variant_sv/cnv/str` partitioned y/n). Render a **go/no-go** for F1 — if S2/S4 don't justify partitioning, recommend descope.
- [ ] **Step 2 — verify + commit.** `make format`. Commit: `docs(planning): storage-shape spike go/no-go + frozen PR-1 parameters`. **(Gate 3.)**
- [ ] **Open the PR** with the merged tooling (PR0-1, PR0-2, optionally PR0-3's bench tool, PR0-6 report). `make ci` + `VARLENS_WEB=1 make ci` green. Controller merges after review.

---

# PR-1 — `feat(pg): partition variants by chr, info_json→jsonb, partition-local brin`

**Branch:** `feat/pg-partition-jsonb-brin` (from `main` after PR-0 merged). **Tasks:** P1–P10. **Cite the spike report's frozen parameters in every migration task.** Tag target: minor bump.

> **Migration discipline:** one migration file `0012_<name>.sql`. It opens with the `SET LOCAL …timeout = 0` triple (RC-2). It is written, tested against fresh + populated + Docker-init schemas, and is then immutable (checksum). Build it incrementally on the branch but the FINAL committed SQL is one coherent file.

### Task PR1-1 (P1/P9): Migration `0012` skeleton + partition `variants` — TDD partition-shape test first

**Files:** Create `tests/main/storage/postgres-partition-shape.test.ts` (failing); create `src/main/storage/postgres/migrations/sql/0012_partition_variants_jsonb.sql`; modify `definitions.ts`.

- [ ] **Step 1 — re-verify the migration number** (`ls … | sort | tail -3`).
- [ ] **Step 2 — write the failing test** (copy the inline-schema setup from an existing `tests/main/storage/postgres-*.test.ts`, RC-11): after `createPostgresStorageSession` runs migrations on a fresh schema, assert via `pg_partitioned_table` / `pg_class.relkind = 'p'` that `variants` is partitioned by `LIST (chr)`; assert the `DEFAULT` partition exists; assert an inserted `chrUn_X` row lands in `DEFAULT` and a `chrM` row in its partition; assert `variants` PK is `(id, chr)`.
- [ ] **Step 3 — author the migration**: `SET LOCAL` timeouts; shadow-table-swap — `ALTER TABLE variants RENAME TO variants_legacy;` then `CREATE TABLE variants (… PRIMARY KEY (id, chr)) PARTITION BY LIST (chr);` create the explicit chr partitions + `DEFAULT`; re-declare `coord_hash` + `search_document` generated columns and the `compute_variants_search_doc` IMMUTABLE function dependency (mirror `0004`); `INSERT INTO variants SELECT … FROM variants_legacy`. (Children + JSONB + indexes follow in P2/P4/P7 tasks but land in the SAME file — build incrementally, commit the file once coherent.)
- [ ] **Step 4 — register** in `MIGRATION_FILES` + rebuild `POSTGRES_MIGRATIONS`.
- [ ] **Step 5 — run** the partition-shape test + the migration-registration/runner suite:
  ```bash
  make pg-reset && make pg-up && make rebuild-node
  npx vitest run tests/main/storage/postgres-partition-shape.test.ts \
    tests/main/storage/postgres-migrations-registration.test.ts \
    tests/main/storage/postgres-migration-runner.test.ts
  ```
- [ ] **Step 6 — `make format` + commit.** `feat(pg): migration 0012 — partition variants by LIST(chr) DEFAULT`.

### Task PR1-2 (P2): Cascade `chr` + composite FK onto the six children

**Files:** extend `0012_*.sql`; extend `postgres-partition-shape.test.ts`.

- [ ] **Step 1 — extend the test:** assert each of `variant_transcripts`, `variant_sv`, `variant_cnv`, `variant_str`, `case_variant_annotations`, `variant_tags` has a `chr` column and an FK referencing `variants(id, chr)`; assert `variant_transcripts` (and any S6-chosen children) is partitioned by `LIST (chr)`.
- [ ] **Step 2 — extend the migration:** add `chr TEXT NOT NULL` to all six; backfill via JOIN to `variants` during the rewrite (rename-old → create-new-with-chr → `INSERT … SELECT c.*, v.chr FROM child_legacy c JOIN variants v ON v.id = c.variant_id`); replace single-column FKs with `(variant_id, chr) REFERENCES variants(id, chr) ON DELETE CASCADE`; partition `variant_transcripts` (and per-S6 the small children) by `LIST (chr)`.
- [ ] **Step 3 — delete-cascade regression test:** insert a variant + child rows, `DELETE` the case, assert children gone (composite-FK cascade fires).
- [ ] **Step 4 — run + format + commit.** `feat(pg): denormalise chr + composite FKs onto variant child tables (0012)`.

### Task PR1-3 (P3): Partition `cohort_variant_summary` by chr

**Files:** extend `0012_*.sql`; extend the shape test.

- [ ] **Step 1 — test:** `cohort_variant_summary` is `relkind='p'`, `LIST (chr)`; the six `idx_cvs_*` exist as partition-local indexes; rows route correctly.
- [ ] **Step 2 — migration:** rename → recreate partitioned (PK unchanged, chr already leads) → recreate the six indexes on the parent → `INSERT … SELECT`. (Sprint A explicitly deferred this here.)
- [ ] **Step 3 — run + format + commit.** `feat(pg): partition cohort_variant_summary by LIST(chr) (0012)`.

### Task PR1-4 (P4): `info_json TEXT → JSONB` + COPY encoder switch

**Files:** extend `0012_*.sql`; modify `src/main/storage/postgres/postgres-import-columns.ts:191`; verify `copy-text-encoder.ts` `encodeJsonb`.

- [ ] **Step 1 — test (TDD):** a round-trip test — import a variant with a representative INFO blob via COPY, assert PG `info_json` column type is `jsonb` (`information_schema.columns`) and the value parses back to the original object; assert SQLite `info_json` stays `TEXT` (explicit no-change assertion).
- [ ] **Step 2 — migration:** declare `info_json JSONB` on the new partitioned `variants` (already created in PR1-1; ensure the column type is JSONB there and the `INSERT … SELECT` casts `info_json::jsonb`).
- [ ] **Step 3 — switch the COPY encoder** for `info_json` from `encodeText` to `encodeJsonb` at `postgres-import-columns.ts:191`; confirm `encodeJsonb` (`copy-text-encoder.ts:106`) handles the JSON-text→jsonb COPY path (it is currently reserved/unused — verify or implement).
- [ ] **Step 4 — run** the import COPY test suite + the round-trip:
  ```bash
  make pg-reset && make pg-up && make rebuild-node
  npx vitest run tests/main/storage/postgres-vcf-import-repository.copy.test.ts \
    tests/e2e/postgres-vcf-copy-large-allele.e2e.ts  # adjust to actual gated availability
  ```
- [ ] **Step 5 — format + commit.** `feat(pg): info_json TEXT→JSONB inside the partition rewrite (0012)`.

### Task PR1-5 (P5): GIN `(info_json jsonb_path_ops)` — evidence-gated (OQ-2)

**Files:** extend `0012_*.sql` ONLY if the spike said ship.

- [ ] **Step 1 — read the spike report's OQ-2 decision.**
  - **If defer (default):** add a one-line SQL comment + a `mainLogger` note where relevant + a line in the spike/PR body recording the deferral. **No silent omission.** Skip to PR1-6.
  - **If ship:** add `CREATE INDEX … USING GIN (info_json jsonb_path_ops)` on the partitioned parent; write a test that an `info_json @> '{…}'` probe uses the index (`EXPLAIN` contains the GIN scan).
- [ ] **Step 2 — run + format + commit** (only if shipped). `feat(pg): GIN(jsonb_path_ops) on info_json (0012, spike-approved)`.

### Task PR1-6 (P6): STORED-generated-column mechanism for hot INFO fields (OQ-3)

**Files:** extend `0012_*.sql`; `tests/main/storage/postgres-generated-info-column.test.ts`.

- [ ] **Step 1 — read the spike's OQ-3 field decision.** Default: mechanism + worked test on one field (synthetic if no real demand).
- [ ] **Step 2 — implement** following the `0004` IMMUTABLE-wrapper pattern: `CREATE FUNCTION … IMMUTABLE` extracting a numeric from `info_json`, `ADD COLUMN <field> <type> GENERATED ALWAYS AS (<fn>(info_json)) STORED`, btree index it.
- [ ] **Step 3 — test:** insert a row with the field in `info_json`; assert the generated column materialises and a range query on it uses the btree index (`EXPLAIN`).
- [ ] **Step 4 — format + commit.** `feat(pg): STORED generated-column mechanism for hot info_json fields (0012)`.

### Task PR1-7 (P7): Partition-local BRIN + gene-trgm recreation

**Files:** extend `0012_*.sql`; extend shape test.

- [ ] **Step 1 — test:** `variants_brin_chr_pos` exists as a partition-local BRIN with the S6-frozen `pages_per_range`; `variants_gene_trgm` recreated; a range query on the partitioned table uses BRIN (`EXPLAIN`).
- [ ] **Step 2 — migration:** recreate `variants_brin_chr_pos USING BRIN (chr, pos) WITH (pages_per_range = <S6>)` and `variants_gene_trgm USING GIN (gene_symbol gin_trgm_ops)` on the partitioned parent. Also recreate the five `idx_variants_case_*` btrees + `variants_coords` + the search_document GIN per partition.
- [ ] **Step 3 — run + format + commit.** `perf(pg): partition-local BRIN + gene-trgm + coordinate indexes (0012)`.

### Task PR1-8 (P8): Repository read/write parity + idempotency on all schema origins

**Files:** verify/adjust `PostgresVariantReadRepository.ts` (`buildPostgresVariantQueryParts:97`), `postgres-cohort-summary-query.ts`, `postgres-import-worker.ts`, `PostgresCaseLifecycleRepository.ts`; add `tests/main/storage/postgres-partition-migration-origins.test.ts`.

- [ ] **Step 1 — grep for any single-column `variants(id)` FK assumption or raw `info_json` text handling** in the PG repos; fix to match the partitioned + JSONB shape. No IPC change.
- [ ] **Step 2 — origins test:** run migration `0012` against (a) a fresh migration-built schema, (b) a schema pre-seeded with legacy-shape data then migrated (the rewrite path), (c) optionally a Docker-init-bootstrapped schema (RC-10). Assert no data loss (row counts preserved) and partition shape correct in all.
- [ ] **Step 3 — run** the broad PG storage suite:
  ```bash
  make pg-reset && make pg-up && make rebuild-node
  npx vitest run tests/main/storage/
  ```
- [ ] **Step 4 — format + commit.** `refactor(pg): repository parity for partitioned + jsonb variants (0012)`.

### Task PR1-9 (P10): Backend output-parity test

**Files:** extend the parity test family (`tests/main/storage/*-backend-parity.test.ts` per Sprint A precedent).

- [ ] **Step 1 — test:** load the parity fixture into SQLite + partitioned PG; assert variant-query + cohort results set-equal (sort-normalised), including a `DEFAULT`-partition (chrUn/ALT-contig) row and a `chrM` row. Run with `VARLENS_RUN_POSTGRES_E2E=1` style gating as the existing parity tests do.
- [ ] **Step 2 — run + format + commit.** `test(storage): partitioned-PG vs sqlite variant/cohort parity (Gate 9)`.

### Task PR1-10 (P10): Sprint-exit perf gate on the 8-case annotated harness

- [ ] **Step 1 — run** the PR-0 8-case annotated harness against the partitioned schema:
  ```bash
  make pg-reset && make pg-up
  node scripts/perf/build-wgs-multicase-fixture.mjs --cases 8
  # import the 8 annotated cases, then:
  VARLENS_RUN_WGS_QUERY_PERF=1 npx vitest run tests/perf/postgres-wgs-query.perf.test.ts
  ```
- [ ] **Step 2 — assert all five budgets `p95 ≤ 0.75 × budget`** (≥25 % margin) and `representative: true`; the two previously-passing budgets must not regress. Record the artifact path (`.planning/artifacts/perf/postgres-query/…-postgres-query.json`) in the PR body (gitignored). **(Gate 8.)** If any budget misses, this is a real result — surface it, do not fabricate; iterate on partition/index params (still within S6's envelope) or escalate.
- [ ] **Step 3 — full gates.** `make ci-full` and `VARLENS_WEB=1 make ci` green. **(Gates 1, 2.)** `make format`. Open PR; controller merges after review + green cross-platform Actions.

---

# PR-2 — `feat(pg): materialise gene_burden_summary (parity with sqlite)`

**Branch:** `feat/pg-gene-burden-summary` (from `main` after PR-1). **Tasks:** G1–G5. No SQLite migration; no renderer/contract change. Tag target: minor bump.

### Task PR2-1 (G1): Migration `0013` — PG `gene_burden_summary`

**Files:** Create `src/main/storage/postgres/migrations/sql/0013_gene_burden_summary.sql`; modify `definitions.ts`; create `tests/main/storage/postgres-gene-burden-migration.test.ts`.

- [ ] **Step 1 — re-verify the number** (`… tail -3` → expect `0012`). **Step 2 — failing test:** after migrations, `gene_burden_summary` exists with PK `(gene_symbol, genome_build)`, columns mirroring SQLite `v25` (`migrations.ts:1558`), and `idx_gbs_affected (affected_case_count DESC)`.
- [ ] **Step 3 — author** the migration (mirror SQLite schema; `updated_at` type matches the repo's read mapping; unpartitioned). Register in `MIGRATION_FILES`.
- [ ] **Step 4 — run + format + commit.** `feat(pg): migration 0013 — gene_burden_summary table`.

### Task PR2-2 (G2/G3): Materialisation repository + rebuild SQL + wiring

**Files:** Create `PostgresGeneBurdenSummaryRepository` (or method on `PostgresCohortSummaryRepository`); wire into the cohort full-rebuild path; create `tests/main/storage/postgres-gene-burden-rebuild.test.ts`.

- [ ] **Step 1 — failing test:** seed variants across two `genome_build`s + a gene present in both; run `rebuild`; assert one `gene_burden_summary` row per `(gene_symbol, genome_build)` with correct `variant_count`/`unique_variant_count`/`affected_case_count` matching `REBUILD_GENE_BURDEN_SQL` semantics.
- [ ] **Step 2 — implement `rebuild({schema, client})`** mirroring `src/shared/sql/cohort-summary-rebuild.ts:101` (`DELETE` + `INSERT … SELECT … GROUP BY gene_symbol, genome_build` — **with `genome_build` grouping**, RC-8 fix). No incremental add/remove (RC-9). Honour the `runNamed :vN` suffix gate + PG-baseline gate for any new `pool.query` literal.
- [ ] **Step 3 — wire `rebuild`** into the same path that rebuilds `cohort_variant_summary` (PG side of `rebuild-summary-worker` / the cohort rebuild entry) so a cohort rebuild refreshes both. Incremental import/delete paths leave it stale (parity with SQLite).
- [ ] **Step 4 — run + format + commit.** `feat(pg): gene_burden_summary rebuild mirroring SQLite (genome_build grouping fix)`.

### Task PR2-3 (G4): `getGeneBurden` reads the materialised table

**Files:** modify `PostgresCohortRepository.getGeneBurden` (`:486`).

- [ ] **Step 1 — switch** the live `GROUP BY variants` to `SELECT … FROM gene_burden_summary ORDER BY affected_case_count DESC, variant_count DESC` — byte-for-byte the SQLite read shape (`cohort.ts:440`). Contract unchanged.
- [ ] **Step 2 — run** the cohort + web read suites (web inherits via `PostgresReadExecutor`):
  ```bash
  npx vitest run tests/main/storage/ tests/main/ipc/  # cohort read paths
  VARLENS_WEB=1 make test
  ```
- [ ] **Step 3 — format + commit.** `perf(pg): getGeneBurden reads gene_burden_summary (no live GROUP BY)`.

### Task PR2-4 (G5): Backend-parity + warm-perf gates

**Files:** Create `tests/main/storage/gene-burden-backend-parity.test.ts`; create `tests/perf/postgres-gene-burden.perf.test.ts` (gated).

- [ ] **Step 1 — parity test:** SQLite vs PG `getGeneBurden` set-equal on the parity fixture, including a multi-build row (locks the RC-8 `genome_build` fix). **(Gate 10, 11.)**
- [ ] **Step 2 — warm-perf test (gated):** on the S1 8-case fixture, gene-burden load `p95 < 500 ms` warm (1 cold + 5 warm); record the 100-case number from S3's fixture as evidence (soft). Artifact under `.planning/artifacts/perf/postgres-query/` (or `postgres-gene-burden/`).
- [ ] **Step 3 — full gates + format + commit.** `make ci-full`, `VARLENS_WEB=1 make ci` green. `test(storage): gene-burden backend parity + warm-perf (Gates 10,11)`. Open PR; merge after review.

---

# PR-3 — `feat(cohort): server-paginated gene burden + min-affected pre-filter`

**Branch:** `feat/gene-burden-server-pagination` (from `main` after PR-2). **Tasks:** R1–R5. **Cohort parity in this PR** (`feedback_cohort_parity.md`). UI placement confirmed at UI-spec time (OQ-4) — run `gsd-ui-phase` for `GeneBurdenTable`/cohort surface before PR3-2 if the placement is unsettled. Tag target: sprint-exit.

### Task PR3-1 (R1): Paginated/filtered `getGeneBurden` contract — full domain-module checklist

**Files (8-step checklist, RC-12):** `src/shared/ipc/domains/cohort.ts`, `src/main/ipc/handlers/cohort.ts` (+ logic in `cohort-logic.ts`), `src/main/ipc/domains/cohort.ts`, `src/preload/domains/cohort.ts`, `src/preload/window-api/{domains,create-window-api,core-api}.ts` as needed, `src/shared/types/api.ts`, `tests/utils/mock-api.ts`, `tests/shared/types/preload-contract.test.ts`; backends `PostgresCohortRepository` + `src/main/database/cohort.ts`; web `src/web/server/routes/cohort.ts` + `openapi-paths/cohort.ts` + `task-types.ts`.

- [ ] **Step 1 — failing preload-contract test** for `cohort:getGeneBurdenPage` + the `WindowAPI`/`CohortAPI`/mock surface. **(Gate 12.)**
- [ ] **Step 2 — add the contract method:** `getGeneBurdenPage(params: { page; pageSize; sortBy?; minAffectedCases?; geneSearch? }): Promise<IpcResult<{ rows: GeneBurden[]; total: number }>>`. Implement on both backends pushing `WHERE affected_case_count >= $min`, optional `gene_symbol ILIKE`, `ORDER BY`, `LIMIT/OFFSET` (or keyset) down to `gene_burden_summary` + a `COUNT(*)` for `total`.
- [ ] **Step 3 — web route + OpenAPI + task-type** for `cohort:getGeneBurdenPage`.
- [ ] **Step 4 — decide the fate of the old param-less `getGeneBurden`** (remove if no caller remains — grep gate — or keep as a thin web wrapper). Document in commit.
- [ ] **Step 5 — run** preload-contract + cohort suites + `VARLENS_WEB=1 make test`; **format + commit.** `feat(ipc): paginated cohort getGeneBurdenPage (both backends + web)`.

### Task PR3-2 (R2/R3): `GeneBurdenTable.vue` → `v-data-table-server` + wire the surface in

**Files:** `src/renderer/src/components/GeneBurdenTable.vue`; create `src/renderer/src/composables/useGeneBurden.ts`; mount point per OQ-4 (default: a Cohort-view "Gene Burden Summary" sub-section + case-scoped parity).

- [ ] **Step 1 — `useGeneBurden` composable** (DRY, `feedback_dry_principles.md`): owns pagination/sort/filter state + the `getGeneBurdenPage` call; no inline fetch in the component.
- [ ] **Step 2 — convert the table** to `v-data-table-server` (server `items-per-page`, `@update:options` → composable). Honour `.planning/docs/UI-PATTERNS.md`: no `surface-variant` backgrounds; `v-data-table-server` `v-model:expanded` is string keys.
- [ ] **Step 3 — add the "min affected cases" pre-filter** control + gene-symbol search; defaults per UI-spec.
- [ ] **Step 4 — wire the surface into the UI** (OQ-4 placement); do NOT re-task `association/GeneBurdenView.vue`.
- [ ] **Step 5 — typecheck + renderer tests + format + commit.** `feat(cohort): server-paginated GeneBurdenTable with min-affected pre-filter`.

### Task PR3-3 (R4): Cohort-view parity

- [ ] **Step 1 — ensure the pagination + min-affected pre-filter + sort ship for BOTH** case-scoped and cohort-scoped gene-burden surfaces in this PR (`feedback_cohort_parity.md`). **(Gate 13.)**
- [ ] **Step 2 — parity-aware integration test** covering both scopes. Format + commit. `feat(cohort): gene-burden parity across case + cohort scopes`.

### Task PR3-4 (R5): Tests + sprint-exit gates

- [ ] **Step 1 — renderer integration tests** (`useGeneBurden` param construction; `GeneBurdenTable` server-mode round-trips, happy-dom). Optional E2E against the parity fixture (page + filter, assert server round-trips + DOM bounds).
- [ ] **Step 2 — full gates.** `make ci-full` + `VARLENS_WEB=1 make ci` green. **(Gates 1, 2.)** `make format`. Open PR; merge after review + green cross-platform Actions.
- [ ] **Step 3 — sprint exit (controller).** After all PRs merged: `make ci-full` on `main`; promote CHANGELOG `[Unreleased]` → minor bump; tag-vs-package guard passes. **Tag push deferred to the user** (release.yml publishes signed installers). **(Gate 14.)**

---

## Verification matrix (gate → step)

| Gate | Verified by |
|---|---|
| 1 — `make ci-full` green per PR | PR1-10 S3, PR2-4 S3, PR3-4 S2 |
| 2 — `VARLENS_WEB=1 make ci` green per PR | PR1-10 S3, PR2-3 S2 / PR2-4 S3, PR3-1 S5 / PR3-4 S2 |
| 3 — spike report + frozen params | PR0-6 |
| 4 — annotated fixture makes 3 budgets representative | PR0-2 S2 |
| 5 — partition correctness (relkind, FKs, DEFAULT/chrM routing, pruning, 3 schema origins) | PR1-1, PR1-2, PR1-8 |
| 6 — JSONB correctness + GIN-or-deferral note | PR1-4, PR1-5 |
| 7 — generated-column mechanism | PR1-6 |
| 8 — exit perf gate (5 budgets ≤ 0.75× on partitioned schema) | PR1-10 |
| 9 — backend output-parity (partitioned PG vs SQLite) | PR1-9 |
| 10 — gene-burden materialised, genome_build grouping fix | PR2-2, PR2-3, PR2-4 S1 |
| 11 — gene-burden parity + warm-perf | PR2-4 |
| 12 — paginated contract extension | PR3-1 |
| 13 — cohort parity (case + cohort) | PR3-3 |
| 14 — sprint exit (merge, CHANGELOG, guard; tag deferred) | PR3-4 S3 |

## Per-task verification checklist (every task)

1. `make typecheck` (always).
2. Touching renderer/IPC/db/workers → `make rebuild-node && <scoped vitest>`.
3. Touching PG → `make pg-reset && make pg-up` then scoped `vitest`, `make pg-down` after.
4. Touching shared/renderer contracts → `VARLENS_WEB=1 make test`.
5. **`make format`** (Sprint A learning — implementers skipped this and forced controller fix-ups).
6. `make agent-check` before opening each PR (PG-baseline + `runNamed :vN` gates; migrations exempt).
7. Atomic Conventional Commit; never on `main`.
