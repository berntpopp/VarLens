# Cohort summary annotation: most severe, configuration-driven (#469)

Status: decided by the owner on 2026-10-07 (issue #469, comment); revised the same day after an
independent review (sections 3, 4, 6 to 9). Implementation follows this spec.

## Problem

`cohort_variant_summary` keeps one value per annotation column for all carriers of a variant.
Since #461 that value was an independent, NULL-ignoring bytewise `MAX()` per column. Bytewise,
`HIGH < LOW < MODERATE < MODIFIER`, so one carrier annotated `MODIFIER` turns the row into
`MODIFIER` and the cohort filter `impact = HIGH` hides the variant; ClinVar strings behave the
same (`Uncertain significance` > `Pathogenic`); and a row can combine the columns of different
transcripts (`consequence = MODIFIER` with `func = stop_gained`).

## Decision

1. What the row shows is the **most severe**, per kind of column (section 3).
2. Every severity order is **one shared configuration** (`src/shared/config/severity.config.ts`):
   impact, ClinVar significance and the ACMG class of the user's own classification.
3. Values are **normalised at import**: every variant row stores `impact_rank` and
   `clinvar_rank`; the raw strings stay as they are (display does not change). Filters and sorts
   use the normalisation too.

## 1. Severity configuration

Rank 0 is "unknown / NULL" on every scale; higher is more severe.

Impact (column `consequence`; `func` holds the SO term and is not ranked): HIGH 4, MODERATE 3,
LOW 2, MODIFIER 1. Matching is space-trimmed and ASCII case-insensitive for the stored rank; the
two former private maps (`vcf-annotation-parser.ts`, `mergeTranscripts.ts`) read the same table
through an exact-key lookup, so their behaviour is unchanged.

ACMG class (`acmg_classification`, the summary's `acmg_best`): Pathogenic 5 ... Benign 1, from
the canonical class list. The rank and label `CASE` expressions of the summary SQL, the SQLite
triggers and both PostgreSQL flag modules are generated from it.

ClinVar categories, most severe first:

| rank | category | raw terms (after normalisation) |
| --- | --- | --- |
| 15 | pathogenic | pathogenic, P, code 5 |
| 14 | pathogenic_likely_pathogenic | derived: pathogenic and likely pathogenic |
| 13 | likely_pathogenic | likely pathogenic, LP, probable / probably pathogenic, code 4 |
| 12 | conflicting | conflicting classifications / interpretations of pathogenicity, conflicting data from submitters; derived: a pathogenic-side with a benign-side component |
| 11 | uncertain_significance | uncertain significance, VUS, VUS-high/-mid/-low, uncertain risk allele, code 0 |
| 10 | risk_factor | risk factor, established risk allele, likely risk allele |
| 9 | association | association |
| 8 | affects | affects |
| 7 | drug_response | drug response, confers / conferring sensitivity, code 6 |
| 6 | other | other, association not found, histocompatibility, oncogenic, somatic tiers, codes 7 and 255 |
| 5 | protective | protective |
| 4 | likely_benign | likely benign, LB, probable / probably benign, code 3 |
| 3 | benign_likely_benign | derived: benign and likely benign, nothing more severe |
| 2 | benign | benign, B, code 2 |
| 1 | not_provided | not provided, no classification provided / for the single variant / from unflagged records, code 1, `.`, `-` |
| 0 | unknown | NULL, empty, unrecognised text |

Normalisation of a raw string: parenthesised suffixes are removed (`Pathogenic(1)`, the
CLNSIGCONF submitter counts); lower case; `_`, `-` and typographic dashes become spaces; the
string is split on `&`, `/`, `,`, `|`, `;`; each component is looked up. `low penetrance` is a
modifier, not a classification, and is ignored.

Multi-valued strings:

1. A classification on the pathogenicity axis (P, P/LP, LP, conflicting, VUS, LB, B/LB, B) is
   never outranked by a term of another kind attached to it. ClinVar's `|` separates
   classification types, so `Benign/Likely_benign|other` is benign / likely benign, not `other`.
   Terms of another kind count only when there is no classification.
2. A pathogenic-side and a benign-side component together are `conflicting`. ClinVar assigns
   that category itself for one variant. A VEP `CLIN_SIG` lists the significance of every
   co-located ClinVar record and is not allele-specific, with no aggregate: `pathogenic&benign`
   asserts neither, so it must not rank as pathogenic.
3. Pathogenic with likely pathogenic, and benign with likely benign when nothing is more severe,
   give ClinVar's aggregate category.
4. Otherwise the most severe component wins (`pathogenic&uncertain_significance` is pathogenic).

Where `conflicting` ranks. ClinVar reports a conflict when submitters disagree between the
groups P/LP, VUS and B/LB. Most ClinVar conflicts are VUS against B/LB: usually not clinically
relevant. A minority involves P/LP, which a reviewer must see. The category alone does not say
which, so it is ranked for the worse case: above uncertain significance (it is surfaced before a
plain VUS and a filter on "conflicting" finds it), below likely pathogenic (nothing affirmative
is agreed, so it never displaces a P or LP assertion). The cost is that a VUS-versus-benign
conflict sorts above a plain VUS; the order is configuration and can be changed.

An unrecognised non-empty string keeps rank 0: it is not guessed. Two things keep that from
hiding data: a fact another carrier has is never lost (section 3), and every import reports its
distinct unranked strings once (main thread: structured logger; worker threads: console, their
documented exception), so real-world spellings can be added to the configuration.

Sources: ClinVar, "Classifications in ClinVar" (germline, somatic and aggregate terms and the
conflict rule), <https://www.ncbi.nlm.nih.gov/clinvar/docs/clinsig/>; Ensembl VEP output fields
(`CLIN_SIG`, multiple values joined with `&`),
<https://www.ensembl.org/info/docs/tools/vep/vep_formats.html>; ClinVar VCF `CLNSIG` /
`CLNSIGCONF` (`/` in aggregates, `|` between classification types, `_` for spaces, `(n)`
counts), <https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/>; numeric codes: the `CLNSIG`
INFO header of the legacy ClinVar VCF ("0 - Uncertain significance, 1 - not provided, 2 -
Benign, 3 - Likely benign, 4 - Likely pathogenic, 5 - Pathogenic, 6 - drug response, 7 -
histocompatibility, 255 - other"). Only these codes are mapped.

## 2. Ranks stored at import

- `impact_rank`, `clinvar_rank` on `variants` (PostgreSQL `variants_all`, exposed by the
  `variants` view) and on `cohort_variant_summary`.
- Every writer of `consequence` / `clinvar` on a variant row writes the ranks from the shared
  config: SQLite import worker and `VariantRepository.insertBatch` (VCF VEP/SnpEff and JSON),
  PostgreSQL COPY (VCF) and `jsonb_to_recordset` (JSON), and the transcript switch on both
  backends (it rewrites `consequence`).
- Existing rows: section 6.

## 3. What a summary row shows

For one summary key (chr, pos, ref, alt, variant_type, genome_build):

| column | kind | value |
| --- | --- | --- |
| `consequence` (impact), `impact_rank` | transcript | from the chosen carrier row |
| `func` | transcript | same row |
| `gene_symbol` | transcript | same row |
| `transcript` | transcript | same row |
| `cdna` | transcript | same row |
| `aa_change` | transcript | same row |
| `omim_mim_number` | transcript (gene-level, follows the gene) | same row |
| `clinvar`, `clinvar_rank` | variant | the string of the highest ClinVar rank over all carriers, ties by the string bytewise |
| `gnomad_af` | variant | the lowest frequency over all carriers |
| `cadd` | variant | the highest score over all carriers |
| `end_pos` | variant | the highest end over all carriers |

Transcript-level columns only make sense together. They come from ONE carrier row, the first in

    impact_rank DESC, func, gene_symbol, transcript, cdna, aa_change, consequence,
    omim_mim_number   -- each DESC, NULL last, text bytewise

so there is no chimera among them. Rows that tie on the whole order are identical in these
columns. ClinVar is not part of this order any more: it is a fact of the variant.

Variant-level facts are aggregated over all carriers, each on its own, so a fact one carrier
has is never lost because another carrier supplies the transcript (carrier A = MODERATE /
Pathogenic, carrier B = HIGH on another transcript without ClinVar: the row shows B's transcript
and `Pathogenic`, and both filters find it). Carriers of one annotation release agree on these
values; they differ only across releases. Then the value least likely to hide the variant from
a filter is kept: "most severe" per column, i.e. the rarest frequency and the highest score.

Deviation from the review's wording, deliberate: it asked for "the representative row's value
when non-NULL, otherwise a deterministic value from the other carriers" for gnomAD and CADD.
That value depends on which row is the representative and on the other carriers at once; it
cannot be maintained on add or removal without re-reading all carriers or storing three more
hidden columns. A per-column MIN / MAX is exact on every path and is never NULL when a carrier
has a value, which is what the rule protects.

Text is compared bytewise (`COLLATE "C"` on PostgreSQL, SQLite's default), so both backends
arrive at the same row. The rule is defined once in `src/shared/sql/cohort-representative.ts`.

Maintenance, all paths, both backends ("maintained equals rebuilt" after any sequence):

| path | rule |
| --- | --- |
| rebuild (PostgreSQL `rebuild()`, SQLite main-thread and worker rebuilds) | per key: the transcript row and the aggregates |
| add at publication | the case's transcript row replaces the stored one iff it is strictly earlier in the order; each fact is replaced iff the case's value wins |
| removal / case delete | recompute a key only if the removed case supplied the transcript or held a fact, and no single remaining carrier row supplies all of that |
| transcript switch / add | the edited row's impact rank is rewritten, then its key is recomputed |
| coordinate recompute (SQLite) | the rebuild template restricted to the coordinate |

PostgreSQL states the same order as hash aggregates for the two bulk statements (a case's
contribution, the rebuild): the transcript row is the bytewise `MAX()` of a text array (rank
character, then a presence flag and the value per column), ClinVar the `MAX()` of the rank
character followed by the string. The single-key recompute and SQLite use window functions.
The drift and parity tests hold all forms to the same rows.

## 4. Readers, filters, sorts

| reader | after this change |
| --- | --- |
| Cohort page, both backends | the summary row of section 3 |
| Cohort and case filters on impact and ClinVar (list filters, column filters `in` / `=` / `!=`, built-in and saved presets) | by normalised category: a value selects every row of its rank, plus the rows with exactly that text. `Pathogenic` matches `pathogenic` and `Pathogenic|drug_response` |
| Filter values offered for impact and ClinVar | the configured categories present in the data, most severe first, then stored strings that are no known category; cells still show the raw string |
| Cohort and case sort on impact and ClinVar | by rank, unknown and NULL last in both directions, equal ranks by the text |
| Other cohort filters, column metadata | unchanged queries on the summary |
| Gene burden | counted from `variants` per gene, unchanged |
| Extension filters (`sv.*`, `cnv.*`, `str.*`), both backends | summary rows plus `EXISTS` on the carriers of the same coordinate, variant type **and genome build** |
| Export, both backends | the page's rows from the summary, never from a stale one (section 8) |

The PostgreSQL live aggregation (coordinate-only grouping, `MAX()` per column,
`MIN(gnomad_af)`, filters on carrier rows) is removed: one oracle. Cohort and case view use one
filter builder (`src/shared/filters/severity-filter.ts`) and one sort builder
(`src/shared/sql/severity-sort.ts`), so the four sinks cannot drift.

The text match is kept next to the rank match on purpose: a row whose rank was not written by
the import pipeline is still found by its own text, so the change is a superset of the old
filter.

## 5. Case view parity

The case view shows one row per carrier, so it has no representative. Its filters and sorts on
impact and ClinVar follow the same rules as the cohort's (section 4).

## 6. Existing rows: migrations

PostgreSQL `0025` changes the catalogue and reads the variants once. It does not rewrite or
update `variants_all` (at 10,000 exomes: about 600 million rows).

- `impact_rank`, `clinvar_rank` are added NULLable; NULL means "not backfilled yet".
- `clinvar_severity(raw, rank)`: every distinct stored ClinVar string that has a rank, ranked by
  the configuration's normaliser in the afterApply step (a multi-valued string cannot be
  categorised in SQL; no `CASE` with one `WHEN` per string).
- Every reader of a variant row's rank uses `COALESCE(stored, computed)`: impact from the
  generated `CASE`, ClinVar from the lookup. Results are correct from the first read.
- Background backfill in id-range batches (20,000 ids), each its own transaction, progress in
  `severity_rank_backfill`, an advisory lock against a second server process, single-flight per
  schema with back-off like the summary rebuild; a cohort read starts it while it is pending.
- The summary's own rank columns are NOT NULL (always written); a populated summary is flagged
  stale and rebuilt in the background.
- Virtual generated columns (PostgreSQL 18) were considered for the impact rank and not used:
  COPY cannot write them, the ClinVar rank cannot be one, and one mechanism for both is simpler.

SQLite `v41` updates in place, in one transaction with the full-text update trigger suspended;
a process that dies mid-way leaves the database at v40 and the next start completes it. It runs
in the existing off-thread migration worker.

## 7. Rebuild

`rebuild()` on PostgreSQL runs one statement per chunk of the genome (chromosome and position
range) inside its transaction. A key never spans two chunks; the chunk width is derived from
the number of variant rows (about 500,000 per chunk when spread evenly), the chromosome ranges
from one index probe per chromosome. No statement grows with the cohort, so none meets the
30-minute statement timeout, which is not raised. The rebuild still holds the summary write
lock for its whole duration, as before.

## 8. Export

An export file cannot carry the page's "refreshing" hint. PostgreSQL: the export waits for the
pending background rebuild, at most 60 s, else fails with `CohortSummaryRefreshingError` (code
`CONFLICT`, user-facing message). SQLite: the main process waits the same bound before starting
the export job and the worker refuses a stale summary. A failed CSV export leaves no partial
file.

## 9. Cost

Measured on PostgreSQL 18, simulated exomes of 60,000 variants each, "before" = the #461 code on
the same schema in the same run (median of 7; rebuilds: best of 1 to 2, rolled back).

Publication of one case (`prepareAdd` + `incrementalAdd`):

| cohort | before | after |
| --- | --- | --- |
| 20 exomes (1.26 M rows) | 243 + 2,172 = 2,415 ms | 369 + 1,869 = 2,234 ms |
| 20 exomes, no rank backfilled yet | 2,388 ms | 2,364 ms |
| 100 exomes (6 M rows) | 2,549 ms | 2,522 ms |

The first version of this change measured 2,601 ms at 20 exomes (before: 3,105 ms in that run).
Publication is not slower than before in any state; the per-case aggregate costs about 125 ms
more and the upsert about 300 ms less.

Full rebuild:

| cohort | before (one statement) | after (chunked) |
| --- | --- | --- |
| 20 exomes, vacuumed | 12.3 s | 12.8 s |
| 20 exomes, no rank backfilled (on-the-fly ranks) | 12.3 s | 14.1 s |
| 20 exomes, right after import | 12.5 s | 19.5 s |
| 100 exomes, right after import | 41.8 s | 56.7 s |

About 9.5 microseconds per variant row at 100 exomes, linear in rows: projected about 10 min at
1,000 exomes (60 M rows) and about 95 min at 10,000 (600 M rows), in roughly 120 and 1,200
statements of about 5 s each (dense regions several times that), none near the 30-minute
timeout. As one statement the old rebuild would have reached the timeout at about 4,300 exomes.
The summary write lock is held for the whole rebuild, as before.

Migration 0025: catalogue changes plus one read for the lookup (0.1 s at 1.26 M rows, 0.36 s at
6 M). On-the-fly ranks cost about 10 % on a rebuild and nothing measurable on publication or on
a sorted or filtered case page. Background backfill: 62 s for 1.26 M rows (63 batches of about
1 s; about 20,000 rows/s, so about 8 h for 600 M rows, in the background); the table grew from
780 MB to 1.4 GB until vacuum reclaims the old row versions.

SQLite v41 on an encrypted database of 1.2 M variants (981 MB): 5.1 s, run again 0.9 s. It stays
an in-place update.

## Tests

Config unit tests (ranking, odd spellings, conflict derivation, ACMG, unranked report); import
tests for VEP, SnpEff and JSON on both backends; migration tests (no rewrite, readers correct
before backfill, resumable batches, SQLite crash); the issue scenario and the A/B fact scenario
on both backends; filters and sorts in four sinks; export while stale; two builds at one
coordinate; chunked rebuild equals unchunked; parity and drift tests keep SQLite == PostgreSQL
and maintained == rebuilt.
