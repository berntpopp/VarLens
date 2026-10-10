**TL;DR:** Imported custom INFO values are preserved but cannot be used as discoverable, typed filters.

**Priority:** P2 · Enhancement.

**Evidence:** `src/main/import/vcf/info-field-registry.ts` stores unmapped values in `info_json`; import preview has Type/Number metadata. The current DSL registry and query builders do not expose arbitrary INFO fields. This is a new capability.

**Implementation guide:**

- Start with scalar numeric/text fields actually present in a case; retain validated type/cardinality metadata.
- Reuse existing typed controls, missing-value operations and parameter binding.
- Distinguish absent keys, explicit missing values and numeric zero. Mark arrays/flags unsupported until their semantics are defined.
- Validate field identities/paths; parameterize comparison values.
- Preserve identity/type in saved filters and explain unavailable fields on another case.
- Define cohort aggregation semantics separately and measure JSON query cost before adding indexes.

**Acceptance:** Import a small synthetic VCF containing zero, absent/missing values, scalar text/numbers and arrays. Compare exact IDs/counts/exports on SQLite and PostgreSQL. No string-based numeric ordering or silent coercion; unsupported cardinality has a visible explanation.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

