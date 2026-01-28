# Phase 21: API Service Layer - Context

**Gathered:** 2026-01-28
**Status:** Ready for planning

<domain>
## Phase Boundary

VEP and HPO API clients providing enriched variant/phenotype data with SQLite caching, rate limiting, and graceful offline degradation. All API calls proxied through Electron main process. Responses validated with zod schemas.

</domain>

<decisions>
## Implementation Decisions

### Error & Offline Behavior
- API errors (timeout, 500, malformed response) show toast notification with retry option
- Proactive offline detection on app start and before API calls, with offline indicator in UI
- When offline, show cached data with "Offline - showing cached data" badge
- No cache AND offline: show "No VEP data available - connect to internet to fetch" explanation

### Cache Freshness Display
- Timestamp badge near VEP section header: "Cached Jan 15, 2026"
- Manual refresh button next to cache timestamp to force re-fetch
- Auto-fetch expired cache (>30 days) when variant viewed and online
- Settings page: "Clear VEP cache" and "Clear HPO cache" as separate buttons
- Show cache storage size next to clear buttons (e.g., "API cache: 12 MB")
- Same 30-day TTL for both VEP and HPO caches
- During refresh: show stale data with small spinner, update when fresh arrives

### VEP Data Selection
- Default to MANE Select transcript, user can select others via dropdown
- Dropdown menu lists all available transcripts for the variant
- Standard clinical field set: CADD, REVEL, SpliceAI, gnomAD AF, consequence, impact
- Color-coded scores based on clinical significance thresholds (CADD >20, REVEL >0.5, etc.)

### Rate Limiting & Performance
- Auto-fetch VEP data when side panel opens (if not cached)
- No prefetch of visible variants, only fetch on panel open
- Loading state: spinner with "Fetching VEP data..." text
- Cancel previous pending request when user selects new variant (no queue)

### Claude's Discretion
- Exact threshold values for color-coding (use established clinical thresholds)
- Specific toast duration and styling
- Offline detection implementation approach
- AbortController pattern for request cancellation

</decisions>

<specifics>
## Specific Ideas

- MANE Select as default transcript (clinically preferred over canonical)
- Standard clinical set mirrors common VEP plugins in clinical pipelines
- Color thresholds should match ClinGen/ACMG guidance where applicable

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-api-service-layer*
*Context gathered: 2026-01-28*
