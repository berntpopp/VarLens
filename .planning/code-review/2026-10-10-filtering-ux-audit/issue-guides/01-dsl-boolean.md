**TL;DR:** Valid-looking expressions can execute a different query. Preserve their meaning; reject unsupported expressions before changing applied filters.

**Priority:** P1 · Bug.

**Evidence:** In `src/renderer/src/dsl/translator.ts`, repeated-field AND keeps only the last rule, same-field OR becomes IN regardless of operator, and cross-field OR becomes AND. The recently added duplicate-field warning does not prevent execution; the integration does not surface translation warnings.

Examples:

- `cadd:>=:20 AND cadd:<=:30` loses the lower bound.
- `cadd:<:10 OR cadd:>:20` becomes membership in 10 and 20.
- `gene:=:BRCA1 OR cadd:>=:20` becomes an intersection.

**Implementation guide:**

- Return structured translation errors and reject atomically before clearing drawer state, resolving presets or emitting requests.
- Only equality alternatives on one field can safely become IN. Validate preset combinations too; scalar overwrite/array union is not logical AND.
- Deliver rejection first. Supporting ranges, nested AND/OR and NOT later requires an expression tree through shared contracts and both query builders.

**Acceptance:** Table-driven expressions assert actual matching IDs on SQLite and PostgreSQL. Invalid/unsupported expressions preserve the previous query and show the offending condition. Keep equality OR, aliases, null checks and extension fields working.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

