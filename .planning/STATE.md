# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-28)

**Core value:** External collaborators can analyze variant data offline with data-dense UX for research use
**Current focus:** Phase 22 - Case Metadata

## Current Position

Phase: 21 of 24 (API Service Layer) → VERIFIED ✓
Plan: 3 of 3 + post-phase UI polish
Status: Phase verified and complete
Last activity: 2026-01-29 - Added online/offline indicator to footer

Progress: [████░░░░░░░░░░░░░░░░] 21/24 phases (87.5% complete, v0.4.0 in progress)

## Milestone History

- **v0.1 POC** - 8 phases, 17 plans - shipped 2026-01-27
- **v0.2.0 UI Polish & Trust Signals** - 4 phases, 8 plans - shipped 2026-01-27
- **v0.3.0 Cohort Analysis, Security & Import Enhancements** - 6 phases, 13 plans - shipped 2026-01-28
- **v0.4.0 Variant Annotation & Case Metadata** - 6 phases (19-24), 6 plans complete - in progress

## Performance Metrics

**v0.3.0 Velocity (completed):**
- Total plans completed: 13 plans
- Total execution time: ~2 days
- Phases completed: 6 phases (13-18)

**v0.4.0 Velocity (in progress):**
- Total plans completed: 9
- Total execution time: 64.9 minutes (8.5 + 16 + 5 + 4.4 + 4 + 6 + 7 + 6 + 8)
- Phases planned: 6 phases (19-24)

**By Phase:**

| Phase | Plans | Status | Notes |
|-------|-------|--------|-------|
| 19. Database Foundation | 2/2 | Complete | Schema + migrations + encrypted DB tests |
| 20. Annotation Core | 4/4 + UAT | Complete | 01: Backend, 02: UI Display, 03: Mutation Methods, 04: ACMG/Comment UI + post-UAT: per-case stars/ACMG, global indicators, cohort mode |
| 21. API Service Layer | 3/3 | Complete | 01: API infrastructure (cache, schemas, thresholds, network status), 02: VEP API client (rate limiting, MANE Select), 03: HPO API client + IPC handlers |
| 22. Case Metadata | TBD | Not started | Status + cohorts + HPO |
| 23. Side Panel UI | TBD | Not started | Drawer + tabs + UI |
| 24. Custom Tags + HPO | TBD | Not started | Tags + autocomplete |

## Accumulated Context

### Decisions

All decisions archived in milestone roadmaps. Key architectural decisions carried forward:

| Decision | Summary | Impact |
|----------|---------|--------|
| better-sqlite3-multiple-ciphers | SQLCipher encryption with same API surface | Core persistence layer |
| FTS5 | Full-text search for gene autocomplete and cohort search | Query patterns |
| Cursor pagination | Efficient large result sets (single-case) | API contract |
| Streaming import | Memory-efficient JSON parsing | Import architecture |
| Warm palette theme | #a09588 primary, #424242 secondary | All UI components |
| URL template system | User-configurable external links | Extensible links |
| DatabaseManager lifecycle | Open/close/switch with rollback safety | Database management |
| PRAGMA user_version migrations | Version-tracked schema upgrades, no migrations table | v0.4.0+ schema evolution |
| Separate global/per-case annotations | variant_annotations has no FK to variants | Annotations persist across cases |
| Temp file testing pattern | Real encrypted temp DBs with cleanup for SQLCipher tests | Test patterns for encrypted databases |
| Atomic annotation upsert | INSERT ON CONFLICT DO UPDATE with COALESCE | Race-free partial updates (20-01) |
| Boolean to INTEGER conversion | IPC layer converts boolean to 0/1 for SQLite | Clear separation of concerns (20-01) |
| Optimistic UI updates | Update UI immediately before IPC completes, revert on failure | Better UX for star toggle (20-02) |
| Annotation cache by variant key | Cache keyed by chr:pos:ref:alt, not database ID | Enables cache hits across case boundaries (20-02) |
| Bulk annotation loading | Load all visible variants in parallel via Promise.all() | Minimizes IPC overhead (20-02) |
| variantId as parameter for per-case | Per-case methods require variantId from caller (item.id) | Avoids extra lookup IPC (20-03) |
| Delete as null-upsert wrapper | Delete comment methods call upsert with null | Preserves other annotation fields (20-03) |
| Emit-based component communication | AcmgMenu/CommentDialog emit events, caller handles persistence | Clean separation, testable components (20-04) |
| Slot-based activator pattern | Menu uses slot for custom activator element | Flexible UI integration (20-04) |
| Per-case starred and ACMG | Stars and ACMG classification stored in case_variant_annotations, not variant_annotations | Different cases can classify same variant differently (post-UAT fix) |
| Schema migration v3 | Added starred, acmg_classification, acmg_evidence columns to case_variant_annotations | Supports per-case annotation workflow |
| Global annotation visibility | Global annotations show in Case mode with ring indicator (box-shadow) | Users see global context when analyzing cases |
| Cohort mode global annotations | CohortTable has star/ACMG/comment controls for global annotations | Consistent annotation UX across views |
| Ring indicator for global | `.has-global` CSS class with `box-shadow: 0 0 0 2px rgba(primary, 0.4)` | Subtle visual distinction without clutter |
| Consolidated annotation column | Star, ACMG, Comment in single column with `ga-1` gap | Compact table layout |
| Zod for API validation | TypeScript-first schema library with automatic type inference | Runtime type safety for VEP/HPO responses (21-01) |
| TTL jitter in ApiCache | ±10% randomization prevents thundering herd | 30-day TTL becomes 27-33 days (21-01) |
| Prepared statements for cache | SQL prepared once in constructor | Avoids reparsing overhead (21-01) |
| Clinical thresholds from ACMG | CADD >= 20, REVEL >= 0.644, SpliceAI >= 0.2 | Evidence-based score classification (21-01) |
| NetworkStatus singleton | Point-in-time net.isOnline() checks | Offline-first API pattern (21-01) |
| Bottleneck rate limiting | 15 req/sec (67ms minTime), 55k req/hour reservoir | Prevents Ensembl API overload (21-02) |
| Exponential backoff on 429 | 1s, 2s, 4s with 50-100% jitter, max 3 retries | Spreads retry traffic, avoids thundering herd (21-02) |
| Request cancellation | AbortController aborts pending requests | Prevents wasted API calls and stale data (21-02) |
| Chromosome normalization | Remove chr prefix, standardize MT | Consistent cache keys across notation variations (21-02) |
| MANE Select prioritization | MANE Select > canonical > first transcript | Clinical best practice for transcript selection (21-02) |
| Lazy singleton IPC handlers | API clients created on first IPC call, not at startup | Avoids database dependency at initialization (21-03) |
| Offline-first cache access | IPC handlers check NetworkStatus, return cached data if offline | Graceful degradation without errors (21-03) |
| Courtesy rate limiting for HPO | 200ms delay (5 req/sec) despite no documented limits | Good API citizenship (21-03) |
| Min 2 chars for HPO search | Return empty array for queries < 2 characters | Prevents excessive API calls, matches autocomplete UX (21-03) |
| navigator.onLine for renderer | Use browser API instead of IPC for network status in UI | Simpler, event-based updates, no IPC overhead (21 post-phase) |

Recent decisions from v0.3.0 affecting v0.4.0:
- FTS5 rebuild for schema upgrades ensures all columns indexed
- LIMIT/OFFSET pagination for cohort aggregation (GROUP BY)
- Tab navigation for Case Analysis / Cohort Analysis views

### Pending Todos

None yet (v0.4.0 just started).

### Blockers/Concerns

**From v0.3.0 known issues:**
- OMIM disease name extraction deferred (MIM numbers only)
- Cohort performance not profiled with 50+ cases
- Franklin URL format has LOW confidence

**v0.4.0 critical considerations:**
- ✅ Foreign keys verified ON with test guard (Phase 19-02)
- ✅ Schema migration tested on encrypted databases (Phase 19-02)
- ✅ ACMG and starred are per-case (post-UAT design change, migration v3)
- VEP API platform transition in 2026 may break response parsing

## Session Continuity

Last session: 2026-01-29 - Phase 21 Plan 03
Stopped at: Completed 21-03-PLAN.md - HPO API client and IPC layer
Resume file: None

---
*Next step: Phase 22 (Case Metadata)*
