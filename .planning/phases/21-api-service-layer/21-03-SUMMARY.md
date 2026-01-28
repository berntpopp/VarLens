---
phase: 21-api-service-layer
plan: 03
subsystem: api
tags: [hpo, vep, ipc, preload, nock, electron]

# Dependency graph
requires:
  - phase: 21-api-service-layer
    plan: 01
    provides: ApiCache, VepApiClient, NetworkStatus, Zod schemas
provides:
  - HpoApiClient with NLM Clinical Tables API integration
  - VEP and HPO IPC handlers with offline detection
  - window.api.vep and window.api.hpo preload APIs
affects: [22-variant-side-panel, 23-phenotype-autocomplete]

# Tech tracking
tech-stack:
  added: []
  patterns: [lazy-singleton-ipc-handlers, offline-fallback-to-cache]

key-files:
  created:
    - src/main/services/api/HpoApiClient.ts
    - src/main/ipc/handlers/vep.ts
    - src/main/ipc/handlers/hpo.ts
    - tests/main/services/api/HpoApiClient.test.ts
  modified:
    - src/main/ipc/index.ts
    - src/preload/index.ts
    - src/shared/types/api.ts
    - src/main/services/api/VepApiClient.ts

key-decisions:
  - "Lazy singleton initialization: IPC handlers create API clients on first use to avoid database dependency at startup"
  - "Offline-first cache access: IPC handlers check NetworkStatus and return cached data if offline"
  - "Courtesy rate limiting for HPO: 200ms delay (5 req/sec) to avoid overwhelming NLM API despite no documented limits"
  - "Min 2 chars for HPO search: Prevents excessive API calls and improves autocomplete UX"

patterns-established:
  - "IPC handler pattern: Check NetworkStatus -> Try cache if offline -> Call API client if online"
  - "getCached() methods: API clients expose cached data retrieval for offline IPC handlers"
  - "Typed preload APIs: VepAPI and HpoAPI interfaces ensure type safety across IPC boundary"

# Metrics
duration: 8min
completed: 2026-01-28
---

# Phase 21 Plan 03: HPO API Client and IPC Layer Summary

**HpoApiClient with NLM Clinical Tables API, VEP/HPO IPC handlers with offline detection, and typed preload API extensions**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-28T23:33:52Z
- **Completed:** 2026-01-28T23:41:48Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- HpoApiClient searches HPO terms by name, ID, and synonyms via NLM Clinical Tables API
- 30-day caching with courtesy rate limiting (5 req/sec) despite no documented API limits
- VEP IPC handlers: vep:fetch, vep:cancel, vep:clearCache, vep:getCacheStats
- HPO IPC handlers: hpo:search, hpo:clearCache
- NetworkStatus integration: offline detection returns cached data with offline flag
- Lazy singleton initialization: API clients created on first IPC call to avoid startup database dependency
- Typed preload API: window.api.vep and window.api.hpo with full TypeScript support
- 10 comprehensive HpoApiClient tests with nock mocks (100% pass rate)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create HpoApiClient with caching** - `0a3d2fe` (feat)
2. **Task 2: Create VEP and HPO IPC handlers** - `33ef09e` (feat)
3. **Task 3: Extend preload API and shared types** - `df206f9` (feat)

## Files Created/Modified

### Created
- `src/main/services/api/HpoApiClient.ts` - HPO autocomplete client with NLM Clinical Tables API integration
- `src/main/ipc/handlers/vep.ts` - VEP IPC handlers with offline detection and cache access
- `src/main/ipc/handlers/hpo.ts` - HPO IPC handlers with offline detection and cache access
- `tests/main/services/api/HpoApiClient.test.ts` - 10 tests for HPO client (search, cache, rate limiting, timeout)

### Modified
- `src/main/ipc/index.ts` - Registered vep and hpo handler modules
- `src/preload/index.ts` - Added window.api.vep and window.api.hpo implementations
- `src/shared/types/api.ts` - Added VepAPI, HpoAPI interfaces and exported enrichment types
- `src/main/services/api/VepApiClient.ts` - Fixed unused parameter and linter errors (strict boolean expressions)

## Decisions Made

1. **Lazy singleton initialization in IPC handlers**: API clients (VepApiClient, HpoApiClient) are instantiated on first IPC call, not at startup. This avoids database dependency issues during app initialization and reduces startup time.

2. **Offline-first cache access**: IPC handlers check `NetworkStatus.getStatus()` before API calls. If offline, they attempt to return cached data with `offline: true` flag. This enables graceful degradation without errors.

3. **Courtesy rate limiting for HPO**: Even though NLM Clinical Tables API has no documented rate limits, we implement 200ms delay (5 req/sec) to be a good API citizen and avoid potential issues.

4. **Min 2 chars for HPO search**: HpoApiClient returns empty array for queries < 2 characters. This prevents excessive API calls and matches autocomplete UX best practices.

5. **getCached() methods**: Both VepApiClient and HpoApiClient expose `getCached()` methods for IPC handlers to retrieve cached data when offline. This separates cache access logic from network-dependent API calls.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed unused ref parameter in VepApiClient**
- **Found during:** Task 2 typecheck
- **Issue:** TypeScript error - `ref` parameter declared but never used in `makeVepRequest()`
- **Root cause:** VEP API endpoint only needs chr:pos and alt allele, not ref allele
- **Fix:** Prefixed parameter with underscore: `_ref: string` to indicate intentionally unused
- **Files modified:** src/main/services/api/VepApiClient.ts
- **Verification:** Typecheck passes
- **Committed in:** 33ef09e (Task 2)

**2. [Rule 1 - Bug] Fixed strict boolean expression linter errors in VepApiClient**
- **Found during:** Task 3 lint check
- **Issue:** ESLint strict-boolean-expressions errors on nullable/any values in conditionals
- **Errors:**
  - Line 77-83: Checking `error.message` on `any` type without proper type guards
  - Line 221: Using `||` with nullable `response.headers.get('Retry-After')`
  - Line 278: Checking truthy `tc.mane_select` (nullable string) in find predicate
- **Fix:**
  - Added explicit type assertions: `(error as { message: unknown }).message`
  - Changed `||` to `??` for nullish coalescing
  - Changed `tc.mane_select` to `tc.mane_select !== undefined`
- **Files modified:** src/main/services/api/VepApiClient.ts
- **Verification:** Lint passes with no errors
- **Committed in:** df206f9 (Task 3)

**3. [Rule 3 - Blocking] Removed unused import in VepApiClient test**
- **Found during:** Task 3 lint check
- **Issue:** `vi` imported from vitest but never used
- **Fix:** Linter automatically removed unused import
- **Files modified:** tests/main/services/api/VepApiClient.test.ts
- **Verification:** Lint passes
- **Committed in:** df206f9 (Task 3)

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking)
**Impact on plan:** All auto-fixes necessary for passing CI. No scope creep.

## Issues Encountered

None - all tasks completed as planned.

## User Setup Required

None - no external service configuration required. HPO API is public, VEP API is public.

## Next Phase Readiness

**Ready for Phase 22 (Variant Side Panel with VEP):**
- window.api.vep.fetch() available for fetching variant annotations
- VepFetchResult type exported for UI type safety
- Offline detection returns cached data with offline indicator
- VepApiClient.cancelPendingRequest() enables rapid variant selection without stale data

**Ready for Phase 23 (Phenotype Autocomplete with HPO):**
- window.api.hpo.search() available for autocomplete
- HpoSearchResult type exported for UI type safety
- 2-character minimum prevents excessive API calls
- Offline detection returns cached terms

**Dependencies satisfied:**
- VepApiClient exists from plan 21-01 (discovered during execution)
- ApiCache, NetworkStatus, Zod schemas from plan 21-01
- api_cache table exists (migration v2)

**Test coverage:**
- 10 new HpoApiClient tests (search, cache, rate limiting, timeout, clearCache)
- All 282 existing tests pass (100% pass rate)
- TypeScript strict checks pass
- ESLint strict-boolean-expressions pass

**IPC channels registered:**
- vep:fetch, vep:cancel, vep:clearCache, vep:getCacheStats
- hpo:search, hpo:clearCache

**Preload API complete:**
- window.api.vep with full TypeScript support
- window.api.hpo with full TypeScript support

---
*Phase: 21-api-service-layer*
*Completed: 2026-01-28*
