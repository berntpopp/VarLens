# K1b-opt and K1c: a leaner fold, and the sustained-arrival runs

Same synthetic spectrum as `K1b-full-fold.md` (234,783 shared sites at allele frequency
0.01–0.45; private sites per sample as stated). PostgreSQL 18 dev container,
`shared_buffers` 2 GB, shared host at load 6–10 with 28–31 GB available. Timing on this
host spreads by tens of percent and the 60 M-site runs show single outliers of 2–7 s; WAL
is the stable figure. Everything below was run unless a line says "derived" or "recalled".

## K1b-opt: fold variants (rolled back; ms / WAL MB)

Variants: **base** = two counter tables, representative rows inserted in the fold, counter
upsert with `RETURNING`; **(a)** one counter table; **(b)** representative rows for
brand-new sites written by the importer before the fold; **(c)** anti-join for new sites
instead of `RETURNING`.

**6.2 M sites** (one warm pass)

| Variant | K = 1 | K = 2 | K = 4 | K = 8 |
|---|---|---|---|---|
| base | 837 / 128 | 1,324 / 80 | 1,699 / 125 | 2,310 / 172 |
| (a) one counter table | 611 / 31 | 919 / 49 | 1,283 / 75 | 1,573 / 105 |
| (b) representative by importer | 611 / 43 | 931 / 70 | 1,315 / 104 | 1,835 / 140 |
| (c) anti-join, no `RETURNING` | 706 / 46 | 1,150 / 76 | 1,904 / 114 | 2,655 / 160 |
| (a) + (b) | 429 / 28 | 713 / 44 | 853 / 64 | 1,208 / 85 |
| (a) + (b) + flags as reference counts | 1,384 / 28 | 595 / 44 | 906 / 64 | 1,524 / 84 |
| importer step alone | 120 / 3 | 201 / 5 | 347 / 10 | 2,600 / 20 |

**60 M sites** (median of three passes; the first pass ran directly after the build)

| Variant | K = 1 | K = 2 | K = 4 | K = 8 | First (cold) pass, K = 1 / 8 |
|---|---|---|---|---|---|
| base | 2,130 / 93 | 1,742 / 80 | 5,008 / 251 | 4,211 / 373 | 3,343 / 7,736 |
| (a) | 621 / 31 | 996 / 49 | 1,446 / 76 | 2,307 / 106 | 529 / 2,307 |
| (b) | 660 / 43 | 1,116 / 70 | 1,640 / 104 | 2,289 / 140 | 655 / 2,289 |
| (c) | 1,216 / 45 | 1,615 / 77 | 2,244 / 114 | 3,491 / 160 | 1,351 / 3,491 |
| (a) + (b) | 486 / 28 | 866 / 44 | 1,043 / 64 | 1,842 / 85 | 467 / 1,651 |
| (a) + (b) + flags | 481 / 28 | 754 / 44 | 1,101 / 64 | 1,418 / 85 | 481 / 1,418 |
| importer step alone | 159 / 3 | 284 / 5 | 515 / 10 | 807 / 20 | 159 / 1,110 |

Findings:

- **(a) and (b) each help, (c) does not.** Combined they cut the single-case fold to
  0.43–0.49 s and its WAL from 46–128 MB to 28 MB. The anti-join is slower than
  `RETURNING` at every K.
- **The cold case is the representative table.** With representative rows out of the fold
  the first pass after the build is as fast as the warm ones (467 ms at K = 1). The fold
  then touches only `site_stats`, whose hot part is small: the 234,783 shared sites sit
  together at the start of the heap and of the primary key, and new private sites append
  at the right end of both indexes. What was cold before is the three secondary indexes
  of `site_repr` (4.3 GB at 60 M sites, 6.3 GB heap), into which 6,000 scattered rows per
  case are inserted. That cost moves to the importer (159 ms at K = 1 here).
- **Flags as reference counts** (a `star_refs` column on the counter row, about 13 flagged
  sites per case): no measurable cost. Removal of a case with a per-case star was not run.
- Relation sizes at 60 M sites: `site_stats` 3.0 GB heap + 1.3 GB primary key + 1.8 GB
  keyset index; `site_repr` 6.3 GB + 1.3 + 2.1 + 1.8 + 0.4 GB. With `shared_buffers` 2 GB
  the counter table alone does not fit; it worked here because the working set is the
  shared sites and the right edge. A deployment at this size would want the counter
  table and its two indexes in memory (about 6 GB); that figure is derived from the sizes,
  not tested.

One counter table and `variant_frequency` (not built, reasoning only): the frequency
table counts cases per `(chr, pos, ref, alt)`, the summary per that plus variant type and
genome build. A counter row keyed by the six-part key gives the four-part count as the
sum over the rows sharing the four parts, which is exact when a case has at most one row
per four-part coordinate, and differs when one case carries the same coordinate under two
types or when today's per-file increment counted a multi-file case twice (an existing
quirk). A second key column or a view over the one table covers the first; the second is
a behaviour change to decide separately.

Visibility with (b): a representative row exists before its counts do. The counter row
has to be the existence gate, so cohort reads must start from `site_stats` and join the
representative row, never the other way round; an import that fails leaves an unreferenced
representative row that the next carrier reuses.

## How many distinct sites at 10,000 exomes (recalled, not looked up)

The simulator adds 6,000 private sites per sample without end, which gives 60 M sites at
10,000 samples. Published exome aggregates are far smaller: ExAC reported on the order of
7–10 million variant sites for about 60,700 exomes and gnomAD v2 about 17 million for
about 125,700, roughly half of them singletons. That is some 100–150 new sites per added
exome at those sizes and a few hundred at 10,000, so 10,000 exomes of one capture design
should land at a few million distinct sites, not 60 million. These figures are from
memory and must be checked against the papers before they are relied on; wider calling
regions (flanks, off-target) raise them. On that basis the gate should be judged at the
6 M-site table, and the simulator's private rate is about ten times too high.

## K1c: sustained arrival (run)

Driver: producers start a case every 1/rate seconds on their own connections; each
generates its 60,000 calls into an unlogged table, writes its per-gene counts and its
representative rows for new sites, and enqueues the case in one transaction ("file
finished"). One folder takes the whole queue each round: counter upsert with `RETURNING`,
gene counters, unique-variant counter, case marked ready, commit. A reader issues the
cohort default page (counters joined to the representative row, carrier order, 100 rows)
every 500 ms. 200 cases per run. Queue age = ready − enqueued.

| Sites | Private / sample | Rate | Achieved | Age p50 | Age p95 | Age max | Fold K p50 / max | Fold ms p50 / p95 | WAL MB/s | Reader p50 / p95 ms | Gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 60 M | 6,000 | 1 | 0.98 | 463 | 1,255 | 3,826 | 1 / 4 | 454 / 882 | 49 | 1.4 / 7.1 | holds at p95 |
| 60 M | 6,000 | 1.5 | 1.49 | 770 | 3,470 | 4,331 | 1 / 6 | 529 / 1,955 | 61 | 1.7 / 112 | fails |
| 60 M | 6,000 | 2 | 1.98 | 1,830 | 6,448 | 8,792 | 2 / 14 | 970 / 2,330 | 68 | 1.9 / 187 | fails |
| 60 M | 6,000 | 2.5 | 2.40 | 5,128 | 10,608 | 12,836 | 9 / 18 | 3,708 / 7,311 | 65 | 1.7 / 1,111 | fails |
| 6.2 M | 6,000 | 1 | 1.00 | 494 | 864 | 1,606 | 1 / 1 | 490 / 820 | 63 | 1.3 / 7.0 | holds |
| 6.2 M | 6,000 | 1.5 | 1.49 | 766 | 1,919 | 2,497 | 1 / 2 | 605 / 1,248 | 79 | 1.6 / 8.4 | holds at p95 |
| 6.2 M | 6,000 | 2 | 1.93 | 4,765 | 11,429 | 15,082 | 5 / 19 | 2,501 / 4,951 | 79 | 1.7 / 135 | fails |
| 6.2 M | 6,000 | 2.5 | 2.31 | 7,767 | 13,163 | 17,071 | 9 / 23 | 4,057 / 9,425 | 102 | 1.6 / 292 | fails |
| 6.2 M | 500 | 2 | 1.98 | 4,371 | 12,884 | 15,362 | 1 / 18 | 786 / 6,258 | 103 | 1.6 / 61 | fails |
| 6.2 M | 500 | 2.5 | 2.47 | 4,329 | 7,750 | 9,654 | 4 / 14 | 1,436 / 5,485 | 30 | 1.5 / 37 | fails |

Verdict against the gate (queue age ≤ 2 s sustained):

- **1 case/s: PASS** at both sizes (p95 0.9–1.3 s; one 3.8 s outlier at 60 M sites).
- **1.5 cases/s: PASS at 6.2 M sites** (p95 1.9 s, at the limit), **fails at 60 M**.
- **2 and 2.5 cases/s: KILL** at both sizes, also with 500 private sites per sample.

Folds in the driver are slower than the rolled-back microbenchmark at the same K
(2.5 s for five cases against 0.9–1.0 s for four): the producers compete for the same
CPUs and the WAL stream (50–100 MB/s, which is one checkpoint's worth of `max_wal_size`
every 80–160 s), and the fold here also aggregates the queued cases' calls into the
delta. Once a fold exceeds the inter-arrival time the queue grows and the folds grow
with it. The system fell over between 1.5 and 2 cases/s; whether a quieter host or
pre-aggregated per-case deltas would move that point was not measured. Today's
`incrementalAdd` was not run as a control on these synthetic schemas (it needs the real
tables); the only control is the 2.2 s per case under the lock from `K1b-full-fold.md`.

## Base-plus-delta (run, one straightforward formulation)

On the 6.2 M-site schema, a case's delta appended to a logged log table with an index on
the batch id: **77 ms, 7.8 MB WAL** for 59,757 rows. That would make publication roughly
constant and small.

Exact cohort default page = counters plus unmerged deltas, written as "aggregate the
backlog, add it to the touched counter rows, take the top 100 of those and of the
untouched rows":

| Backlog | Default page |
|---|---|
| 0 (base only) | under 1 ms |
| 10 cases | 2,051–2,585 ms |
| 50 cases | 4,418 ms (one run 26 s) |
| 200 cases | 6,635–11,515 ms |

A first formulation with a correlated anti-join took 83 s at a backlog of 10. The filtered
page was not measured with the second formulation.

**KILL as formulated** (kill criterion: reads with a realistic backlog slower than 2×;
target page ≤ 300 ms). Every read re-aggregates the backlog's calls (600,000 rows for ten
cases). A design that keeps the backlog pre-aggregated per site, or bounds it to a few
cases, was not measured.
