---
phase: 15-external-links
plan: 01
subsystem: ui
tags: [external-links, url-builders, genomic-databases, gnomad, clinvar, omim, ucsc, varsome, franklin, shell-security]

# Dependency graph
requires:
  - phase: 14-database-selection
    provides: Database manager and encryption UI (sets foundation for external data reference)
provides:
  - Pure URL builder functions for 8 external genomic databases
  - Expanded shell domain allowlist with 6 genomic database domains
  - Comprehensive unit tests for URL construction logic
  - GenomeBuild type for genome-build-aware URL construction
affects: [15-02-external-links-ui, variant-table-enhancements]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure-url-builders, genome-build-aware-urls, explicit-null-checks, domain-allowlist-security]

key-files:
  created:
    - src/renderer/src/utils/externalLinks.ts
    - tests/renderer/externalLinks.test.ts
  modified:
    - src/main/ipc/handlers/shell.ts

key-decisions:
  - "Pure functions take primitive parameters (not full Variant object) for testability and reuse"
  - "null return means 'cannot construct link, show dash placeholder' in UI layer"
  - "ClinVar coordinate search (chr:pos:ref:alt) used for Phase 15 since Variant interface lacks clinvar_id field"
  - "OMIM gene search (by gene_symbol) used for Phase 15 since Variant interface lacks omim_mim_number field"
  - "Franklin URL format has LOW confidence from research; isolated in single function for easy updates"
  - "Explicit null checks (chr == null || chr === '') required by @typescript-eslint/strict-boolean-expressions rule"

patterns-established:
  - "URL builders: Pure functions, zero side effects, synchronous, null return on missing data"
  - "URL encoding: Applied to user-data components (ref, alt, search terms) but not structural parts (chr, pos)"
  - "Genome build mapping: GRCh37 → gnomAD v2/hg19, GRCh38 → gnomAD v4/hg38"
  - "Security: HTTPS-only + domain allowlist enforced by shell.openExternal IPC handler"

# Metrics
duration: 3.5min
completed: 2026-01-27
---

# Phase 15-01: External Links Foundation Summary

**Pure URL builder functions for 8 genomic databases (gnomAD, ClinVar, OMIM, UCSC, VarSome, Franklin) with genome-build-aware URL construction and expanded shell domain allowlist**

## Performance

- **Duration:** 3.5 min
- **Started:** 2026-01-27T21:08:45Z
- **Completed:** 2026-01-27T21:12:10Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Eight URL builder functions exported from `externalLinks.ts` with genome-build-aware URL construction for gnomAD, ClinVar, OMIM, UCSC Genome Browser, VarSome, and Franklin
- Comprehensive unit tests (46 test cases) covering valid inputs, null rejection, URL encoding, and position clamping
- Shell domain allowlist expanded from 2 to 8 domains, enabling secure external links to genomic databases
- Pure functions with zero side effects, suitable for reuse across UI components

## Task Commits

Each task was committed atomically:

1. **Task 1: Create URL builder utility functions** - `cf53f80` (feat)
2. **Task 2: Write unit tests for URL builders** - `c7029c5` (test)
3. **Task 3: Expand shell.ts domain allowlist** - `00d7cbc` (feat)

**Deviation fix:** `a350bdf` (fix: explicit null checks for strict boolean expressions)

## Files Created/Modified

- `src/renderer/src/utils/externalLinks.ts` - Pure URL builder functions for 8 external databases, GenomeBuild type
- `tests/renderer/externalLinks.test.ts` - 46 unit tests covering all URL builders
- `src/main/ipc/handlers/shell.ts` - Expanded ALLOWED_DOMAINS with 6 genomic database domains

## Decisions Made

1. **Pure functions with primitive parameters** - URL builders take individual parameters (chr, pos, ref, alt) rather than full Variant object for testability and reuse across different contexts
2. **null return semantics** - null return means "cannot construct link, show dash placeholder" - UI layer interprets null as no link available
3. **ClinVar coordinate search for Phase 15** - Use chr:pos:ref:alt search URL since Variant interface lacks clinvar_id field (future phases may add ID-based links)
4. **OMIM gene search for Phase 15** - Use gene symbol search since Variant interface lacks omim_mim_number field (future phases may add MIM-based links)
5. **Franklin URL format uncertainty** - Franklin URL format has LOW confidence from research; isolated in single function for easy updates if format changes
6. **Explicit null checks** - @typescript-eslint/strict-boolean-expressions rule requires explicit null/empty checks (chr == null || chr === '') instead of truthy checks (!chr)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Use explicit null checks for strict boolean expressions**
- **Found during:** Task 1 verification (lint errors after initial implementation)
- **Issue:** Initial implementation used truthy checks (!chr, !pos) which violate @typescript-eslint/strict-boolean-expressions project linting rule
- **Fix:** Replaced all truthy checks with explicit null/empty checks (chr == null || chr === '', pos == null || pos <= 0)
- **Files modified:** src/renderer/src/utils/externalLinks.ts
- **Verification:** All 46 tests still pass, lint errors cleared
- **Committed in:** a350bdf (separate fix commit after Task 3)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Essential fix to comply with project linting standards. No scope creep - same validation logic, different syntax.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 15-02 (External Links UI):**
- URL builders are pure, testable, and ready for UI integration
- Domain allowlist includes all target databases
- GenomeBuild type available for genome-build detection from variant data
- ClinVar coordinate search and OMIM gene search URLs ready for current schema

**Future enhancements (Phase 17+):**
- buildClinvarUrl (ID-based) ready when clinvar_id field added to schema
- buildOmimUrl (MIM-based) ready when omim_mim_number field added to schema
- Franklin URL format may need adjustment based on real-world testing

**No blockers or concerns.**

---
*Phase: 15-external-links*
*Completed: 2026-01-27*
