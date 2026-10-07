# Cohort representative annotation: most severe, configuration-driven (#469)

Status: decided by the owner on 2026-10-07 (issue #469, comment). Implementation follows this spec.

## Problem

`cohort_variant_summary` keeps one value per annotation column for all carriers of a variant.
Since #461 that value is an independent, NULL-ignoring bytewise `MAX()` per column. Bytewise,
`HIGH < LOW < MODERATE < MODIFIER`, so one carrier annotated `MODIFIER` turns the row into
`MODIFIER` and the cohort filter `impact = HIGH` hides the variant; ClinVar strings behave the
same (`Uncertain significance` > `Pathogenic`); and a row can combine values of different
carriers (`consequence = MODIFIER` with `func = stop_gained`).

## Decision

1. The representative is the **most severe** carrier annotation.
2. The severity order is **one shared configuration** (`src/shared/config/severity.config.ts`).
3. Values are **normalised at import**: every variant row stores `impact_rank` and
   `clinvar_rank`; the raw strings stay as they are (display does not change).

## 1. Severity configuration

`src/shared/config/severity.config.ts` is the only place that knows an order. Rank 0 is
"unknown / NULL" on both scales; higher is more severe.

Impact (column `consequence`; `func` holds the SO term and is not ranked):

| level | rank |
| --- | --- |
| HIGH | 4 |
| MODERATE | 3 |
| LOW | 2 |
| MODIFIER | 1 |
| anything else, NULL | 0 |

Matching is trimmed and case-insensitive for the stored rank. The two former private maps
(`vcf-annotation-parser.ts`, `mergeTranscripts.ts`) read the same table through an exact-key
lookup, so their behaviour (exact, case-sensitive keys) is unchanged.

ClinVar categories, most severe first:

| rank | category | raw terms (after normalisation) |
| --- | --- | --- |
| 15 | pathogenic | pathogenic |
| 14 | pathogenic_likely_pathogenic | aggregate: components contain both pathogenic and likely pathogenic |
| 13 | likely_pathogenic | likely pathogenic |
| 12 | conflicting | conflicting classifications of pathogenicity, conflicting interpretations of pathogenicity, conflicting data from submitters, conflicting classifications of oncogenicity |
| 11 | uncertain_significance | uncertain significance, VUS, VUS-high/-mid/-low, uncertain risk allele |
| 10 | risk_factor | risk factor, established risk allele, likely risk allele |
| 9 | association | association |
| 8 | affects | affects |
| 7 | drug_response | drug response, confers/conferring sensitivity |
| 6 | other | other, association not found, oncogenic, likely oncogenic, somatic tiers |
| 5 | protective | protective |
| 4 | likely_benign | likely benign |
| 3 | benign_likely_benign | aggregate: benign and likely benign, nothing more severe |
| 2 | benign | benign |
| 1 | not_provided | not provided, no classification provided, no classification(s) for the single variant / from unflagged records, `.`, `-` |
| 0 | unknown | NULL, empty, unrecognised text |

Normalisation of a raw string: lower-case, `_` to space, split on `&`, `/`, `,`, `|`, `;`,
trim and collapse spaces, look each component up. Modifiers that are not a classification of
their own (`low penetrance`, which the comma split separates from `Pathogenic, low penetrance`)
are ignored.

Multi-valued rule: **the most severe component wins**, with two exceptions that mirror ClinVar's
own aggregates: pathogenic together with likely pathogenic is `pathogenic_likely_pathogenic`
(between the two), and benign together with likely benign, with nothing more severe, is
`benign_likely_benign`. `conflicting` is never derived by us: it stays the category ClinVar
assigned. It ranks below likely pathogenic and above uncertain significance, because ClinVar
reports a conflict only when submitters disagree between the P/LP, VUS and B/LB groups, so at
least one submitter asserts something other than "uncertain", but nothing affirmative is agreed.
Terms on another axis than Mendelian pathogenicity (risk factor, association, affects, drug
response, other, protective) rank below uncertain significance and above the benign group.
The order is configuration; changing it needs a migration that recomputes the stored ranks.

Sources: ClinVar, "Classifications in ClinVar" (germline, somatic and aggregate terms, and the
rule for `Conflicting classifications of pathogenicity`),
<https://www.ncbi.nlm.nih.gov/clinvar/docs/clinsig/>; Ensembl VEP output fields (`CLIN_SIG`,
multiple values joined with `&`), <https://www.ensembl.org/info/docs/tools/vep/vep_formats.html>;
ClinVar VCF `CLNSIG` (`/` in aggregates, `|` between classification types, `_` for spaces),
<https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/>.

## 2. Ranks stored at import

- New columns `impact_rank`, `clinvar_rank` (small integer, NOT NULL DEFAULT 0) on `variants`
  (PostgreSQL `variants_all`; the `variants` view is recreated to expose them).
- Every writer of `consequence` / `clinvar` on a variant row writes the ranks from the shared
  config: SQLite import worker and `VariantRepository.insertBatch` (VCF VEP/SnpEff and JSON),
  PostgreSQL COPY (VCF) and `jsonb_to_recordset` (JSON), and the transcript switch on both
  backends (it rewrites `consequence`).
- Backfill: PostgreSQL migration `0025`, SQLite schema version `41`. Impact uses a `CASE`
  generated from the config. ClinVar cannot be tokenised in portable SQL, so the migration
  reads the distinct stored strings, ranks each with the config's normaliser and applies the
  result (PostgreSQL: a `CASE` over the ranked strings; SQLite: a lookup table). PostgreSQL
  writes the ranks by rewriting `variants_all` once (`ALTER COLUMN ... USING`) instead of an
  `UPDATE`, which would write a second copy of every row and a new entry in each of its twelve
  indexes (measured on 1.26 million variants: 77 s against 9 s); the `variants` view is
  redefined afterwards. SQLite updates in place with the full-text update trigger suspended.
  Running either again changes nothing.
- The same migrations add `impact_rank`, `clinvar_rank` to `cohort_variant_summary` and flag a
  populated summary stale, so the existing background rebuild replaces the old rows.

## 3. Representative rule

For one summary key (chr, pos, ref, alt, variant_type, genome_build) the representative is the
first visible carrier row in this total order:

    impact_rank DESC, clinvar_rank DESC,
    func, gene_symbol, transcript, cdna, aa_change, consequence, clinvar, omim_mim_number,
    gnomad_af, cadd, end_pos   -- each DESC, NULL last, text bytewise

Text is compared bytewise (`COLLATE "C"` on PostgreSQL, SQLite's default), so both backends
choose the same row. Every annotation column of the summary row, and its two ranks, come from
that one row: no chimeras. Rows that tie on the whole order are identical in every stored
column, so the result does not depend on which of them is picked. gnomAD frequency, CADD and
`end_pos` are per-variant facts and follow the chosen row (no reader needs another aggregate,
see below). The order and the comparison SQL are generated once in
`src/shared/sql/cohort-representative.ts` for both dialects.

Maintenance, all paths, both backends ("maintained equals rebuilt" after any sequence):

| path | rule |
| --- | --- |
| rebuild (PostgreSQL `rebuild()`, SQLite main-thread and worker rebuilds, all from one template) | pick the first row per key in the order |
| add at publication (PostgreSQL `prepareAdd` / `incrementalAdd`, SQLite per-file add) | the case's best row per key replaces the stored row iff it is strictly earlier in the order than the stored one (stored ranks make this a row-local comparison) |
| removal / case delete | recompute a key only if the removed case's best row equals the stored representative and no remaining carrier row equals it |
| transcript switch / add | the edited row's ranks are rewritten, then its key is recomputed |
| coordinate recompute (SQLite) | the rebuild template restricted to the coordinate |

## 4. Readers of the summary columns

| reader | reads | after this change |
| --- | --- | --- |
| Cohort page, both backends | stored annotation columns | representative row |
| Cohort filters (impact, func, ClinVar, gene, gnomAD, CADD, search, column filters) | stored columns | representative row; `impact = HIGH` matches when the most severe carrier annotation is HIGH |
| Cohort sort | stored columns | impact and ClinVar sort by rank (see 5) |
| Cohort column metadata | DISTINCT / MIN / MAX over stored columns | unchanged queries, representative values |
| Gene burden (`gene_burden_summary`, `cohort_gene_summary`) | counted from `variants` per gene, not from the representative | unchanged |
| SQLite extension filters and export | summary rows plus `EXISTS` on the extension tables | unchanged path, representative values |
| PostgreSQL extension filters and export ("live path") | grouped `variants` by coordinate only, `MAX()` per column, `MIN(gnomad_af)`, filters applied to carrier rows before grouping | replaced: served from the summary like SQLite, extension predicates as `EXISTS` |

The PostgreSQL live aggregation is removed rather than re-derived, so there is one oracle. Its
`MIN(gnomad_af)` had no reader that depended on a minimum; with the summary path the value is
the representative row's. Known remaining difference: none in the values; the export now
depends on the summary being current, and uses the same staleness reconciliation as the page.

## 5. Case view parity

The case view shows one row per carrier, so it has no representative. Sorting by impact or
ClinVar was by string on both views and both backends; all four now sort by the stored rank
(`src/shared/sql/severity-sort.ts`, used by the two shared ORDER BY builders): descending is
most severe first, unknown values and NULL last in both directions, equal ranks by the text and
then the existing order. Filtering by exact stored string is unchanged on both views.

## 6. Cost

Measured on PostgreSQL 18, one schema of 21 simulated exomes (60,000 variants each, 1.26 million
variant rows, 344,063 summary rows), the same data for both versions, median of 7 runs of
publishing the 21st case onto the 20-case summary:

| step | before (#461 rule) | after |
| --- | --- | --- |
| `prepareAdd` (the case's contribution) | 293 ms | 325 ms |
| `incrementalAdd` (summary upsert) | 2,796 ms | 2,269 ms |
| publication, both | 3,105 ms | 2,601 ms (-16 %) |
| `incrementalRemove` of one case | 3,189 ms | 2,787 ms |
| full `rebuild()` | 16.1 s | 21.6 s (+34 %) |

Publication does not get slower. The full rebuild does: it sorts the carrier rows to pick one
instead of hashing per-column maxima. It runs in the background after this migration and after
a failed incremental step, not per import. The backfill of 0025 took 9 s for these 1.26 million
rows (about 45 s expected for 6 million).

## Tests

Config unit tests; import tests for VEP, SnpEff and JSON on both backends; migration backfill
tests (idempotent, legacy rows, SQLCipher); the issue scenario on both backends; parity and
drift tests updated to the new rule (their old expectations encoded the defect).
