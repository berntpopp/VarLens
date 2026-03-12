# Filtering

VarLens provides multiple ways to filter variants, from broad category filters to precise per-column text search.

![Filter toolbar with active filters applied](/screenshots/filters-active.png)

## Filter Toolbar

The filter toolbar above the variant table provides dropdown filters for common criteria:

- **Gene symbol** — Filter by gene name (partial match)
- **Consequence** — Multi-select consequence types (missense, frameshift, splice, etc.)
- **Function** — Filter by functional class (exonic, splicing, intronic)
- **ClinVar** — Filter by clinical significance
- **gnomAD AF** — Maximum allele frequency threshold
- **CADD** — Minimum CADD score threshold
- **Tags** — Filter by assigned tags
- **Starred only** — Show only starred variants
- **Has comment** — Show only variants with comments
- **ACMG** — Filter by ACMG classification

## Per-Column Text Filters

![Per-column text filters for precise searching](/screenshots/column-filters.png)

Each column in the table supports a text filter input. Type in the filter field above a column to search within that column. Filters are applied with a 300ms debounce for smooth typing.

## Full-Text Search

The search bar supports full-text search across gene symbols with Boolean operators:

- `BRCA1` — Search for a gene
- `BRCA1 OR TP53` — Search for either gene
- `BRCA1 AND NOT TP53` — Exclude results

## Exact Variant Lookup

For precise lookups, you can search by chromosome, position, reference, and alternate allele to find a specific variant.
