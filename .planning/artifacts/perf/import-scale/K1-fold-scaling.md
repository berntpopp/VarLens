# K1 (partial): fold-scaling curve for a narrow counter table

**Counters only, synthetic, warm.** What was measured is one statement,
`INSERT ... SELECT ... FROM delta ORDER BY site_id ON CONFLICT (site_id) DO UPDATE SET
carrier_count = carrier_count + excluded...`, folding the aggregated delta of K cases into

    site_stats(site_id bigint PRIMARY KEY, carrier_count int, het_count int, hom_count int)
    + index ((-carrier_count), site_id)        -- the carrier keyset order

The table and the cases are synthesised set-based from the simulator's spectrum as given
in the plan: 234,783 shared sites with allele frequency uniform in 0.01–0.45, 6,000 private
sites per sample (60,076 calls per case, 54,076 of them at known sites). The delta is
built before the timed statement. Each fold runs in a transaction that is rolled back, so
every K starts from the same table. Minimum of two runs; WAL from
`pg_current_wal_insert_lsn()`; buffers from `EXPLAIN (ANALYZE, BUFFERS)`. Host load 2.7–4.2,
31–32 GB available. All table pages were in shared buffers (reads ≤ 1,560 of about a
million buffer touches), so this is the warm case only.

| Counter table | K | Fold ms | ms per case | Delta rows | Inserted | Updated | HOT | WAL MB | Shared buffers hit |
|---|---|---|---|---|---|---|---|---|---|
| 834,783 rows (100 samples, 85 MB) | 1 | 198 | 198 | 60,076 | 6,000 | 54,076 | 0 | 34.9 | 806,114 |
| | 2 | 368 | 184 | 103,856 | 12,000 | 91,856 | 0 | 34.5 | 1,496,475 |
| | 4 | 591 | 148 | 162,809 | 24,000 | 138,809 | 0 | 54.6 | 2,300,613 |
| | 8 | 786 | 98 | 229,038 | 48,000 | 181,038 | 0 | 75.9 | 3,186,099 |
| | 16 | 980 | 61 | 304,306 | 96,000 | 208,306 | 0 | 99.0 | 4,129,640 |
| | 32 | 1,295 | 40 | 415,186 | 192,000 | 223,186 | 0 | 130.7 | 5,434,739 |
| 6,234,783 rows (1,000 samples, 632 MB) | 1 | 204 | 204 | 60,076 | 6,000 | 54,076 | 0 | 35.0 | 806,109 |
| | 2 | 378 | 189 | 103,856 | 12,000 | 91,856 | 0 | 34.6 | 1,496,526 |
| | 4 | 623 | 156 | 162,809 | 24,000 | 138,809 | 0 | 54.3 | 2,300,925 |
| | 8 | 837 | 105 | 229,038 | 48,000 | 181,038 | 0 | 75.7 | 3,186,793 |
| | 16 | 1,160 | 72 | 304,306 | 96,000 | 208,306 | 0 | 98.1 | 4,129,404 |
| | 32 | 1,365 | 43 | 415,186 | 192,000 | 223,186 | 0 | 144.3 | 5,432,830 |
| 60,234,783 rows (10,000 samples, 6.1 GB) | 1 | 296 | 296 | 60,076 | 6,000 | 54,076 | 0 | 35.0 | 974,417 |
| | 2 | 504 | 252 | 103,856 | 12,000 | 91,856 | 0 | 34.5 | 1,808,031 |
| | 4 | 871 | 218 | 162,809 | 24,000 | 138,809 | 0 | 54.2 | 2,788,922 |
| | 8 | 1,278 | 160 | 229,038 | 48,000 | 181,038 | 0 | 76.0 | 3,873,815 |
| | 16 | 1,738 | 109 | 304,306 | 96,000 | 208,306 | 0 | 98.2 | 5,042,469 |
| | 32 | 2,260 | 71 | 415,186 | 192,000 | 223,186 | 0 | 128.6 | 6,678,506 |

WAL records were not captured (`pg_stat_wal` did not advance inside the measuring
transaction). The K = 1 WAL figure includes full-page images of the first run after the
table build.

Against the prediction (per-case counter cost 0.78 s at K = 1, 0.53 at 4, 0.37 at 8,
0.25 at 16, 0.17 at 32): measured 0.30 / 0.22 / 0.16 / 0.11 / 0.07 s at 60 million rows,
and 0.20 / 0.15 / 0.10 / 0.06 / 0.04 s at 0.8 million. The shape is as predicted (per-case
cost falls about fourfold from K = 1 to K = 32 because the union of touched sites
saturates at the shared set); the level is 2.5 times lower.

No update is heap-only: `carrier_count` is in the keyset index, so every changed counter
writes a new index entry in both indexes. WAL is about 0.6 kB per touched row at K = 1 and
0.3 kB at K = 32.

## Arrival rates (derived from the curve, not run)

A single folder drains K cases every T(K); it keeps up with arrival rate r when
K / T(K) ≥ r, and a case then waits at most about the fold in progress plus its own.

| Counter table | 1 case/s | 2.5 cases/s | 5 cases/s |
|---|---|---|---|
| 0.8 M rows | K = 1, T 0.20 s | K = 1, T 0.20 s | K = 2, T 0.37 s; age ≤ 0.8 s |
| 6.2 M rows | K = 1, T 0.20 s | K = 1, T 0.20 s | K = 2, T 0.38 s; age ≤ 0.8 s |
| 60 M rows | K = 1, T 0.30 s | K = 2, T 0.50 s; age ≤ 1.0 s | needs K = 8 (6.3 cases/s), T 1.28 s; age up to 2.6 s |

## Verdict

**INCONCLUSIVE, leaning PASS for the counter part.** For counters alone the gate
(T(K) ≤ 1 s at the K the arrival rate needs, queue age ≤ 2 s) holds at 1 and 2.5 cases/s
at all three sizes and at 5 cases/s up to 6 million rows; at 60 million rows and
5 cases/s the fold is 1.28 s and the queue age about 2.6 s, just outside.

Not measured, and each can change the verdict:
- the rest of the fold: gene aggregates, annotation flags, reference counts and the
  representative annotation. Today's whole summary step is 1.7–3.9 s per case on the wide
  table, so the counters measured here are the small part;
- the sustained-arrival run itself (queue age p50/p95 with importers delivering);
- the GIAB/VEP spectrum (K = 1, 8, 32);
- a cold table: at 60 million rows the counter table is 6.1 GB and was fully cached here;
- concurrent readers of the keyset index during a fold.
