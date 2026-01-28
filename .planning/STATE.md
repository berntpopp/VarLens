# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-28)

**Core value:** External collaborators can analyze variant data offline with data-dense UX for research use
**Current focus:** v0.4.0 — Variant Annotation & Case Metadata

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-01-28 — Milestone v0.4.0 started

Progress: Not started

## Milestone History

- **v0.1 POC** -- 8 phases, 17 plans -- shipped 2026-01-27
- **v0.2.0 UI Polish & Trust Signals** -- 4 phases, 8 plans -- shipped 2026-01-27
- **v0.3.0 Cohort Analysis, Security & Import Enhancements** -- 6 phases, 13 plans -- shipped 2026-01-28

## Accumulated Context

### Decisions

All decisions from v0.1 are archived in `.planning/milestones/v0.1-ROADMAP.md`.
v0.2.0 decisions are archived in `.planning/milestones/v0.2.0-ROADMAP.md`.
v0.3.0 decisions are archived in `.planning/milestones/v0.3.0-ROADMAP.md`.

Key architectural decisions carried forward:

| Decision | Summary | Impact |
|----------|---------|--------|
| better-sqlite3-multiple-ciphers | SQLCipher encryption with same API surface | Core persistence layer |
| FTS5 | Full-text search for gene autocomplete and cohort search | Query patterns |
| Cursor pagination | Efficient large result sets (single-case) | API contract |
| LIMIT/OFFSET pagination | Cohort aggregation (GROUP BY) | Cohort queries |
| Streaming import | Memory-efficient JSON parsing | Import architecture |
| Warm palette theme | #a09588 primary, #424242 secondary | All UI components |
| HTTPS-only + domain whitelist | shell:openExternal validates protocol and hostname | Security pattern |
| URL template system | User-configurable external links | Extensible links |
| DatabaseManager lifecycle | Open/close/switch with rollback safety | Database management |
| Tab navigation | Case Analysis / Cohort Analysis tabs | UI structure |

### Pending Todos

None yet.

### Blockers/Concerns

None.

### Research Flags

- Performance profiling with 50+ cases for cohort aggregation queries
- Franklin URL format verification (LOW confidence)
- Ensembl VEP REST API rate limits and response format for variant annotation
- HPO ontology API availability and response structure
- PubTator/LitVar API integration patterns

## Session Continuity

Last session: 2026-01-28
Stopped at: v0.4.0 milestone started, defining requirements
Resume file: None

## Next Steps

**v0.4.0 milestone started.** Research → Requirements → Roadmap in progress.

---
*Updated: 2026-01-28 after v0.4.0 milestone start*
