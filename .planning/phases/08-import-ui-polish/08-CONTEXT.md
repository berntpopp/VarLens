# Phase 8: Import UI + Polish - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete import dialog with file selection, case name input, progress feedback, error handling, and end-to-end POC verification. The dialog is triggered from the sidebar and handles the full import workflow from file selection through success confirmation.

</domain>

<decisions>
## Implementation Decisions

### Dialog design
- Modal dialog, centered overlay blocking background
- Browse button only for file selection (no drag-and-drop)
- Case name auto-populated from filename, user can edit before import
- Clicking outside modal or pressing Escape closes dialog (before import starts)

### Progress feedback
- Determinate progress bar showing percentage complete
- Text shows variant count + phase: "Inserting variants... 12,450 / 65,000"
- Cancel button visible during import — stops and rolls back
- Dialog locked during active import (clicking X or outside does nothing)

### Error presentation
- Errors displayed inline within the import dialog
- User-friendly messages like "File format not supported" or "File not found"
- "Try again" button available after error, plus Close button
- Duplicate case name prevented with message: "A case with this name exists"

### Post-import flow
- Brief success message shown, dialog auto-closes after 1-2 seconds
- Newly imported case auto-selected, variant table loads its data
- Snackbar toast after dialog closes: "Case imported: sample.json (65,432 variants)"
- Import triggered via "+ Import" button in sidebar header

### Claude's Discretion
- Exact auto-close delay timing
- Progress bar styling and animation
- Success state visual design
- Button placement within dialog

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-import-ui-polish*
*Context gathered: 2026-01-26*
