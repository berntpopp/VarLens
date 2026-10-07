# Import-scale experiments: summary (2026-10-07)

One page over the artefacts in this folder. Every number has its method and caveats in the
file named in the last column; `README.md` lists how the screening runs deviate from the
plan's protocol. PostgreSQL 18 dev container, `shared_buffers` 2 GB, shared host.

## Every experiment, with verdict

| Id (old id) | Question | Result | Verdict | File |
|---|---|---|---|---|
| P4 / X2 (A1) | What do the indexes and generated columns cost on row writing? | 60,000 rows into a 6 M-row `variants_all`: 2,410 ms / 164 MB WAL with 12 indexes, 1,599 ms without the two GIN indexes, 1,107 ms / 52 MB with five, 618 ms with the primary key only | PASS at screening level; the five-index set is **not** a safe set (it drops indexes that serve reads) | `A1-index-attribution.md` |
| (A2) | Search on a deduplicated table | Unselective term 225 ms against 461 ms legacy; selective term 6 ms against 1 ms | PASS for the unselective case | `A2-search-on-deduplicated-table.md` |
| X1 (B1/B2) | Filters on a deduplicated variant table joined to a case's calls | Best forced plan 1.5× to 33× legacy; a column not on the per-sample row costs about 130 ms per exome | KILL: per-sample rows with every filter column win | `B1-B2-filters-on-variant-table.md` |
| X3 (B4) | Sub-cohort counts from rows on demand | About 57 ms per case; 5.7 s for 100 cases | KILL; `pg_roaringbitmap` not available, id arrays not tried | `B4-subcohort-aggregation.md` |
| K1 | Fold of K cases into a narrow counter table | 0.20–0.30 s for one case, 1.3–2.3 s for 32, at 0.8 M to 60 M rows | counters are not the expensive part | `K1-fold-scaling.md` |
| K1b | The rest of the fold | Full fold 0.70–0.77 s for one case warm; 3.5 s directly after a build because of the representative table's indexes | PASS at 1 case/s only | `K1b-full-fold.md` |
| K1b-opt | One counter table; representative rows by the importer; no `RETURNING` | 0.43–0.49 s and 28 MB WAL per single-case fold; cold penalty gone; anti-join slower than `RETURNING` | (a) + (b) adopted | `K1b-opt-and-K1c.md` |
| K1c | Sustained arrival, folder aggregates calls | PASS at 1 case/s; higher rates were run on bloated tables | superseded by K1d | `K1b-opt-and-K1c.md` |
| A5 | Base plus unmerged deltas | Append 77 ms / 7.8 MB; exact default page 2.1 / 4.4 / 6.6 s with a backlog of 10 / 50 / 200 cases | KILL as formulated | `K1b-opt-and-K1c.md` |
| K1d | Sustained arrival with staged pre-aggregated deltas, 6.2 M sites | Queue age p95 0.5 s at 1 case/s, 1.8 s at 1.5, 3.2 s at 2 unlimited; 1.3–1.4 s at 2 cases/s with at most three cases in flight (three runs); that limit sustains about 2 cases/s | PASS at 1, 1.5 and, with the limit, 2 cases/s | `K1d-staged-deltas-and-site-estimate.md` |

Not run: K2 (id resolution), P2, P3 at read scale, P5, the safe index set with every
reader named, anything on the GIAB/VEP data beyond the representative-change count, WGS,
the alternating control pair on a real schema.

## Before and after for the chosen design

Chosen: per-sample rows keep every filter column; cohort counts in one narrow counter
table; each importer stages its pre-aggregated per-site and per-gene deltas and writes
representative rows for new sites; one folder merges staged deltas and marks cases ready;
a limit on concurrent preparation.

| | Today | Chosen design | How comparable |
|---|---|---|---|
| Serial work per case under the lock | 1,714 ms summary upsert + 503 ms variant frequency (samples 16–20, real import on `main`); 3.9 s summary upsert at samples 81–100 on an earlier base | 405–675 ms per single-case fold at 6.2 M sites | **not a like-for-like pair**: today's figure is the real worker on real tables at 20 samples, the new one a synthetic schema and driver |
| WAL per case for cohort structures | not measured | 28 MB in the fold; 45–60 MB including staging and representative rows | new side only |
| Queue age p95 at 1 / 1.5 / 2 cases/s | not applicable (serial publication) | 0.5 s / 1.8 s / 1.3–1.4 s (the last with three cases in flight) | new side only |
| Cohort default page while folding | not measured | p95 2–83 ms | new side only |

The clean alternating before/after pair on one real 100-sample schema, through the real
worker path and with a 4-worker 100-file batch, has not been produced. It needs the
staged-delta fold implemented in the import worker, which was not done here.

## Derived, not measured

- Arrival-rate tables in `K1-fold-scaling.md` and `K1b-full-fold.md` (capacity computed
  from fold times). K1c and K1d are runs.
- Distinct sites at 10,000 exomes (3–9 million for files as wide as the simulated ones):
  scaled from the published ExAC and gnomAD v2.1 totals with an assumed exponent; no
  sites-versus-N curve was retrieved.
- Buffer and WAL needs at 10,000 exomes: from relation sizes and WAL per case; no setting
  was varied.
- That one counter table can serve `variant_frequency`: reasoning about the keys, nothing
  built.
- Storage and read projections for the normalised model at 10,000 exomes (spec section
  13.4).

## Open risks

- **No real-data fold.** Every fold number comes from a synthetic spectrum with 6,000
  private sites per sample, about ten times the realistic rate. Real VEP rows are wider
  (the simulator leaves cdna, aa_change, OMIM, MOI and INFO empty and has one transcript
  per variant), which raises row-writing cost and WAL and does not touch the counters.
- **Host noise.** Load 6–12, timing spread of tens of percent, occasional stalls of
  several seconds that look like checkpoints at 50–100 MB/s of WAL; maxima of the queue
  age exceed 2 s in most runs even where p95 holds.
- **The representative rule (#469)** as now decided (most severe carrier row by rank,
  variant-level facts aggregated over carriers) is not modelled. What was measured is the
  old per-column maximum: 3–13 of 60,000 known sites change per case on the simulated
  cohort, 0 on the GIAB trio.
- **Visibility.** A representative row exists before its counts; reads must start from
  the counter table. Not exercised by any test.
- **Deletes and flags.** Case removal from the counters and removal of a starred case
  were not run.
- **Simulator.** `scripts/simulate-variants.ts` has `--shared-fraction` but no option for
  the size of the shared pool or its spectrum (`sharedPoolSizeFor` derives the pool), so
  the corrected cohort cannot be generated from the command line as it stands.
- **The normalised-model branch** (migration 0025, staged writer, conversion job, pending
  0026 with three known hazards) is unmerged and not part of the chosen design; its
  schema-diff harness is independent of the storage model and is the equivalence gate to
  keep.
