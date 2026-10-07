# A1 (screening): cost of indexes, generated columns and the foreign key on row writing

60,000 rows of one case inserted into `variants_all` holding 6,000,000 rows (100 exomes),
then its 60,000 `variant_transcripts` rows; transaction rolled back. Median of three
alternating rounds.

| Configuration | `variants_all` ms | WAL MB | `variant_transcripts` ms | WAL MB |
|---|---|---|---|---|
| Baseline: 12 indexes + 4 on transcripts | 2,410 | 164 | 330 | 28 |
| Without the two GIN indexes (`search_document`, gene trigram) | 1,599 | 76 | 289 | 30 |
| Primary key + chr-rank + `(case_id, chr, pos)` + `(case_id, gene_symbol)` + `(case_id, consequence)`; transcripts: unique key only | 1,107 | 52 | 250 | 20 |
| Primary key only; transcripts: unique key only | 618 | 26 | 236 | 20 |
| Primary key only, no generated `coord_hash`/`search_document`, no case foreign key | 215 (84–1,178) | 62 (18–466) | 273 | 20 |

Single drops, one run each (baseline that round: 2,097 ms, 153 MB): no single B-tree
changes the time by more than the run-to-run spread (1,778–2,720 ms); each GIN index
removes about 38 MB of WAL (`idx_variants_search_document` 1,697 ms / 114 MB,
`variants_gene_trgm` 1,810 ms / 114 MB).

Reading: indexes are about three quarters of the row-writing time at this size, the two
GIN indexes about a third on their own, and WAL is about 2.7 kB per variant row (full-page
images after checkpoints; the first cold baseline wrote 516 MB). The last row is unstable
because dropping the columns invalidates the view and the runs straddled checkpoints.

Which reads each of the seven dropped indexes serves (from the reader inventory in the
normalised-model spec, section 2.2): `idx_variants_case_type` type counts (a 60,000-row
scan without it); `idx_variants_case_func` func filter counts; `idx_variants_coord_hash_case`
nothing in the read path (internal AF joins `variant_frequency` by its own unique index);
`variants_coords` carriers by coordinate without a case and annotation batch lookups;
`variants_brin_chr_pos` nothing measured; the two GIN indexes search and gene `ILIKE`.

Correction after review: the five-index set above is **not** a safe set. It drops
`idx_variants_case_type` and `idx_variants_case_func`, which serve reads (type counts, func
filter counts), and `variants_coords`, which serves carriers-of-a-variant and the
representative/flag recomputes (499,993 scans in the reviewers' catalog check). The
"cheapest safe set, every reader named" has to be redone; of the indexes measured here
only `idx_variants_coord_hash_case`, `variants_brin_chr_pos` and (with search moved to a
deduplicated table) the two GIN indexes have no per-sample reader in this inventory.

Verdict: **PASS at screening level** (pass criterion: row writing ≤ 1.5 s at sample 100
with the read matrix within target). The five-index set writes in 1.1 s + 0.25 s. Not yet
shown: the read matrix on that reduced set (the dropped indexes' reads above need
re-measuring; search needs A2), COPY through the importer, and samples 1–5 / 16–20.

For comparison, the normalised staged writer of this branch spends 2.6 s per sample on row
writing at samples 16–20 (legacy importer 2.3 s there, 5.1 s at samples 81–100).
