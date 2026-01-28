---
phase: 21-api-service-layer
plan: 01
subsystem: api
tags: [zod, better-sqlite3, electron, vep, hpo, clinical-thresholds]

# Dependency graph
requires:
  - phase: 20-annotation-core
    provides: variant_annotations and case_variant_annotations tables, annotation IPC patterns
provides:
  - ApiCache service with SQLite backend and TTL expiration
  - Zod schemas for VEP and HPO API response validation
  - NetworkStatus service for online/offline detection
  - Clinical threshold classification functions (CADD, REVEL, SpliceAI, gnomAD)
affects: [22-vep-api-client, 23-hpo-api-client, 24-annotation-ui]

# Tech tracking
tech-stack:
  added: [zod@3.x, bottleneck@2.x, nock@13.x (dev)]
  patterns: [prepared-statements-caching, ttl-jitter, clinical-score-classification]

key-files:
  created:
    - src/main/services/api/ApiCache.ts
    - src/main/services/api/schemas/vep-response.ts
    - src/main/services/api/schemas/hpo-response.ts
    - src/main/services/api/clinical-thresholds.ts
    - src/main/services/network/NetworkStatus.ts
    - src/shared/types/api-enrichment.ts
  modified: []

key-decisions:
  - "Zod for runtime validation: TypeScript-first, automatic type inference, 2kb bundle"
  - "TTL jitter (±10%): Prevents thundering herd on cache expiration"
  - "Prepared statements in constructor: Avoid SQL reparsing overhead"
  - "Clinical thresholds from ACMG/ClinGen: CADD >= 20, REVEL >= 0.644, SpliceAI >= 0.2"
  - "NetworkStatus singleton: Point-in-time checks, future event-based detection if needed"

patterns-established:
  - "Zod schema pattern: Optional fields for VEP responses that vary by variant type"
  - "Cache result types: Success/failure discriminated unions with offline flag"
  - "Classification functions: Return 'pathogenic' | 'uncertain' | 'benign' | 'unknown'"

# Metrics
duration: 7min
completed: 2026-01-28
---

# Phase 21 Plan 01: API Service Layer Summary

**Zod-validated VEP/HPO schemas, SQLite cache with TTL jitter, clinical thresholds (CADD/REVEL/SpliceAI), and NetworkStatus singleton**

## Performance

- **Duration:** 7 min
- **Started:** 2026-01-28T23:21:48Z
- **Completed:** 2026-01-28T23:28:54Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments
- VEP response schema validates transcript consequences, scores (CADD, REVEL, SpliceAI), and gnomAD frequencies
- HPO autocomplete schema validates NLM Clinical Tables API tuple format
- ApiCache service with prepared statements, TTL jitter, and prefix-based clearing
- Clinical threshold classification functions based on ACMG guidelines
- NetworkStatus service using Electron net.isOnline()

## Task Commits

Each task was committed atomically:

1. **Task 1: Create zod schemas for VEP and HPO responses** - `2d210f2` (feat)
2. **Task 2: Create ApiCache service for SQLite caching** - `0fce9a2` (feat)
3. **Task 3: Create NetworkStatus service and clinical thresholds** - `5e1eb46` (feat)

## Files Created/Modified

### Created
- `src/main/services/api/schemas/vep-response.ts` - Zod schema for VEP REST API (transcript consequences, scores, frequencies)
- `src/main/services/api/schemas/hpo-response.ts` - Zod schema for HPO autocomplete API (tuple format)
- `src/main/services/api/ApiCache.ts` - SQLite cache with TTL expiration and jitter
- `src/main/services/network/NetworkStatus.ts` - Online/offline detection singleton
- `src/main/services/api/clinical-thresholds.ts` - ACMG threshold constants and classification functions
- `src/shared/types/api-enrichment.ts` - Type definitions for VepFetchResult, HpoSearchResult, CacheSizeInfo
- `tests/main/services/api/schemas.test.ts` - Schema validation tests (11 tests)
- `tests/main/services/api/ApiCache.test.ts` - Cache service tests (13 tests)
- `tests/main/services/network/NetworkStatus.test.ts` - Network status tests (3 tests)
- `tests/main/services/api/clinical-thresholds.test.ts` - Threshold classification tests (24 tests)

### Modified
- `package.json` - Added zod, bottleneck dependencies
- `package-lock.json` - Lockfile updated
- `src/main/services/api/schemas/vep-response.ts` - Fixed z.record type signature (linter)

## Decisions Made

1. **Zod for runtime validation**: TypeScript-first schema library with automatic type inference and small bundle (2kb). Validates VEP responses that vary by variant type (intergenic vs coding, available scores).

2. **TTL jitter (±10%)**: ApiCache adds 0.9-1.1x multiplier to TTL to prevent thundering herd when many entries expire simultaneously. 30-day TTL becomes 27-33 days.

3. **Prepared statements in constructor**: All SQL statements prepared once during ApiCache construction to avoid reparsing overhead on each cache operation.

4. **Clinical thresholds from ACMG/ClinGen**:
   - CADD >= 20 (pathogenic), <= 10 (benign)
   - REVEL >= 0.644 (pathogenic), <= 0.29 (benign) - Pejaver et al. 2022
   - SpliceAI >= 0.2 (pathogenic), <= 0.1 (benign) - Walker et al. 2023
   - gnomAD AF > 0.05 (common), < 0.001 (very rare)

5. **NetworkStatus singleton**: Simple point-in-time check using net.isOnline(). No polling in this phase. Future enhancement: event-based detection if needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed nullable coalescing in getCacheStats**
- **Found during:** Task 2 (ApiCache implementation)
- **Issue:** ESLint error - using `||` with nullable numbers (0 evaluates to false, returns wrong default)
- **Fix:** Changed `result.vep_count || 0` to `result.vep_count ?? 0` (nullish coalescing)
- **Files modified:** src/main/services/api/ApiCache.ts
- **Verification:** Lint passes, test with 0 cache entries returns correct 0 count
- **Committed in:** 5e1eb46 (Task 3 commit)

**2. [Rule 1 - Bug] Fixed z.record type signature**
- **Found during:** Task 1 verification (typecheck)
- **Issue:** Zod 3.x requires both key and value types for z.record()
- **Fix:** Changed `z.record(z.number())` to `z.record(z.string(), z.number())`
- **Files modified:** src/main/services/api/schemas/vep-response.ts
- **Verification:** Typecheck passes
- **Committed in:** 5e1eb46 (Task 3 commit)

**3. [Rule 1 - Bug] Fixed TTL test race condition**
- **Found during:** Task 2 testing
- **Issue:** Tests using setTimeout with short TTL (0.001 days) failed due to jitter making expiration time unpredictable
- **Fix:** Manually insert expired entries with past expiration times instead of relying on TTL calculation
- **Files modified:** tests/main/services/api/ApiCache.test.ts
- **Verification:** All 13 tests pass consistently
- **Committed in:** 0fce9a2 (Task 2 commit)

**4. [Rule 3 - Blocking] Removed unused imports**
- **Found during:** Lint check
- **Issue:** VepResponseItemSchema and VepTranscriptConsequenceSchema imported but not used in test file
- **Fix:** Removed unused imports
- **Files modified:** tests/main/services/api/schemas.test.ts
- **Verification:** Lint passes
- **Committed in:** 5e1eb46 (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (3 bugs, 1 blocking)
**Impact on plan:** All auto-fixes necessary for correctness and passing CI. No scope creep.

## Issues Encountered

None - all tasks completed as planned.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 22 (VEP API Client):**
- Zod schemas validate VEP REST API responses
- ApiCache prepared for VEP response caching
- NetworkStatus ready for offline detection
- Clinical thresholds ready for score color-coding in UI

**Ready for Phase 23 (HPO API Client):**
- Zod schema validates HPO autocomplete responses
- ApiCache prepared for HPO term caching
- Type definitions for HpoTerm in shared types

**Dependencies satisfied:**
- api_cache table exists (migration v2)
- better-sqlite3-multiple-ciphers available
- Electron net module available

**Test coverage:**
- 51 tests across 4 test files
- All schemas, cache operations, thresholds, and network status tested

---
*Phase: 21-api-service-layer*
*Completed: 2026-01-28*
