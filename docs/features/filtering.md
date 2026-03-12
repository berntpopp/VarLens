# Filtering

VarLens provides multiple ways to filter variants, from broad category filters to precise per-column text search.

![Filter toolbar with active filters applied](/screenshots/filters-active.png)

## Filter Toolbar

The filter toolbar above the variant table provides quick-access filters:

- **Starred only** — Show only starred variants
- **Has comment** — Show only variants with comments
- **ACMG** — Filter by ACMG classification (P, LP, VUS, LB, B chips)
- **Tags** — Filter by assigned tags

## Filter Drawer

Open the filter drawer by clicking the **Filters** button in the toolbar, or use the keyboard shortcut `Ctrl+Shift+F` / `Cmd+Shift+F`. The drawer slides in from the right with advanced filters:

- **Gene symbol** — Autocomplete search by gene name
- **Consequence** — Multi-select consequence types (HIGH, MODERATE, LOW, MODIFIER)
- **Function** — Multi-select functional class (exonic, splicing, intronic)
- **ClinVar** — Multi-select clinical significance
- **gnomAD AF** — Maximum allele frequency threshold (presets: 1%, 0.1%, 0.01%)
- **CADD** — Minimum CADD score threshold (presets: 10, 15, 20, 25)

## Per-Column Text Filters

![Per-column text filters for precise searching](/screenshots/column-filters.png)

Each column in the table supports a text filter input. Type in the filter field above a column to search within that column. Filters are applied with a 300ms debounce for smooth typing.

## Search Bar

The search bar in the toolbar supports multiple query types:

- **Gene search** — `BRCA1` searches by gene symbol (uses SQLite FTS5)
- **Boolean operators** — `BRCA1 OR TP53`, `BRCA1 AND NOT TP53`
- **HGVS notation** — `c.5123C>T` or `p.Ala1708Glu` searches coding/protein changes
- **Position lookup** — `chr17:43094000` navigates to a specific genomic position
