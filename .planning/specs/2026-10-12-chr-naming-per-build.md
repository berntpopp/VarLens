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

Flagged cases are listed to the user (dense banner + dialog, copy in `BUILD_COPY.review*`). The dialog
is built for hundreds to thousands of cases: rows are grouped by evidence (reason), each row starts at
the header's build or else the stored one (the user still confirms; nothing is applied unseen), a group
or any selection can be set to one build, the list is virtually scrolled, and "Confirm all" /
"Confirm selected" send **one** write: `cases:resolveBuildReviews(choices[])` (analyst+ on web).
Every confirmation writes an audit row (`api_write` / `api_call`, key `cases:<id>:genome_build`,
old → new build, the request's actor). SQLite renames the confirmed cases in that transaction; PostgreSQL
stores the builds and queues the cases (`contig_naming_pending.confirmed`), and the job renames them.
`cases:buildReviews` also reports `renameInProgress` (PG queue not empty): the shell then says that
cohort counts can mix old and new names until the background update finishes.

Until confirmed, a flagged case keeps its names. Search, the exact-variant filter and DSL `chr` equality
match every spelling, so they still work; panel regions and BED-region filtering use the canonical form
of the case build and do not match a flagged case's non-canonical contigs until it is confirmed.

## Annotation remap (`src/shared/genome/annotation-remap.ts`, both backends)

`variant_annotations` has no build in its key, so a row can serve cases of both builds. Rows are handled
per **locus group** (every spelling of one contig at one pos/ref/alt) and decided from the **final**
names of all cases renamed in the same pass, never case by case (case by case mixes loci: a GRCh38 `1`
and an hg19 `chr1` at the same position swap keys):
- Each row goes to every key the cases using its key will use afterwards (a copy when they differ); a
  key no case uses keeps its row; a group where no case changes name is left alone.
- Rows that land on one key are merged: `starred = max`, comments joined by paragraph in time order
  (a paragraph appears once), ACMG classification + evidence of the newest row that has one; a different
  classification that is dropped goes to `audit_log` (`acmg_classify`, reason `contig_merge of <keys>`).
- SQLite: in the migration / confirmation transaction, before the variants are renamed (all renamed
  cases together). PostgreSQL: in **each case's own rename transaction** (`postgres-contig-rename.ts`),
  with that case's group rows locked `FOR UPDATE`: notes and variants move together, so every read
  (notes join on the exact name) and the starred / ACMG / comment filters see the case before or after,
  and an edit made while the case waits moves with it. Other queued cases keep their names, except a
  queued case that would take one of this case's new keys while giving up its own at that locus (a swap
  or chain, repeated until stable): its variant and notes at that locus move in the same transaction.

## Order (per backend)

SQLite (`PRAGMA user_version` 47, `src/main/database/contig-naming-migration.ts` +
`contig-rename-sqlite.ts`, runs in the migration worker):
1. Discover: `SELECT c.id, c.genome_build, v.chr, MAX(v.pos) … GROUP BY c.id, v.chr`; a case already in
   its build's form is skipped (no file read, no row written); the others are planned.
2. Backup, at the **start of the run, before its first pending migration** (`backupBeforeMigrations`,
   called first in `runMigrations`), whenever v47 is pending and the database holds cases: check free
   space: `DATABASE_CONFIG.CONTIG_MIGRATION_FREE_SPACE_RATIO` (2.7 x the DB size: backup + peak WAL)
   when some case stores a name its build would rename (the plan's own first test,
   `contigRenamePairs`, over the distinct build/name pairs; a case that is later flagged counts too),
   else `BACKUP_ONLY_FREE_SPACE_RATIO` (1.1 x: the copy alone),
   `wal_checkpoint(TRUNCATE)` and require it complete (busy 0, every frame checkpointed), then
   byte-copy the DB file to `<db>.pre-v<N>.bak`, N = the first pending version (a v45 database gives
   `<db>.pre-v46.bak`, the v45 file before v46 and v47 ran). It is the file the previous release wrote
   and can open. A failing check stops with a user-facing message (`BUILD_COPY.migrationNoSpace` /
   `migrationBusy`, an `AppError` that DatabaseService passes through) before any migration runs;
   a filesystem that cannot report free space skips that check with a logged warning. The copy keeps
   SQLCipher encryption. No backup for a new or empty database, or when v47 is not pending.
3. One transaction: annotation remap, then per renamed case decrement frequencies → `UPDATE variants SET
   chr = to WHERE case_id = ? AND chr = from` (only rows under an old name are written) → recount;
   review rows for flagged cases; summary marked stale; user_version 47.

PostgreSQL (`0030_contig_naming.sql` + background job `src/main/storage/postgres/postgres-contig-naming.ts`):
1. Migration: create `contig_build_review` and `contig_naming_pending(case_id, confirmed, pairs)`, queue every published case (newer imports are canonical and never queued).
2. Job (scheduled from the cohort freshness probe and from `cases:buildReviews`; `FOR UPDATE SKIP
   LOCKED` everywhere, one short transaction per step, so a crash resumes at the step in flight):
   a. plan one case (re-check, async header read off the event loop; or take the confirmed build):
      store `pairs`, or flag it, or dequeue a case that needs nothing;
   b. once nothing is unplanned: rename one case per transaction, its notes (and a swap partner's at the
      same locus) with it, frequencies like a case delete/publish, and dequeue it.
   The step that empties the queue asks for **one** cohort-summary rebuild (`cohort_summary_rebuild_requests`
   `contig_naming`), not one per case.
3. Backup: operator's responsibility (release notes); the job is resumable and idempotent.

## Scale (measured by the independent review, 23-review-chr-migration.md)

- SQLite: 2 M rows / 741 MB encrypted DB takes 34–36 s in one transaction, about 200 MB RSS, peak WAL
  about 620 MB, so a 5 GB DB is about 4 min behind the migration splash. Rows already canonical are not
  written, so time and WAL scale with the rows actually renamed. Run `VACUUM` afterwards only if the file
  must shrink; it is not required.
- PostgreSQL: about 3 s and 210 MB WAL per 100k-variant case renamed (dev container, `wal_level=minimal`):
  10k renamed exomes is about 8 h serial and about 2 TB of WAL with production WAL settings, and the
  renamed rows' old versions are dead tuples: let autovacuum catch up or run `VACUUM (ANALYZE)
  variants_all` after the queue empties, and size `max_wal_size` / archiving for it. Databases whose
  cases are already canonical write nothing. Locks are per row; cohort counts mix renamed and unrenamed
  cases until the queue empties (the shell says so).

## Idempotency

A second run finds every case canonical (or already flagged, which is skipped) and does nothing:
SQLite by user_version and by the plan being empty; PG by the empty pending table. Confirming a case
twice fails cleanly (no review row).

## Import and query input (same PR)

- Import: SQLite `insertBatch` (all SQLite VCF/JSON/append paths) the PG VCF repository (PostgresVcfImportRepository) and the PG JSON worker batch store
  `canonicalContig(chr, caseBuild)`.
- Query input: coordinate search (3 sites), exact-variant filter, DSL `chr =` / OR → every spelling
  (`contigQueryNames`). Panel regions and panel BED export → `canonicalContig(…, build)`; the four
  "does this case use chr" probes and `getChrPrefix` are deleted.
- APIs/links: `bareContig` replaces the five strip-`chr` copies. Links: `{chr}` = bare, new `{chr_ucsc}`
  (UCSC style per build from config `links.ucscRcrsMito`: GRCh38 MT → chrM, GRCh37 MT → chrMT, hg19 chrM
  stays chrM); the UCSC built-in template uses `{chr_ucsc}` (a stored old default is upgraded); Franklin
  `chr{chr}` no longer yields `chrchr1`.

## Release notes (must say)

- Chromosome names are now stored in each build's reference form (GRCh38 `chr1`, GRCh37 `1`); existing
  data is converted on first open. Desktop: before updating, VarLens copies the database next to
  itself as `<name>.pre-v46.bak` (from the previous release; it needs free space of about 1.1x the
  database size, or 2.7x when chromosome names have to be rewritten), which the previous version can open if you need to go back. Web: converted in the
  background; back up PostgreSQL first, the change is one-way. Cases whose build cannot be confirmed are listed for
  the user to confirm.
- Custom external-link templates: `{chr}` is now always the bare name (`1`, `X`, `MT`); use `{chr_ucsc}`
  for `chr1`-style names. Only the built-in UCSC template is updated automatically.
- Global stars/comments/ACMG no longer bleed between a GRCh37 and a GRCh38 locus with the same numbers.

## Tests

- `contig.ts`: table test over every primary × importable build, every mito alias per build, unknown
  contigs, case/whitespace; `bareContig`; `contigQueryNames`.
- Planner: canonical → none; non-canonical + confirming header → rename; disagreeing/no evidence → flag.
- SQLite migration: mixed-build DB → expected rows, frequencies, summary stale, backup file; collision
  merge (star, comments, newer ACMG, audit row); cross-build copy vs move; run twice = no-op; unresolved
  case untouched + review row; rank unchanged.
- The review's two loss scenarios on both backends: GRCh37 `1` + `chrMT` keeps its shared note; a
  GRCh38 `1` / hg19 `chr1` swap keeps each note with its own locus.
- PG job (real Postgres): same scenarios, one rebuild request, a step killed mid-case rolls back and
  resumes, an import and an annotation edit during the job are kept.
- SQLite: free-space refusal and incomplete-checkpoint refusal change nothing; a v45 database gets
  `<db>.pre-v46.bak` (user_version 45, opens) and then reaches v47; no backup for a new database or
  when v47 is not pending.
- Resolve: one batched write confirms many cases, audit-logged, renames them, removes the reviews.
- Links, panel BED export (bare for GRCh37), panel intervals per build.

## Rollback

SQLite: close the app and replace the DB file with `<db>.pre-v<N>.bak` (for a v45 database
`<db>.pre-v46.bak`): it is the database exactly as the previous release left it, before any of this
release's migrations, so the previous app version opens it. PG: restore the operator's backup.
