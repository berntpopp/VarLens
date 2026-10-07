# Staged-delta cohort publication (2026-10-07)

Status: design for review, revision 2 (the #469 rule with two kinds of columns; slimmer counter
row; bounded pages for anti-correlated filters; cursor policy; long alleles). No product code
exists for it. It answers section 0.3 of
`.planning/plans/2026-10-07-import-scale-experiments-and-routes.md` (revision 3) for the
publication half. Id resolution for the per-sample table (0.3 item 4) is out of scope.

Inputs: the measurements in `.planning/artifacts/perf/import-scale/` (branch `normalised-model`:
`SUMMARY.md`, K1, K1b, K1b-opt/K1c, K1d), the code on `main` at `feac7ad0`, and the #469 branch
`fix/cohort-representative-severity` (rule as of `09d19700`; migration 0025). Table names omit the
`"__schema__".` prefix; every table is per workspace schema.

Marking: **[M]** measured in those artefacts, **[D]** derived from them, **[U]** not backed by
any measurement. Section 11 collects every [U].

## 1. Scope, the rule, and where the code differs from the brief

### 1.1 Scope

In: PostgreSQL cohort publication (counters split from the annotation, per-case deltas staged
by the importers, one folder per workspace that merges them and marks cases ready in the same
transaction); cohort reads on the new structures; delete, overwrite, transcript switch and
annotation edits; migration from `cohort_variant_summary`, `variant_frequency` and
`cohort_gene_variant_summary`; a rollback switch; the SQLite counterpart (section 9).

Out: the per-sample table `variants_all`, its indexes and integer site ids on it (filters stay
case-local, X1 verdict); sub-cohorts (X3); id resolution (K2); partitioning; the frequency
denominator question C10 (the definition is kept exactly, I6).

### 1.2 The rule this design maintains (#469, `src/shared/sql/cohort-representative.ts`)

For one site (chr, pos, ref, alt, variant_type, genome_build):

- **Transcript-level columns** (`func`, `gene_symbol`, `transcript`, `cdna`, `aa_change`,
  `consequence`, `omim_mim_number`, with `impact_rank`) come together from ONE carrier row,
  the first by `transcriptOrderBy` (impact rank, then those columns, bytewise).
- **Variant-level facts** are aggregated over ALL carrier rows, each on its own: `clinvar`
  with `clinvar_rank` (highest rank, ties by the string), `gnomad_af` (lowest), `cadd`
  (highest), `end_pos` (highest).

That makes five independently maintained **kinds** per site: the transcript row and four
facts. The design uses only the module's predicates (`precedesTranscript`, `sameTranscript`,
`SUMMARY_FACTS[].raises`), so a change of the configuration changes no structure.

### 1.3 Key of the counter table: surrogate

| | Six-part natural primary key | Surrogate `site_id` + unique `(coord_hash, variant_type, genome_build)` (chosen) |
|---|---|---|
| Fold statement | upsert probing a text composite key; never measured | upsert on a `bigint` key: the shape K1, K1b-opt and K1d measured |
| Staged delta row | about 60 B of key per row, 3.6 MB per case | 8 B per row |
| Resolution | none | one join per case from `variants_all.coord_hash` (already stored) to `cohort_site`; the importer needs that join anyway to compare annotations |
| Long alleles | index tuples above 2,704 B fail (today's summary primary key) | uniqueness is on a 32-byte hash |
| Cost | none extra | 33 B per site and about 0.4 GB for the unique index at 6 M sites [D] |

The id lives in the cohort structures only; `variants_all` is joined through its existing
`coord_hash` (sha256 of chr, pos, ref, alt). No new hash is computed.

### 1.4 Where the code contradicts the brief (the code is followed)

1. **Gene aggregates need a pair table.** `unique_variant_count` per gene counts a coordinate
   under every gene symbol any carrier row has, so `main` keeps a refcount per
   (gene, coordinate), rewritten for every carrier. The measured fold derived unique variants
   from new sites only and does not include it (2.5).
2. **Two things are called column metadata.** The per-case one is computed by the importer
   before the lock already. The cohort one is an in-memory cache that is recomputed (two
   scans of the summary) after every publication; section 6 fixes that one.
3. **Cohort search** is an unindexed `ILIKE` on gene, consequence and OMIM number.
   **Internal frequency** is a filter and a projection on the case view, not a sort.
4. **Locks today.** `hideCase` locks the case row, then the summary lock; annotation hooks
   take no lock (C2); a transcript switch waits briefly and otherwise requests a *full*
   rebuild; workers verify the import lease only at start (C1).
5. **Overwrite** is "delete the old case, then import"; appending to an existing PostgreSQL
   case has no caller. **Export and extension filters** are live aggregations on `main` and
   served from the summary on the #469 branch, which this design assumes merged first.

## 2. Structures (migration 0026)

`main` ends at 0024 and #469 takes 0025; this is **0026**: DDL only, additive, every table of
this design in one step so that later PRs need no further migration.

### 2.1 Site: identity and annotation

```sql
CREATE TABLE cohort_site (
  site_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coord_hash   BYTEA  NOT NULL,          -- same value as variants_all.coord_hash
  variant_type TEXT   NOT NULL,
  genome_build TEXT   NOT NULL,
  chr TEXT NOT NULL, pos BIGINT NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
  -- transcript-level: one carrier row
  func TEXT, gene_symbol TEXT, transcript TEXT, cdna TEXT, aa_change TEXT, consequence TEXT,
  omim_mim_number TEXT, impact_rank SMALLINT NOT NULL DEFAULT 0,
  -- variant-level: aggregated over all carriers
  clinvar TEXT, clinvar_rank SMALLINT NOT NULL DEFAULT 0,
  gnomad_af DOUBLE PRECISION, cadd DOUBLE PRECISION, end_pos BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coord_hash, variant_type, genome_build)
) WITH (fillfactor = 95);
```

**A site row is not visible data.** Readers reach it only through a counter row (2.2), the
existence gate. A site row without a counter row is an orphan (failed import, removed last
carrier); the next carrier reuses its id and overwrites its annotation; when idle the folder
deletes, under the write lock, orphans older than a day that no staged row references.

| Index (all written once per site, by importers, never by a fold) | Reader |
|---|---|
| primary key | join from the counter on every cohort page; fold updates |
| `UNIQUE (coord_hash, variant_type, genome_build)` | importer resolution; case-view internal frequency (prefix); sibling lookups |
| `(gene_symbol COLLATE "C")` | gene filter, gene panel |
| `(consequence, gnomad_af)` | impact filter, alone or with a gnomAD bound |
| `(func)`, `(clinvar_rank) WHERE clinvar_rank > 0` | `funcs`, ClinVar filter and sort (unindexed today) |
| `(chrRankSql(chr), chr COLLATE "C", pos, substr(ref,1,64), substr(alt,1,64))` | `sort_by=chr`, `chr:pos` search, panel intervals |
| GIN `(gene_symbol, consequence, omim_mim_number) gin_trgm_ops` | cohort text search (a scan today) [U] |

### 2.2 Counter: what every fold rewrites

```sql
CREATE TABLE cohort_site_counter (
  site_id BIGINT PRIMARY KEY REFERENCES cohort_site(site_id),
  pos BIGINT NOT NULL,
  gnomad_af DOUBLE PRECISION,          -- copy, see below
  carrier_count    INTEGER NOT NULL,   -- distinct ready cases with a row at the site
  het_count        INTEGER NOT NULL,
  hom_count        INTEGER NOT NULL,
  coord_case_count INTEGER NOT NULL,   -- share of the internal-frequency numerator (2.4)
  impact_rank SMALLINT NOT NULL, clinvar_rank SMALLINT NOT NULL,   -- copies
  chr TEXT NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
  variant_type TEXT NOT NULL, genome_build TEXT NOT NULL
) WITH (fillfactor = 90, autovacuum_vacuum_scale_factor = 0,
        autovacuum_vacuum_threshold = 200000, autovacuum_vacuum_cost_delay = 0,
        autovacuum_analyze_scale_factor = 0.05);

-- K = the keyset terms of 6.3: (-COALESCE(carrier_count,-1)), chrRankSql(chr),
--     chr COLLATE "C", pos, substr(ref,1,64), substr(alt,1,64), variant_type, genome_build
CREATE INDEX idx_csc_keyset      ON cohort_site_counter (K);
CREATE INDEX idx_csc_keyset_high ON cohort_site_counter (K) WHERE impact_rank = 4;
CREATE INDEX idx_csc_keyset_plp  ON cohort_site_counter (K) WHERE clinvar_rank >= 13;
```

**What is on this row and why.** A cohort page never needs an index-only scan here: it walks
the keyset index, filters on this row, and joins `cohort_site` for the 50 rows it returns.
So only three things belong on the counter:

- what a fold changes (the four counts);
- what the keyset index and the read scope need in the same table (the natural key: tie-break
  terms, `genome_build` for the frequency denominator, `variant_type`);
- what a scan in carrier order must test without a second table: `impact_rank`,
  `clinvar_rank` (4 B, and the predicates of the two partial indexes) and `gnomad_af` (8 B;
  "rare, sorted by carriers" is the central cohort query).

Moved off it against revision 1: flags (2.3), holder counts (2.3), the CADD copy (a CADD
bound is tested on the joined site row). The three copies change only when the site's
annotation changes, in the fold that changes it.

**The measured fold is not this row.** 0.43–0.49 s and 28 MB WAL per single-case fold were
measured on a row of about 50 B (id and three counts) with a keyset entry of `(int, bigint)`.
This row is about 90 B and its keyset entry about 48 B. Estimate [D]: +64 B of WAL per touched
row, 28 → about 32 MB per case; fold time 0.5–0.6 s [U]. The two partial indexes add an entry
only for touched rows inside them (about 1% of sites [U]). **Gate K1e, before PR 3** (10.3):
repeat K1b-opt (a)+(b) and the K1d arrival runs with exactly this DDL. If it fails, the next
step is to drop the natural key from the counter and tie-break by `(chrRankSql(chr), pos,
site_id)`, which changes the tie order of the default page on both backends.

No update is heap-only while the carrier count is indexed [M]; fillfactor 90 only keeps new
versions near the old ones.

### 2.3 Sparse companions: holders and flags

```sql
CREATE TABLE cohort_site_holders (       -- exists only where carriers disagree
  site_id BIGINT PRIMARY KEY,
  tx_holders INTEGER NOT NULL, clinvar_holders INTEGER NOT NULL,
  gnomad_holders INTEGER NOT NULL, cadd_holders INTEGER NOT NULL, end_holders INTEGER NOT NULL
) WITH (fillfactor = 70);                -- counts are not indexed: heap-only updates
CREATE TABLE cohort_site_flags (         -- exists only where a flag is set
  site_id BIGINT PRIMARY KEY, star_refs INTEGER NOT NULL, comment_refs INTEGER NOT NULL,
  acmg_best_rank SMALLINT NOT NULL);
```

**Holders: a count per kind, not a recheck.** A carrier (a case; its contribution is the
transcript row and the four facts aggregated over its own rows at the site) *agrees* with the
stored annotation on a kind when `sameTranscript` holds, respectively when its fact is not
distinct from the stored one. `x_holders` is the number of agreeing carriers of that kind.
**No row means every carrier agrees on every kind**, which is the state of every site in a
cohort annotated by one release. The stored value of a kind is always some carrier's, so a
holder count is at least 1 while carriers exist.

| | Holder count per kind (chosen) | Recheck by probing carriers on removal |
|---|---|---|
| Removal of a case | subtract where it agreed; recompute a kind only when its count reaches 0 with carriers left | one probe of other carriers per site the case holds: 54,000 probes, 2.8 s per removal [M, #469 branch] |
| Cost per added case, one release | nothing: the table is empty; the fold's join against it is a no-op | nothing |
| Cost per added case, mixed releases | one heap-only update per touched site with a row: up to 54,000, estimated 0.1–0.2 s and 4–8 MB WAL [U] (upper bound: the second narrow counter, 0.2 s and 15 MB [M]) | nothing on add |
| Size | 0 for one release; at worst one 56 B row per site, 0.5 GB with its key at 6 M [D] | 0 |

**How often a known site changes.** Under the old per-column rule 3–13 of 60,000 known sites
changed per simulated case, all of them simulator duplicates with different CADD, and 0 on
the GIAB trio [M]. Under this rule: the transcript row changes only when a carrier was
annotated with another transcript (another release, or a user's transcript switch); a fact
changes only across annotation releases, or where one carrier lacks the annotation (NULL
against a value, for example a JSON import without CADD). Expected for one release: 0 changes
and 0 holder rows. For a second release: each site where the releases differ gets one row,
when its first dissenting carrier arrives, and one stored-value change per kind at most.

**Flags** are source counts, recomputed for a site, never incremented blindly: `star_refs` =
(1 if `variant_annotations` at the coordinate is starred) + the starred
`case_variant_annotations` rows on ready carrier rows at (chr, pos, ref, alt, variant_type);
`comment_refs` likewise; `acmg_best_rank` the highest rank among the same sources. This is
the set today's `flagRecomputeSql` evaluates. A few thousand rows at most.

### 2.4 One frequency counter instead of `variant_frequency`

Today (`PostgresVariantReadRepository.ts:166`, `PostgresJsonImportRepository.ts:458`):
`internal_af = vf.case_count / (SELECT COUNT(*) FROM cases)`; `case_count` is the number of
ready cases with at least one row at the four-part coordinate (any type, any build), +1 per
publication and −1 per hide; the denominator is every ready case of every build.

The sum of `carrier_count` over the six-part rows of a coordinate equals that numerator **iff
no case has rows at the coordinate under two variant types** (a case has one build). It
differs for a case carrying, say, `<DEL>` at one position as `sv` and as `cnv`: today 1, the
sum 2. So each case contributes 1 to exactly one of its rows per coordinate (smallest
`variant_type`, bytewise: `coord_first` in the staged delta), and

    numerator(coord_hash) = SUM(coord_case_count) over the sites with that coord_hash

is today's value in every case. `variant_frequency` is not written in staged mode.

### 2.5 Gene counters

`cohort_gene_summary` (0023) is kept with today's meaning. Its companion changes from a
refcount to an existence table:

```sql
CREATE TABLE cohort_gene_pair (
  gene_symbol TEXT COLLATE "C" NOT NULL, coord_hash BYTEA NOT NULL,
  PRIMARY KEY (gene_symbol, coord_hash));
```

A row exists iff some ready carrier row has that gene at that coordinate;
`unique_variant_count` moves by ±1 with it. An add inserts only missing pairs (a few hundred
per case; the importer finds them by anti-join outside the lock). A removal deletes a pair
without probing in the two common cases: no counter row remains at the coordinate (delete),
or the gene is the stored gene of a sibling site that still has carriers (keep: a holder of
the transcript row exists). The rest is probed through `idx_variants_coord_hash_case`.

### 2.6 State, queue, staged deltas, pending work

```sql
ALTER TABLE cohort_summary_state
  ADD COLUMN publication_mode TEXT NOT NULL DEFAULT 'legacy'
    CHECK (publication_mode IN ('legacy', 'staged')),
  ADD COLUMN revision      BIGINT NOT NULL DEFAULT 0,  -- +1 per committed fold or rebuild
  ADD COLUMN site_epoch    BIGINT NOT NULL DEFAULT 0,  -- +1 per fold that logs a recheck
  ADD COLUMN rebuild_epoch BIGINT NOT NULL DEFAULT 0,  -- site_epoch of the last full rebuild
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
  site_epoch BIGINT NOT NULL DEFAULT 0,  -- read before the importer compared anything
  enqueued_at TIMESTAMPTZ,               -- clock_timestamp() in the prepare transaction
  solo BOOLEAN NOT NULL DEFAULT false, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  UNIQUE (case_id, kind));
CREATE INDEX idx_cpq_claim ON cohort_publication_queue (enqueued_at, queue_id)
  WHERE state = 'queued';                -- the folder's claim

CREATE TABLE cohort_staged_site (        -- one row per site of a prepared case
  case_id BIGINT NOT NULL, site_id BIGINT NOT NULL,
  gt SMALLINT NOT NULL,                  -- 0 other, 1 het, 2 hom: today's MAX(gt_num) classes
  coord_first BOOLEAN NOT NULL,          -- 2.4
  is_new BOOLEAN NOT NULL,               -- no counter row seen at prepare
  agree  SMALLINT NOT NULL,              -- bit per kind: contribution equals the stored value
  raises SMALLINT NOT NULL               -- bit per kind: contribution must replace it
) WITH (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 100000);
CREATE INDEX idx_css_case ON cohort_staged_site (case_id);        -- the folder's read
CREATE TABLE cohort_staged_annotation (  -- only where raises <> 0 or is_new
  case_id BIGINT NOT NULL, site_id BIGINT NOT NULL, /* REPRESENTATIVE_COLUMNS */
  PRIMARY KEY (case_id, site_id));
CREATE TABLE cohort_staged_gene (
  case_id BIGINT NOT NULL, gene_symbol TEXT COLLATE "C" NOT NULL, row_count INTEGER NOT NULL,
  PRIMARY KEY (case_id, gene_symbol));
CREATE TABLE cohort_staged_pair (        -- pairs missing from cohort_gene_pair at prepare
  case_id BIGINT NOT NULL, gene_symbol TEXT COLLATE "C" NOT NULL, coord_hash BYTEA NOT NULL,
  PRIMARY KEY (case_id, gene_symbol, coord_hash));

CREATE TABLE cohort_pending_op (         -- work left by interactive writers (3.4)
  op_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('flags', 'variant_changed')),
  coord_hash BYTEA NOT NULL, variant_type TEXT, genome_build TEXT,
  payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE cohort_site_recheck (       -- sites changed other than by plain addition
  site_id BIGINT PRIMARY KEY, epoch BIGINT NOT NULL);
```

The staged tables are logged (a prepared case survives a crash) and have no foreign keys
(60,000 referential checks per case otherwise); rows of a case that left the queue are
garbage and are deleted by the folder after its commit.

### 2.7 Sizes at about 6 M sites

| Relation | Measured shape (K1d) | This DDL |
|---|---|---|
| counter heap / indexes | 0.31 GB / 0.32 GB [M] | about 0.6 GB / 0.5 GB [D] |
| site heap / indexes | 0.65 GB / 0.95 GB [M] (key + 3) | about 0.85 GB / 2.0 GB [D] (key, unique, 5 filter or sort, trigram) |
| gene summary | 3 MB [M] | unchanged |
| gene pairs | not modelled | about 0.8 GB [D], written once |
| holders, flags | not modelled | 0 for one annotation release; at most 0.5 GB [D] |
| second counter (`coord_freq`) | 0.40 GB [M] | dropped |
| staged, queue, ops, recheck | not reported | under 20 MB [D]: at most 3 cases |

## 3. Publication

### 3.1 Importer, before the fold (no global lock)

After the last row batch of a file, on the worker's connection:

1. Take a preparation slot (4.4). Read `site_epoch` from the state row.
2. Aggregate the case's own rows into a session temporary table and `ANALYZE` it: one row per
   `(coord_hash, variant_type)` with the transcript row first by `transcriptOrderBy`, the
   four facts over the case's rows (`summaryColumnsOverWindow`), the genotype class of
   `MAX(gt_num)` and `coord_first`; plus rows per gene and the distinct (gene, coord_hash)
   pairs. This is today's `prepareAdd` (about 0.3 s [M]).
3. In an autocommit statement, insert the sites that do not exist, with the case's
   contribution as their annotation: `INSERT INTO cohort_site ... SELECT ... WHERE NOT EXISTS
   (...) ORDER BY coord_hash, variant_type ON CONFLICT (coord_hash, variant_type,
   genome_build) DO NOTHING`. The anti-join keeps the identity sequence from burning 60,000
   values per file; the order makes importers that meet on new sites wait in one direction.
4. One transaction `T_prepare` (fenced, 4.3; `synchronous_commit = off`, as row batches use
   today): join the temporary table to `cohort_site`, left-join the counter; insert
   `cohort_staged_site` with `agree` and `raises` computed per kind against the stored
   annotation; `cohort_staged_annotation` where `raises <> 0` or the site is new;
   `cohort_staged_gene`; `cohort_staged_pair` by anti-join; write `variant_count`,
   `case_data_info`, the per-case column metadata; set the case `prepared`; set the queue row
   `queued` with `enqueued_at` and `site_epoch`; `pg_notify('varlens_fold', schema)`.
5. Wait until the case is `ready` or its queue row is `failed` (poll every 100 ms), then post
   `complete` or the error. "Complete means visible" is unchanged.

A prepared case is hidden and immutable: every mutation entry point resolves its variant
through the `variants` view, which shows only `ready` cases. JSON imports take the same path
(their case is inserted as `importing`).

**Who writes what.** The importer writes, in parallel and unlocked: per-sample rows; site
rows for new sites; the staged delta (60,000 narrow rows); for a cohort of one release no
annotation row for a known site. The folder writes: counter rows; the annotation of a known
site only where a staged contribution raises a kind; holder rows only where carriers
disagree; gene counters and new pairs; flags of new counter rows; the case status.

### 3.2 Folder: one fold transaction

`T_fold`, READ COMMITTED, `synchronous_commit = on`, on the folder's connection:

1. `pg_try_advisory_xact_lock` on the summary write lock (`cohort-summary-lock.ts`); it
   excludes a rebuild and the cut-over. If taken, the round is skipped.
2. Claim in arrival order, skipping rows somebody else holds:
   ```sql
   SELECT q.queue_id, q.kind, q.case_id, q.site_epoch
     FROM cohort_publication_queue q JOIN cases_all c ON c.id = q.case_id
    WHERE q.state = 'queued' ORDER BY q.enqueued_at, q.queue_id
    LIMIT $k FOR UPDATE OF q, c SKIP LOCKED;
   ```
   A round is the pending work plus either all claimed adds (never more than the slot limit)
   or one remove.
3. Pending work (3.4): `WITH ops AS (DELETE FROM cohort_pending_op RETURNING *) ...`, so each
   row is applied exactly once.
4. Counters, one statement in the measured shape:
   ```sql
   WITH d AS (SELECT site_id, count(*) AS n, count(*) FILTER (WHERE gt = 1) AS het,
                     count(*) FILTER (WHERE gt = 2) AS hom,
                     count(*) FILTER (WHERE coord_first) AS coord_n, bool_or(is_new) AS is_new
                FROM cohort_staged_site WHERE case_id = ANY($cases) GROUP BY site_id),
        src AS (SELECT d.*, s.<key and copies> FROM d JOIN cohort_site s USING (site_id)
                 WHERE d.is_new
                UNION ALL SELECT d.*, NULL... FROM d WHERE NOT d.is_new)
   INSERT INTO cohort_site_counter AS k (...) SELECT ... FROM src ORDER BY site_id
   ON CONFLICT (site_id) DO UPDATE SET
     carrier_count = k.carrier_count + EXCLUDED.carrier_count, het_count = ..., hom_count = ...,
     coord_case_count = k.coord_case_count + EXCLUDED.coord_case_count
   RETURNING site_id, (xmax = 0) AS inserted;
   ```
   Only sites flagged new are joined to `cohort_site` (rows the importers just wrote); the
   other 54,000 touch the counter alone, which kept the cold fold as fast as the warm one
   [M]. A site whose counter row vanished since the prepare is in `cohort_site_recheck` with
   a newer epoch and is treated as new.
5. Annotation and holders, for the set N of claimed sites that have a staged row with
   `agree <> 31`, `raises <> 0` or `is_new`, or that have a `cohort_site_holders` row (N is
   empty for a cohort of one release). Per site and per kind, with `before` the carrier
   count before this fold:
   - the stored value competes with the staged contributions that raise it (re-evaluated
     against the row as it is now); if a contribution wins, it is written to `cohort_site`
     (and the copies on the counter), the kind's holders become the number of claimed
     carriers equal to it, and the site is logged in `cohort_site_recheck`;
   - otherwise the kind's holders grow by the claimed carriers that agree (starting from
     `before` when the site has no holder row);
   - afterwards the holder row is written if any kind's count is below the new carrier
     count, and deleted otherwise.

   For a site whose counter row this fold inserts, the stored annotation does not compete
   (it may be an orphan's, or that of an importer that has not been folded): the claimed
   contributions alone are merged, and written, and logged, only where the result differs
   from what is stored. Normally that is the importer's own row and nothing is written. No
   carrier of another case is read in this step.
6. Recheck fix-up. For each claimed case with `q.site_epoch < state.site_epoch`: the sites
   of its delta that are in `cohort_site_recheck` with a newer epoch get that case's
   contribution fetched from `variants_all` (case-local index), compared again, and handled
   by step 5; its pairs at those coordinates are re-derived. A case with
   `q.site_epoch < rebuild_epoch` is prepared again by the folder under the lock (a rebuild
   ran while it waited).
7. For inserted counter rows: flags (today's `annotationFlagCtes`, a join against the two
   small annotation tables), `site_count`, and `unique_variant_count` +1 per coordinate
   without a sibling counter row. Existing rows keep their flags: a case that was never
   visible has no per-case annotation.
8. Genes: `cohort_gene_pair` gets the claimed `cohort_staged_pair` rows `ON CONFLICT DO
   NOTHING RETURNING gene_symbol`; `cohort_gene_summary` gets the summed `cohort_staged_gene`
   rows, +1 affected case per (case, gene), and the returned fresh pairs.
9. Cases become `ready`; the claimed queue rows are deleted; `revision + 1`, `last_fold_at`;
   `pg_notify('varlens_cohort', schema)`. COMMIT.

After the commit, in its own transaction: delete the staged rows of the folded cases and the
recheck rows that no queued or preparing case predates.

### 3.3 Removal (delete, and the first half of an overwrite)

The request inserts a `remove` queue row; the folder does the rest in one `T_fold`, so the
subtraction and the hiding stay in one transaction, as in `hideCase` today:

1. claim the queue row and the case row; apply all pending work first (a switch of this case
   must be in the counters before they are subtracted);
2. compute the case's contribution and its `agree` bits against the stored annotation with
   the prepare template (today's `removeCaseFromSummary` runs the same aggregate under the
   lock);
3. subtract the counts and `coord_case_count`; counter rows at zero carriers are deleted
   with their holder and flag rows, and `site_count` and `unique_variant_count` follow;
4. for the case's sites that have a holder row: subtract the agree bits; a kind whose count
   reaches 0 with carriers left is recomputed from the remaining ready carriers by
   coordinate probe (the transcript row by `transcriptOrderBy`, a fact by its aggregate) and
   its holders are counted. Sites without a holder row need nothing: every remaining carrier
   agrees. Deleted and recomputed sites are logged in `cohort_site_recheck`; `site_epoch`
   + 1;
5. genes per 2.5 (a deleted pair logs the sites of its coordinate for recheck); flags
   recomputed for the sites where this case has per-case annotations, excluding it; per-case
   column metadata deleted;
6. the case becomes `deleting` and is renamed; `revision + 1`; COMMIT. Purge and
   finalisation are today's.

### 3.4 Interactive writers never wait for the folder

A star, comment or ACMG edit, and a transcript switch, commit their own row change together
with one `cohort_pending_op` row and `pg_notify`; they take no summary lock. The folder
applies the row in its next round (tens of milliseconds when idle, one fold when busy).

- `flags`: recompute the flag row of the sites at the key from the annotation tables.
  Idempotent, so an edit that commits during a fold is simply applied once more. Closes C2.
- `variant_changed` (transcript switch on a ready case): the switch locks its case row
  (`FOR NO KEY UPDATE`) before reading and proceeds only if the case is still `ready`, so
  two switches in one case are serial and none can follow a removal. It records the signed
  gene deltas computed from that case's rows (row moved from gene A to B; whether the case
  lost A, gained B, lost the pair, gained the pair). The folder applies them, checks the old
  pair as in 2.5, recomputes the site's transcript row and `tx_holders` from its carriers
  (a switch does not touch the facts), and logs the site for recheck.

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
| 4 | new sites | importer | `cohort_site` rows, autocommit | orphan site rows | nobody needs to: invisible, reused, collected when idle (2.1) |
| 5 | slot → `prepared` / `queued` | importer | `T_prepare` (3.1 step 4) | staged delta, hidden complete case | the folder publishes it; a restarted server starts the folder when the queue is not empty. If `T_prepare` did not commit: state 3 |
| 6 | `queued` → `ready` | folder | `T_fold` (3.2) | counters, case visible, revision | nothing to repair; staged rows are deleted by the next round |
| 7 | fold fails | folder | ROLLBACK, then one small transaction: `attempts + 1`, `solo = true` | attempt count | rows are still `queued`; next round |
| 8 | `queued` → `failed` | folder | after a solo failure with a deterministic error: `state = 'failed'`, `last_error` | hidden case, error text | the waiting worker reports the file as failed and cleans up as in 1; without a worker, lease recovery does |
| 9 | `ready` → `deleting` | delete job → folder | queue row `remove`; `T_fold` (3.3) | case hidden and subtracted | today's `listPendingDeletions` resumes the purge. Before `T_fold`: the case is still ready and counted; the job re-requests |
| 10 | op pending → applied | user → folder | op row with the user's change; deleted in `T_fold` | the user's change | op row survives; next round |

### 4.1 Election, claims, wake-up

- **One folder per schema.** A dedicated connection (not from the pool) takes
  `pg_try_advisory_lock(hashtext(schema), hashtext('varlens-cohort-folder'))`, session level,
  and runs every `T_fold` and the `LISTEN` on that same connection. Lock and work share one
  fate: if the connection dies, PostgreSQL releases the lock and aborts the open fold
  together, so a folder that has lost its lock cannot write. `tcp_keepalives_idle = 5`,
  `_interval = 2`, `_count = 3` bound a dead host to about 11 s; a dead process frees the
  lock at once.
- **Correctness does not rest on the election.** Every fold also holds the summary write
  lock and row locks on what it claimed, and all its effects are one transaction. Two
  folders would be slow, not wrong.
- **Standby.** Any server process that enqueues work calls `ensureFolder(schema)`; a loser
  of the election retries every 2 s while it sees queued work older than 1 s.
- **Claims are by state, never by position.** Sequence order is not commit order, so the
  folder keeps no high-water mark; a row that commits late is queued in the next round.
- **Wake-up.** `LISTEN varlens_fold` only shortens the wait. The truth is a poll: every
  200 ms while work exists or was seen in the last 5 s, every 2 s otherwise.
- **Poison.** A failed group fold sets `solo` on its rows; solo rows are folded one per
  transaction. SQLSTATE classes 40, 08, 53 and 57 are retried with backoff; anything else on
  a solo fold is deterministic and becomes row 8. A failing removal leaves the case ready
  and reports the error to the delete job.

### 4.2 Uncertain commit, restart, two workspaces

- **Folder COMMIT with unknown outcome**: the folder reconnects and reads the queue; rows
  still queued were not folded, rows gone were. It keeps no memory to reconcile.
- **Importer `T_prepare` with unknown outcome**: the worker reconnects and reads its case:
  `prepared` or `ready` means committed; `importing` means not, and it repeats step 4 after
  deleting its own staged rows.
- **Server restart**: all advisory locks and open transactions are gone. Queued cases are
  folded by the first folder; `deleting` cases resume; `importing` cases wait for the next
  import's recovery, as today.
- **Two workspaces**: every lock key, table and folder is per schema. A `hashtext` collision
  between two schema names costs mutual waiting only.

### 4.3 The import lease and correctness item C1

The coordinator (or a single-file worker) takes the workspace import lock as today and then,
before recovery, runs `UPDATE import_lease_state SET generation = generation + 1, ...
RETURNING generation`. Workers receive the generation and start **every** transaction with

    SELECT 1 FROM import_lease_state WHERE id = 1 AND generation = $g FOR SHARE;

and abort on zero rows. The owner's `UPDATE` conflicts with `FOR SHARE`, so it waits for
every fenced transaction in flight; any transaction that starts later sees the new
generation and aborts. After the bump commits, no worker of an older generation can commit
anything, and only then recovery reads the `importing` cases. A worker of a lost coordinator
therefore either committed `T_prepare` before the new owner existed (a complete case that
the folder publishes) or can never commit it (recovery deletes the case; it has no
contribution anywhere). The worker itself no longer publishes. A worker stuck idle in a
transaction is terminated by the new owner after a 30 s `lock_timeout` on the bump.

Mode changes (section 7) take the same workspace import lock, so the publication mode cannot
change during a batch.

### 4.4 Backpressure, cancel, delete, and what the user sees

- **Slots.** `VARLENS_IMPORT_MAX_UNPUBLISHED` (default 3) bounds the cases between "about to
  prepare" and "ready". A worker inserts its `preparing` queue row under a short transaction
  advisory lock only while fewer than that many `add` rows are `preparing` or `queued`, and
  polls otherwise. Row writing of further workers continues. This is the in-flight limit of
  K1d applied from the preparation step on, and the bound on a fold's group size.
- **Queue depth.** Adds are bounded by the slots. At most 16 `remove` rows; a further delete
  request answers "busy". Above 10,000 pending ops the handlers stop waiting and answer
  `summaryPending`.
- **UI.** A file in states 3–5 shows phase `publishing` in the batch progress, after
  `inserting`. The case is not in the case list before it is ready.
  `cohort:summaryStatus` gains `pending: { adds, removes, ops, oldestAgeMs }`; above 10 s the
  cohort view says that publication is delayed.

| State of the case | Cancel of the batch | Delete / overwrite | Transcript switch, annotation edit |
|---|---|---|---|
| `importing` | worker stops; rows and case removed (today) | refused: "still being imported" (today) | not addressable (hidden) |
| slot, `prepared`, `queued` | not retracted: the file is finished, will be published and is reported as imported | refused with the same message; ready within seconds | not addressable (hidden) |
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
11. counter rows ascending `site_id`, holder and flag rows, gene rows ascending symbol, pair
    rows, state row last (folder only)

Deadlock freedom: the folder waits for nothing a waiter on the folder can hold. It claims
6–7 with `SKIP LOCKED`; 5 is a try-lock; nobody else writes 9 (deletes), 10 (updates) or 11.
Importers hold 2 in share mode and wait only on another importer's insert of the same new
site, in key order, so those waits cannot form a cycle. User transactions take 6 then 8, one
case each, and never touch 10–11. The new lease owner waits for workers; workers never wait
for it. `hideCase` changes accordingly: it only enqueues.

## 5. Exactness invariants

| # | Invariant | Mechanism | Test that proves it |
|---|---|---|---|
| I1 | A ready case is counted; a counted case is ready, or was hidden by the transaction that subtracted it | only `T_fold` adds to the counters and it flips the status in the same transaction; removal subtracts and hides in one transaction; the folder is the only writer | crash at every barrier of 10.2, then maintained structures equal a rebuild from the ready cases |
| I2 | Maintained equals rebuilt after any sequence of add, delete, overwrite, switch and annotation edit, once the queue is empty | counts commute; annotation, holders, pairs and flags are re-derived for logged sites; `rebuildStaged` is the oracle, run REPEATABLE READ under the write lock, and it also rebuilds holder rows | the schema-diff harness, seeded random sequences at 1 and 4 importers, zero differences, on both backends |
| I3 | The #469 rule on every path, for both kinds | add: a kind is replaced iff a contribution raises it; remove: a kind is recomputed iff its holder count reaches 0 with carriers left; switch: the transcript row is recomputed; a prepare that raced with any of these is repaired through `cohort_site_recheck` | per kind: remove the only holder; remove one of two holders (no probe); the A/B scenario of the #469 tests (transcript from one carrier, ClinVar from another), then remove either; prepare, remove the holder, fold; two releases mixed; NULL against a value |
| I4 | Flags after deleting a case that held a per-case star | flag values are source counts recomputed for the case's annotated sites, excluding it, in the removal fold | star per case, delete the case: no flag row; with a global star as well: `star_refs` 1 |
| I5 | Count, page and totals of one response come from one snapshot | one REPEATABLE READ, READ ONLY transaction reads the state row first; the response carries `revision`; cursors carry it (6.2) | a fold forced between the statements of one read; a cursor used across a fold |
| I6 | Internal frequency unchanged: ready cases with a row at the coordinate, over all ready cases | `coord_case_count` (2.4); denominator `SELECT COUNT(*) FROM cases` untouched | every coordinate against `variant_frequency` on a schema with two builds and a case carrying one coordinate under two types |
| I7 | A staged delta is immutable and hidden | mutations resolve through the `variants` view | each mutation entry point against a prepared case is refused |
| I8 | Each staged delta and each op is folded exactly once | the queue row and the op row are deleted in the fold transaction | kill after COMMIT before the acknowledgement; uncertain commit |

## 6. Read contract

Every cohort read starts from `cohort_site_counter k` (existence gate), joins `cohort_site s`
on `site_id`, and left-joins `cohort_site_flags` for the returned rows.

### 6.1 Three shapes, chosen by rule

- **A, order first, bounded.** Walk a keyset index from the cursor; test the counter's own
  columns; join `s` for the survivors and test the rest. The walk examines at most a
  **budget** of index rows per request (50,000, doubling on each continuation up to
  1,000,000 [U]). Rows are found in order, so what one request returns is always an exact
  prefix of the answer; when the budget ends before the page is full the response carries
  `partial: true` and a cursor at the last *examined* row, and the client continues. With
  `consequences = HIGH` or a ClinVar filter of rank ≥ 13 the walk uses the matching partial
  index and skips nothing.
- **B, filter first.** A selective predicate on `s` through its index, join `k`, sort,
  limit. Chosen when `SELECT count(*) FROM (SELECT 1 FROM cohort_site s WHERE <s predicates>
  LIMIT 100001)` returns at most 100,000.
- **C, top-N scan.** The sort key has no index (as today): scan the table that owns it with
  its own filters, keep the page plus a margin, join the other table for those rows, repeat
  with a larger margin if orphans leave the page short.

**The anti-correlated case** (a filter that matches many sites but few with many carriers,
sorted by carriers) was a 2–3 s scan in revision 1. Now:

| Mitigation | What it buys | Cost |
|---|---|---|
| Budgeted exact prefix (shape A) | every request is bounded (target ≤ 300 ms [U]); rows appear in final order as they are found; total work never exceeds the one ordered scan that was the alternative | none in storage or in the fold; a short or empty first page with "searching" for such filters; one extra cursor state |
| `idx_csc_keyset_high`, `idx_csc_keyset_plp` | O(page) for the two filters where the effect is strongest (severe variants are depleted among common ones), alone or combined with counter filters | one more index entry per touched row inside the predicate: about 600 per case for HIGH at 1% of sites, under 2% of the fold's index writes [U]; about 30 MB each at 6 M sites [D] |
| `gnomad_af` on the counter | a gnomAD bound is tested without a second table, about 1 µs instead of 3–5 µs per examined row [U] | 8 B per counter row |
| Asynchronous exact count | says early that nothing (or little) matches, so the client stops continuing | the count itself (below) |

Considered and not taken: an index on the site table led by a filter key with a copied
carrier order (the order changes with every fold, so every fold would rewrite it), and a
general composite counter index per filter column (one more index write per touched row,
about +25% fold WAL each [D]).

### 6.2 Revision and cursor policy during an import

The server never holds a snapshot between requests: at 2 cases/s a snapshot held for a
minute keeps 6.5 million dead counter rows from being vacuumed (section 8). So each response
is exact at its own `revision`, and consistency across pages is a client policy:

- A cursor is `{v:2, s, r, k}`: scope hash, the revision of the list's **first** page, and
  the resume key. The server accepts a cursor of an older revision, answers from current
  data, and returns both `revision` and `baseRevision`.
- **At the top** (only the first page loaded, not scrolled): the renderer refetches page 1
  when the revision event arrives, at most once every 5 s. The list a user is looking at
  while a batch runs is therefore current, and it does not flicker at fold rate.
- **Deep** (more pages loaded, or scrolled): loaded pages are kept; further pages are
  appended by keyset from current data and de-duplicated by site key; a "cohort changed,
  reload" hint appears as soon as `revision <> baseRevision`; the total stays the one of the
  base revision and is labelled so. Reload starts a new list at the current revision.
- Exports and counts carry the revision they were computed at.

Why this one: restarting on every revision makes a deep list unusable during a batch (the
revision moves about once a second); rejecting old cursors does the same; pinning snapshots
costs vacuum. The price is stated to the user instead: a deep list assembled across
revisions can miss a variant whose count rose past the cursor, until reload.

### 6.3 Long alleles in the keyset order

Today the keyset index, the genomic index and the summary's primary key contain `ref` and
`alt` in full; an index tuple above 2,704 B is refused, the summary update fails and the
summary stays stale. The fix, for both backends in `cohortKeysetTerms` and
`chromosome-order.ts`: the order becomes

    (-COALESCE(carrier_count,-1)), chrRank, chr, pos, substr(ref,1,64), substr(alt,1,64),
    variant_type, genome_build, ref, alt

PostgreSQL indexes the first eight terms and resolves the last two by incremental sort and
by rechecking the row-value seek (`(terms) > (cursor)` uses the index for its leading
columns and filters on the rest) [U: to confirm with EXPLAIN in PR 2]. SQLite indexes all
ten (it has no tuple limit). The order differs from today's only between rows that share
count, chromosome, position and the first 64 characters of both alleles. It ships with
cursor v2 (PR 2), so cursors change once. A hash of the allele in the index was rejected:
it would order ties differently on the two backends.

### 6.4 Every read

| Read today | Shape on the new structures | Index | Cost class |
|---|---|---|---|
| Default page, `carrier_count DESC`, keyset or offset | A, no filter | `idx_csc_keyset` + site key | O(page); 1–2 ms p50, 2–83 ms p95 while folding [M] |
| `carrier_count_min`, build, variant type, het/hom/carrier column filters, `gnomad_af_max` | A, tested on the counter | `idx_csc_keyset` | O(page + skipped), bounded per request |
| impact HIGH, ClinVar pathogenic or likely pathogenic | A on the partial index | `idx_csc_keyset_high` / `_plp` | O(page) |
| other impact or ClinVar values, `cadd_min`, `funcs` with many matches | A; rank on the counter first, the rest on the joined row | `idx_csc_keyset` | bounded per request; 3–5 µs per examined row when the site row is needed [U] |
| gene, gene panel, `chr:pos`, panel intervals, `funcs` or impact with few matches | B | site indexes (2.1) | O(matches), at most 100,000 probes |
| text search | B through the trigram index | GIN | O(matches) [U] |
| starred, has comment, ACMG | from `cohort_site_flags`, join `k` and `s` | flags key | O(flagged) |
| extension filters (`sv.*`, `cnv.*`, `str.*`), after #469 | `EXISTS` per candidate row, as on the #469 branch | `variants` coordinate index | unchanged |
| cohort frequency filter or sort | `k.carrier_count / bt.total` with per-build case counts, as today; the sort is C on `k` | – | scan of the narrow counter |
| sort by `chr` | walk the site genomic index, probe `k` | site genomic index | O(page) |
| sort by ClinVar | walk `(clinvar_rank)` for ranked rows, probe `k` | site partial index | O(page) |
| sort by gene, cdna, aa change, impact, func, gnomAD, CADD, transcript | C on `s` | none (none today) | one scan of `s`, as today; **a hash join when a counter filter is combined** [U] |
| sort by het, hom, carrier ascending | C on `k` | none | one scan of the counter, narrower than today |
| exact count | no filter: `site_count`; counter filters: parallel scan of `k`; site filters: shape B count; both: hash join | – | **asynchronous**: the page answers with `total_count: null`; the count follows within 2 s, labelled with its revision, cached per (scope, revision) |
| cohort column metadata | distinct values from `s`, bounds from `k`; cached with its revision; recomputed on request, at most every 30 s while the revision moves, once after the queue drains | – | **not per fold**; labelled advisory during an import |
| tiles, overview, gene burden | state row, `cases`, `cohort_gene_summary` | – | unchanged |
| carriers of a variant | `variants` by coordinate | `variants_coords` | unchanged (out of scope) |
| export | one statement copies the matching rows into a session temporary table, then streams | as the page | the snapshot is held for the copy, not the download |
| case view: internal frequency | `LEFT JOIN LATERAL (SELECT SUM(k.coord_case_count) FROM cohort_site s JOIN cohort_site_counter k USING (site_id) WHERE s.coord_hash = v.coord_hash)`; left out of the count query when no frequency predicate is set (unconditional today) | site unique index, counter key | **two probes per row instead of one**: 100 for a page, 120,000 for a full-case filter [U] |

Writer-side readers of the old summary (`removalKeysCte`, `countAddedCoordinatesSql`,
`dropEmptySummaryRows`, the flag updates) are replaced by 3.2 and 3.3.

## 7. Migration and rollback

**Migration 0026** creates the structures of section 2 empty and leaves
`publication_mode = 'legacy'`. Catalogue locks only; nothing is rewritten except the check
constraint on the small `cases_all`.

**The switch.** `VARLENS_IMPORT_PUBLICATION=legacy|staged` states the wanted mode;
`cohort_summary_state.publication_mode` is the mode the workspace is in. They converge by a
job, never implicitly. Readers read the mode in their snapshot and pick the builder, so a
flip needs no restart. One release ships both paths.

**Dual maintenance is not viable.** The legacy write is the cost being removed (2.2 s per
case under the lock [M]). Both sets are pure functions of `variants`, `cases` and the
annotation tables, so the rollback is an exact regeneration: the structures of the inactive
mode stay in place, unmaintained, and are rebuilt on the way back.

**Cut-over (legacy → staged)**, a background job per workspace:

1. take the workspace import lock (a running import wins; the job retries) and bump the
   lease generation;
2. one REPEATABLE READ transaction under the summary write lock: empty the new structures;
   fill `cohort_site` and `cohort_site_counter` from the ready cases with the shared rebuild
   template, **inserting in descending carrier order** so that the frequently updated sites
   sit together at the start of heap and primary key (the locality the measurements relied
   on); holder rows where carriers disagree; `cohort_gene_pair`; flags; `site_count`;
   `rebuild_epoch`; `publication_mode = 'staged'`, `revision + 1`; COMMIT.

No table lock is taken: readers keep using the legacy tables until the commit; imports are
refused for the duration (about 20 s per million variant rows [D] from the #469 rebuild
figure: 2 minutes at 100 exomes, the largest existing workspace); deletes and switches wait
or defer as during a rebuild today.

**Cut-back (staged → legacy)**: take the import lock; let the folder drain the queue; under
the write lock run today's `rebuild()` plus a rebuild of `variant_frequency` (one grouped
insert, new: nothing rebuilds that table today) and set the mode in the same transaction.
Cost: the legacy rebuild, 17 s per million variant rows [M].

The release after next drops `cohort_variant_summary`, `variant_frequency`,
`cohort_gene_variant_summary`, `cohort_summary_rebuild_requests` and the legacy code.

## 8. Operating budget

All settings below are **derived**; none was varied in a run.

| Quantity | 1 case/s | 2 cases/s | Source |
|---|---|---|---|
| WAL of the fold | 28 MB per case | same | [M] narrow row; about 32 MB for this DDL [D] |
| WAL of all cohort structures | 45 MB/s | 85–92 MB/s | [M] K1d |
| the same per hour | 162 GB | 306–331 GB | [D] |
| per-sample rows | 26–164 MB per case | same | [M] A1, by index set |
| cohort WAL for 10,000 cases | 0.45–0.6 TB | same | [D] |
| dead counter rows | 54,000/s | 108,000/s | [D] one per updated row |

- **`max_wal_size`.** At 8 GB (dev container) the cohort structures alone force a
  checkpoint every 90–180 s, each followed by full-page images of the whole hot set.
  Recommended for a bulk import: `max_wal_size = 64GB`, `checkpoint_timeout = 15min`,
  `wal_compression = lz4`. Archiving or replication must carry 100–300 MB/s meanwhile.
- **Commit durability.** `T_fold` commits synchronously, which also makes the importers'
  earlier asynchronous commits durable; "ready" is never reported before that.
- **Vacuum.** With `autovacuum_naptime = 60s` and default cost limits the counter gains one
  dead row per live row per minute at 2 cases/s. Table settings in 2.2 plus
  `autovacuum_naptime = 10s`; the folder also issues `VACUUM cohort_site_counter` on a
  second connection after every 200 folded cases if autovacuum has not run since.
- **Snapshot age.** A reader holding a snapshot stops that cleanup. The folder samples
  `pg_stat_activity` every 30 s and reports the oldest `backend_xmin` holder above 60 s
  during an import; reads hold no snapshot between requests (6.2); the export copies and
  releases; the cut-over runs only without an import.
- **Memory.** Hot during an import: counter heap and indexes (about 1.1 GB), the site
  unique index (0.4 GB) and most of the site heap, which importers read to compare
  (0.85 GB): about 2.5 GB at 6 M sites. Recommended `shared_buffers >= 4GB` there; the 2 GB
  of the dev container relied on the operating system cache in K1d.
- **Connections.** One per folder and one for its vacuum, both direct: session advisory
  locks and `LISTEN` do not survive a transaction-pooling proxy (as the import lease today).

## 9. SQLite counterpart

SQLite has one writer at a time and no row versions: an update rewrites the row in place
and only the indexes whose columns changed. Today a file's publication rewrites the wide
summary row and four indexes containing `carrier_count`; to stay fast the session drops the
full-text insert trigger and up to ten read indexes while cases become visible (C6), and
may publish a case with the summary marked stale.

**The same**: the logical model and names (`cohort_site`, `cohort_site_counter`,
`cohort_site_holders`, `cohort_site_flags`, `cohort_gene_pair`, `revision` in
`cohort_summary_meta`), the rules of sections 2–3 for both kinds, the keyset terms of 6.3,
and the shared SQL in `src/shared/sql/` with the dialect as a parameter:
`cohort-representative.ts` (existing), a new `cohort-case-delta.ts` (contribution per site,
genotype class, `coord_first`, agree and raise bits, gene rows, pairs) and
`cohort-site-rebuild.ts` (the oracle). `cohort-summary-rebuild.ts`, SQLite-only despite its
location, is retired with the old table.

| Differs | PostgreSQL | SQLite |
|---|---|---|
| Who folds | one folder, asynchronous | the import worker, inline, in the transaction that ends the file |
| Staging | logged tables, queue, slots | session `TEMP` tables; no queue, no `prepared` state |
| Site key | `coord_hash` | `UNIQUE (chr, pos, ref, alt, variant_type, genome_build)`: no digest function, no tuple limit |
| Id lists | `= ANY($1)` | joins to temp tables; no array type anywhere |
| Interactive edits | pending ops | inline in the write worker's transaction, as today; the six flag triggers of v14 are retargeted to `cohort_site_flags` |
| Recheck log, epochs, lease fence | needed | not needed: nothing is prepared outside the writing transaction |
| Frequency lookup | `coord_hash` prefix | index `(chr, pos, ref, alt)` on `cohort_site` |

One `BEGIN IMMEDIATE` per file, after its last row batch: case delta into temp tables; new
sites; counters; annotation and holders for the sites that need them; genes and pairs;
flags for new counter rows; **the case's rows into the full-text index** (`INSERT INTO
variants_fts(rowid, ...) SELECT ... WHERE case_id = ?`); `import_status = 'ready'`;
`revision + 1`. The only carrier-bearing index left is the keyset index, on the narrow
table.

**Read structures during a session (C6).** A case is ready only when every read structure
covers it:

- Only the insert trigger `variants_fts_ai` is dropped during row batches; the delete and
  update triggers stay, because the write worker edits rows during a session. The full
  rebuild of the index at session end is removed (it is linear in the whole database); an
  incremental `merge` per file and one `optimize` at the end replace it.
- Read indexes on `variants` are never dropped once a ready case exists. `DROP_INDEXES` is
  allowed only for the first file into a database without ready cases, and they are
  restored before that file is published.
- `rebuildIsCheaper` ("publish stale, rebuild at the end") and the `import_session_open`
  marker are removed: no visible case is ever uncounted, and a transcript switch during a
  session is applied exactly.
- Pool workers key their column-metadata cache by `revision`, read inside the read
  transaction (C7).

**Bounds and gates.**

- Visibility: a file is visible when its publishing transaction commits; gate at most 2 s
  after its last row batch at 1,000 cases [U]. Folding every K files was dropped: with one
  sequential writer it only adds delay.
- Checkpoints: `wal_autocheckpoint = 0` and a `PASSIVE` checkpoint per file stay; readers
  are now active throughout, so when the WAL exceeds 256 MB after a passive attempt the
  worker runs `wal_checkpoint(RESTART)` within its busy timeout.
- SQLCipher: cost is per page written and per cache miss; the narrow counter cuts dirty
  pages per file; the gate is measured on an encrypted database, the worse case.
- Numeric gate: batch seconds per file, encrypted, at 100 and 1,000 cases, not above
  today's figure with indexes kept; search and every read index current at each `ready`.
- Migration: schema version 42 (41 is #469) creates the tables empty; the existing startup
  rebuild fills them, with the cohort view in its "rebuilding" state. There is no runtime
  switch: a database file is upgraded forward only, so SQLite ships one release after
  PostgreSQL has run with `staged` as the default.

## 10. Implementation plan

### 10.1 Pull requests, in order

Each leaves the product correct; `legacy` stays the default until PR 6. Tests come first.

| PR | Content | Tests first | Gate |
|---|---|---|---|
| 1 | Migration 0026; lease generation and the fence in every worker transaction (C1) | fence unit tests; schedule S1; migration idempotence | import seconds per sample within spread |
| 2 | `revision` written by the legacy publication, hide and rebuild; reads in one snapshot; cursor v2 and the keyset terms of 6.3 on both backends (C5) | I5 and S6 on the legacy path; a 5 kB allele imports and pages; preload contract | cohort page p95 within 10% or 10 ms; EXPLAIN shows the index seek |
| – | **K1e** (an experiment, no PR): the fold on the DDL of 2.2 | – | 10.3 item 1 |
| 3 | `cohort-case-delta.ts`, `rebuildStaged`, a shadow build that fills the new structures without reading them | harness projection "new structures → legacy shape" equals the #469 summary, `variant_frequency` and the gene tables on GIAB and a 100-sample import; I6 | build at most 1.5× the legacy rebuild; sizes against 2.7 |
| 4 | Read builders for the staged structures (6.1–6.4), selectable in tests only; renderer policy of 6.2 | every row of 6.4 on both builders with equal results; budgeted pages concatenate to the unbounded answer; cohort parity suite | read matrix on the 10,000-sample read-scale schema: every request ≤ 300 ms, count ≤ 2 s, the anti-correlated case reported |
| 5 | Prepare, queue, folder, removal, pending ops, cut-over and cut-back; `staged` opt-in | I1–I4, I7, I8; schedules S2–S5, S7–S9; harness at 1 and 4 importers | 10.3 items 2–5 |
| 6 | `staged` becomes the default; operating settings documented; queue-age and snapshot-age monitoring | upgrade and cut-back end to end on a 100-sample schema | hosted green build; second adversarial review |
| 7 | SQLite (section 9), schema 42 | harness on SQLite including SQLCipher; C6 and C7 tests | the numeric gate of section 9 |
| 8 | Next release: drop legacy tables and code | – | – |

Deliberately left out: integer site ids on `variants_all`; staged deltas as one array row
per case (the first optimisation to try: rows are the measured shape); a general composite
counter index per filter; retracting a finished file on cancel; sub-cohort counters.

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
| S5 | prepare of case X; then, per kind, removal of the only holder at a shared site; then fold of X |
| S6 | a fold between the statements of one cohort read; a cursor used across a fold |
| S7 | star, comment, ACMG and a transcript switch committing while a fold holds the lock, and immediately before a removal of the same case |
| S8 | uncertain COMMIT of `T_prepare` and of `T_fold` |
| S9 | cancel in each state of 4.4; delete requested for a prepared case |

### 10.3 The measurements that gate

Protocol of plan section 3 (alternating pairs, one benchmark at a time, WAL as the primary
figure). None of this has been run for this design.

1. **K1e, before PR 3**: K1b-opt variant (a)+(b) at K = 1, 2, 4, 8 on the 6.2 M-site schema
   with the counter DDL of 2.2 (natural key, three copies, three keyset indexes), rolled
   back, WAL and time; then K1d at 1, 1.5 and 2 cases/s, three slots, fresh table,
   autovacuum on, three runs. Pass: single-case fold ≤ 0.6 s and ≤ 35 MB; queue age p95
   ≤ 2 s at 1.5 cases/s. A second arm with two annotation releases (every shared site with
   a holder row) reports the mixed-release cost of 2.3.
2. **The clean before/after pair**: one real 100-sample import through the real worker,
   `legacy, staged, legacy, staged`: serial work per case (lock hold against fold time,
   target ≤ 0.6 s against 2.2 s); end-to-end seconds per sample at 4 workers; WAL per case
   by relation; importer prepare time.
3. **Sustained arrival** at 1, 1.5 and 2 cases/s on the 6 M-site schema with real
   importers: "file finished → visible" p95 ≤ 2 s, three runs each; cohort page p95
   ≤ 100 ms alongside.
4. **A 1,000-case soak** with a reader holding a snapshot for 60 s every 5 minutes: fold
   time and dead-row ratio must not drift.
5. **Removal**: fold time of one removal and of an overwrite batch of 20, for one release
   and for two.

## 11. Open questions and risks: what is not backed by a measurement

1. **No real-data fold exists.** Every fold figure is synthetic (6,000 private sites per
   sample, ten times the realistic rate; one transcript; empty annotation columns), on a
   driver, not through the worker.
2. **The counter row is about 90 B, the measured one about 50 B** (2.2). The 32 MB and
   0.5–0.6 s are estimates; K1e decides, with a named fallback.
3. **Holder counts and the recheck log are new.** The "0 changes for one release"
   expectation rests on the old-rule measurement (3–13 per case, all simulator artefacts; 0
   on GIAB) and on reasoning about releases, not on a cohort with two releases. In such a
   cohort the fold updates up to 54,000 holder rows per case; that cost is an estimate.
4. **The importer's extra reads are unmeasured**: the anti-join of about 54,000 pair probes
   and the comparison read of about 54,000 site rows; only the insert of new sites was
   measured (120–159 ms). Gene pairs are outside every measured fold.
5. **Removal runs a per-case aggregate under the lock**, as today's does (2.8 s for the
   whole step on the #469 branch), and was never run in this shape. An overwrite batch will
   not hold 2 s visibility if a removal fold exceeds about 1 s.
6. **Budgeted pages**: the budget, its doubling and the per-row costs are estimates; a
   filter that matches nothing costs several round trips until the count says so. The 1%
   share of HIGH sites behind the partial-index cost is assumed.
7. **Vacuum in steady state** (runs were 200 cases each) and **importer contention** (K1d's
   producers were synthetic; four real importers write 26–164 MB of WAL per case next to
   the fold) may move the 2 cases/s ceiling. The slot limit of 3 is taken from that run.
8. **Read regressions by construction**: case-view internal frequency costs two probes per
   row (the clean fix is a site id on the per-sample row, out of scope); a sort without an
   index combined with a counter filter becomes a hash join of two 6 M-row tables.
9. **The seek on a prefix of the keyset terms** (6.3) relies on PostgreSQL using a
   row-value comparison for the index's leading columns and on incremental sort for the
   rest; to be confirmed by EXPLAIN before PR 2 merges.
10. **The cursor policy accepts a visible gap**: a deep list during an import is not one
    snapshot. The alternative is a per-list temporary copy of the order, a scan per list.
11. **Scale assumptions**: 3–9 M sites at 10,000 exomes is derived from two published
    totals with an assumed exponent. The design is sized for about 6 M; at 60 M the K1c
    runs failed above 1 case/s. Cut-over time is extrapolated from 1.26 M variant rows.
12. **Folder in the server process**: takeover takes 2–11 s, during which the 2 s target is
    missed; the trigram index, the asynchronous count and the metadata throttle are
    unmeasured.
13. **SQLite**: nothing in section 9 is measured; its numeric gate is the gate of PR 7.
14. **#469 is still moving** (its tip was `f2faa9c3` when this was written; category
    filters and a chunked rebuild were uncommitted). This design depends only on the
    module's predicates and the two rank columns; the constants in the two partial-index
    predicates (4, 13) must follow `severity.config.ts`.
