**TL;DR:** Current preselection can omit a high-priority variant solely because it was imported late. Improve candidate coverage while bounding memory.

**Priority:** P2 · Enhancement.

**Evidence:** SQLite and PostgreSQL shortlist paths select the first `topN × 4` candidates by ascending ID before scoring. For a top-50 tier, later candidates beyond the first 200 per type cannot enter the ranking. This is a disclosed current limit, not an undisclosed regression.

**Implementation guide:**

- Read eligible candidates in bounded pages and use the existing scorer/comparator to retain the best top N.
- Keep pinning, tie ordering and candidate-count reporting explicit and consistent between backends.
- Measure realistic cases before choosing chunk sizes or adding caching. Do not retune scoring weights as part of this change.

**Acceptance:** Place the highest-scoring and pinned variants after candidate 200; both must be considered. Shuffle import IDs and verify equivalent ranked biological variants. Check bounded memory, cancellation and measured query time on an appropriately sized fixture.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

