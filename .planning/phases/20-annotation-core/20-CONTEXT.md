# Phase 20: Annotation Core - Context

**Gathered:** 2026-01-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can annotate variants with comments, stars/flags, and ACMG classification with persistent storage. IPC handlers for CRUD operations. Does NOT include side panel UI (Phase 23) or custom tags (Phase 24).

</domain>

<decisions>
## Implementation Decisions

### Comment behavior
- Display as unified list with source labels (global / case name)
- Support basic markdown rendering (bold, italic, links, code)
- Character limit ~2000 chars for detailed clinical reasoning
- Inline confirm for edit/delete (Save/Cancel buttons, no modal)
- Timestamps preserved (created_at, updated_at)

### Star/flag design
- Single star toggle (on/off) — simple "mark as interesting"
- Separate global star AND per-case star (both exist independently)
- Single click to toggle in table — no confirmation needed
- Combined icon with badge/indicator showing scope (globe vs case icon overlay)

### ACMG classification
- Full 5-tier system: Pathogenic, Likely Pathogenic, VUS, Likely Benign, Benign
- Evidence criteria tracking with variable strength adaptation (modern approach)
- Notes field for rationale alongside evidence
- Per-case only (no global classification)
- Optional — users can leave variants unclassified
- Quick-add chips for evidence entry (type/select criteria, shown as chips with strength badge)

### Table integration
- Annotation columns: Star + ACMG only (minimal)
- Position: Left side of table (first columns after row selector)
- ACMG display: Colored icon only with tooltip showing full classification
- Star filter: Yes — filter to show only starred variants

### Claude's Discretion
- Exact icon choices for star and ACMG states
- Color palette for ACMG 5-tier badges
- Star indicator visual design (badge style, positioning)
- Error handling patterns for IPC operations

</decisions>

<specifics>
## Specific Ideas

- Evidence system should feel lean — quick-add chips, not heavy form
- Combined star icon should be "larger with bigger border and indicator" to distinguish global vs per-case
- ACMG evidence strength adaptation (like ClinGen's modern refinements)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-annotation-core*
*Context gathered: 2026-01-28*
