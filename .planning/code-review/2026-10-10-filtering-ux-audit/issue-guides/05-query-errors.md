**TL;DR:** A failed query currently leaves old case rows visible without an error, making them look like results for the new filters.

**Priority:** P1 · Bug.

**Evidence:** `useOffsetPagination.ts` exposes an error and retains rows/count, but `components/variant-table/useVariantData.ts` does not forward that error. In a synthetic browser check, an HTTP 500 left the previous rows/count visible with no alert.

**Implementation guide:**

- Pass the existing error through to `VariantTable.vue`.
- Reuse the cohort error/retry pattern. If retaining old rows during a same-case refresh, label them as previous results until the new query succeeds.
- Distinguish first-load failure, failed refresh and a successful zero-result query.
- Preserve existing request-order guards.

**Acceptance:** Force initial failure and failure after a successful filter request. Both show an actionable error; Retry uses current filters; stale rows are identified; a successful empty response still shows the normal no-matches state. Test the real composable/component boundary.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

