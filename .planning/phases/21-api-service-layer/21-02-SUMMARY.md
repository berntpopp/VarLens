---
phase: 21-api-service-layer
plan: 02
subsystem: api
tags: [vep, bottleneck, rate-limiting, caching, mane-select, transcript-selection]

# Dependency graph
requires:
  - phase: 21-api-service-layer
    plan: 01
    provides: ApiCache, VepResponseSchema, clinical-thresholds
provides:
  - VepApiClient with rate limiting and caching
  - MANE Select transcript selection logic
  - Chromosome normalization for cache keys
  - Request cancellation for rapid variant selection
affects: [21-03-vep-ipc-handler, 22-annotation-ui]

# Tech tracking
tech-stack:
  added: [nock@13.x (dev)]
  patterns: [bottleneck-rate-limiting, exponential-backoff, request-cancellation, transcript-prioritization]

key-files:
  created:
    - src/main/services/api/VepApiClient.ts
    - tests/main/services/api/VepApiClient.test.ts
  modified:
    - src/shared/types/api-enrichment.ts

key-decisions:
  - "Bottleneck rate limiting: 15 req/sec (67ms minTime), 55k req/hour reservoir"
  - "Exponential backoff on 429: 1s, 2s, 4s with 50-100% jitter to spread retries"
  - "Request cancellation via AbortController: prevents wasted requests when user selects new variant"
  - "Chromosome normalization: remove chr prefix, standardize MT for consistent cache keys"
  - "MANE Select > canonical > first: clinical best practice for transcript selection"
  - "GET endpoint over POST: more reliable for single-variant queries per REST API docs"

patterns-established:
  - "VepFetchResult includes preferredTranscript and allTranscripts for UI consumption"
  - "extractScores calculates SpliceAI max delta from 4 individual deltas"
  - "normalizeChromosome utility for consistent cache key generation"

# Metrics
duration: 6min
completed: 2026-01-28
---

# Phase 21 Plan 02: VEP API Client Summary

**VEP REST API client with Bottleneck rate limiting (15 req/sec), SQLite caching (30d TTL), request cancellation, and MANE Select transcript prioritization**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-28T23:33:52Z
- **Completed:** 2026-01-28T23:40:01Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- VepApiClient fetches from Ensembl VEP REST API with GET endpoint
- Bottleneck rate limiter enforces 15 req/sec and 55k req/hour
- 429 responses trigger exponential backoff (1s, 2s, 4s) with jitter
- AbortController cancels in-flight requests when user selects new variant
- Zod validation on all responses before caching
- 30-day TTL with ±10% jitter (27-33 days actual)
- Chromosome normalization (chr prefix removal, MT standardization)
- MANE Select transcript selection with canonical fallback
- extractScores calculates SpliceAI max delta from 4 individual delta scores
- 25 comprehensive tests with nock HTTP mocking

## Task Commits

Each task was committed atomically:

1. **Task 1: Create VepApiClient with Bottleneck rate limiting** - `bbf2d51` (feat)
2. **Task 2: Add MANE Select transcript selection** - `7aac530` (feat)
3. **Linter fixes** - `7daacf8` (fix)

## Files Created/Modified

### Created
- `src/main/services/api/VepApiClient.ts` - VEP API client with rate limiting, caching, cancellation
- `tests/main/services/api/VepApiClient.test.ts` - 25 tests (nock mocking, rate limit, caching, transcript selection)

### Modified
- `src/shared/types/api-enrichment.ts` - Added preferredTranscript and allTranscripts to VepFetchResult success type

## Decisions Made

1. **Bottleneck rate limiting**: Configured for Ensembl VEP limits (15 req/sec via 67ms minTime, 55k req/hour via reservoir). Serializes requests (maxConcurrent: 1) for predictable behavior and easier debugging.

2. **Exponential backoff on 429**: Retry delays of 1s, 2s, 4s (max 3 retries) with 50-100% jitter to spread retry traffic and avoid thundering herd. Bottleneck's `failed` event listener returns delay for automatic retry.

3. **Request cancellation via AbortController**: When user rapidly selects different variants in UI, previous pending request is cancelled to avoid wasted API calls and stale data overwriting fresh data. AbortError is re-thrown to signal cancellation upstream.

4. **Chromosome normalization**: Remove "chr" prefix (chr1 → 1) and standardize mitochondrial (M/mt → MT) for consistent cache keys. Prevents duplicate cache entries for same variant with different chromosome notation.

5. **MANE Select prioritization**: Clinical best practice is MANE Select transcript (when available), falling back to canonical, then first transcript. MANE Select is the joint NCBI-EMBL-EBI clinically relevant transcript set.

6. **GET endpoint over POST**: VEP REST API GET endpoint more reliable for single-variant queries than POST batch endpoint. POST has stricter rate limits and occasional parsing issues per research phase findings.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed strict-boolean-expressions linter violations**
- **Found during:** Post-Task 2 lint check
- **Issue:** ESLint strict-boolean-expressions rule requires explicit null/undefined checks. Error objects in Bottleneck callback are `any` type, nullable strings (mane_select) require explicit checks
- **Fix:**
  - Extract error message to variable with ternary operator and explicit type narrowing
  - Use `!== undefined` checks for optional transcript properties (mane_select, canonical)
  - Added type assertions `(error as { message: string })` to satisfy type checker
- **Files modified:** src/main/services/api/VepApiClient.ts, tests/main/services/api/VepApiClient.test.ts
- **Verification:** `npm run lint` passes
- **Committed in:** 7daacf8 (fix commit)

**2. [Rule 3 - Blocking] Removed unused import**
- **Found during:** Lint check
- **Issue:** `vi` imported but not used in test file (was likely scaffolded but not needed)
- **Fix:** Removed `vi` from vitest imports
- **Files modified:** tests/main/services/api/VepApiClient.test.ts
- **Verification:** Lint passes
- **Committed in:** 7daacf8 (fix commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** All fixes necessary for passing CI. No scope creep.

## Issues Encountered

None - all tasks completed as planned. Nock HTTP mocking worked well for testing rate limiting and retry behavior.

## User Setup Required

None - VepApiClient is ready for IPC integration. No API keys required (Ensembl VEP REST is public).

## Next Phase Readiness

**Ready for Phase 21-03 (VEP IPC Handler):**
- VepApiClient fully functional with rate limiting and caching
- VepFetchResult type includes preferredTranscript and allTranscripts for UI
- Chromosome normalization ensures cache hits across notation variations
- Request cancellation ready for integration with IPC handler

**Ready for Phase 22 (Annotation UI):**
- MANE Select transcript selection provides clinical best practice
- extractScores provides UI-ready score object with SpliceAI max delta
- getAllTranscripts enables transcript dropdown in side panel

**Dependencies satisfied:**
- ApiCache available from 21-01
- VepResponseSchema validates responses from 21-01
- clinical-thresholds.getSpliceAIMaxDelta available from 21-01

**Test coverage:**
- 25 tests covering:
  - Successful fetch and caching
  - 429 retry with exponential backoff
  - Network error handling
  - Invalid response format (Zod validation)
  - Request cancellation
  - Chromosome normalization (chr prefix, MT variants)
  - MANE Select/canonical/first transcript selection
  - Score extraction with SpliceAI max delta calculation
  - Cache clearing

---
*Phase: 21-api-service-layer*
*Completed: 2026-01-28*
