# Phase 18: Cohort Analysis - Context

**Gathered:** 2026-01-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Dedicated cohort analysis view for analyzing variants across all imported cases. Delivers an aggregated variant table with carrier counts, allele frequencies, het/hom breakdown, per-case drill-down, gene-level burden for genes with actual hits, and cohort-wide search. Accessed via tab-based navigation separate from single-case analysis.

</domain>

<decisions>
## Implementation Decisions

### Cohort view layout
- Navigation pattern: Claude to research best practices from comparable genomic cohort tools (e.g., seqr, GEMINI, VarSome) and decide the optimal navigation approach
- Compact expandable dashboard above the aggregated table showing summary stats (total cases, total variants, average variants per case, etc.)
- Dashboard is collapsed by default to prioritize the variant table, expandable for more detail
- Gene-level aggregation only shows genes with actual hits (variants present in the cohort) — no empty gene entries

### Drill-down navigation
- Expandable row pattern: clicking an aggregated variant row expands it inline to show a nested table of per-case carriers
- Expanded row shows: case name, zygosity (het/hom), and a clickable link to navigate to that case
- Clicking the case link switches to the single-case tab, pre-filtered to show the specific variant from the cohort drill-down
- Navigation is a tab switch (not a new window or modal)

### Search & filtering
- Persistent search bar above the cohort table
- Search accepts: gene symbol, genomic position (chr:pos), c.HGVS notation, and p.HGVS notation
- Search filters the aggregated table in-place (no separate results area)
- No column-level filters — global search bar only
- Carrier count visible in table rows; full carrier details (case names, zygosity) via expandable row — consistent with drill-down pattern

### Data density & columns
- Default columns: chr, pos, ref, alt, gene, carrier count, cohort allele frequency, het/hom counts
- Minimal genomic + aggregation focus — no annotation columns by default
- Cohort allele frequency displayed as fraction format (e.g., "3/10" — carriers / total cases)
- Het/hom breakdown in a single combined column (e.g., "2 het / 1 hom")
- All columns sortable — users can sort by carrier count, frequency, het/hom, gene, position, etc.

### Claude's Discretion
- Exact navigation pattern (top-level tab vs sidebar) — based on research of genomic analysis tools
- Dashboard card/stat design and which summary metrics to include
- Compact format for combined het/hom column
- Default sort order for the cohort table
- Gene burden section placement and presentation
- Search implementation details (FTS5 vs LIKE queries)
- Table pagination strategy for large cohorts

</decisions>

<specifics>
## Specific Ideas

- Gene-level aggregation should only include genes with actual variant hits — showing all genes makes no sense for this use case
- Search should cover the nomenclatures geneticists commonly use: gene symbols, genomic coordinates, and HGVS notations (both coding and protein level)
- Drill-down from cohort to case should feel like a natural navigation — switch tabs with the variant pre-filtered, not a jarring modal or new window

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-cohort-analysis*
*Context gathered: 2026-01-28*
