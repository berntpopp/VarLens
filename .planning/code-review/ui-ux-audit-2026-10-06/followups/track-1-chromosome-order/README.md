# Track 1: natural chromosome order

Audit item: §9 P1 "Default case sort ignores chromosome". Also covers D-2 (the default sort had no matching index) and the chromosome part of D-7 (cohort default sort index).

## What changed

- `src/shared/sql/chromosome-order.ts` holds the single chr-rank expression (`chrRankSql`) and its JS mirror (`chromosomeRank`, `compareChromosomes`). The order is 1..22, X, Y, MT (M = MT), then every other contig, compared bytewise by name. A `chr` prefix is ignored in any letter case.
- Every sort sink emits ORDER BY through the shared helpers:
  - case view: SQLite `VariantFilterBuilder.applySort` and PG `buildPostgresVariantOrderBy`
  - SQLite export
  - cohort view: SQLite `CohortService`, the PG summary query, and the PG live aggregate (also used for export)
  - shortlist tiebreakers (`compareScoredRows`)
- On PG, the name tiebreaker uses `COLLATE "C"`. With the database collation (en_US), `chrUn_…` would sort before `GL…`, unlike SQLite's BINARY collation.

## Indexes (also used by track 5b for keyset paging)

| Name | Backend | Columns |
|---|---|---|
| `idx_variants_case_chr_rank` | SQLite v33 | `variants(case_id, chr_rank_expr, chr, pos)` (rowid = id is implicit) |
| `idx_variants_case_chr_rank` | PG 0017 | `variants_all(case_id, chr_rank_expr, chr COLLATE "C", pos, id)` |
| `idx_cvs_chr_rank` | both | `cohort_variant_summary(chr_rank_expr, chr, pos, ref, alt)` |
| `idx_cvs_carrier_chr_rank` | both | `cohort_variant_summary(carrier_count DESC [NULLS LAST], chr_rank_expr, chr, pos, ref, alt)` |

The keyset for the default case order is `(chr_rank_expr, chr, pos, id)`. Use `genomicVariantOrderTerms(alias, dialect)` for the ORDER BY and `chrRankSql(column)` for the key, so the expression matches the index byte for byte. The PG `chr` comparison needs `COLLATE "C"`.

Tests use EXPLAIN to confirm that the default case order and both cohort orders walk these indexes with no Sort / TEMP B-TREE step:

- SQLite: `tests/main/database/chr-rank-order.test.ts`
- PG, gated: `tests/main/storage/postgres-chr-rank-order.test.ts`

## Before and after (built web UI, PG backend, same data)

The fixture has 2 cases on contigs 1, 2, 3, 6, 10, 11, 16, 17, 22, X, Y, MT, GL000220.1 and chrUn_KI270742v1, inserted in shuffled order. The check is the headless Playwright script `ui-order-check.cjs`, run against a web build on :8810.

| Table | Before | After |
|---|---|---|
| Case, default (SNV/Indel) | 1, 10, 11, 16, 17, 2, 22, 3, 6, chrUn, GL, MT, X, Y | 1, 2, 3, 6, 10, 11, 16, 17, 22, X, Y, MT, GL, chrUn |
| Case, Shortlist (chr tiebreaker) | 1, 10, 11, …, 2, … (`before-case-shortlist.png`) | natural (`after-case-shortlist.png`) |
| Case, Chr header asc / desc | text order | natural / reverse natural |
| Cohort, Chr header asc / desc | text order | natural / reverse natural (`after-cohort-chr-asc.png`) |
| Cohort, default (carrier_count desc) | ties broken in text order | ties broken in natural order |

Raw data sits next to this file but is not committed, because `.gitignore` excludes `*.png` and `.planning/code-review/**/*.json`:

- `before-sql-order.json`: the old ORDER BY run on the same PG rows
- `after-ui-order.json`: the Chr column read from the rendered tables
- `*.png`: screenshots

Re-create them with `node ui-order-check.cjs <outDir>` against a seeded web build on :8810.
