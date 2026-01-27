# Phase 16: Batch Import & ZIP Extraction - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Import multiple case files at once -- from multi-file selection, folder selection, or a password-protected ZIP archive -- with per-file progress and error isolation. Single-file import already exists; this phase adds batch workflows on top. Cohort analysis and new data fields are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Import workflow UX
- Claude's discretion on entry point design (unified vs separate batch action) -- research best practices and decide based on current UI patterns
- Folder selection imports top-level JSON.gz files only (no recursive subfolder scanning)
- Batch import uses a modal dialog (blocking UI) -- user cannot interact with the app while import runs
- User can cancel mid-batch; already-imported files are kept, remaining files are skipped

### Progress & feedback
- Detailed per-file progress: shows current file name, variant count being processed, AND overall progress (file N of M + percentage)
- Summary report displays inline in the same modal (replaces progress view on completion/cancellation)
- Summary shows succeeded/failed/skipped counts with expandable details per file
- Failed files show file name and error reason only -- no per-file retry action
- No OS-level notification when batch finishes in background

### Duplicate & error handling
- Duplicate case names trigger a per-file prompt: Skip or Overwrite (no rename option)
- Duplicate prompt includes "Apply this choice to all remaining duplicates" checkbox
- File-level errors (malformed JSON, unsupported format) do NOT pause the batch -- error is logged, file marked as failed, batch continues automatically
- All failures are reported in the end-of-batch summary

### ZIP password experience
- App inspects ZIP first to determine if it is password-protected; only prompts for password if encrypted
- Wrong password allows unlimited retries (user can cancel to abort)
- Password field is masked by default with a show/hide toggle (eye icon)
- After extraction, app shows list of discovered JSON.gz files before starting import -- user confirms with a "Start Import" button
- Zip Slip path traversal prevention (reject `..`, absolute paths, UNC paths) -- as specified in requirements

### Claude's Discretion
- Entry point design (unified import button vs separate single/batch actions) -- research best practices and current UI
- ZIP extraction library choice
- Temp directory management and cleanup strategy
- Exact progress bar / percentage implementation
- Error message wording and formatting
- Modal dialog layout and component choices

</decisions>

<specifics>
## Specific Ideas

No specific references -- open to standard approaches that align with the existing Varlens UI (Vuetify 3, warm palette theme).

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 16-batch-import-zip-extraction*
*Context gathered: 2026-01-27*
