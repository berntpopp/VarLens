# Phase 6: Variant Table - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Paginated variant table using Vuetify v-data-table-server for displaying case variants with sorting. Users can view variants for a selected case, navigate pages, and sort by columns. Filtering and search are Phase 7; import UI is Phase 8.

</domain>

<decisions>
## Implementation Decisions

### Column layout & density
- All 9 columns visible by default: chr, pos, ref, alt, gene, consequence, gnomAD AF, CADD, ClinVar
- Ref/alt alleles: full text, truncate at ~20 chars with tooltip for full sequence
- No sticky columns — all columns scroll together
- Compact row density — minimal padding to maximize visible rows (data-dense UX)

### Data formatting
- Genomic positions formatted with commas (12,345,678)
- gnomAD allele frequencies in scientific notation (1.2e-4)
- ClinVar significance displayed as colored chips (Pathogenic=red, Benign=green, VUS=amber)
- Consequence shown as human-readable labels (Missense, Frameshift, Splice donor)

### Pagination behavior
- Default page size: 50 rows
- Page size options: 25, 50, 100
- Loading state: overlay spinner on table (table stays visible)
- Standard prev/next and page number navigation — no jump-to-page input

### Sorting interactions
- Default sort: genomic position (chr, pos) in natural order
- Multi-column sorting supported (Shift+click to add secondary sort)
- Sort indicators: arrow icon with 1/2/3 badge for multi-sort priority
- Chromosome sorting: numeric/natural order (chr1 < chr2 < chr10 < chrX < chrY)

### Claude's Discretion
- Exact column widths and responsive breakpoints
- Tooltip implementation details
- Loading spinner styling
- Empty state design for case with no variants

</decisions>

<specifics>
## Specific Ideas

- Data-dense UX is a core project value — compact rows prioritize information density over whitespace
- ClinVar color scheme should follow clinical genetics conventions (red=pathogenic, green=benign)
- Natural chromosome ordering expected by genetics users

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-variant-table*
*Context gathered: 2026-01-26*
