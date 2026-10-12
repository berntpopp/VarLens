# Chromosome naming per genome build — migration spec

Status: approved design (09-chr-normalisation-and-cohort-denominator.md, Part 1, Option B), 2026-10-12.
Branch: `feat/chr-naming-per-build` (stacked on `fix/uiux-audit-batch-2`, which holds genome-build detection).
This changes stored user data, so this spec is required before code.

## Rule

Each case stores its primary chromosomes in its build's reference-dictionary form:

| Build  | 1–22, X, Y        | Mitochondrion                                     |
|--------|-------------------|---------------------------------------------------|
| GRCh38 | `chr1…chr22, chrX, chrY` | `chrM` (`M`, `MT`, `chrMT` → `chrM`; all rCRS)   |
| GRCh37 | `1…22, X, Y`      | `MT` (`chrMT` → `MT`); hg19 `chrM` (NC_001807) stays `chrM`, never merged with `MT` |

Only these 25 names are renamed. Alt/decoy/unplaced/HLA/RefSeq names are stored verbatim.
The canonical forms live in `src/shared/config/genome-builds.config.ts` (`primaryPrefix`, `mito.canonical`,
`mito.aliases`); `src/shared/utils/contig.ts` is the only code that applies them. A build without these
fields (or an unknown build id) keeps every name verbatim.

`chr_rank` (`chrRankSql`) ignores the prefix and treats M = MT, so rank values and the rank expression
indexes do not change (verified by test: the rank of every renamed pair is equal).

## Data affected

| Table | Change |
|-------|--------|
| `variants` (PG `variants_all`) | `chr` rewritten for renamed cases. PG `coord_hash`/`search_document` regenerate (STORED). SQLite FTS follows the `variants_fts_au` trigger. |
| `case_variant_annotations`, `variant_tags`, extension tables | keyed by `variant_id` — untouched. |
| `variant_annotations` (global star/comment/ACMG, UNIQUE `chr,pos,ref,alt`) | rows at a renamed key are moved, copied or merged (rules below). |
| `variant_frequency` | per case: decrement the old keys before the rename, count the new keys after (existing per-case helpers). |
| `cohort_variant_summary`, gene summaries | flagged stale; rebuilt by the existing machinery (SQLite `MARK_STALE_SQL` → rebuild on next cohort read; PG `markCohortSummaryStale` → background rebuild). |
| `cases.genome_build` | changed only when the user confirms another build for a flagged case. |
| new `contig_build_review` | one row per flagged case: `case_id` PK (cascade), `stored_build`, `suggested_build` (nullable), `reason`, `created_at`. |
| `audit_log` | one `acmg_classify` entry per discarded ACMG classification of a merge (`new_value.reason = 'contig_merge'`); no schema change (PG audit schema is centrally owned). |

## Build re-check (before any rename)

Cases stored as GRCh38 by past batch/JSON imports may be GRCh37. Renaming such a case would invent wrong
names. For every case whose primary contigs are not canonical for its stored build:

1. Evidence: header lines re-read from each existing file in `case_import_files.file_path` (SQLite) and
   `cases.file_path` (both); plain or (b)gzip, at most the first 8 MiB. Plus the stored max `pos` per
   chromosome (can only exclude a build).
2. `redetectStoredCaseBuild` (pure, `src/shared/genome/genome-build.ts`, restored from 3c16ee3e).
3. Decision (`planCaseContigNaming`, pure, shared by both backends):
   - detected (definitive or strong) = stored build and not excluded → **rename**;
   - otherwise → **flag** (no rename): stored excluded or another build detected (`suggested_build` set),
     or no evidence at all (`suggested_build` null). Never guess.
4. Cases already canonical need no evidence and are never flagged.

Flagged cases are listed to the user (dense banner above the case list + dialog, copy in
`BUILD_COPY.review*`). The user picks a build per case; that sets `cases.genome_build` (if changed),
renames the case's contigs for that build with the same merge rules, deletes the review row, updates
frequencies and marks the summary stale. IPC: `cases:buildReviews` (read), `cases:resolveBuildReview`
(write, analyst+ on web), shared on both backends.

Until confirmed, a flagged case keeps its names. Search, the exact-variant filter and DSL `chr` equality
match every spelling, so they still work; panel regions and BED-region filtering use the canonical form
of the case build and do not match a flagged case's non-canonical contigs until it is confirmed.

## Annotation merge rules (per renamed key `from → to`, in the rename transaction)

Only `variant_annotations` rows whose key matches a variant of a renamed case are touched.
- Target row absent → the source becomes the target. **Copy** (source kept) when a variant of any case
  not being renamed still uses the source key (the row applied to both builds' loci before); else **move**.
- Target row present → **merge** into the target: `starred = max`, comments joined (`a\n\nb`, identical
  comments once), ACMG classification + evidence from the row with the newer `updated_at`; if both rows
  have different classifications, the discarded one is written to `audit_log`. The source row is then
  deleted or kept by the copy/move rule above.

## Order (per backend)

SQLite (`PRAGMA user_version` 46, `src/main/database/contig-naming-migration.ts`, runs in the migration
worker, one transaction):
1. Discover: `SELECT c.id, c.genome_build, v.chr, MAX(v.pos) … GROUP BY c.id, v.chr`; plan per case.
2. If any case will be renamed: checkpoint WAL and byte-copy the DB file to `<db>.pre-v46.bak`
   (skipped for `:memory:`; failure aborts the migration, nothing changed). This is the rollback.
3. In one transaction: per renamed case: decrement frequencies → merge annotations → `UPDATE variants`
   → count frequencies; insert review rows for flagged cases; mark the summary stale; set user_version 46.

PostgreSQL (`0029_contig_naming.sql` + background job `contig-naming-job.ts`):
1. Migration: create `contig_build_review` and `contig_naming_pending(case_id PK)`, seed the pending table
   with every existing case (newer imports are canonical at import and are never queued).
2. Job (scheduled like the severity backfill, from the cohort freshness probe): take one pending case
   (`FOR UPDATE SKIP LOCKED`), plan, rename or flag, delete its pending row — **one transaction per case**,
   so a crash resumes and readers see a case before or after its rewrite. When the queue empties and
   anything was renamed, `markCohortSummaryStale('contig_naming')`.
3. Backup: operator's responsibility (release notes); the job is resumable and idempotent.

## Idempotency

A second run finds every case canonical (or already flagged, which is skipped) and does nothing:
SQLite by user_version and by the plan being empty; PG by the empty pending table. Resolving a review
twice fails cleanly (no review row).

## Import and query input (same PR)

- Import: SQLite `insertBatch` (all SQLite VCF/JSON/append paths) the PG VCF repository (PostgresVcfImportRepository) and the PG JSON worker batch store
  `canonicalContig(chr, caseBuild)`.
- Query input: coordinate search (3 sites), exact-variant filter, DSL `chr =` / OR → every spelling
  (`contigQueryNames`). Panel regions and panel BED export → `canonicalContig(…, build)`; the four
  "does this case use chr" probes and `getChrPrefix` are deleted.
- APIs/links: `bareContig` replaces the five strip-`chr` copies. Links: `{chr}` = bare, new `{chr_ucsc}`;
  the UCSC built-in template uses `{chr_ucsc}` (a stored old default is upgraded); Franklin `chr{chr}`
  no longer yields `chrchr1`.

## Tests

- `contig.ts`: table test over every primary × importable build, every mito alias per build, unknown
  contigs, case/whitespace; `bareContig`; `contigQueryNames`.
- Planner: canonical → none; non-canonical + confirming header → rename; disagreeing/no evidence → flag.
- SQLite migration: mixed-build DB → expected rows, frequencies, summary stale, backup file; collision
  merge (star, comments, newer ACMG, audit row); cross-build copy vs move; run twice = no-op; unresolved
  case untouched + review row; rank unchanged.
- PG migration + job (`web-gate-postgres` style real-Postgres test): same scenarios, per-case resume.
- Resolve: confirm/change build renames the case and removes the review.
- Links, panel BED export (bare for GRCh37), panel intervals per build.

## Rollback

SQLite: close the app and replace the DB file with `<db>.pre-v46.bak` (it is the v45 database, so it
needs the previous app version). PG: restore the operator's backup.
