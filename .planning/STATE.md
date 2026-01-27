# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-27)

**Core value:** External collaborators can analyze variant data offline with data-dense UX for research use
**Current focus:** Milestone v0.2.0 -- UI Polish & Trust Signals

## Current Position

Phase: 11 of 4 (Trust Signals -- Disclaimer & FAQ)
Plan: 1 of 2 complete
Status: In progress
Last activity: 2026-01-27 -- Completed 11-01-PLAN.md (Disclaimer Subsystem)

Progress: [█████▓░░░░] 58%

### Phase Overview

| Phase | Name | Status |
|-------|------|--------|
| 9 | Branding & Theme Foundation | ✓ Complete (2/2 plans) |
| 10 | Logging Infrastructure & Viewer | ✓ Complete (2/2 plans) |
| 11 | Trust Signals -- Disclaimer & FAQ | In Progress (1/2 plans) |
| 12 | App Footer Integration | Not Started |

## Milestone History

- **v0.1 POC** -- 8 phases, 17 plans -- shipped 2026-01-27

## Performance Metrics

**v0.2.0 Progress:**
- Plans completed: 5
- Average duration: 5.6 min
- Phases complete: 2 of 4 (50%)

## Accumulated Context

### Decisions

All 66 decisions from v0.1 are archived in `.planning/milestones/v0.1-ROADMAP.md`.
Key architectural decisions carried forward:

| Decision | Summary | Impact |
|----------|---------|--------|
| better-sqlite3 | Synchronous SQLite with native bindings | Core persistence layer |
| FTS5 | Full-text search for gene autocomplete | Query patterns |
| Cursor pagination | Efficient large result sets | API contract |
| Streaming import | Memory-efficient JSON parsing | Import architecture |

**v0.2.0 Decisions (Phase 9):**

| Decision | Summary | Impact |
|----------|---------|--------|
| Warm palette theme | #a09588 primary, #424242 secondary, warm-tinted surfaces | All UI components use RequiForm branding |
| Dual theme support | warmLight and warmDark from the start | Theme switching ready when needed |
| Custom DNA icon | Unique varlens-dna SVG icon (not stock MDI) | Brand distinction in app bar |
| Roboto Mono via CDN | Google Fonts for genomic data monospace | Technical data readability, can self-host later |
| Global compact density | All components default to compact | Data-dense UI feel throughout app |
| App bar branding | App bar is single source of VarLens branding (name + icon) | Consistent brand identity across all navigation states |
| Sidebar as content panel | Sidebar controlled by app bar toggle, not independent branded element | Clear navigation hierarchy |
| Research language | "research analysis", "pathogenicity classification" (not clinical terminology) | Consistent research positioning throughout UI |
| Monospace for genomic data | Semantic utility classes for gene symbols, HGVS, coordinates | Enhanced readability of technical data |

**v0.2.0 Decisions (Phase 10):**

| Decision | Summary | Impact |
|----------|---------|--------|
| Lazy store initialization | getStore() function with null check instead of module-level useLogStore() | Prevents Pinia timing issues where stores accessed before Pinia installed |
| Capture-time sanitization | Sanitize in LogService.log() before adding to store | Sensitive data never enters store or localStorage, reducing security risk |
| Circular buffer stats | Keep totalReceived/totalDropped cumulative even when clearing entries | Full usage history preserved for debugging |
| Setup store pattern | defineStore with setup function (ref/computed/actions) | Better TypeScript inference and composition patterns |
| Quick pre-checks | Simple regex pre-checks before expensive full patterns | Performance optimization for high-frequency logging |
| Virtual scroll for 1000+ entries | Use v-virtual-scroll for log viewer performance | Handles large log buffers without rendering all DOM nodes |
| 300ms search debounce | Debounce search input with useDebounce composable | Prevents excessive filtering on every keystroke |
| Auto-scroll with pause | Track scroll position, pause on user scroll up with resume button | Users can review historical logs without interference |
| Per-level counts from buffer | Compute from current entries array, not cumulative stats | Counts match visible filtered entries |
| Temporary access mechanisms | Floating FAB + Ctrl+L until Phase 12 footer | Provides access during development before permanent UI |

**v0.2.0 Decisions (Phase 11):**

| Decision | Summary | Impact |
|----------|---------|--------|
| Vite define for __APP_VERSION__ | Use Vite define instead of import.meta.env for build-time version injection | Build-time constant with TypeScript declaration, cleaner usage pattern |
| Simple version string equality | Store version string in localStorage, compare with equality (not semver parsing) | Lightweight version-gating sufficient for disclaimer reset |
| Parent-controlled disclaimer check | App.vue controls timing of checkAndShow(), not DisclaimerDialog onMounted | Avoids component mounting timing issues |
| persistent + scrim props | Use persistent + scrim for blocking modal (no hide-overlay or no-click-animation) | Correct Vuetify pattern for blocking dialogs |
| Dual exposure methods | Expose checkAndShow() for version check and show() for manual re-open | Separation of concerns for version-gated vs unconditional display |

### v0.2.0 Design Notes

- Footer (#E5AA94 background) integrates disclaimer status, FAQ trigger, and log viewer toggle
- Logging subsystem and trust signals are built independently, then wired into footer in Phase 12
- Temporary access mechanisms (dev shortcuts) used in Phases 10-11 before footer exists
- JSON config files (faqConfig.json, disclaimer config, log config) are build-time assets
- Reference projects: RequiForm (palette, FAQ), phentrieve (disclaimer, LogViewer), kidney-genetics-db (footer, logging)

### Pending Todos

None yet.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-01-27T10:22:00Z
Stopped at: Completed 11-01-PLAN.md (Disclaimer Subsystem)
Resume file: None

## Next Steps

1. Execute Plan 11-02 (FAQ Dialog) to complete Phase 11
2. Complete Phase 12 (App Footer Integration) to wire everything together

---
*Updated: 2026-01-27 after completing Phase 11 Plan 01*
