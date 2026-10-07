# B4 (screening): sub-cohort aggregation on demand

Carrier, het and hom counts for the first N cases, top 100 loci by carriers, computed
from rows at query time. No parallel workers, `work_mem` 256 MB.

| Sub-cohort | Narrow fact, grouped by `locus_id` | Same with impact = HIGH (dimension join) | Legacy rows, grouped by coordinates |
|---|---|---|---|
| 10 cases (600,000 calls) | 1,373 ms | 741 ms | 425 ms |
| 50 cases | 3,293 ms | 2,341 ms | 2,515 ms |
| 100 cases | 5,700 ms | 4,232 ms | 6,132 ms |

About 57 ms per case and linear, so a 1,000-case sub-cohort would take about a minute on
either row store. The maintained summary answers the whole-cohort page in under 1 ms and a
filtered count in 2 ms (impact) to 89 ms (gnomAD, unindexed) over 847,002 rows.

**KILL** for on-demand aggregation from per-sample rows (kill criterion: above 5 s; it is
reached at 100 cases, far below the 10,000-sample target). Per-variant carrier bitmaps
could not be measured: `pg_roaringbitmap` is not available in the dev container and the
container was not rebuilt. Not measured: A5-style signed deltas, cost per sample at import
time, cost on case deletion.
