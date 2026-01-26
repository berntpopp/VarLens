# Phase 3: Import Service - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Import gzipped JSON variant files into the database with streaming decompression, memory-efficient parsing, batch inserts, and progress reporting. The target is 65k variants in under 30 seconds with real-time progress updates.

</domain>

<decisions>
## Implementation Decisions

### Progress Reporting
- Three phases: Reading file → Parsing JSON → Inserting variants
- Report variant counts (not percentages) — total unknown until file fully read
- Fire progress callback after each batch insert (~every 5000 variants)
- Include elapsed time in progress updates for UI duration display

### Error Handling
- Skip invalid variants and continue import — don't fail on bad data
- Summary error report at end: "5 variants skipped due to missing fields"
- No skip threshold — complete import regardless of invalid count
- Rollback entire import on critical failure (file error, crash)
- Cancellation supported with full cleanup/rollback

### JSON Structure
- Support both formats:
  - Columnar: `{ caseId: { header: [...], data: [[row], ...] } }`
  - Object-per-variant: `[{variant}, {variant}, ...]`
- Auto-detect format and parse accordingly
- Config-driven field mapping (source columns → target schema)
- Use `selectedTranscript` index to extract primary value from multi-value arrays
- Store full multi-value/transcript data in JSON blob column for future use

### Performance
- Batch size: 5000 variants per insert (matches Phase 2 decision D017)
- Bounded buffer for backpressure between parse and insert
- Main thread parsing — streams provide natural async, sufficient for POC
- Support abort signal for mid-import cancellation

### Claude's Discretion
- Streaming JSON parser library choice
- Exact buffer size for backpressure
- Field mapping config file format (JSON vs TypeScript)
- Temp file handling during decompression

</decisions>

<specifics>
## Specific Ideas

- Test data is from a clinical variant analysis tool with 165 columns; we only need ~10 for the variant table
- Multi-value fields are transcript-level data (Gene, Impact, cDNA, etc.) — selectedTranscript indicates the preferred transcript
- Chr/Pos/Ref/Alt are single-value; Gene/Impact are multi-value
- gnomAD AF field: `GnomPMaxFiltAF` (single value)
- CADD field: `CADDPhredScore` (single value)
- Use JSON blob columns as needed for complex data that doesn't fit flat schema

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-import-service*
*Context gathered: 2026-01-26*
