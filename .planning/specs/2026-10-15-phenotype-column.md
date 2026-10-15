# Phenotype column in the single-sample variant table (2026-10-15)

User need: the HPO phenotype score (v2 scorer, `openHpoGeneScorer`) must be visible, sortable and
filterable in the MAIN case variant table (most useful there), not only inside shortlist rules/tooltips.
Hard constraint (user): NEVER recompute on reads. Compute once (first time a case with HPO terms needs it)
and on changes to that case's HPO terms; store; reads only join stored values. Also recompute when the
installed HPO data changes (the stored row carries the data key, so stale = key mismatch).

## Storage (migration SQLite v59 / PG 0042; check the latest numbers on main first)
`case_phenotype_scores(case_id, gene_symbol, score REAL NOT NULL, best_disease TEXT, PRIMARY KEY(case_id, gene_symbol))`
+ per-case state `case_phenotype_state(case_id PK, profile_hash TEXT, hpo_data_key TEXT, computed_at)`.
Only genes that occur in the case's variants (distinct gene_symbol) AND have a score are stored (≤ ~20k/WGS case).
FK cascade on case delete. Index covers (case_id, gene_symbol).

## Compute (never on the Electron main thread; never per request)
`ensureCasePhenotypeScores(caseId)`: if state.profile_hash == hash(present/excluded/key terms) and
state.hpo_data_key == current HPO DB key → no-op. Else score once (openHpoGeneScorer, memoised) for the case's
distinct genes, replace rows in ONE transaction, update state. Triggers: after HPO term assign/remove/flag change
(desktop + web), after HPO data install/update (mark all states stale lazily — key mismatch), and lazily the first
time a case table/shortlist query needs the column (the first query waits, later ones only read). No terms → delete rows.
Run in the existing read/scorer worker path (see prewarmHpoIndexInPool, hpo:prewarm, DbPool scorer pool) on desktop;
web server path likewise off the request hot path where possible.

## Query + DSL (SQLite AND Postgres, identical results)
Case variant query LEFT JOINs the table on (case_id, gene_symbol) → row fields `phenotype_score` (number|null) and
`phenotype_disease` (string|null). Sortable column (keyset pagination: follow how other sortable extra columns work,
e.g. SQLITE_KEYSET_EXTRA_COLUMNS; nulls last both directions) and DSL/filter field `phenotype_score` (numeric, caseOnly).
Shortlist evidence `hpo_resnik` may keep using the in-memory scorer (unchanged).
Cohort parity: cohort rows get `phenotype_score` = MAX over carrier cases' stored scores (each case's own terms),
column label "Best phenotype match (carriers)"; sortable/filterable the same way; cohort query must stay fast
(measure on the perf fixture; add index only if needed).

## UI
Column "Phenotype" in the case table (dense; score 2 decimals + best disease label truncated), hidden by default? NO —
visible by default when the case has HPO terms; "—" for null. Hover/click: the existing phenotype explanation block
(reuse rank-tooltip-phenotype.ts lines via an IPC `hpo:explainGene(caseId, gene)` that uses the memoised scorer).
Recompute indicator: while scores are being (re)computed after a term edit show a small inline progress state in the
column header; refetch the table when done. Cohort column analogous (no explanation, just max + case count hint).
Missing HPO data: column shows "—" and the existing missing-data hint.
