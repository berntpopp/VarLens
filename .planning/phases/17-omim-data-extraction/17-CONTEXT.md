# Phase 17: OMIM Data Extraction - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract OMIM MIM numbers from variant annotation data during import, store them in the variants table, display them as clickable links in the variant table, and upgrade the OMIM external link from gene search (Phase 15) to direct MIM entry URLs. Disease name extraction is out of scope — MIM number only.

</domain>

<decisions>
## Implementation Decisions

### Data source and extraction
- OMIM data comes from source JSON column index 25 (id: "OMIM", title: "OMIM", description: "OMIM ID of the gene")
- Field is multi-value (one per transcript), dataType STRING
- Use selected transcript index to pick the MIM number (same pattern as gene_symbol extraction)
- Fallback: if selected transcript has null, use first non-null value from any transcript
- MIM number only — no disease name extraction (users look up disease names via OMIM.org link)
- Source URL template for reference: `https://www.omim.org/entry/{value}`

### Database schema
- New `omim_mim_number` TEXT column added to variants table
- No schema migration for existing databases — only new databases get the column
- Silent null storage when source file doesn't contain the OMIM field at all
- Add omim_mim_number to FTS5 full-text search index (users can search by MIM number)

### Variant table display
- OMIM column visible by default in the variant table
- Positioned next to the Gene column (semantically related — gene MIM number)
- MIM number text itself is the clickable link (with external-link icon suffix, consistent with Phase 15 pattern)
- Link URL: `https://www.omim.org/entry/{mim_number}` — exact pattern, no special edge case handling
- Empty cells show dash placeholder (em dash '—')

### OMIM link changes
- Remove the existing gene symbol → OMIM gene search link (from Phase 15)
- Replace with direct MIM entry link using the extracted MIM number
- No OMIM link at all when MIM number is absent (no gene search fallback)
- Only show OMIM link when variant has a real MIM number stored

### Claude's Discretion
- Column width and text alignment for OMIM column
- Exact position of OMIM column relative to Gene (immediately after vs one column gap)
- FTS5 trigger update implementation details
- Import pipeline error handling for malformed MIM number values

</decisions>

<specifics>
## Specific Ideas

- Source data structure confirmed: column 25 in test-data/case-892-snv-sample.json.gz contains MIM numbers like '616765', '611395', '171500', '617314'
- Values are arrays with one entry per transcript, often duplicated (e.g., ['616765', '616765', '616765'])
- Follow existing FieldMapper.ts multi-value extraction pattern (selected transcript → fallback to first non-null)
- "OMIM" column in varvis source data is the field to map
- The column name in varvis from where data comes is named "OMIM"

</specifics>

<deferred>
## Deferred Ideas

- Disease name extraction (OMIM-02 from roadmap) — MIM number is sufficient for this phase; disease names would require an external lookup or additional source data fields
- HPODisease field (column 161) has disease name data dictionaries but is semantically different from OMIM — could be a separate enhancement

</deferred>

---

*Phase: 17-omim-data-extraction*
*Context gathered: 2026-01-27*
