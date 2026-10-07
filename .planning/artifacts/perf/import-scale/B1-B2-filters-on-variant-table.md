# B1 / B2 (screening): filters evaluated on a deduplicated variant table

Stand-in for the B1 shape: this branch's fact (`variant_call`, integer `annotation_id`)
with an added `(case_id, annotation_id)` index so the fact side is an index-only scan, and
B-tree indexes on the dimension's `consequence`, `gnomad_af`, `cadd`, `clinvar`. Differences
from the plan's B1: 8-byte ids, the fact is ordered by call id (genomic order), not
clustered by variant id. Counts for one 60,000-variant case; dimension 848,839 rows.

| Predicate | Legacy | Planner's choice | Nested loop (fact → dimension) | Hash join | Merge join | Dimension rows matching |
|---|---|---|---|---|---|---|
| impact = HIGH | 1.1 | 40.8 | 54.5 | 40.2 | 36.8 | 43,235 |
| gnomAD ≤ 0.01 | 35.0 | 118.3 | 72.1 | 118.7 | 82.8 | 501,944 |
| CADD ≥ 20 | 36.4 | 111.7 | 72.2 | 111.8 | 81.7 | 355,628 |
| ClinVar pathogenic | 35.5 | 61.3 | 106.9 | 60.1 | 54.4 | 110,516 |
| Three-way AND | 12.9 | 121.3 | 217.7 | 121.8 | 119.5 | 212,048 |
| impact = MODERATE (58%) | 13.8 | 127.2 | 78.2 | 124.4 | 85.4 | 453,029 |

Best plan against legacy: 33×, 2.1×, 2.0×, 1.5×, 9.3×, 5.7×. Hash and merge plans read
every matching dimension row, and the dimension grows with the cohort (848,839 rows at 100
exomes), so they get slower as samples are added; the nested loop is bounded by the case
(about 1.2 µs per call) and cannot go below roughly 70 ms per exome. Sorted integer arrays
and `pg_roaringbitmap` were not tried: `intarray` is available in the container but not
installed, `pg_roaringbitmap` is not available.

**B1: KILL** (kill criterion: any common predicate above 3× with the best plan; impact,
the three-way AND and the unselective predicate are).

## The full matrix: legacy, this branch today, and filter columns on the fact

Count / first page with default sort / page sorted by CADD, ms. "(a)" is this branch
(annotation columns in the dictionary, nested-loop join); "(b)" copies `consequence`,
`gnomad_af` and `cadd` onto the fact with no extra index.

| Predicate | Legacy | (a) today | (b) three columns on the fact |
|---|---|---|---|
| impact = HIGH (0.6%) | 1.1 / 2.6 / 2.8 | 112.5 / 43.1 / 119.7 | 8.1 / 3.2 / 11.2 |
| gnomAD ≤ 0.01 (8%) | 35.0 / 1.1 / 183.7 | 145.3 / 7.2 / 350.5 | 8.9 / 1.4 / 31.7 |
| CADD ≥ 20 (40%) | 36.4 / 1.2 / 189.6 | 146.9 / 2.1 / 348.4 | 9.9 / 1.4 / 307.7 |
| ClinVar pathogenic (11%) | 35.5 / 1.2 / 201.2 | 131.7 / 6.2 / 166.3 | 128.9 / 5.2 / 172.9 |
| gene in a 50-gene panel | 0.6 / 1.6 / 1.4 | 0.6 / 2.3 / 1.6 | 0.4 / 2.3 / 2.2 |
| impact + gnomAD + CADD | 12.9 / 1.7 / 21.5 | 148.5 / 12.8 / 164.8 | 9.8 / 1.6 / 21.0 |
| impact = MODERATE (58%) | 13.8 / 1.1 / 210.5 | 144.4 / 2.1 / 382.6 | 10.6 / 1.5 / 349.4 |
| full-text search | 460.6 / 592.6 / 547.8 | 224.8 / 444.9 / 438.4 | 228.6 / 412.3 / 408.7 |

Storage of the fact, 6,005,187 calls: (a) 312 B per call (1,871 MB); (b) 329 B per call
(1,975 MB; heap 1,041 MB, indexes 842 MB). Adding `(case_id, consequence)` to (b): 41 MB,
7 B per call, built in 6 s, and the impact count drops from 8.1 to 0.7 ms. A
`(locus_id, case_id)` index on the fact: 181 MB, 31.6 B per call, built in 2.3 s.

Reading: a filter column that sits on the per-sample row is as fast as legacy or faster
(the row is narrower); a filter column that does not (ClinVar here) costs about 130 ms per
exome, 3.7× legacy, whatever else is done. That is the owner's extensibility requirement
in numbers: "any column, any combination, no schema change" within 2× is only met when
every filterable column is on the per-sample row, which is the legacy row.

**B2: INCONCLUSIVE.** A prefilter on the fact makes the prefiltered columns fast (the (b)
column shows the upper bound of what a prefilter can give), and does nothing for any other
column. Not measured as a 2–3 byte code with reader-side prefilter predicates.
