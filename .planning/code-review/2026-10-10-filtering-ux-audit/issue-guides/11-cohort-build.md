**TL;DR:** A cohort URL must restore its genome build as well as its filters.

**Priority:** P2 · Bug.

**Evidence:** `components/CohortView.vue` binds filters and type to URL state but not build. `useCohortData.ts` initializes GRCh38 and only substitutes another build when GRCh38 is unavailable. A GRCh37 view can therefore reopen against GRCh38 when both exist.

**Implementation guide:**

- Bind selected build through the existing `useUrlParam` mechanism.
- Validate it after available builds load; explicitly report an unavailable linked build.
- Keep table requests, panel resolution and export on the same restored scope. Coordinate persisted snapshots with #124.

**Acceptance:** With both builds present, reload and share a GRCh37 URL containing filters and variant type. Assert unchanged build, matching IDs and export scope. Cover browser back/forward and a linked build absent from the destination database.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

