# Phase 10: Logging Infrastructure & Viewer - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

A logging subsystem with two parts: (1) a LogService that captures, stores, and sanitizes log entries with a circular buffer backed by a Pinia store, and (2) a LogViewer drawer that lets the user search, filter, export, and monitor logs. Temporary access mechanism (dev shortcut or floating button) until footer exists in Phase 12.

</domain>

<decisions>
## Implementation Decisions

### Log viewer layout & interaction
- Bottom drawer (slides up, like browser DevTools)
- Two-line card format per entry: first line = level badge + message, second line = timestamp + source
- Auto-scroll to newest entries; pauses when user scrolls up; resume button appears
- Colored left border strip per entry indicating log level (green=info, yellow=warn, red=error, etc.) -- subtle but clear

### Search & filtering UX
- Fixed top toolbar within the drawer containing search bar + filter controls
- Toggle chips for level filtering: one chip per level (debug, info, warn, error, critical), all active by default, click to toggle off/on, multi-select
- Search matches highlighted with yellow background within log messages
- Search filtering is real-time with debounce (~300ms) as user types

### Sanitization rules
- Type-tagged redaction format: `[REDACTED:HGVS]`, `[REDACTED:COORD]`, `[REDACTED:ID]` -- shows the type of data redacted, not the value
- Sanitized data categories (roadmap-specified only): HGVS notation (e.g., c.123A>G), genomic coordinates (e.g., chr1:12345), patient/sample identifiers
- Sanitization happens at capture time -- sensitive data never stored in the log buffer
- The type-tagged redaction string is self-documenting; no extra badge or indicator needed on sanitized entries

### Memory & statistics display
- Buffer statistics displayed inline in the top toolbar section (alongside search/filter controls)
- Simple progress bar showing buffer fullness (e.g., 450/1000 entries)
- Per-level counts shown as badge numbers on the level filter chips (e.g., "Error (3)") -- dual purpose as filter + stats
- When entries are dropped due to buffer full: subtle "X entries dropped" indicator next to the buffer usage bar

### Claude's Discretion
- Exact drawer height and resize behavior
- Level color palette (specific hex values for each log level)
- Debounce timing fine-tuning
- Export JSON structure and filename format
- Clear logs confirmation UX
- Dev shortcut or floating button design for temporary access before footer
- Buffer default size and localStorage config structure

</decisions>

<specifics>
## Specific Ideas

- DevTools-like bottom drawer feel for the log viewer
- Filter chips with badge counts serve double duty as both filter controls and statistics display
- Top toolbar keeps controls always visible while logs scroll beneath

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 10-logging-infrastructure-viewer*
*Context gathered: 2026-01-27*
