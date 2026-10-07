# Import-scale experiments: screening results (2026-10-07)

Experiment ids follow `.planning/plans/2026-10-07-import-scale-experiments-and-routes.md`
(plan worktree). **These are screening runs, not protocol runs.** Deviations from section 3
of the plan, the same for every table here:

- one schema: 100 simulated exomes (6,000,000 variant rows) plus the GIAB trio, PostgreSQL
  18 dev container, legacy tables and the normalised tables of this branch side by side
  (converted in place, 103 cases in 321 s);
- reads: best of three warm runs, one 60,000-variant case (case 50), no parallel workers,
  `EXPLAIN (ANALYZE, TIMING OFF)` execution time; not median/p95 of ten, no cold runs, no
  extension-column or tag/star/ACMG rows, per-case only;
- writes: `INSERT ... SELECT` of one case's 60,000 rows (and its 60,000 transcript rows)
  into the 100-exome table inside a transaction that is rolled back, three alternating
  rounds, median; WAL from `pg_current_wal_insert_lsn()` (other sessions on the container
  add noise); not a COPY through the importer and not at samples 1–5 / 16–20;
- machine: shared host, 1-minute load 4–6, 29–31 GB available during the runs.

Verdicts are therefore PASS/KILL only where the margin is far larger than this noise;
otherwise INCONCLUSIVE.

Revision 3 of the plan renamed the experiments: A1 is now P4/X2, A2 the search part of
the target, B1/B2 are X1 (dropped: per-sample rows win), B4 is X3. File names keep the
ids they were measured under.

| File | Experiment | Verdict |
|---|---|---|
| `A1-index-attribution.md` | A1: which indexes and generated columns cost what | PASS (screening): 5 indexes 1.1 s vs 2.4 s; protocol run needed |
| `A2-search-on-deduplicated-table.md` | A2: search on a deduplicated table | PASS (screening) |
| `B1-B2-filters-on-variant-table.md` | B1/B2: filters on a deduplicated variant table, prefilter on the fact | B1 KILL; B2 INCONCLUSIVE |
| `K1-fold-scaling.md` | K1: fold of K cases into a narrow counter table, 0.8 M / 6 M / 60 M rows | INCONCLUSIVE, leaning PASS for the counters; rest of the fold not measured |
| `K1b-full-fold.md` | K1b: counters + representative rows + gene counters + second counter, 6 M / 60 M sites | PASS at 1 case/s (0.70–0.77 s warm); KILL at 2.5 and 5 cases/s (derived); cold first pass 3.5 s |
| `K1b-opt-and-K1c.md` | Leaner fold (one counter table, representative rows by the importer), sustained-arrival runs, base-plus-delta | Fold 0.43–0.49 s per case; sustained: PASS at 1 case/s, PASS at 1.5 at 6.2 M sites only, KILL at 2 and 2.5; base-plus-delta read KILL as formulated |
| `K1d-staged-deltas-and-site-estimate.md` | Staged pre-aggregated deltas, backpressure, fold cap; correction to K1c; distinct-site estimate with sources; production sizing | PASS at 1 and 1.5 cases/s; 2 cases/s KILL unlimited, PASS in one run with three cases in flight |
| `B4-subcohort-aggregation.md` | B4: on-demand sub-cohort aggregation | KILL for row scans; bitmaps not available |

Not run: K2, P2, P3, P5 (old A3–A7), B3, the cohort read matrix, the 10,000-sample
read-scale schema, the sustained-arrival run, GIAB/VEP repetitions, WGS.
