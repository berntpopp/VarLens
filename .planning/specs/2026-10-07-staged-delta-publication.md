# Staged-delta cohort publication (2026-10-07)

Status: design for review. No product code exists for it. It answers section 0.3 of
`.planning/plans/2026-10-07-import-scale-experiments-and-routes.md` (revision 3) for the
publication half: state machine, read and index contract, derived-structure inventory, operating
budget, SQLite design. Id resolution for the per-sample table (0.3 item 4) is out of scope.

Inputs: the measurements in `.planning/artifacts/perf/import-scale/` (branch `normalised-model`:
`SUMMARY.md`, K1, K1b, K1b-opt/K1c, K1d), the code on `main` at `feac7ad0`, and the #469 branch
(`fix/cohort-representative-severity`, migration 0025). Table names below omit the
`"__schema__".` prefix; every table is per workspace schema.

Marking used throughout: **[M]** measured in those artefacts, **[D]** derived from them,
**[U]** not backed by any measurement. Section 11 collects every [U].

## 1. Scope, non-goals, and where the code differs from the brief

### 1.1 In scope

PostgreSQL cohort publication: counters split from the representative annotation, per-case
deltas staged by the importers, one folder per workspace that merges them and marks cases
ready in the same transaction; cohort reads on the new structures; case delete, overwrite,
transcript switch and annotation edits; migration from `cohort_variant_summary`,
`variant_frequency` and `cohort_gene_variant_summary`; a rollback switch; the SQLite counterpart
(section 9).

### 1.2 Out of scope

- The per-sample table `variants_all`, its indexes, and integer site ids on it. Filters stay
  case-local on per-sample rows (X1 verdict).
- Sub-cohorts (X3), id resolution for a normalised model (K2), partitioning.
- The frequency denominator question C10: the definition is kept exactly (section 5, I6).

### 1.3 Key of the counter table: surrogate, decided here

| | Six-part natural key as primary key | Surrogate `site_id` + unique `(coord_hash, variant_type, genome_build)` (chosen) |
|---|---|---|
| Fold statement | upsert probing a text composite key; never measured | upsert on a `bigint` key: the shape K1, K1b-opt and K1d measured |
| Staged delta row | about 60 B of key per row, 3.6 MB per case | 8 B per row |
| Resolution | none | one join per case from `variants_all.coord_hash` (already stored) to `cohort_site`; the importer needs that join anyway to compare its annotation with the stored one |
| Long alleles | index tuples above 2,704 B fail (today's summary primary key has this hazard) | uniqueness is on a 32-byte hash; only the keyset index keeps the hazard (section 11) |
| Cost | none extra | 33 B per site for `coord_hash`, about 0.4 GB for the unique index at 6 M sites [D] |

The id lives in the cohort structures only. `variants_all` is not touched: it is joined through
its existing `coord_hash` (sha256 of chr, pos, ref, alt). No new hash is computed anywhere.

### 1.4 Where the code contradicts the brief (the code is followed)

1. **#469 rule.** The branch takes *every* annotation column, both ranks, gnomAD, CADD and
   `end_pos` from one carrier row: the first in `impact_rank DESC, clinvar_rank DESC`, then
   eleven tie-break columns (`src/shared/sql/cohort-representative.ts`). It does not aggregate
   ClinVar, gnomAD or CADD across carriers. This design maintains that rule and uses only the
   module's three predicates (`representativeOrderBy`, `precedesRepresentative`,
   `sameRepresentative`); a rule that aggregates variant-level facts would change those
   predicates and item 3 of section 11, not the structures.
2. **Gene aggregates need a pair table.** `unique_variant_count` per gene counts a coordinate
   under every gene symbol any carrier row has, so `main` keeps a refcount per
   (gene, coordinate) in `cohort_gene_variant_summary`, about one row per site, rewritten for
   every carrier. The measured fold (0.43–0.49 s) derived unique variants from new sites only
   and does not include it. Section 2.4 replaces the refcount by an existence table.
3. **Two things are called column metadata.** Per-case (`cohort_column_meta`) is computed by
   the importer before the lock already. The cohort one is an in-memory cache keyed by
   `last_incremental_at | last_rebuilt_at | case count`, so it is recomputed (two scans of the
   summary) after every publication. The second is what section 6 fixes.
4. **Cohort search** is `ILIKE '%t%'` on gene, consequence and OMIM number, unindexed; there
   is no full-text search on the cohort. **Internal frequency** is a filter and a projection
   on the case view; it is not sortable.
5. **Locks today.** `hideCase` locks the case row and then the summary lock; annotation hooks
   take no lock (C2); a transcript switch waits briefly and otherwise requests a *full*
   rebuild; one import operation per workspace is already enforced by a session advisory lock
   on the coordinator's connection, verified by workers only at start (C1).
6. **Overwrite** is "delete the old case, then import". Appending files to an existing
   PostgreSQL case has no caller (`beginProvisionalImport` is never given an existing id), so
   the double-count quirk of `variant_frequency` noted in K1b-opt cannot occur on PostgreSQL.
7. **Export and extension filters** use a live aggregation on `main`; the #469 branch serves
   them from the summary. This design assumes #469 is merged first.

## 2. Structures (migration 0026)

`main` ends at 0024 and #469 takes 0025; this is **0026**. It is DDL only, additive, and
creates every table of this design in one step so that later PRs need no further migration.

### 2.1 Site: identity and representative annotation

```sql
CREATE TABLE cohort_site (
  site_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coord_hash   BYTEA  NOT NULL,          -- same value as variants_all.coord_hash
  variant_type TEXT   NOT NULL,
  genome_build TEXT   NOT NULL,
  chr TEXT NOT NULL, pos BIGINT NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
  -- representative row (#469): REPRESENTATIVE_COLUMNS, all from one carrier row
  end_pos BIGINT, gene_symbol TEXT, cdna TEXT, aa_change TEXT, consequence TEXT, func TEXT,
  clinvar TEXT, gnomad_af DOUBLE PRECISION, cadd DOUBLE PRECISION, transcript TEXT,
  omim_mim_number TEXT,
  impact_rank SMALLINT NOT NULL DEFAULT 0, clinvar_rank SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coord_hash, variant_type, genome_build)
) WITH (fillfactor = 95);
```

Written by importers (new sites, before the fold) and by the folder (a representative
changes: 0–13 of 60,000 sites per case [M, old rule]). **A site row is not visible data.**
Readers reach it only through a counter row (2.2), which is the existence gate; a site row
without a counter row is an orphan left by a failed import or a removed last carrier, and the
next carrier reuses its id and overwrites its annotation. Garbage collection: when idle, the
folder deletes, under the write lock, site rows older than a day that have no counter row
and no staged row.

| Index | Reader |
|---|---|
| primary key | join from the counter on every cohort page; fold updates |
| `UNIQUE (coord_hash, variant_type, genome_build)` | importer resolution; per-case internal frequency (prefix `coord_hash`); sibling lookup for the unique-variant counter and global annotation flags |
| `(gene_symbol COLLATE "C")` | gene filter, gene panel `IN` |
| `(consequence, gnomad_af)` | impact filter, alone or with a gnomAD bound (today `idx_cvs_covering_common` without the counter) |
| `(func)`, `(clinvar) WHERE clinvar IS NOT NULL` | `funcs IN`, `clinvars IN` (unindexed today) |
| `(chrRankSql(chr), chr COLLATE "C", pos, ref, alt)` | `sort_by=chr`, `chr:pos` search, panel intervals (today `idx_cvs_chr_rank`) |
| GIN `(gene_symbol, consequence, omim_mim_number) gin_trgm_ops` | cohort text search (a sequential scan today) [U] |

All of them are written once per site, by importers in parallel, never by a fold.

### 2.2 Counter: everything a fold changes

```sql
CREATE TABLE cohort_site_counter (
  site_id BIGINT PRIMARY KEY REFERENCES cohort_site(site_id),
  carrier_count    INTEGER NOT NULL,   -- distinct ready cases with a row at the six-part key
  het_count        INTEGER NOT NULL,
  hom_count        INTEGER NOT NULL,
  coord_case_count INTEGER NOT NULL,   -- share of the internal-frequency numerator (2.3)
  rep_holders      INTEGER NOT NULL,   -- carriers whose best row equals the representative
  star_refs        INTEGER NOT NULL DEFAULT 0,
  comment_refs     INTEGER NOT NULL DEFAULT 0,
  acmg_best_rank   SMALLINT NOT NULL DEFAULT 0,   -- ACMG_RANKS of severity.config.ts
  -- copies of the representative's filter values, so a scan in carrier order can filter
  -- without reading cohort_site; they change only when the representative changes
  impact_rank SMALLINT NOT NULL, clinvar_rank SMALLINT NOT NULL,
  gnomad_af DOUBLE PRECISION, cadd DOUBLE PRECISION,
  -- tie-break and scope columns of the keyset page and the frequency denominator
  chr TEXT NOT NULL, pos BIGINT NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
  variant_type TEXT NOT NULL, genome_build TEXT NOT NULL
) WITH (fillfactor = 90, autovacuum_vacuum_scale_factor = 0,
        autovacuum_vacuum_threshold = 200000, autovacuum_vacuum_cost_delay = 0,
        autovacuum_analyze_scale_factor = 0.05);

CREATE INDEX idx_csc_keyset ON cohort_site_counter (
  (-COALESCE(carrier_count, -1)), (chrRankSql(chr)), chr COLLATE "C", pos, ref, alt,
  variant_type, genome_build);          -- byte-identical to cohortKeysetTerms('', 'postgres')
CREATE INDEX idx_csc_flagged ON cohort_site_counter (site_id)
  WHERE star_refs > 0 OR comment_refs > 0 OR acmg_best_rank > 0;
```

Two full indexes, as measured; the partial one holds a few thousand rows. `idx_csc_keyset`
serves the default page and its seek, and `carrier_count_min` (emitted as
`(-COALESCE(carrier_count,-1)) <= -$n`). No update is heap-only while the carrier count is
indexed [M]; fillfactor 90 only keeps new versions near the old ones.

Flags are *source counts*, recomputed for a key, never incremented blindly:
`star_refs` = (1 if `variant_annotations` at (chr, pos, ref, alt) is starred) + the number of
starred `case_variant_annotations` rows on ready carrier rows at (chr, pos, ref, alt,
variant_type); `comment_refs` likewise; `acmg_best_rank` the highest rank among the same
sources. The reader's `has_star` is `star_refs > 0`. This is exactly the set today's
`flagRecomputeSql` evaluates (per-case sources are not restricted by genome build there
either).

### 2.3 One frequency counter instead of `variant_frequency`

Today (`PostgresVariantReadRepository.ts:166`, `PostgresJsonImportRepository.ts:458`):
`internal_af = vf.case_count / (SELECT COUNT(*) FROM cases)`, where `case_count` is the number
of ready cases with at least one row at the four-part coordinate (any variant type, any
build), +1 per publication and −1 per hide, and the denominator is every ready case of every
build.

The sum of `carrier_count` over the six-part rows of a coordinate equals that numerator
**iff no case has rows at the coordinate under two variant types** (a case has one build, so
builds never double count). It differs for a case that carries, say, `<DEL>` at one position
as `sv` and as `cnv`: today 1, the sum 2. Therefore the counter keeps `coord_case_count`: each
case contributes 1 to exactly one of its six-part rows per coordinate (the one with the
smallest `variant_type`, bytewise; `coord_first` in the staged delta), and

    numerator(coord_hash) = SUM(coord_case_count) over the sites with that coord_hash

is today's value in every case. `variant_frequency` is no longer written in staged mode.

### 2.4 Gene counters

`cohort_gene_summary` (0023) is kept as it is, with today's meaning: per gene symbol the
number of ready variant rows, of distinct coordinates, and of distinct ready cases. Its
companion changes from a refcount to an existence table:

```sql
CREATE TABLE cohort_gene_pair (
  gene_symbol TEXT COLLATE "C" NOT NULL,
  coord_hash  BYTEA NOT NULL,
  PRIMARY KEY (gene_symbol, coord_hash)
) WITH (fillfactor = 100);
```

A row exists iff some ready carrier row has that gene at that coordinate.
`unique_variant_count` of a gene moves by +1 when its pair is inserted and −1 when it is
deleted. An add inserts only the pairs that do not exist yet (a few hundred per case; the
importer finds them with an anti-join outside the lock). A removal deletes a pair without
probing other carriers in the two common cases: no counter row remains at the coordinate
(delete), or the gene is the representative gene of a sibling site that still has
`rep_holders > 0` (keep). Only the remainder is probed through `idx_variants_coord_hash_case`.
The primary key serves those three paths; nothing else reads the table (as today).

### 2.5 State, queue, staged deltas, pending work

```sql
ALTER TABLE cohort_summary_state
  ADD COLUMN publication_mode TEXT NOT NULL DEFAULT 'legacy'
    CHECK (publication_mode IN ('legacy', 'staged')),
  ADD COLUMN revision      BIGINT NOT NULL DEFAULT 0,  -- +1 per committed fold or rebuild
  ADD COLUMN rep_epoch     BIGINT NOT NULL DEFAULT 0,  -- +1 per fold that logs a recheck
  ADD COLUMN rebuild_epoch BIGINT NOT NULL DEFAULT 0,  -- rep_epoch of the last full rebuild
  ADD COLUMN site_count    BIGINT NOT NULL DEFAULT 0,  -- rows of cohort_site_counter
  ADD COLUMN last_fold_at  TIMESTAMPTZ;
-- unique_variant_count (0024) is reused: distinct coord_hash among counter rows.

CREATE TABLE import_lease_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  generation BIGINT NOT NULL DEFAULT 0, holder_pid INTEGER, acquired_at TIMESTAMPTZ);

ALTER TABLE cases_all DROP CONSTRAINT cases_import_status_check;
ALTER TABLE cases_all ADD CONSTRAINT cases_import_status_check
  CHECK (import_status IN ('ready', 'importing', 'prepared', 'deleting'));
-- the cases / variants views (0015) already show only 'ready'.

CREATE TABLE cohort_publication_queue (
  queue_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind  TEXT NOT NULL CHECK (kind IN ('add', 'remove')),
  case_id BIGINT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('preparing', 'queued', 'failed')),
  lease_generation BIGINT NOT NULL,
  rep_epoch BIGINT NOT NULL DEFAULT 0,   -- read before the importer compared anything
  enqueued_at TIMESTAMPTZ,               -- clock_timestamp() in the prepare transaction
  solo BOOLEAN NOT NULL DEFAULT false, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  UNIQUE (case_id, kind));
CREATE INDEX idx_cpq_claim ON cohort_publication_queue (enqueued_at, queue_id)
  WHERE state = 'queued';                -- the folder's claim

CREATE TABLE cohort_staged_site (        -- one row per site of a prepared case
  case_id BIGINT NOT NULL, site_id BIGINT NOT NULL,
  gt SMALLINT NOT NULL,                  -- 0 other, 1 het, 2 hom: today's MAX(gt_num) classes
  coord_first BOOLEAN NOT NULL,          -- 2.3
  rep_rel SMALLINT NOT NULL,             -- 0 lower than stored, 1 same, 2 precedes or site new
  is_new BOOLEAN NOT NULL                -- no counter row seen at prepare
) WITH (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 100000);
CREATE INDEX idx_css_case ON cohort_staged_site (case_id);        -- the folder's read
CREATE TABLE cohort_staged_rep (         -- only rows with rep_rel = 2
  case_id BIGINT NOT NULL, site_id BIGINT NOT NULL, /* REPRESENTATIVE_COLUMNS */
  PRIMARY KEY (case_id, site_id));
CREATE TABLE cohort_staged_gene (
  case_id BIGINT NOT NULL, gene_symbol TEXT COLLATE "C" NOT NULL, row_count INTEGER NOT NULL,
  PRIMARY KEY (case_id, gene_symbol));
CREATE TABLE cohort_staged_pair (        -- pairs missing from cohort_gene_pair at prepare
  case_id BIGINT NOT NULL, gene_symbol TEXT COLLATE "C" NOT NULL, coord_hash BYTEA NOT NULL,
  PRIMARY KEY (case_id, gene_symbol, coord_hash));

CREATE TABLE cohort_pending_op (         -- work left by interactive writers, see 3.4
  op_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('flags', 'variant_changed')),
  coord_hash BYTEA NOT NULL, variant_type TEXT, genome_build TEXT,
  payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE cohort_site_recheck (       -- sites changed other than by plain addition
  site_id BIGINT PRIMARY KEY, epoch BIGINT NOT NULL);
```

The staged tables are logged (a prepared case survives a crash) and have no foreign keys
(60,000 referential checks per case otherwise); rows of a case that is no longer in the queue
are garbage and are deleted by the folder after its commit.

### 2.6 Sizes at about 6 M sites

| Relation | Measured shape (K1d) | This DDL |
|---|---|---|
| counter heap | 0.31 GB [M] (id and three counts) | about 0.75 GB [D]: 120 B rows with the key and filter copies |
| counter indexes | 0.32 GB [M] | about 0.55 GB [D]: keyset entries carry the natural key |
| site heap | 0.65 GB [M] | about 0.85 GB [D] with `coord_hash` |
| site indexes | 0.95 GB [M] (key + 3) | about 2.0 GB [D]: key, unique, 5 filter/sort, trigram |
| gene summary | 3 MB [M] | unchanged |
| gene pairs | not modelled | about 0.8 GB [D]; write-once |
| second counter (`coord_freq`) | 0.40 GB [M] | dropped |
| staged, queue, ops, recheck | not reported | under 20 MB steady state [D]: at most 3 cases |

The wider counter row and keyset entry add about 100 B of WAL per touched row, about 5 MB per
case on top of the 28 MB measured for the fold [D]. Section 11 item 2.

## 3. Publication

### 3.1 Importer: prepare (no global lock)

After the last row batch of a file, on the worker's connection:

1. Take a preparation slot (section 4.4). Read `rep_epoch` from the state row.
2. Aggregate the case's own rows into a session temporary table and `ANALYZE` it: one row per
   `(coord_hash, variant_type)` with the best row by `representativeOrderBy`, the genotype
   class of `MAX(gt_num)` (today's dedup rule), and `coord_first`; plus rows per gene and the
   distinct (gene, coord_hash) pairs. This is today's `prepareAdd` (about 0.3 s [M]).
3. In its own autocommit statement, insert the sites that do not exist:
   `INSERT INTO cohort_site (...) SELECT ... WHERE NOT EXISTS (...) ORDER BY coord_hash,
   variant_type ON CONFLICT (coord_hash, variant_type, genome_build) DO NOTHING`. The
   anti-join keeps the identity sequence from burning 60,000 values per file; the order makes
   two importers that meet on new sites wait for each other in one direction only.
4. One transaction `T_prepare` (fenced, section 4.3; `synchronous_commit = off`, as the row
   batches use today): join the temporary table to `cohort_site` and left-join
   `cohort_site_counter`; insert `cohort_staged_site` with `rep_rel` from
   `sameRepresentative` / `precedesRepresentative` and `is_new`; insert `cohort_staged_rep`
   for `rep_rel = 2`; `cohort_staged_gene`; `cohort_staged_pair` by anti-join against
   `cohort_gene_pair`; write `variant_count`, `case_data_info`, the per-case column metadata;
   set the case `prepared`; set the queue row `queued` with `enqueued_at` and `rep_epoch`;
   `pg_notify('varlens_fold', schema)`.
5. Wait until the case is `ready` or its queue row is `failed` (poll every 100 ms), then post
   `complete` or the error. The contract "complete means visible" is unchanged.

A prepared case is hidden and immutable: every mutation entry point resolves its variant
through the `variants` view, which shows only `ready` cases. JSON imports take the same path:
their case is inserted as `importing` instead of being published inside the import
transaction.

### 3.2 Folder: one fold transaction

`T_fold`, READ COMMITTED, `synchronous_commit = on`, on the folder's connection:

1. `pg_try_advisory_xact_lock` on the summary write lock (`cohort-summary-lock.ts`). It
   excludes a rebuild and the cut-over; if it is taken, the round is skipped.
2. Claim, in arrival order, skipping rows somebody else holds:
   ```sql
   SELECT q.queue_id, q.kind, q.case_id, q.rep_epoch
     FROM cohort_publication_queue q JOIN cases_all c ON c.id = q.case_id
    WHERE q.state = 'queued' ORDER BY q.enqueued_at, q.queue_id
    LIMIT $k FOR UPDATE OF q, c SKIP LOCKED;
   ```
   A round is either the pending work plus all claimed adds (never more than the slot limit),
   or the pending work plus one remove.
3. Pending work (3.4): `WITH ops AS (DELETE FROM cohort_pending_op RETURNING *)`, applied in
   the same statement chain, so each row is applied exactly once.
4. Counters, one statement in the measured shape:
   ```sql
   WITH d AS (SELECT site_id, count(*) AS n, count(*) FILTER (WHERE gt = 1) AS het,
                     count(*) FILTER (WHERE gt = 2) AS hom,
                     count(*) FILTER (WHERE coord_first) AS coord_n,
                     count(*) FILTER (WHERE rep_rel = 1) AS holders, bool_or(is_new) AS is_new
                FROM cohort_staged_site WHERE case_id = ANY($cases) GROUP BY site_id),
        src AS (SELECT d.*, s.* FROM d JOIN cohort_site s USING (site_id) WHERE d.is_new
                UNION ALL SELECT d.*, NULL... FROM d WHERE NOT d.is_new)
   INSERT INTO cohort_site_counter AS k (...) SELECT ... FROM src ORDER BY site_id
   ON CONFLICT (site_id) DO UPDATE SET
     carrier_count = k.carrier_count + EXCLUDED.carrier_count, het_count = ..., hom_count = ...,
     coord_case_count = ..., rep_holders = k.rep_holders + EXCLUDED.rep_holders
   RETURNING site_id, (xmax = 0) AS inserted;
   ```
   Only sites flagged new are joined to `cohort_site` (rows the importers have just written);
   the other 54,000 touch the counter alone, which is what kept the cold fold as fast as the
   warm one [M]. A site whose counter row vanished since the prepare is in
   `cohort_site_recheck` with a newer epoch and is treated as new.
5. Representatives. For sites with a `cohort_staged_rep` row among the claimed cases, the
   winner is the first row by `representativeOrderBy` among the candidates and, if the
   counter row existed before this fold, the stored row. If the stored row wins,
   `rep_holders` grows by the candidates equal to it. Otherwise the winner is written to
   `cohort_site`, its four filter values to the counter, `rep_holders` becomes the number of
   claimed cases whose candidate equals it, and the site is logged in `cohort_site_recheck`.
   No carrier of another case is read.
6. Recheck fix-up. For each claimed case with `q.rep_epoch < state.rep_epoch`: the sites of
   its delta that are in `cohort_site_recheck` with a newer epoch get that case's row fetched
   from `variants_all` (case-local index) and are handled as candidates of step 5, and its
   pairs at those coordinates are re-derived. A case with `q.rep_epoch < rebuild_epoch` is
   prepared again by the folder under the lock (rare: a rebuild ran while it waited).
7. For inserted counter rows: flag sources (today's `annotationFlagCtes`, a join against the
   two small annotation tables), `site_count`, and `unique_variant_count` +1 per coordinate
   with no sibling counter row. Existing rows keep their flags: a case that was never
   visible has no per-case annotation.
8. Genes: `cohort_gene_pair` gets the claimed `cohort_staged_pair` rows
   `ON CONFLICT DO NOTHING RETURNING gene_symbol`; `cohort_gene_summary` gets the summed
   `cohort_staged_gene` rows, +1 affected case per (case, gene), and the returned fresh pairs.
9. `UPDATE cases_all SET import_status = 'ready' ...`, delete the claimed queue rows,
   `revision = revision + 1`, `last_fold_at`, `pg_notify('varlens_cohort', schema)`. COMMIT.

After the commit, in its own transaction: delete the staged rows of the folded cases, and
the recheck rows no queued or preparing case predates.

### 3.3 Removal (delete, and the first half of an overwrite)

The request inserts a `remove` queue row; the folder does the rest in one `T_fold`, so the
subtraction and the hiding stay in one transaction as in `hideCase` today:

1. claim the queue row and the case row; apply all pending work first (a switch of this case
   must be in the counters before they are subtracted);
2. compute the case's contribution from its current rows with the prepare template (today's
   `removeCaseFromSummary` does the same aggregate under the lock);
3. subtract counts, `coord_case_count` and `rep_holders` (rows that were holders);
4. counter rows at zero carriers are deleted, `site_count` and `unique_variant_count` follow;
   rows with carriers left and `rep_holders = 0` get the representative recomputed from the
   remaining ready carriers by coordinate probe (the #469 removal rule; rare); both kinds are
   logged in `cohort_site_recheck` and `rep_epoch` is incremented;
5. genes per 2.4, a deleted pair logging the sites of its coordinate for recheck; flag
   sources recomputed for the keys where this case has per-case
   annotations, excluding it; per-case column metadata deleted;
6. the case becomes `deleting` and is renamed; revision +1; COMMIT. Purge and finalisation
   are today's.

### 3.4 Interactive writers never wait for the folder

A star, comment or ACMG edit, and a transcript switch, commit their own row change together
with one `cohort_pending_op` row and `pg_notify`; they take no summary lock. The folder
applies the row in its next round (tens of milliseconds when idle, one fold when busy).

- `flags`: recompute the three flag values for the counter rows at the key from the
  annotation tables. Idempotent, so an edit that commits during a fold is simply applied once
  more in the next round. Closes C2.
- `variant_changed` (transcript switch on a ready case): the switch locks its case row
  (`FOR NO KEY UPDATE`) before reading and proceeds only if the case is still `ready`, so
  two switches in one case are serial and none can follow a removal; it records
  the signed gene deltas computed from that case's rows (row moved from gene A to B; whether
  the case lost A, gained B, lost the pair, gained the pair). The folder applies them, checks
  the old pair as in 2.4, recomputes the site's representative and holders from its carriers,
  and logs the site for recheck.

The handler then waits up to 1.5 s for its op row to disappear and otherwise answers with
`summaryPending: true`. A transcript switch during a batch no longer requests a full rebuild.

## 4. State machine

`cases_all.import_status` is the visible state; `cohort_publication_queue.state` refines it.
"Folding" is not a durable state: it is the row locks of `T_fold`.

| # | State → state | Actor | Written, in which transaction | Durable afterwards | Crash right after: what is left, who repairs |
|---|---|---|---|---|---|
| 1 | – → `importing` | importer | case row, fenced | hidden case | lease recovery deletes it (today's `recoverInterruptedImports`) |
| 2 | `importing` (rows) | importer | COPY batches, each fenced, async commit | rows above the watermark | as 1: batched delete of rows, then the case |
| 3 | `importing` → slot | importer | queue row `preparing` (4.4), autocommit | a slot | recovery deletes `preparing` rows of older lease generations |
| 4 | new sites | importer | `cohort_site` rows, autocommit | orphan site rows | nobody needs to: invisible, reused; the folder's janitor deletes old ones when idle |
| 5 | slot → `prepared` / `queued` | importer | `T_prepare` (3.1 step 4) | staged delta, hidden complete case | the folder publishes it; a restarted server starts the folder when the queue is not empty. If `T_prepare` did not commit: state 3 |
| 6 | `queued` → `ready` | folder | `T_fold` (3.2) | counters, case visible, revision | nothing to repair. Staged rows remain: deleted by the next folder round |
| 7 | fold fails | folder | ROLLBACK, then one small transaction: `attempts + 1`, `solo = true` | attempt count | rows are still `queued`; next round |
| 8 | `queued` → `failed` | folder | after a solo failure with a deterministic error: `state = 'failed'`, `last_error` | hidden case, error text | the waiting worker reports the file as failed and cleans up as in 1; without a worker, lease recovery does |
| 9 | `ready` → `deleting` | delete job → folder | queue row `remove`; `T_fold` (3.3) | case hidden and subtracted | today's `listPendingDeletions` resumes the purge. Before `T_fold`: the case is still ready and counted; the job re-requests |
| 10 | op pending → applied | user → folder | op row with the user's change; deleted in `T_fold` | the user's change | op row survives; next round |

### 4.1 Election, claims, wake-up

- **One folder per schema.** A dedicated connection (not from the pool) takes
  `pg_try_advisory_lock(hashtext(schema), hashtext('varlens-cohort-folder'))`, session level,
  and runs every `T_fold` and the `LISTEN` on that same connection. Lock and work share one
  fate: if the connection dies, PostgreSQL releases the lock and aborts the open fold
  together, so a folder that has lost its lock cannot write. The connection sets
  `tcp_keepalives_idle = 5`, `_interval = 2`, `_count = 3`, bounding a dead host to about
  11 s; a dead process frees the lock at once.
- **Correctness does not rest on the election.** Every fold also holds the summary write
  lock and row locks on what it claimed, and every effect of a fold is in one transaction.
  Two folders would be slow, not wrong.
- **Standby.** Any server process that enqueues work calls `ensureFolder(schema)`. A process
  that loses the election retries every 2 s while it sees queued work older than 1 s.
- **Claims are by state, never by position.** Sequence order is not commit order, so the
  folder keeps no high-water mark; a row that commits late is simply queued in the next round.
- **Wake-up.** `LISTEN varlens_fold` only shortens the wait. The truth is a poll: every
  200 ms while work exists or was seen in the last 5 s, every 2 s otherwise.
- **Poison.** A failed group fold sets `solo` on its rows; solo rows are folded one per
  transaction. SQLSTATE classes 40, 08, 53 and 57 are retried without limit (with backoff);
  anything else on a solo fold is deterministic and becomes row 8. A failing removal leaves
  the case ready and reports the error to the delete job.

### 4.2 Uncertain commit, restart, two workspaces

- **Folder COMMIT with unknown outcome**: the folder reconnects and reads the queue. Rows
  still queued were not folded; rows gone were. It keeps no memory to reconcile.
- **Importer `T_prepare` with unknown outcome**: the worker reconnects and reads its case:
  `prepared` or `ready` means committed; `importing` means not, and it repeats step 4 after
  deleting its own staged rows.
- **Server restart**: all sessions end, so all advisory locks and open transactions are gone.
  Queued cases are folded by the first folder; `deleting` cases resume; `importing` cases
  wait for the next import's recovery, as today.
- **Two workspaces**: every lock key, table and folder is per schema; the notify payload is
  the schema. A `hashtext` collision between two schema names costs mutual waiting only.

### 4.3 The import lease and correctness item C1

The coordinator (or a single-file worker) takes the workspace import lock as today and then,
before recovery, runs `UPDATE import_lease_state SET generation = generation + 1, ...
RETURNING generation`. Workers receive the generation and start **every** transaction with

    SELECT 1 FROM import_lease_state WHERE id = 1 AND generation = $g FOR SHARE;

and abort on zero rows. The owner's `UPDATE` conflicts with `FOR SHARE`, so it waits for
every fenced transaction that is in flight; any transaction that starts later sees the new
generation and aborts. After the bump commits, no worker of an older generation can commit
anything, and only then recovery reads the `importing` cases. A worker of a lost coordinator
therefore either committed `T_prepare` before the new owner existed (a complete case that the
folder publishes) or can never commit it (recovery deletes the case; it has no contribution
anywhere). The worker itself no longer publishes. A worker stuck idle in a transaction is
terminated by the new owner after a 30 s `lock_timeout` on the bump.

Mode changes (section 7) take the same workspace import lock, so the publication mode cannot
change during a batch.

### 4.4 Backpressure, cancel, delete, and what the user sees

- **Slots.** `VARLENS_IMPORT_MAX_UNPUBLISHED` (default 3) bounds the cases between "about to
  prepare" and "ready". A worker inserts its `preparing` queue row under a short transaction
  advisory lock only while fewer than that many `add` rows are `preparing` or `queued`, and
  polls otherwise. Row
  writing of further workers continues. This is the in-flight limit of K1d applied from the
  preparation step on; it is also the bound on a fold's group size.
- **Queue depth.** Adds are bounded by the slots. At most 16 `remove` rows; a further delete
  request answers "busy". Pending ops are small and unbounded; above 10,000 the handlers stop
  waiting and answer `summaryPending`.
- **UI.** A file in states 3–5 shows phase `publishing` in the batch progress
  (`inFlight[].phase`), after `inserting`. The case is not in the case list before it is
  ready. `cohort:summaryStatus` gains `pending: { adds, removes, ops, oldestAgeMs }`; above
  10 s the cohort view says that publication is delayed.

| State of the case | Cancel of the batch | Delete / overwrite | Transcript switch, annotation edit |
|---|---|---|---|
| `importing` | worker stops; rows and case removed (today) | refused: "still being imported" (today) | not addressable (hidden) |
| slot, `prepared`, `queued` | not retracted: the file is finished and will be published and reported as imported | refused with the same message; ready within seconds | not addressable (hidden) |
| being folded | – | – | – |
| `ready` | – | `remove` through the folder (3.3); an overwrite waits for it, then imports | op row (3.4); never waits for a fold |
| `deleting` | – | purge resumes (today) | not addressable |

### 4.5 Lock order

1. workspace import lock (session advisory; coordinator)
2. lease row (`FOR SHARE` workers, `UPDATE` new owner)
3. slot gate (transaction advisory, around one insert)
4. folder election (session advisory; folder connection only)
5. summary write lock (transaction advisory, try-lock; folder, rebuild, cut-over)
6. case rows, ascending id (the folder with `SKIP LOCKED`; a user transaction exactly one)
7. queue rows (folder, same statement as 6)
8. annotation and variant rows (user transactions)
9. pending-op rows (insert by users, delete by the folder)
10. site rows (importers insert new ones in key order; the folder updates existing ones)
11. counter rows ascending `site_id`, gene rows ascending symbol, pair rows, state row last
    (folder only)

Deadlock freedom: the folder waits for nothing a waiter on the folder can hold. It claims 6–7
with `SKIP LOCKED`; 5 is a try-lock; nobody else writes 9 (deletes), 10 (updates) or 11.
Importers hold 2 in share mode and wait only on another importer's insert of the same new
site, in key order, so those waits cannot form a cycle; `ON CONFLICT DO NOTHING` does not
wait on committed rows the folder updates. User transactions take 6 then 8, one case each,
and never touch 10–11. The new lease owner waits for workers; workers never wait for it.
`hideCase` changes accordingly: it only enqueues.

## 5. Exactness invariants

| # | Invariant | Mechanism | Test that proves it |
|---|---|---|---|
| I1 | A ready case is counted; a counted case is ready, or was hidden by the transaction that subtracted it | only `T_fold` adds to the counters, and it flips the status in the same transaction; removal subtracts and hides in one transaction; the folder is the only writer | crash at every barrier of section 10.2, then maintained structures equal a rebuild from the ready cases |
| I2 | Maintained equals rebuilt after any sequence of add, delete, overwrite, switch and annotation edit, once the queue is empty | deltas commute; non-commutative facts (representative, holders, pairs, flags) are re-derived for logged sites; `rebuildStaged` is the oracle, run REPEATABLE READ under the write lock | the schema-diff harness, seeded random sequences at 1 and 4 importers, zero differences; on both backends |
| I3 | The #469 rule on every path | add: replace iff a candidate strictly precedes; remove: recompute iff `rep_holders` reaches 0 with carriers left; switch: recompute the site; a prepare that raced with any of these is repaired through `cohort_site_recheck` | named cases: remove the only holder; remove one of two holders (no probe); prepare, then remove the holder, then fold; switch up and down; two annotation releases mixed |
| I4 | Flags after deleting a case that held a per-case star | flag values are source counts recomputed for the case's annotated keys, excluding it, in the removal fold | star per case, delete the case: `star_refs` 0; with a global star as well: 1 |
| I5 | Count, page and totals of one response come from one snapshot | one REPEATABLE READ, READ ONLY transaction reads the state row first; the response carries `revision`; cursors become `{v:2, s, r, k}` and a cursor with another `r` is answered with `revisionChanged: true` | a fold forced between the statements of one read; a cursor across a fold |
| I6 | Internal frequency unchanged: ready cases with a row at the coordinate, over all ready cases | `coord_case_count` (2.3); denominator `SELECT COUNT(*) FROM cases` untouched | every coordinate against `variant_frequency` on a schema with two builds and one case carrying a coordinate under two types |
| I7 | A staged delta is immutable and hidden | mutations resolve through the `variants` view | each mutation entry point against a prepared case is refused |
| I8 | Each staged delta and each op is folded exactly once | the queue row and the op row are deleted in the fold transaction | kill after COMMIT before the acknowledgement; uncertain commit |

Scope of I5: one response is exact at its revision. Pages fetched at different revisions are
not one snapshot; the client is told and reloads.

## 6. Read contract

Every cohort read starts from `cohort_site_counter k` (existence gate) and joins
`cohort_site s` on `site_id`. The builder chooses one of three shapes by rule, not by
planner estimate:

- **A, order first**: walk `idx_csc_keyset`, filter on counter columns, join `s` for the
  returned rows only.
- **B, filter first**: a selective predicate on `s` through its index, join `k` by primary
  key, sort, limit. Chosen when a probe
  `SELECT count(*) FROM (SELECT 1 FROM cohort_site s WHERE <s predicates> LIMIT 100001)`
  returns at most 100,000.
- **C, top-N scan**: the sort key has no index (as today). Scan the table that owns the sort
  key with its own filters, keep page size plus a margin, then join the other table for those
  rows; repeat with a larger margin if orphans leave the page short.

| Read today | Shape on the new structures | Index | Cost class |
|---|---|---|---|
| Default page, `carrier_count DESC`, keyset or offset | A; seek `(terms) > (cursor)` unchanged | `idx_csc_keyset` + site key | O(page); 1–2 ms p50, 2–83 ms p95 while folding [M] |
| `carrier_count_min`, build, variant type, het/hom/carrier column filters | A, predicates on `k` | `idx_csc_keyset` | O(page + skipped) |
| `gnomad_af_max`, `cadd_min`, impact, ClinVar with the default sort | A on the counter's copies; impact and ClinVar pre-filter by rank, the exact string is rechecked on the joined row | `idx_csc_keyset` | O(skipped) in the counter only. **Scan when matches are frequent overall but absent among high-carrier rows** [U]; section 11 item 6 |
| gene, gene panel, `chr:pos`, panel intervals, `funcs`, `clinvars`, impact with few matches | B | the site indexes of 2.1 | O(matches), at most 100,000 key probes |
| text search | B through the trigram index | GIN | O(matches) [U] |
| starred, has comment, ACMG | A restricted to `idx_csc_flagged` | partial index | O(flagged) |
| extension filters (`sv.*`, `cnv.*`, `str.*`), after #469 | `EXISTS` on the extension tables per candidate row, as on the #469 branch | `variants` coordinate index | unchanged |
| `max_internal_af` in the cohort, `cohort_frequency` filter or sort | `k.carrier_count / bt.total` with the per-build case counts, as today; sort is C on `k` | – | scan of the narrow counter |
| sort by `chr` | walk the site genomic index, probe `k` | site genomic index | O(page) |
| sort by gene, cdna, aa change, impact, func, ClinVar, gnomAD, CADD, transcript | C on `s` | none (none today) | one scan of `s`, as today; **a join when a counter filter is combined** [U] |
| sort by het, hom, carrier ascending | C on `k` | none | one scan of the counter, narrower than today |
| exact count | no filter: `site_count`; counter filters: parallel scan of `k`; site filters: shape B count; both: hash join | – | **delivered asynchronously**: the page answers with `total_count: null`, the count follows within 2 s, labelled with its revision and cached per (filter scope, revision) |
| cohort column metadata | distinct values from `s`, bounds from `k`; cached with the revision it was computed at; recomputed on request, at most every 30 s while the revision moves, once after the queue drains | – | **not per fold**; labelled advisory while an import runs |
| tiles and overview | case count, `SUM(variant_count)`, `unique_variant_count`, `COUNT(*)` of the gene summary | – | O(1) and O(genes), unchanged |
| gene burden | `cohort_gene_summary`, unchanged | – | unchanged |
| carriers of a variant | `variants` by coordinate, unchanged | `variants_coords` | unchanged (out of scope) |
| export | one statement copies the matching `k ⋈ s` rows into a session temporary table, then streams from it | as the page | the snapshot is held for the copy, not for the download (section 8) |
| case view: internal frequency projection and filter | `LEFT JOIN LATERAL (SELECT SUM(k.coord_case_count) FROM cohort_site s JOIN cohort_site_counter k USING (site_id) WHERE s.coord_hash = v.coord_hash)`; omitted from the count query when no frequency predicate is set (it is unconditional today) | site unique index, counter key | **two probes per row instead of one**: a page costs 100 probes; a full-case filter 120,000 [U] |

Writer-side readers of the old summary (`removalKeysCte`, `countAddedCoordinatesSql`,
`dropEmptySummaryRows`, the flag updates) are replaced by 3.2 and 3.3.

## 7. Migration and rollback

**Migration 0026** creates the structures of section 2 empty and leaves
`publication_mode = 'legacy'`. It takes catalogue locks only; no row of an existing table is
rewritten except the check constraint on the small `cases_all`.

**The switch.** `VARLENS_IMPORT_PUBLICATION=legacy|staged` states the wanted mode;
`cohort_summary_state.publication_mode` is the mode the workspace is in. They converge by a
job, never implicitly. Readers read the mode in their snapshot and pick the builder, so a
flip needs no restart. One release ships both paths.

**Dual maintenance is not viable.** The legacy write is the cost being removed (2.2 s per
case under the lock [M]); maintaining it in staged mode keeps the bottleneck. Both sets are
pure functions of `variants`, `cases` and the annotation tables, so the rollback is an exact
regeneration instead: the structures of the inactive mode are left in place, not maintained,
and rebuilt on the way back.

**Cut-over (legacy → staged)**, a background job per workspace:

1. take the workspace import lock (an import that is running wins; the job retries) and bump
   the lease generation;
2. one REPEATABLE READ transaction under the summary write lock: empty the new structures;
   fill `cohort_site` and `cohort_site_counter` from the ready cases with the shared rebuild
   template, **inserting in descending carrier order** so that the frequently updated sites
   sit together at the start of heap and primary key (the locality the measurements relied
   on); `cohort_gene_pair`; flag sources; `site_count`; `rebuild_epoch`; set
   `publication_mode = 'staged'`, `revision + 1`; COMMIT.

No table lock is taken: cohort readers keep using the legacy tables until the commit;
imports are refused for the duration (about 20 s per million variant rows [D] from the #469
rebuild figure: 2 minutes at 100 exomes, the largest existing workspace); deletes and
switches wait or defer as they do during a rebuild today.

**Cut-back (staged → legacy)**: take the import lock; let the folder drain the queue; under
the write lock run today's `rebuild()` plus a rebuild of `variant_frequency` (one grouped
insert, new, because nothing rebuilds that table today) and set the mode in the same
transaction. Cost: the legacy rebuild, 17 s per million variant rows [M].

The release after next drops `cohort_variant_summary`, `variant_frequency`,
`cohort_gene_variant_summary`, `cohort_summary_rebuild_requests` and the legacy code.

## 8. Operating budget

All settings below are **derived**; none was varied in a run.

| Quantity | 1 case/s | 2 cases/s | Source |
|---|---|---|---|
| WAL of the fold | 28 MB per case | same | [M] K1b-opt, narrow shape; about +5 MB for this DDL [D] |
| WAL of all cohort structures | 45 MB/s | 85–92 MB/s | [M] K1d |
| the same per hour | 162 GB | 306–331 GB | [D] |
| per-sample rows | 26–164 MB per case | same | [M] A1, by index set |
| cohort WAL for 10,000 cases | 0.45–0.6 TB | same | [D] |
| dead counter rows | 54,000/s | 108,000/s | [D] one per updated row |

- **`max_wal_size`.** At 8 GB (dev container) the cohort structures alone force a checkpoint
  every 90–180 s, and every checkpoint is followed by full-page images of the whole hot set
  (about 0.6–1.3 GB). Recommended for a bulk import: `max_wal_size = 64GB`,
  `checkpoint_timeout = 15min`, `wal_compression = lz4`. Archiving or replication must carry
  100–300 MB/s for the duration.
- **Commit durability.** `T_fold` commits synchronously, which also makes the earlier
  asynchronous commits of the importers durable; "ready" is never reported before that.
- **Vacuum.** No counter update is heap-only. With `autovacuum_naptime = 60s` and default
  cost limits the counter gains one dead row per live row per minute at 2 cases/s. Table
  settings in 2.2 (fixed threshold, no cost delay) plus `autovacuum_naptime = 10s`; in
  addition the folder issues `VACUUM cohort_site_counter` on a second connection after every
  200 folded cases if autovacuum has not run since. K1d ran 200 cases per run with autovacuum
  on; a steady state over thousands of cases is unmeasured (section 11 item 7).
- **Snapshot age.** A reader that holds a snapshot stops that cleanup. The folder samples
  `pg_stat_activity` every 30 s and reports the oldest `backend_xmin` holder when it is older
  than 60 s during an import; pool connections keep `idle_in_transaction_session_timeout`;
  the export copies and releases (section 6); the cut-over runs only without an import.
- **Memory.** Hot during an import: counter heap and both indexes (about 1.3 GB), the site
  unique index (0.4 GB) and most of the site heap, which the importers read for comparison
  (0.85 GB): about 2.5–3 GB at 6 M sites. Recommended `shared_buffers >= 4GB` there; the
  2 GB of the dev container relied on the operating system cache in K1d. At 60 M sites this
  design needs about ten times that and was not sized for it.
- **Connections.** One per folder and one for its vacuum, both direct: session advisory
  locks and `LISTEN` do not survive a transaction-pooling proxy (the import lease has the
  same requirement today).

## 9. SQLite counterpart

SQLite has one writer at a time, enforced by the file lock, and no row versions: an update
rewrites the row in place and only the indexes whose columns changed. The problem is
therefore different. Today a file's publication rewrites the wide summary row and four
indexes that contain `carrier_count`, and, to stay fast, the session drops the full-text
insert trigger and up to ten read indexes while cases become visible (C6), and may publish a
case with the summary marked stale.

### 9.1 What is the same

- The logical model and names: `cohort_site`, `cohort_site_counter` (with `rep_holders`,
  `coord_case_count`, flag source counts, the filter copies), `cohort_gene_pair`, and
  `revision` in `cohort_summary_meta`. One model keeps the equivalence harness and the rules
  of sections 2–3 common.
- Shared SQL in `src/shared/sql/`, dialect as a parameter as `cohort-keyset.ts` does it:
  `cohort-representative.ts` (existing), a new `cohort-case-delta.ts` (best row per site,
  genotype class, `coord_first`, gene rows, pairs) and `cohort-site-rebuild.ts` (the oracle).
  `cohort-summary-rebuild.ts`, SQLite-only despite its location, is retired with the old
  table.

### 9.2 What differs

| | PostgreSQL | SQLite |
|---|---|---|
| Who folds | one folder, asynchronous | the import worker, inline, in the transaction that ends the file |
| Staging | logged tables, queue, slots | session `TEMP` tables (`temp_store = MEMORY`); no queue, no `prepared` state |
| Site key | `coord_hash` | `UNIQUE (chr, pos, ref, alt, variant_type, genome_build)`: no digest function, and no index tuple limit |
| Id lists | `= ANY($1)` | joins to temp tables; no array type is used anywhere |
| Interactive edits | pending ops | inline in the write worker's transaction, as today; the six flag triggers of v14 are retargeted to the counter |
| Recheck, epochs, lease fence | needed | not needed: nothing is prepared outside the writing transaction |
| Frequency key | `coord_hash` prefix | index `(chr, pos, ref, alt)` on `cohort_site` |

One `BEGIN IMMEDIATE` per file, after its last row batch: case delta into temp tables; new
sites; counters; representative candidates; genes and pairs; flags for new counter rows;
**the case's rows into the full-text index** (`INSERT INTO variants_fts(rowid, ...) SELECT
... WHERE case_id = ?`); `import_status = 'ready'`; `revision + 1`. The only carrier-bearing
index left is the keyset index, on the narrow table.

### 9.3 Read structures during an import session (C6)

A case is ready only when every read structure covers it:

- Only the insert trigger `variants_fts_ai` is dropped during row batches; the delete and
  update triggers stay, because the write worker edits rows during a session. The file's
  rows enter the index in the publishing transaction. The full rebuild of the index at
  session end is removed (it is linear in the whole database); an incremental `merge` per
  file and one `optimize` at the end replace it.
- Read indexes on `variants` are never dropped once a ready case exists. `DROP_INDEXES` is
  allowed only for the first file into a database without ready cases, and the indexes are
  restored before that file is published.
- `rebuildIsCheaper` ("publish stale, rebuild at the end") and the `import_session_open`
  marker are removed: no visible case is ever uncounted, and a transcript switch during a
  session is applied exactly instead of marking the summary stale.
- Pool workers key their column-metadata cache by `revision`, read inside the read
  transaction (C7).

### 9.4 Visibility bound, durability, encryption, migration

- **Bound.** A file is visible when its publishing transaction commits. Gate: at most 2 s
  after its last row batch at 1,000 cases [U]. Folding every K files was considered and
  dropped: with one sequential writer it only adds delay.
- **Checkpoints.** `wal_autocheckpoint = 0` and a `PASSIVE` checkpoint per file stay. Readers
  are now active throughout, so when the WAL exceeds 256 MB after a passive attempt the
  worker runs `wal_checkpoint(RESTART)` within its busy timeout.
- **SQLCipher.** Cost is per page written and per cache miss. The narrow counter cuts dirty
  pages per file; the gate is measured on an encrypted database, which is the worse case.
- **Numeric gate.** Batch seconds per file, encrypted, at 100 and 1,000 cases: not above
  today's figure with indexes kept, and search and every read index current at each `ready`.
- **Migration.** Schema version 42 (41 is #469): create the tables empty; the existing
  startup rebuild (`needsStartupRebuild`, rebuild worker) fills them, with the cohort view in
  its "rebuilding" state as after any upgrade that empties the summary. There is no runtime
  switch on SQLite: a database file is upgraded forward only. SQLite therefore ships one
  release after PostgreSQL has run with `staged` as the default.

## 10. Implementation plan

### 10.1 Pull requests, in order

Each leaves the product correct; `legacy` stays the default until PR 6. Tests are written
first in every PR.

| PR | Content | Tests first | Gate |
|---|---|---|---|
| 1 | Migration 0026; lease generation and the fence in every worker transaction (C1) | fence unit tests; schedule S1; migration idempotence | import seconds per sample unchanged within spread (one row lock per transaction) |
| 2 | `revision` written by the legacy publication, hide and rebuild; cohort reads in one snapshot; cursor v2 (C5) | I5 schedules S6 on the legacy path; preload contract | cohort page p95 within 10% or 10 ms |
| 3 | `src/shared/sql/cohort-case-delta.ts`, `rebuildStaged`, a shadow build that fills the new structures without reading them | harness projection "new structures → legacy shape" equals `cohort_variant_summary`, `variant_frequency` and the gene tables on GIAB and a 100-sample import; I6 | build at most 1.5× the legacy rebuild; sizes against 2.6 |
| 4 | Read builders for the staged structures (shapes A, B, C, asynchronous count, metadata cache, export), selectable in tests only | every row of section 6 on both builders with equal results; cohort parity suite | read matrix on the 10,000-sample read-scale schema: page ≤ 300 ms, count ≤ 2 s, the anti-correlated case reported |
| 5 | Prepare, queue, folder, removal, pending ops, cut-over and cut-back; `VARLENS_IMPORT_PUBLICATION=staged` opt-in | I1–I4, I7, I8; schedules S2–S5, S7–S9; harness at 1 and 4 importers | **the clean pair** and the sustained-arrival run (10.3) |
| 6 | `staged` becomes the default; operating settings documented; monitoring of queue age and snapshot age | upgrade and cut-back end to end on a 100-sample schema | hosted green build; second adversarial review |
| 7 | SQLite (section 9), schema 42 | harness on SQLite including SQLCipher; C6 and C7 tests | the numeric gate of 9.4 |
| 8 | Next release: drop legacy tables and code | – | – |

Deliberately left out: integer site ids on `variants_all`; folding staged deltas as one
array row per case (section 11 item 9); a composite counter index for anti-correlated
filters; retracting a finished file on cancel; sub-cohort counters.

### 10.2 Forcing the schedules

The folder, the importer's publication step and the delete job take a `barriers` object (a
test seam, absent in production): `await barriers.at('<name>')` at each numbered step.
Across connections a barrier is an advisory lock the test holds; a crash is
`pg_terminate_backend` of that connection at the barrier; an uncertain commit is a client
wrapper that lets COMMIT reach the server and then destroys the socket. Each schedule ends
with "maintained equals rebuilt".

| | Schedule |
|---|---|
| S1 | coordinator connection killed; new owner bumps the generation while a worker is between row batches, and while it is inside `T_prepare` |
| S2 | crash after each of: slot insert, site insert, `T_prepare`, the claim, the counter statement, `T_fold` COMMIT, staged cleanup |
| S3 | folder connection killed mid-fold with a standby present; two folders forced to run |
| S4 | a poison case in a group of three: the other two become ready, the poison is reported once |
| S5 | prepare of case X, then removal of the only holder of a shared site, then fold of X |
| S6 | a fold between the statements of one cohort read; a cursor used across a fold |
| S7 | star, comment, ACMG and a transcript switch committing while a fold holds the lock, and immediately before a removal of the same case |
| S8 | uncertain COMMIT of `T_prepare` and of `T_fold` |
| S9 | cancel in each state of 4.4; delete requested for a prepared case |

### 10.3 The measurements that gate PR 5

Protocol of plan section 3 (alternating pairs, one benchmark at a time, WAL as the primary
figure). None of this has been run for this design.

1. **The clean before/after pair**: one real 100-sample import, through the real worker, on
   one schema per arm, `legacy, staged, legacy, staged`: serial work per case (legacy: lock
   hold; staged: fold time per case) target ≤ 0.6 s against 2.2 s; end-to-end seconds per
   sample at 4 workers; WAL per case by relation; importer prepare time.
2. **Sustained arrival** at 1, 1.5 and 2 cases/s on the 6 M-site schema with real importers:
   "file finished → visible" p95 ≤ 2 s, three runs each; cohort page p95 ≤ 100 ms alongside.
3. **A 1,000-case soak** with a reader holding a snapshot for 60 s every 5 minutes: fold time
   and dead-row ratio must not drift.
4. **Removal**: fold time of one removal and of an overwrite batch of 20.

## 11. Open questions and risks: what is not backed by a measurement

1. **No real-data fold exists.** Every fold figure is synthetic (6,000 private sites per
   sample, ten times the realistic rate; one transcript; empty annotation columns), on a
   driver, not through the worker.
2. **The counter row here is wider than the measured one** (natural key, filter copies,
   flags, holders): about 120 B against 50 B, and a keyset entry of about 50 B against 28 B.
   Expected +15–25% fold WAL and an unknown effect on fold time. The alternative, a compact
   order key, would change the tie order of the default page on both backends.
3. **Representative maintenance by holder count and recheck log is new.** Its inputs (3–13
   changed sites per case) were measured under the *old* per-column rule. If the final #469
   rule aggregates variant-level facts across carriers, `rep_holders` would have to be kept
   per fact.
4. **Gene pairs are outside every measured fold.** The importer's anti-join of about 54,000
   pair probes and comparison read of about 54,000 site rows are unmeasured; only the insert
   of new sites was (120–159 ms).
5. **Removal runs a per-case aggregate under the lock**, as today's removal does (about
   0.3 s for the aggregate; 2.8 s for the whole step on the #469 branch), and was never run
   in this shape; an overwrite batch alternates removals and adds and will not hold 2 s
   visibility if a removal fold exceeds about 1 s.
6. **Anti-correlated filters.** A frequent filter with no matches among high-carrier sites
   scans every multi-carrier counter row (up to a few million, 2–3 s estimated). Named
   fallback: one composite counter index led by `impact_rank`, at one more index write per
   touched row. Not adopted without the read-scale measurement.
7. **Vacuum in steady state**: the runs were 200 cases each. The settings of section 8 are
   derived.
8. **Importer and fold contention.** K1d's producers generated rows synthetically; four real
   importers writing 26–164 MB of WAL per case next to the fold may move the 2 cases/s
   ceiling in either direction. The slot limit of 3 is taken from that run.
9. **Staged rows against one array row per case**: rows are the measured shape; an array row
   would cut staging WAL and vacuum work severalfold and is the first optimisation to try.
10. **Case-view internal frequency costs two probes per row** and may miss "≤ 2× today" for
    a full-case filter. The clean fix is a site id on the per-sample row, which is out of
    scope.
11. **Sorts without an index combined with a counter filter become a hash join** of two
    6 M-row tables; today it is one scan. Unmeasured.
12. **Long alleles.** Index tuples above 2,704 B fail in `idx_csc_keyset`, as they do in
    today's summary primary key and keyset index. A case with such an allele becomes a poison
    case (reported, not silently stale as today). Bounding the tie-break (`substr(ref, 1,
    255)` plus the site hash) changes `cohortKeysetTerms` on both backends and is a separate
    decision.
13. **Cursor policy during an import**: the revision moves about once a second, so a cohort
    view that reloads on every `revisionChanged` never settles. The renderer policy
    (debounce, or keep paging and show a notice) is not designed here.
14. **Scale assumptions**: 3–9 M sites at 10,000 exomes is derived from two published totals
    with an assumed exponent. The design is sized for about 6 M; at 60 M the K1c runs failed
    above 1 case/s and the memory figures grow tenfold. Cut-over time is extrapolated from
    1.26 M variant rows.
15. **Folder in the server process**: takeover takes 2–11 s, during which the 2 s target is
    missed; the trigram index, the asynchronous count path and the metadata throttle are
    unmeasured.
16. **SQLite**: nothing in section 9 is measured. The assumption that one carrier-bearing
    index on a narrow table makes per-file exact publication affordable with all read
    indexes kept is the gate of PR 7, not a finding.
