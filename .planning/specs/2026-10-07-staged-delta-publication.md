# Cohort publication on split structures, folded by the importer (2026-10-07)

Status: revision 3, after two adversarial reviews (Codex, Opus) of revision 2. Decision:
**simplify**. No product code exists. The file name is kept; "staged delta" now means a
session-local prepared delta. Supersedes revisions 1 and 2 (commits `4ac5e110`, `c41309d6`).

Inputs: `.planning/artifacts/perf/import-scale/` on branch `normalised-model` (`SUMMARY.md`,
A1, K1, K1b, K1b-opt/K1c, K1d); `main` at `feac7ad0`; the #469 branch
`fix/cohort-representative-severity` (rule module as of `09d19700`, migration 0025). Tables
are per workspace schema; the `"__schema__".` prefix is omitted.

Marking: **[M]** measured in those artefacts, **[D]** derived, **[U]** unmeasured.

## 1. Decision and reason

| | Revision 2 | Revision 3 |
|---|---|---|
| Who folds | one elected folder per schema, queue, slots, `prepared`/`failed` states, logged staged tables, poison protocol, LISTEN/NOTIFY | each importer folds its own case under the summary write lock; the case becomes ready in that transaction, as today |
| Interactive edits | asynchronous through op rows | synchronous under the lock; an op row only when the lock is not had in 1.5 s |
| Kept | counter/site split, sparse holder counts, `site_epoch`, lease fence, revision and snapshot reads, cursor v2, long alleles | |

Why. Row writing costs 2,410 ms + 330 ms and 192 MB of WAL per case per worker [M, A1], so
four workers deliver at most 1.5 cases/s before parsing and about 1 in practice. Every
sustained-arrival run that passed had a median fold size of 1 [M, K1d]. The single-case
fold is 0.43–0.49 s [M] on a 50 B counter row, estimated 0.5–0.6 s on the row of 3.2 [U]. A
serial fold of 0.6 s carries 1.6 cases/s; a separate folder buys headroom only above about
1.5 cases/s, which importers cannot deliver until row writing is fixed (plan items P4, P5).
The folder's machinery was where both reviews found the blockers.

**Later option, recorded:** a group-folding folder. Its gate: with row writing at ≤ 1 s
per case, K1e (10.2) shows lock wait above 2 s at the delivered rate. The plan's target
"serial work per case ≤ 0.2 s" is **not met** (0.5–0.6 s); that is accepted now because at
0.6 s serial the bound is row writing, not publication.

## 2. Scope and the rule

In: PostgreSQL publication on the split structures; reads on them; delete, transcript
switch, annotation edits; migration, cut-over, rollback; SQLite (section 9). Out: the
per-sample table `variants_all` and its indexes, site ids on it, sub-cohorts, C10.

The rule (#469, `src/shared/sql/cohort-representative.ts`), five independent **kinds** per
site (chr, pos, ref, alt, variant_type, genome_build):

- transcript row: `func`, `gene_symbol`, `transcript`, `cdna`, `aa_change`, `consequence`,
  `omim_mim_number`, `impact_rank`, together from the first carrier row by
  `transcriptOrderBy`;
- four facts, each aggregated over all carrier rows: `clinvar` with `clinvar_rank` (highest
  rank, ties by string), `gnomad_af` (lowest), `cadd` (highest), `end_pos` (highest).

A carrier is a ready case; its **contribution** is its transcript row and its four facts over
its own rows at the site. It **agrees** on a kind when `sameTranscript` holds, respectively
when its fact is not distinct from the stored one; it **raises** a kind when
`precedesTranscript`, respectively `SUMMARY_FACTS[].raises`, holds.

## 3. Structures

Two migrations: **0026** with PR 2 (the `revision` column and the index changes of 7.3;
0025 is #469), **0027** with PR 3 (everything below). 0027 creates only what PRs 3 and 4
use and seeds every singleton row. The prepared delta is session-local, so its format needs
no versioning across upgrades.

### 3.1 Site

```sql
CREATE TABLE cohort_site (
  site_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coord_hash   BYTEA  NOT NULL,         -- same value as variants_all.coord_hash (4-part sha256)
  variant_type TEXT   NOT NULL,
  genome_build TEXT   NOT NULL,
  chr TEXT NOT NULL, pos BIGINT NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
  live BOOLEAN NOT NULL DEFAULT false,  -- true iff a counter row exists (same transaction)
  func TEXT, gene_symbol TEXT, transcript TEXT, cdna TEXT, aa_change TEXT, consequence TEXT,
  omim_mim_number TEXT, impact_rank SMALLINT NOT NULL DEFAULT 0,
  clinvar TEXT, clinvar_rank SMALLINT NOT NULL DEFAULT 0,
  gnomad_af DOUBLE PRECISION, cadd DOUBLE PRECISION, end_pos BIGINT
) WITH (fillfactor = 90);
CREATE UNIQUE INDEX cohort_site_key ON cohort_site (coord_hash, variant_type, genome_build)
  INCLUDE (site_id);
```

A site row with `live = false` is not data: readers filter on `live` or come through the
counter. Such orphans (failed import, last carrier removed) are reused by the next carrier,
which overwrites the annotation. **Collection** happens only in a job that holds the
workspace import lock, so never while any importer prepares.

| Index (static: written when a site is created, never by a count change) | Reader |
|---|---|
| primary key | join from the counter; fold |
| `cohort_site_key` with `INCLUDE (site_id)` | importer resolution; case-view internal frequency, index-only (7.2); siblings of a coordinate |
| `(gene_symbol COLLATE "C")` | gene `=`, `in`, gene panel |
| `(consequence, gnomad_af)` | impact `=`, `in`, with or without a gnomAD bound |
| `(func)` | func `=`, `in` |
| `(clinvar_rank, clinvar COLLATE "C") WHERE clinvar IS NOT NULL` | ClinVar `=`, `in` (the rank of a literal is computed from the configuration), sort |
| `(chrRankSql(chr), chr COLLATE "C", pos, substr(ref,1,64), substr(alt,1,64))` | sort by chr ascending, `chr:pos`, panel intervals |
| GIN `(gene_symbol, consequence, omim_mim_number) gin_trgm_ops` | text search, `like` on those columns [U] |

### 3.2 Counter

```sql
CREATE TABLE cohort_site_counter (
  site_id BIGINT PRIMARY KEY,           -- = cohort_site.site_id; no foreign key
  pos BIGINT NOT NULL,
  gnomad_af DOUBLE PRECISION,           -- copy of the site's value
  carrier_count    INTEGER NOT NULL,    -- ready cases with a row at the site
  het_count        INTEGER NOT NULL,
  hom_count        INTEGER NOT NULL,
  coord_case_count INTEGER NOT NULL,    -- 3.4
  impact_rank SMALLINT NOT NULL, clinvar_rank SMALLINT NOT NULL,   -- copies
  chr TEXT NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
  variant_type TEXT NOT NULL, genome_build TEXT NOT NULL
) WITH (fillfactor = 90, autovacuum_vacuum_scale_factor = 0,
        autovacuum_vacuum_threshold = 200000, autovacuum_vacuum_cost_delay = 0);
-- K = (-COALESCE(carrier_count,-1)), chrRankSql(chr), chr COLLATE "C", pos,
--     substr(ref,1,64), substr(alt,1,64), variant_type, genome_build        (7.3)
CREATE INDEX idx_csc_keyset      ON cohort_site_counter (K);
CREATE INDEX idx_csc_keyset_high ON cohort_site_counter (K) WHERE impact_rank = 4;
CREATE INDEX idx_csc_keyset_plp  ON cohort_site_counter (K) WHERE clinvar_rank >= 13;
```

On this row: what a fold changes; what the keyset index and the read scope need in the same
table (natural key, build, type); and the three values a walk in carrier order must test
without a second table. Display columns are joined from `cohort_site` for the returned rows.
The row is about 90 B against the measured 50 B, the keyset entry 48 B against 24 B: about
+64 B of WAL per touched row, 28 → 32 MB per case [D]. K1e (10.2) measures it; the fallback
is a tie-break by `(chrRank, pos, site_id)` without the natural key, which changes the tie
order on both backends. No update is heap-only while the count is indexed [M].

### 3.3 Sparse companions, tallies, state, ops

```sql
CREATE TABLE cohort_site_holders (      -- a row only where some carrier disagrees on a kind
  site_id BIGINT PRIMARY KEY,
  tx_holders INTEGER NOT NULL, clinvar_holders INTEGER NOT NULL,
  gnomad_holders INTEGER NOT NULL, cadd_holders INTEGER NOT NULL, end_holders INTEGER NOT NULL
) WITH (fillfactor = 70);               -- no indexed column changes: heap-only updates
CREATE TABLE cohort_site_flags (        -- a row only where a flag is set
  site_id BIGINT PRIMARY KEY, star_refs INTEGER NOT NULL, comment_refs INTEGER NOT NULL,
  acmg_best_rank SMALLINT NOT NULL);
CREATE TABLE cohort_gene_pair (         -- exists iff a ready carrier row has the gene there
  gene_symbol TEXT COLLATE "C" NOT NULL, coord_hash BYTEA NOT NULL,
  PRIMARY KEY (gene_symbol, coord_hash));
CREATE TABLE cohort_site_tally (        -- exact unfiltered counts per read scope
  genome_build TEXT NOT NULL, variant_type TEXT NOT NULL, site_count BIGINT NOT NULL,
  PRIMARY KEY (genome_build, variant_type));
CREATE TABLE cohort_pending_op (        -- fallback of an edit that did not get the lock (4.4)
  op_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coord_hash BYTEA NOT NULL, genes TEXT[] NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  quarantined BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE cohort_summary_state        -- `revision` arrives with 0026
  ADD COLUMN publication_mode TEXT NOT NULL DEFAULT 'legacy'
    CHECK (publication_mode IN ('legacy', 'staged')),
  ADD COLUMN site_epoch BIGINT NOT NULL DEFAULT 0,      -- +1 whenever a stored annotation
  ADD COLUMN build_watermark TEXT;                      --   value changes; 6.1 for the last
INSERT INTO cohort_summary_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
```

**Holders.** `x_holders` is the number of carriers that agree on kind x. No row means every
carrier agrees on every kind. The stored value of a kind is always some carrier's, so a
count is at least 1 while carriers exist. A count per kind was chosen over probing other
carriers on removal: the probe is 54,000 index probes and 2.8 s per removed case [M, #469
branch]; a count costs nothing where no row exists.

**The table is not empty for one annotation release.** A row exists wherever two carriers
differ on any kind, including NULL against a value:

| Cause | Sites with a row | Size (56 B row + key, about 80 B) | Fold cost per case [U] |
|---|---|---|---|
| SV/CNV: `end_pos` differs per sample and caller | most SV/CNV sites with 2+ carriers: 10⁴–10⁵ | under 10 MB | one heap-only update per such site of the case: negligible |
| one fact missing in some files (CADD absent for some rows, JSON imports without gnomAD or CADD) | every site shared between the two groups: up to all multi-carrier sites, about 3 M of 6 M | up to 0.25 GB | up to 54,000 heap-only updates: 0.1–0.2 s, 4–8 MB WAL; upper bound the second narrow counter, 0.2 s / 15 MB [M] |
| a second release (gnomAD, CADD, ClinVar or transcript versions) | every shared site where the releases differ: up to all | up to 0.5 GB | as above |
| one release, complete annotation, SNV/indel | 0 | 0 | 0 (a join against an empty table) |

A stored value of a known site changed for 3–13 of 60,000 sites per case under the old
per-column rule (all simulator duplicates with different CADD) and for 0 on the GIAB trio
[M]. Under this rule it changes at most once per kind and site per arriving "better" group.

**Flags** are source counts recomputed for a site, the set today's `flagRecomputeSql`
evaluates: `star_refs` = (1 if `variant_annotations` at the coordinate is starred) + starred
`case_variant_annotations` rows on ready carrier rows at (chr, pos, ref, alt,
variant_type); `comment_refs` likewise; `acmg_best_rank` the highest among them.
**Genes.** `cohort_gene_summary` (0023) keeps its meaning; its `unique_variant_count` moves
with rows of `cohort_gene_pair`.

### 3.4 Internal frequency instead of `variant_frequency`

Today: `internal_af = vf.case_count / (SELECT COUNT(*) FROM cases)`; `case_count` is the
number of ready cases with a row at the four-part coordinate, any type or build
(`PostgresVariantReadRepository.ts:166`, `PostgresJsonImportRepository.ts:458`). The sum of
`carrier_count` over a coordinate's sites equals it **iff no case has the coordinate under
two variant types** (for example `<DEL>` as `sv` and `cnv`: today 1, the sum 2). So each
case adds 1 to `coord_case_count` of exactly one of its sites per coordinate (smallest
`variant_type`, bytewise), and the numerator is `SUM(coord_case_count)` over the sites with
that `coord_hash`: today's value in every case. Denominator unchanged.

### 3.5 Sizes at about 6 M sites

Counter 0.6 GB heap + 0.5 GB indexes [D] (measured narrow shape 0.31 + 0.32 [M]); site
0.85 GB + about 2.0 GB of static indexes [D] (0.65 + 0.95 [M] with three); gene pairs about
0.8 GB [D]; holders 0–0.5 GB; flags, tallies, ops negligible; `variant_frequency` (0.4 GB)
and the legacy tables are dropped after the rollback window.

## 4. Publication by the importer

### 4.1 Before the lock

After the last row batch, on the worker's own connection:

1. **Case-local aggregate** into session `TEMP` tables, then `ANALYZE` (today's
   `prepareAdd`, 304 ms [M], plus the per-case column metadata, 187 ms [M]): `_d_site`
   with one row per `(coord_hash, variant_type)`: natural key, the contribution
   (`summaryColumnsOverWindow`), genotype class of `MAX(gt_num)`, `coord_first`; `_d_gene`
   (gene, rows); `_d_pair` (gene, coord_hash).
2. **Take a preparation slot**: a session advisory lock on one of
   `VARLENS_IMPORT_PREPARE_SLOTS` keys (default 3; the in-flight limit that made 2 cases/s
   pass in K1d). It is freed by `pg_advisory_unlock` after the fold or by the death of the
   connection; no row represents it.
3. **Resolve sites** in one short fenced transaction (5.2): insert the missing ones with the
   case's contribution and `live = false` (`WHERE NOT EXISTS ... ORDER BY coord_hash,
   variant_type ON CONFLICT DO NOTHING`; the anti-join spares 60,000 sequence values, the
   order makes importers wait in one direction), then `UPDATE _d_site SET site_id = ...`.

Nothing in the delta is compared with stored values here. That was blocker B1.

### 4.2 The fold: one transaction, one case

`BEGIN`; the fence (5.2); `SELECT pg_advisory_xact_lock(<summary write lock>)` (5.1);
`synchronous_commit = on`. Then:

```sql
-- F1  classify against CURRENT rows; the only place agreement is evaluated
CREATE TEMP TABLE _f ON COMMIT DROP AS
SELECT d.*, k.site_id IS NULL AS is_new, COALESCE(k.carrier_count, 0) AS before,
       h.site_id IS NOT NULL AS has_holders,
       k.site_id IS NOT NULL AND <sameTranscript(d, s)>   AS agree_tx,  -- one pair per fact too
       k.site_id IS NULL OR <precedesTranscript(d, s)>    AS raise_tx   -- raise_x: <raises(d, s)>
  FROM _d_site d JOIN cohort_site s USING (site_id)
  LEFT JOIN cohort_site_counter k USING (site_id) LEFT JOIN cohort_site_holders h USING (site_id);
-- assert: rows(_f) = rows(_d_site); otherwise ROLLBACK and fail the file

-- F2  existing counter rows (no NULL ever reaches a NOT NULL column)
UPDATE cohort_site_counter k
   SET carrier_count = k.carrier_count + 1, het_count = k.het_count + (f.gt = 1)::int,
       hom_count = k.hom_count + (f.gt = 2)::int,
       coord_case_count = k.coord_case_count + f.coord_first::int,
       impact_rank  = CASE WHEN f.raise_tx      THEN f.impact_rank  ELSE k.impact_rank  END,
       clinvar_rank = CASE WHEN f.raise_clinvar THEN f.clinvar_rank ELSE k.clinvar_rank END,
       gnomad_af    = CASE WHEN f.raise_gnomad  THEN f.gnomad_af    ELSE k.gnomad_af    END
  FROM _f f WHERE k.site_id = f.site_id AND NOT f.is_new;       -- rows = count(NOT is_new)
-- F3  new counter rows, complete
INSERT INTO cohort_site_counter (site_id, pos, gnomad_af, carrier_count, het_count, hom_count,
       coord_case_count, impact_rank, clinvar_rank, chr, ref, alt, variant_type, genome_build)
SELECT site_id, pos, gnomad_af, 1, (gt = 1)::int, (gt = 2)::int, coord_first::int, impact_rank,
       clinvar_rank, chr, ref, alt, variant_type, $build FROM _f WHERE is_new ORDER BY site_id;
-- assert: rows(F2) + rows(F3) = rows(_f); otherwise ROLLBACK and fail the file

-- F4  annotation: per kind, only where this case raises it; a new site takes the case's row
UPDATE cohort_site s SET live = true,
       (func, gene_symbol, ..., impact_rank) = CASE WHEN f.raise_tx THEN (f...) ELSE (s...) END,
       (clinvar, clinvar_rank) = CASE WHEN f.raise_clinvar THEN ... END, gnomad_af = ..., ...
  FROM _f f WHERE s.site_id = f.site_id
   AND (f.is_new OR f.raise_tx OR f.raise_clinvar OR f.raise_gnomad OR f.raise_cadd OR f.raise_end);
-- F5a holders where a row exists: each kind +1 if agree, = 1 if raise, unchanged otherwise
UPDATE cohort_site_holders h
   SET tx_holders = CASE WHEN f.raise_tx THEN 1 WHEN f.agree_tx THEN h.tx_holders + 1
                         ELSE h.tx_holders END, ...
  FROM _f f WHERE h.site_id = f.site_id;
-- F5b holders where none exists and the case does not agree on everything
INSERT INTO cohort_site_holders (site_id, tx_holders, ...)
SELECT site_id, CASE WHEN raise_tx THEN 1 WHEN agree_tx THEN before + 1 ELSE before END, ...
  FROM _f WHERE NOT is_new AND NOT has_holders
   AND NOT (agree_tx AND agree_clinvar AND agree_gnomad AND agree_cadd AND agree_end);
```

Then, each one statement: F6 flags for new counter rows (today's `annotationFlagCtes`
joined to `_f WHERE is_new`); F7 `cohort_site_tally` and `unique_variant_count` (+1 per
new coordinate without another live sibling); F8 `cohort_gene_pair` from `_d_pair`
`ON CONFLICT DO NOTHING RETURNING gene_symbol`, then `cohort_gene_summary` from `_d_gene`
plus the returned fresh pairs; F9 pending ops (4.4), at most 100; F10 `site_epoch + 1` if
F4 changed a known site; `variant_count`, `case_data_info`, `import_status = 'ready'`,
`revision + 1`. COMMIT; release the slot.

Why this is exact: folds are serial; F1 reads the stored values that F2–F5 modify, in the
same transaction; each table is written by one statement that joins `_f` once, so a
contribution is applied exactly once. For a new site the stored annotation never competes:
it is an orphan's, or that of an importer that has not folded and will raise or agree
against whatever is stored when its turn comes. The fold now reads the case's site rows
under the lock (about 54,000 by primary key). If K1e misses: the importer compares before
the lock and F1 trusts that only while `site_epoch` is unchanged (not built at first).

### 4.3 Removal (`hideCase`; first half of an overwrite)

One transaction under the same lock, taken as a job (5.1); subtraction and hiding stay
together as today. The case's contribution and its agreement are computed under the lock
with the F1 template. Counts and `coord_case_count` are subtracted. For its sites with a
holder row the agreed kinds are decremented; a kind at 0 with carriers left is recomputed
from the remaining ready carriers by coordinate probe (rare) and `site_epoch` moves; **a
holder row whose five counts all equal the carrier count is deleted**. Counter rows at 0
carriers are deleted with their holder and flag rows, the site becomes `live = false`,
tallies follow. A gene pair is deleted when no live site remains at its coordinate, kept
when the gene is the stored gene of a live sibling, probed otherwise. Flags are recomputed
for the sites where the case has per-case annotations, excluding it. Then `deleting`,
rename, `revision + 1`.

### 4.4 Interactive edits: synchronous, with a durable fallback

Star, comment, ACMG and transcript switch run `BEGIN; SAVEPOINT l; SET LOCAL lock_timeout =
'1500ms'; SELECT pg_advisory_xact_lock(...)`.

- **Lock had** (the normal case; a fold holds it about 0.5 s): the edit and its effect on
  the structures commit together. Flags: recompute the flag row of the sites at the key
  (closes C2). Transcript switch: today's row-level gene delta (correct here because it is
  evaluated and applied under the lock), then the site's transcript row and `tx_holders`
  recomputed from its carriers.
- **Timeout** (`55P03`): `ROLLBACK TO l`; the edit commits with one `cohort_pending_op`
  row `(coord_hash, genes)`. The op means "recompute from source, for every site of this
  coordinate: annotation, holders, flags; the pairs of the coordinate; the
  `cohort_gene_summary` rows of the named genes (one probe per ready case through
  `idx_variants_case_gene`)". It is **idempotent**, never a signed delta.
- **Who applies it**: the next lock holder (fold, edit, removal), each op under its own
  savepoint; and a drain started by the server on the response path and at startup, so no
  op waits for a user action. A failing op gets `attempts + 1`; at 3 it is `quarantined`,
  the summary is flagged `is_stale` with the reason, and an error is logged (section 8).
- **What the user sees**: the edit itself is saved and shown. The response carries
  `summaryPending: true`; `summaryIsStaleSql` counts pending ops as it counts rebuild
  requests today, so cohort reads carry the existing `staleSummary` warning and the
  existing "refreshing" indicator shows until the op is applied.

Delete does not use the fallback: hiding without subtracting would break I1. It is a job
that waits for the lock in turn (5.1).

## 5. Locks, the fence, and every wait

### 5.1 The summary write lock

Same key as `cohort-summary-lock.ts`, always transaction-scoped. Workers stop polling: the
import worker's own connection (session limits already lifted) blocks in
`pg_advisory_xact_lock`, which queues in arrival order and holds no transaction id while
waiting. Pooled connections never block longer than their `SET LOCAL lock_timeout`: edits
1.5 s (4.4), the delete job and a rebuild chunk 60 s per attempt. Request-path reads never
take it. A cancel reaches a blocked worker as `pg_cancel_backend(pid)` from the batch's
control connection (workers report their backend pid at start).

Lock order: import lock (session; coordinator) → fence (shared: workers; exclusive: new
owner) → preparation slot (session) → summary write lock → rows. Under the summary lock one
transaction at a time writes the structures, in ascending `site_id`, so row locks cannot
cycle; site resolution runs before it and orders its inserts by key. A slot holder waits
for the summary lock; the summary lock holder never waits for a slot.

### 5.2 The lease fence (C1)

Advisory locks, no row locks (60 transactions per file must not write a lock row). Every
mutating worker transaction, including site resolution, starts with

    SELECT pg_advisory_xact_lock_shared(hashtext($schema), hashtext('varlens-import-fence'));

followed by today's `assertImportLeaseHeld`, extended to compare the holder's
`backend_start` as well as its pid (pid reuse). A new owner, after taking the import lock
and before recovery, takes the same key **exclusively** and holds it through recovery. It
therefore waits for every worker transaction in flight; any worker transaction that starts
later either waits and then fails the lease check (the old holder is gone) or fails it at
once. A worker of a lost coordinator has either committed its fold (a complete, counted,
ready case) or can never commit it; recovery then deletes an `importing` case that has no
contribution anywhere. No table, no migration: PR 1 is code only.

### 5.3 Every wait has a bound and an outcome

| Wait | Bound | Outcome at the bound |
|---|---|---|
| worker for a preparation slot or the summary lock | `lock_timeout` 15 min | the file fails "publication busy"; rows and case removed by today's cleanup |
| a fold, a removal, an edit, once inside | `statement_timeout` 10 min, `idle_in_transaction_session_timeout` 60 s (both `SET LOCAL`) | the server aborts the transaction and frees the lock; the case stays `importing` and is cleaned up by its worker or by recovery |
| interactive edit for the lock | 1.5 s | op row (4.4) |
| delete job, rebuild chunk for the lock | 60 s per attempt | retry with the existing backoff; the job reports "busy" |
| new owner for the exclusive fence | 30 s | it terminates the backends that hold the shared lock (`pg_locks`), then retries |
| cancel during any wait | – | `pg_cancel_backend`; the file ends as cancelled |

No state needs a particular live process: all locks die with their connection; `importing`
cases are recovered at the next import and, new, at server start when the import lock is
free; op rows by any lock holder or the startup drain; a build by its watermark (6.1).

## 6. Rebuild, cut-over, rollback

### 6.1 Chunked rebuild and the boundary against edits

A rebuild is a sequence of **range recomputes** (a chromosome-rank and position range
sized to about 2 M variant rows), each its own transaction under the summary lock:
recompute sites, counters, holders, flags and pairs of the range from `variants`, `cases`
and the annotation tables; `site_epoch + 1`; advance `build_watermark`. Because edits and
folds take the same lock, a chunk sees no half-applied change, and between chunks folds
continue. Op rows visible to a chunk whose coordinate lies in its range are deleted by it
(their source change is in what it read); later ones remain and are applied later, which
is harmless because they are idempotent. Op rows are written in **both** modes from 0027.
The 30-minute statement timeout of today's rebuild then bounds a chunk, not a rebuild. The
chunking is to be shared with the chunked rebuild the #469 branch is adding. As a repair
the chunks make ranges exact one after another while imports continue. A **sampled audit**
(default 2,000 random sites per run against a live aggregate over their carriers) is the
routine check; the rebuild is the remedy.

### 6.2 Cut-over and rollback

`VARLENS_IMPORT_PUBLICATION=legacy|staged` states the wanted mode;
`cohort_summary_state.publication_mode` the actual one; readers pick their builder from the
mode read in their snapshot. Dual maintenance is not viable: the legacy write is the 2.2 s
per case [M] being removed.

**Cut-over (legacy → staged)**: a job holds the workspace import lock (imports are refused;
readers and edits continue on the legacy tables, and while a build runs every edit also
leaves an op row), builds the new structures chunk by chunk, applies the op rows, and
flips the mode in the last transaction. It resumes from the watermark after a restart.
Within a range rows are inserted in descending carrier order; the global heap locality of
the synthetic runs (common sites first) is not reproduced [U]. **Rollback** is the same in
reverse: today's `rebuild()` made chunked, plus a grouped rebuild of `variant_frequency`,
which nothing rebuilds today.

**Honest cost**: 17–20 s per million variant rows [M/D]: 2 minutes at 100 exomes (the
largest workspace today), 20 minutes at 1,000, **about 2.8 hours at 10,000 (600 M rows),
with imports refused throughout**. Rollback by rebuild is practical only for small
workspaces; for a large one the path is forward: audit, range recompute, op quarantine.
The legacy tables are dropped one release after `staged` is the default.

## 7. Reads

### 7.1 Contract

One REPEATABLE READ, READ ONLY transaction per request reads the state row first and
returns `revision` (I5). The builder tries, in that one snapshot:

1. **index path** when a predicate or the sort is index-served (table below);
2. otherwise **walk** `idx_csc_keyset` for at most 20,000 examined rows [U] (default sort
   only);
3. otherwise **collect** site matches up to 100,000 and sort them by their counter rows;
4. otherwise **scan**: hash join of both tables with a top-N sort.

There is no continuation across requests and no "exact prefix" claim: a response is the
complete page at its revision, or an error at the statement timeout.

Cost classes at 6 M sites: **I** index-served, O(page) or O(matches ≤ 100,000), under
0.3 s [U]; **C** one scan of the counter, 0.3–0.5 s [U]; **S** one scan of the site table,
0.4–0.8 s [U]; **J** join scan, 2–4 s [U]. Today's equivalents on the single wide table:
I where an index exists, otherwise one scan of about 0.6–1.0 s [D from 89 ms per 847,000
rows] or a walk of the keyset index.

**`column_filters`: 13 columns × 10 operators** (`=`, `!=`, `<`, `>`, `<=`, `>=`, `in`,
`like` = `ILIKE '%v%'`, `is_null`, `is_not_null`). Page with the default sort / count:

| Columns | `=`, `in` | ranges | `!=`, `is_null`, `is_not_null` | `like` |
|---|---|---|---|---|
| `carrier_count`, `het_count`, `hom_count`, `cohort_frequency`, `gnomad_af`, `pos`, `chr` (all on the counter) | walk / C | walk / C | walk / C | walk / C (text cast, as today) |
| `gene_symbol`, `consequence`, `func`, `clinvar` | I / I | n/a for text; as `!=` | walk-or-collect / S | I by trigram for gene and consequence [U]; S for func, clinvar |
| `cadd_phred`, `transcript` | walk-or-collect / S | walk-or-collect / S | walk-or-collect / S | walk-or-collect / S |

Dedicated parameters: `gnomad_af_max`, `carrier_count_min`, build, variant type: counter,
walk / C. Impact HIGH and ClinVar rank ≥ 13: I through the partial indexes. `cadd_min`: as
`cadd_phred`. Starred, comment, ACMG: I from `cohort_site_flags`. Search: `chr:pos` I;
text I by trigram [U], else S. Panel intervals: I. Extension filters (`sv.*`, `cnv.*`,
`str.*`): `EXISTS` per candidate row inside the row's build, as on the #469 branch,
unchanged. **Default `genome_build` filter** (the renderer always sends one): unfiltered
totals are O(1) from `cohort_site_tally`; `variant_type = 'snv'` sums `snv` and `indel`.

**Sorts, both directions** (unknown and NULL ranks last in both, as #469 defines):

| Sort | Ascending | Descending |
|---|---|---|
| `carrier_count` | C (top-N; today an index prefix with a 3 M-row tie group) | I, keyset |
| `het_count`, `hom_count`, `cohort_frequency`, `pos` | C | C |
| `chr` | I (site genomic index) | S (mixed directions: rank and chr descending, position ascending; a scan today too) |
| `clinvar` | I (rank index, backward) | I |
| `gene_symbol`, `cdna`, `aa_change`, `consequence`, `func`, `gnomad_af`, `cadd_phred`, `transcript` | S on `live` rows, page rows joined | S |

Any sort other than the default combined with a filter on the *other* table is **J**.

Export: one statement copies the matching rows into a session temporary table, then
streams (the snapshot is held for the copy only). Carriers, tiles, overview, gene burden:
unchanged sources. Cohort column metadata: cached with its revision, recomputed on request
at most every 30 s while the revision moves and once when it rests; never per fold.

**Totals.** Contract change: `total_count: number | null` with `total_pending: boolean`.
Totals of class I or from the tally come with the page; others are `null`, pending, and
`cohort:count` returns `{ total_count, revision }`. The renderer shows "counting…", never
0, and discards a count whose revision differs from the page's.

### 7.2 Slower than today: needs the owner's sign-off

The plan says no filter may get slower. These do:

| Read | Today | New | Why |
|---|---|---|---|
| Default-sort page with a non-indexable filter on a site-only column (`cadd`, `transcript`, `!=`, null tests, some `like`) whose 50th match lies beyond 20,000 walked rows | walk on one table, about 1 µs per row | collect (S, 0.4–0.8 s) or J | the predicate and the order are in two tables |
| A non-default sort combined with a filter on the other table; counts with predicates on both tables | one scan, 0.6–1.0 s | J, 2–4 s | join |
| Case view with `max_internal_af` set: 60,000-row case | 60,000 probes of `variant_frequency`, about 0.1 s [U] | 60,000 index-only probes of `cohort_site_key` + 60,000 counter probes, about 0.2–0.25 s [U] | two structures; the clean fix is a site id on the per-sample row (out of scope) |

(The count query of the case view stops joining the frequency when no frequency predicate
is set, which is faster than today.) Possible remedies if sign-off is refused: a `cadd`
copy on the counter (8 B per row), further partial keyset indexes, or keeping
`variant_frequency` maintained (one more counter write per carrier, 0.2 s / 15 MB per case
[M]).

### 7.3 Revision, cursor v2, long alleles (PR 2, on the legacy structures first)

- **Revision**: `cohort_summary_state.revision`, +1 in every transaction that changes
  what a cohort read can return.
- **Cursor v2** `{v:2, s, r, k}`: scope hash, the revision of the list's first page, the
  resume key. The server holds no snapshot between requests (a snapshot held for a minute
  at 2 cases/s keeps 6.5 M dead counter rows). It accepts an older `r`, answers from
  current data and returns `revision` and `baseRevision`. Renderer policy: at the top
  (first page only, not scrolled) refetch on a revision change, at most every 5 s; deep,
  keep loaded pages, append by keyset, de-duplicate by site key, show "cohort changed,
  reload", and label the total with its base revision. The gap is stated to the user: a
  deep list assembled across revisions can miss a variant until reload.
- **Long alleles.** A B-tree tuple above 2,704 B is refused. Inventory of everything that
  holds full alleles:

| Object | Fix | Where |
|---|---|---|
| `idx_cvs_carrier_keyset`, `idx_cvs_chr_rank` (legacy), `idx_csc_keyset*`, the site genomic index | terms use `substr(ref,1,64), substr(alt,1,64)`; the order appends `ref, alt` as trailing terms, resolved by incremental sort and by rechecking the row-value seek [U: EXPLAIN in PR 2]; SQLite indexes all terms | 0026; `cohortKeysetTerms`, `chromosome-order.ts` |
| `cohort_variant_summary` primary key, `cohort_gene_variant_summary` primary key (legacy) | not fixed: they go away with the legacy tables; in legacy mode a long allele still makes the summary stale, as today | – |
| new structures | keyed by `coord_hash`; no full allele in any unique key | 0027 |
| `variants_coords (chr, pos, ref, alt)` on `variants_all`; `variant_annotations` `UNIQUE (chr, pos, ref, alt)` and its index | **out of scope** (per-sample table; annotation key). A long allele fails there first, at row writing or at the first annotation. | plan item P4 |

  The claim is therefore scoped: after this work the *cohort* structures accept any allele;
  the import as a whole does not until `variants_coords` is replaced by the existing
  `coord_hash` index.

## 8. Operating budget (all settings derived, none varied in a run)

| Per case | WAL | Source |
|---|---|---|
| per-sample rows, 12 + 4 indexes | 192 MB | [M] A1 |
| cohort structures (fold, new sites, pairs) | 35–50 MB | [D] from 28 MB fold [M], 45–60 MB with staging [M]; no logged staging now |
| **total** | **about 230–240 MB** | 230 MB/s at 1 case/s, 460 MB/s at 2 |

That is beyond any reasonable budget at 2 cases/s, and what bounds it is not this design:
the worker count (four workers reach about 1 case/s); `wal_compression = lz4` (most of the
192 MB is full-page images after checkpoints); and fewer indexes on the fact (52 MB with
the five-index set [M], plan item P4). Recommended for a bulk import: `max_wal_size =
64GB`, `checkpoint_timeout = 15min`, `wal_compression = lz4`; archiving must carry about
250 MB/s at 1 case/s until P4 lands.

- **Vacuum.** 54,000 dead counter rows per case. Table settings of 3.2 and
  `autovacuum_naptime = 10s`.
- **Horizon.** `xmin` is database-wide: a `pg_dump`, a long export, or a rebuild chunk in
  *another* schema pins it. Before each fold the worker reads the age of the oldest
  snapshot in the database; above 5 minutes the batch throttles to one slot and reports
  "cleanup delayed by a long-running read"; it does not stop.
- **Memory.** Hot set at 6 M sites about 2.5 GB (counter and its indexes, the site key
  index, most of the site heap, now read under the lock): `shared_buffers >= 4GB`.
- **What pages an operator** (error log and admin status): a quarantined op; an audit
  difference; a fold above 5 s; lock wait above 60 s; the oldest snapshot above 15 minutes
  during an import; the counter's dead rows above 3× live.

## 9. SQLite counterpart (nothing here is measured)

One writer at a time, no row versions: an update rewrites the row in place and only the
indexes whose columns changed. Today a publication rewrites the wide summary row and four
indexes containing `carrier_count`; the session drops the three `variants_fts` triggers and
up to ten read indexes while cases become visible (C6), and may publish a case with a stale
summary.

- **Model**: the same tables and rules (sites keyed by `UNIQUE (chr, pos, ref, alt,
  variant_type, genome_build)`, no digest function; no array type anywhere; no ops, no
  fence, no slots). Shared SQL in `src/shared/sql/` with the dialect as a parameter:
  `cohort-representative.ts`, a new `cohort-case-delta.ts` and `cohort-site-rebuild.ts`.
  The fold statements F1–F5 are the same text apart from upsert spelling.
- **Fold**: the import worker, inline, one `BEGIN IMMEDIATE` per file after its last row
  batch, with the delta in `TEMP` tables; the case becomes ready in it. `rebuildIsCheaper`
  ("publish stale, rebuild later") and the `import_session_open` marker are removed.
- **Full-text search.** The triggers are **never dropped**, so there is nothing to restore
  after a crash. All three on `variants`, and the three each on `variant_sv` and
  `variant_str`, get `WHEN (SELECT import_status FROM cases WHERE id = <row>.case_id) =
  'ready'`: rows of a provisional case are not indexed on insert, and deleting them
  (cleanup, recovery) issues no FTS delete for rows that were never indexed. The publishing
  transaction indexes the case's rows in bulk (`INSERT INTO variants_fts(rowid, ...) SELECT
  ... WHERE case_id = ?`, likewise the two extension tables) before it sets `ready`. The
  full FTS rebuild at session end goes; `optimize` is linear in the index and is no longer
  run per session, only FTS5's automatic merges and an explicit maintenance action.
- **Read indexes** on `variants` are never dropped once a ready case exists.
- **Five writer connections** (import worker, delete worker, rebuild worker, write worker,
  main): all serialise on the file lock. The publishing transaction must stay under the
  smallest busy timeout: gate ≤ 2 s; the timeouts of the other four are raised to 30 s
  (the write worker already uses 60 s); `SQLITE_BUSY` after that is a retryable error to
  the user, not a silent drop.
- **Edits** stay inline in the write worker's transaction; the six v14 flag triggers are
  retargeted to `cohort_site_flags`.
- **Reads**: the same four-step builder; a join is a rowid lookup, there is no parallel
  scan, so class J is a nested loop over one table's scan. Pool workers key their
  column-metadata cache by `revision`, read in the read transaction (C7).
- **Migration**: schema 42 (41 is #469) creates the tables empty. `needsStartupRebuild`
  gains the condition "new tables empty and variants exist", which is true for every
  populated database after the upgrade although the old summary is populated; the rebuild
  worker fills them in chunks. No runtime switch: SQLite ships one release after PostgreSQL
  has run `staged` as the default.
- **Gates**: batch seconds per file on an encrypted database at 100 and 1,000 cases not
  above today's with indexes kept; search, extension search and every read index current at
  each `ready`; publish transaction ≤ 2 s.

## 10. Implementation plan

### 10.1 Pull requests

| PR | Content | Deterministic tests, written first |
|---|---|---|
| 1 | Lease fence with advisory locks (5.2); recovery at server start | T1: coordinator killed while a worker is between batches, inside site resolution, and blocked on the fence; no worker commit after recovery starts; pid reuse faked |
| 2 | Migration 0026: `revision`; reads in one snapshot; cursor v2; keyset terms and indexes of 7.3, both backends; `total_count` contract | T2: a publication forced between the statements of one read; T3: cursor across a revision returns `baseRevision`; T4: a 5 kB allele pages in order on both backends and EXPLAIN shows the index seek; preload contract |
| 3 | Migration 0027; chunked build and cut-over; audit; readers on the split tables behind the mode | T5: build equals the #469 summary, `variant_frequency` and gene tables projected to the legacy shape (schema-diff harness), GIAB and a 100-sample import; T6: every cell of 7.1 returns the same rows on both builders; T7: edit and op during a chunk, before and behind the watermark; T8: restart mid-build |
| 4 | Importer-side fold under the blocking lock; removal; synchronous edits with the op fallback; `staged` opt-in | T9: **A/X/B**: A ready with CADD 20; X (25) and B (20) both resolve their sites, then X folds, then B: stored 25, `cadd_holders` 1, three carriers; remove X: 20, holders 2, no holder row left; T10: the same per kind, and transcript from one carrier with ClinVar from another; T11: site collected or counter row removed between resolution and fold: the assert fires or the site is new, never a ready case with a missing row; T12: crash after each of F1–F10 and after COMMIT; T13: edit under the lock, edit timing out into an op, op failing into quarantine; T14: every wait of 5.3 at its bound; T15: seeded random sequences of add, delete, overwrite, switch, edit at 1 and 4 importers end with maintained = rebuilt |
| 5 | SQLite (section 9), schema 42 | T15 on SQLite with SQLCipher; search current at each `ready`; crash during a file leaves no FTS rows of it; C7 |
| 6 | `staged` default; later: drop legacy | upgrade and rollback end to end on a 100-sample schema |

A barrier is a test seam (`await barriers.at(name)`); across connections an advisory lock
the test holds; a crash is `pg_terminate_backend` at the barrier.

### 10.2 K1e: the gate before PR 4

Real spectrum (annotated exomes, not the simulator's 6,000 private sites), a schema of
about 6 M sites, the final DDL, four real workers writing rows throughout. Timed per case
from its last row batch to `ready`, and separately the time under the lock and its WAL.
Included in the timing: the full prepare (aggregate 304 ms, column metadata 187 ms today,
site resolution, delta) and every fold step F1–F10.

| Arm | What |
|---|---|
| 1 | today's publication (#469 branch) |
| 2 | the importer-side fold under the blocking lock, three slots |
| 3 | arm 2 on a cohort where every shared site has a holder row (one fact missing in half the files) |

Pass: serial work under the lock ≤ 0.6 s per case in arms 2 and 3; end to end not slower
than arm 1 at any cohort size measured (20, 100, 1,000 cases); alternating pairs, three per
size. Also reported, not gated: lock wait p95, WAL by relation, dead-row ratio after 1,000
cases, cohort page p95 alongside.

## 11. Exactness invariants

| # | Invariant | Mechanism | Test |
|---|---|---|---|
| I1 | ready ⇒ counted; counted ⇒ ready, or hidden by the transaction that subtracted | the fold counts and sets `ready` in one transaction; removal subtracts and hides in one; all under one lock | T12, T15 |
| I2 | maintained = rebuilt after any sequence, once no op is pending | agreement evaluated under the lock; idempotent ops; chunked rebuild as the oracle | T15, T5 |
| I3 | the #469 rule for both kinds on every path, including removal of the only holder | 4.2, 4.3 | T9, T10 |
| I4 | flags after deleting a case that held a per-case star | source counts recomputed excluding the case | star, delete: no flag row; with a global star: 1 |
| I5 | count, page and totals of one response are one snapshot | 7.1; `revision` in responses and cursors | T2, T3 |
| I6 | internal frequency as today | 3.4 | every coordinate against `variant_frequency`, two builds, one coordinate under two types |
| I7 | a ready case is never missing a row | asserts after F1 and F3; collection only under the import lock | T11 |

## 12. Open: unresolved review points and unmeasured assumptions

1. **Not resolved**: reads slower than today (7.2; sign-off or a named remedy); long alleles
   outside the cohort structures (7.3; plan item P4); rollback of a large workspace, hours
   without imports (6.2); WAL including row writing at 2 cases/s (section 8).
2. **Unmeasured**: the fold on the 90 B row with the site rows read under the lock; the
   holder cases of 3.3; removal; the fallback op for a large gene (0.3–0.5 s estimated at
   10,000 cases); the trigram index; the walk budget; every cost class of 7.1; vacuum over
   thousands of cases; everything in section 9. K1e covers the first three.
3. **Assumed, to be confirmed by a test before the design relies on it**: `lock_timeout`
   applies to advisory lock waits and they are granted in arrival order (PR 4); a row-value
   seek uses the leading index columns and rechecks the rest (PR 2).
4. **Departures from the review decision, with reasons**: the per-site recheck log is cut
   (with agreement evaluated under the lock no prepared bit can be stale; `site_epoch`
   stays); delete does not use the op fallback (hiding and subtracting must stay one
   transaction); PR 2 needs DDL, so it carries 0026 and the split structures are 0027.
5. **Scale**: 3–9 M sites at 10,000 exomes is derived from two published totals; the design
   is sized for about 6 M. **#469 is still moving**: this depends on its predicates, the
   two rank columns, and the constants 4 and 13 in the partial-index predicates.
