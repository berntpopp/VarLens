# K1d: pre-aggregated staged deltas, backpressure, fold cap; and how many sites to plan for

## Correction to `K1b-opt-and-K1c.md`

The K1c runs were made one after the other on the same tables with autovacuum switched
off on them, so each rate started on a counter table already carrying the dead rows of
the previous runs (about 54,000 updated rows per folded case). The 1 case/s rows are
clean; the higher rates in K1c were measured on increasingly bloated tables and overstate
the queue age. The runs below marked "fresh table" rebuild the 6.2 M-site schema before
every run and leave autovacuum on.

## K1d (run)

Change against K1c: each producer commits its case's **pre-aggregated** per-site delta
(site, carriers, het, hom) and per-gene delta into logged staging tables keyed by case,
plus its representative rows for new sites, then enqueues the case. The folder only sums
the staged deltas of the cases it takes, upserts the counters (`RETURNING` the new
sites), updates gene counters and the unique-variant counter, and marks the cases ready.
Reader as before. 200 cases per run, 6,000 private sites per sample, 6.2 M sites. Queue
age = ready − enqueued, ms. "In-flight cap" is the backpressure: a producer starts a case
only while fewer than that many cases are started and not yet ready.

**Fresh table per run, autovacuum on** (one run each; host load in the last column)

| Rate | In-flight cap | Fold cap | Achieved | Age p50 | p95 | max | Fold K p50 / max | Fold ms p50 / p95 | WAL MB/s | Reader p50 / p95 | Producer ms p50 | Producer wait s | Load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 16 | none | 1.00 | 413 | 513 | 1,388 | 1 / 1 | 405 / 506 | 45 | 1.3 / 2.1 | 285 | 0 | 6.5 |
| 1.5 | 16 | none | 1.50 | 474 | 1,800 | 3,378 | 1 / 5 | 465 / 864 | 67 | 1.7 / 29.7 | 346 | 0 | 10.9 |
| 2 | 16 | none | 1.99 | 1,146 | 3,190 | 6,847 | 1 / 11 | 551 / 1,552 | 85 | 1.8 / 139 | 360 | 0 | 10.0 |
| 2 | 16 | 4 | 1.99 | 892 | 2,334 | 3,010 | 1 / 4 | 476 / 1,418 | 91 | 1.5 / 70 | 333 | 0 | 6.7 |
| 2 | 3 | none | 1.99 | 810 | 1,316 | 2,253 | 1 / 2 | 529 / 951 | 90 | 1.6 / 39 | 374 | 27 | 9.0 |

**Repeats** (fresh table per run, autovacuum on; in-flight cap 3 unless stated)

| Rate asked | In-flight cap | Achieved | Age p50 | p95 | max | Fold K p50 / max | Fold ms p50 / p95 | WAL MB/s | Reader p50 / p95 | Producer wait s | Load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 3 | 1.97 | 905 | 1,428 | 2,689 | 1 / 2 | 675 / 1,234 | 90 | 1.6 / 83 | 82 | 8.3 |
| 2 | 3 | 1.96 | 847 | 1,309 | 2,402 | 1 / 2 | 525 / 948 | 92 | 1.9 / 42 | 30 | 11.5 |
| 2.5 | 3 | 2.05 | 896 | 1,342 | 5,445 | 1 / 2 | 670 / 1,145 | 93 | 1.7 / 33 | 82 | 12.5 |
| 2.5 | 16 | 2.47 | 1,433 | 4,184 | 5,346 | 2 / 8 | 783 / 2,238 | 99 | 1.7 / 59 | 0 | 9.3 |

With at most three cases in flight, 2 cases/s held the gate at p95 in all three runs
(1,316, 1,428 and 1,309 ms; maxima 2.3–2.7 s). Asked for 2.5 cases/s, the same limit
delivers 2.05 cases/s with a p95 of 1.3 s: the limit is the backpressure, and about
2 cases/s is what this setup sustains. Without the limit 2.5 cases/s fails (p95 4.2 s).

**Same table reused, autovacuum off** (the first series, kept for the record; later rows
are affected by bloat as described above)

| Rate | In-flight cap | Fold cap | Achieved | Age p50 | p95 | max | Fold K p50 / max |
|---|---|---|---|---|---|---|---|
| 1 | 16 | none | 1.00 | 445 | 5,754 | 8,494 | 1 / 7 |
| 1.5 | 16 | none | 1.49 | 550 | 1,703 | 2,640 | 1 / 3 |
| 2 | 16 | none | 1.92 | 1,529 | 4,530 | 6,628 | 2 / 9 |
| 2.5 | 16 | none | 2.42 | 3,903 | 6,695 | 7,764 | 6 / 11 |
| 2 | 16 | 4 | 1.97 | 2,876 | 5,959 | 8,835 | 4 / 4 |
| 2.5 | 4 | none | 1.28 | 1,751 | 4,781 | 7,412 | 2 / 2 |

Verdict against the gate (queue age ≤ 2 s sustained), on the fresh-table runs:

- **1 case/s: PASS** (p95 0.5 s).
- **1.5 cases/s: PASS at p95** (1.8 s; one case waited 3.4 s).
- **2 cases/s without limits: KILL** (p95 3.2 s).
- **2 cases/s with at most three cases in flight: PASS, three runs** (see the repeats above; first run: (p95 1.3 s, max
  2.3 s, throughput unchanged at 1.99 cases/s; producers waited 27 s in total before
  starting)). Limiting how many importers prepare at once helped more than capping the
  fold size (p95 2.3 s). Host load moved between 6.5 and 12.5 across these runs.

Compared with K1c on a clean table there is only the 1 case/s row (p95 864 ms there, 513
here), so how much of the improvement at 2 cases/s comes from pre-aggregation and how
much from the clean table is not separated.

Not run: the 60 M-site table at 1.5 and 2 cases/s with this variant; today's
`incrementalAdd` as an alternating control on a real imported 100-sample schema (the
only control remains 1,714 ms summary upsert + 503 ms variant frequency per case under
the lock at 20 samples, from `K1b-full-fold.md`).

## How many distinct sites at 10,000 exomes

Published figures:

| Data set | Exomes | Variant sites | Note |
|---|---|---|---|
| ExAC (Lek et al., Nature 2016) | 60,706 | 7,404,909 high-quality variants | one variant per 8 bp of the exome intervals; 54% singletons |
| gnomAD v2.1 exomes (release notes) | 125,748 | about 16 M SNVs + 1.2 M indels | |

The two are not on one curve (different filtering; 17.2 M / 7.4 M is more than the ratio
of the sample counts), and no sites-versus-N table was retrieved, so the range below is
derived, not quoted: scaling each figure to 10,000 exomes with S ∝ N^a for a between 0.7
and 0.9 (sub-linear, singleton-dominated) gives 1.5–2.1 M from ExAC and 1.8–2.9 M from
gnomAD, inside the exome intervals. Our simulated files carry 60,000 calls per sample,
two to three times what falls inside exome intervals, which suggests **3–9 million
distinct sites at 10,000 exomes** for files of that width. The growth at that point,
dS/dN ≈ a·S/N, is 100–250 new sites per added exome inside the intervals, a few hundred
to about 700 for the wider files.

Consequences:

- judge the fold gates at the **6 M-site** table; 60 M is an order of magnitude too
  large;
- the simulator's 6,000 private sites per sample (`--shared-fraction 0.9`) is about ten
  times too many. `--shared-fraction 0.99` (600 private per sample) with a shared pool of
  a few million sites and a spectrum skewed to rare variants would reproduce the range.
  Nothing was regenerated.

Sources: https://www.nature.com/articles/nature19057 (ExAC),
https://gnomad.broadinstitute.org/news/2018-10-gnomad-v2-1 (gnomAD v2.1).

## What a production PostgreSQL needs at 10,000 exomes (derived from the sizes measured)

At about 6 M sites the counter table is 0.31 GB with 0.32 GB of indexes and the
representative table 0.65 GB with 0.95 GB of indexes, so the cohort structures fit in a
2 GB `shared_buffers` with room to spare; at 60 M sites they were 6.1 GB and 11.9 GB and
would need about 8 GB of buffers for the counters alone. The larger cost is WAL: the
cohort structures alone (staged deltas, counters, representative rows, gene counters)
wrote 45 MB per case at 1 case/s and 45–60 MB per case at 1.5–2 cases/s, that is
45–90 MB/s, before the per-sample variant rows (26–164 MB per case depending on the
index set, `A1-index-attribution.md`). With `max_wal_size` 8 GB that is a forced
checkpoint every 1.5–3 minutes and roughly 0.5–1 TB of WAL for 10,000 cases; archiving
or replication has to carry that rate. None of these settings were varied in a run.
