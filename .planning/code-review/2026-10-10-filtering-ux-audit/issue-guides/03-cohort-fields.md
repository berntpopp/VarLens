**TL;DR:** A cohort filter must constrain results or produce an error. Some advertised fields currently disappear or are rejected downstream.

**Priority:** P1 · Bug.

**Evidence:** The DSL canonicalizes CADD to `cadd`, while cohort allowlists use `cadd_phred`. A synthetic cohort probe applying `cadd:>=:1000` retained all 50 rows. PostgreSQL's summary column-filter map also omits `cdna` and `aa_change`. Case-only `qual` and `gt_num` need explicit cohort scope handling.

**Implementation guide:**

- Align the canonical key and legacy aliases in `column-registry.ts`, SQLite `database/cohort.ts`, and PostgreSQL `postgres-cohort-summary-query.ts`.
- Also update `PostgresCohortRepository.ts` `SUPPORTED_COLUMN_FILTERS`: changing SQL mappings alone is insufficient because validation runs first.
- Make autocomplete and validation scope-aware; never silently discard unsupported conditions.
- Keep summary and extension-query fallback paths consistent.

**Acceptance:** Run input → parser → request → actual row IDs/count/page/export tests on SQLite and live PostgreSQL. Cover CADD and its aliases, cDNA, protein change, null values, unsupported case-only fields, and an extension-filter fallback.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

