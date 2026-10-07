# A2 (screening): full-text search on a deduplicated table

The normalised tables of this branch already hold the search document once per distinct
annotation (`variant_annotation`, 848,839 rows for 6,005,187 calls, GIN index 13 MB at 20
exomes against 24 MB + 32 MB for the two GIN indexes on the per-sample rows). The search
row of the matrix (`search_document @@ 'missense_variant:*'`, an unselective term),
one case:

| | Legacy per-sample GIN | Via the deduplicated table |
|---|---|---|
| Count | 460.6 ms | 224.8 ms |
| Page, default sort | 592.6 ms | 444.9 ms |
| Page sorted by CADD | 547.8 ms | 438.4 ms |

A selective term (`ddx11l1:*`, 20-exome prototype): 0.9 ms legacy, 6.2 ms deduplicated.

Verdict: **PASS at screening level** for the unselective term (0.5–0.8× legacy);
selective terms are about 7× slower in relative terms and 5 ms in absolute terms, which
fails "≤ 2× today" as a ratio and needs the protocol run to judge. Gene `ILIKE` on the
per-sample gene column without a trigram index: 0.4–17 ms.
