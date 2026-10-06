---
id: "ARCH-01"
number: 13
title: "Source file size exceeding 600-line LLM sustainability limit"
priority: "P3 - Medium"
tags: ["architecture", "dx", "refactor", "tech-debt"]
affected_files:
  - "src/main/database/VariantFilterBuilder.ts"
  - "src/main/workers/import-pipeline.ts"
  - "src/renderer/src/composables/useAnnotations.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [ARCH-01] Source file size exceeding 600-line LLM sustainability limit

| Attribute | Value |
|---|---|
| **Priority** | **P3 - Medium** |
| **Tags** | `architecture` `dx` `refactor` `tech-debt` |
| **Affected Files** | `src/main/database/VariantFilterBuilder.ts`, `src/main/workers/import-pipeline.ts`, `src/renderer/src/composables/useAnnotations.ts` |
| **Audited Snippet** | `Multiple core files exceed 600-800 lines with high cyclomatic complexity, violating AGENTS.md guardr...` |

---

## Technical Context & Audited Impact
Reduced agent comprehension, brittle refactoring, high maintenance overhead.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

# ARCH-01 review: oversized source files

## 1. Technical assessment

The audit is **partly valid**. I checked it against the repo at `fdbf5fab`:

| File | Lines | In `agent-health-baseline.json`? | Verdict |
|---|---|---|---|
| `src/main/database/VariantFilterBuilder.ts` | 782 | Yes (ceiling 782) | **Valid. The real problem is one function, not the file length.** |
| `src/renderer/src/composables/useAnnotations.ts` | 923 | Yes (ceiling 923) | **Valid**, mainly because of duplicated per-case and global code |
| `src/main/workers/import-pipeline.ts` | 594 | No | **Invalid.** It is under the 600-line limit. `prepareStatements()` (lines 61–278, ~218 lines) is worth watching, but it is not a violation. |

Corrections to the finding:
- **These files don't break the guardrail.** AGENTS.md handles oversized files through `scripts/agent-health-baseline.json`, and both oversized files are listed there with "must not grow" ceilings. They are known debt that can't get bigger, not a CI escape.
- **"High cyclomatic complexity / increasing bug density" is not backed by evidence.** The audit has no metric or defect history behind it. Below I name the specific risks instead.

**Root causes:**

1. **`VariantFilterBuilder.build()` is one ~590-line method (lines 117–708).** That is about 7× the ~80-line function guideline. It handles about 15 separate concerns in order: the internal-AF case count, variant-type joins, extension-table joins with alias-collision rules, simple/array/range filters, FTS, exact match, tags, panel intervals, three scope-dependent annotation filters (starred, comment, ACMG), dynamic column filters and inheritance modes.
2. **There is a known duplicate filter translator.** The TODO at lines 508–514 says the bare-key `column_filters` translator in Path 1 (Kysely) copies `translateColumnFilter` in `variant-where-builder.ts` (Paths 2/3, raw SQL). This is the real correctness risk: two implementations of the same filter can drift apart and return different results in the case view, cohort/shortlist queries and the Postgres read paths.
3. **`useAnnotations` repeats each operation for both scopes.** There are about 8 near-identical per-case/global pairs: `toggleStar`/`toggleGlobalStar`, `setAcmgClassification`/`setGlobalAcmgClassification`, the `…WithEvidence` pair, the upsert-comment and delete-comment pairs, and the getters. A fix to one scope can easily miss the other.

**Edge cases to keep intact in any refactor:**
- Join alias handling: `str_ext` and `str` are both joined on the same table, and sv/cnv joins must not be added twice ("alias already used").
- The panel-interval temp table switches on at 50 or more intervals (`preparePanelIntervals`).
- Starred, comment and ACMG filters behave differently per scope.
- Annotation cache invalidation when the database or case changes (`ensureScopeOrClear`), and the generation counter.

## 2. Severity and priority

**P3 (Medium).** There is no known user-facing defect, and the baseline already stops growth. It ranks above cosmetic work for one reason: the duplicate `column_filters` translator (root cause 2) can cause filter results to differ between query paths, which matters for a clinical filtering tool. That piece should be done first. If a mismatch is ever reproduced, it becomes a P1 `data-integrity` bug.

## 3. Labels

`architecture`, `dx`, `tech-debt`, `parity`, `refactor`

## 4. Issue specification

**Title:** `refactor: break up VariantFilterBuilder.build() and remove per-scope duplication in useAnnotations`

**Description and reproduction**
- `wc -l` shows VariantFilterBuilder at 782 lines and useAnnotations at 923. Both are frozen at those ceilings in `scripts/agent-health-baseline.json`.
- `VariantFilterBuilder.build()` covers lines 117–708 as one method.
- The TODO at `VariantFilterBuilder.ts:508` documents that column-filter logic exists in both this file and `variant-where-builder.ts`.
- `useAnnotations.ts` defines mirrored per-case and global functions (lines 225–860).
- Remove `import-pipeline.ts` from this issue's scope; it is under the limit.

**Expected behavior**
- Both files are under 600 lines and their baseline entries are deleted.
- No function is over ~80 lines.
- `column_filters` semantics live in one place, used by all query paths.
- Public APIs stay the same: `VariantFilterBuilder.build/applySort/preparePanelIntervals`, `SORTABLE_COLUMNS`, and the return value of `useAnnotations()`.
- Generated SQL and parameters are identical before and after for every filter combination.

**Proposed fix (staged PRs, as AGENTS.md asks for):**
1. **Characterization tests first.** Extend `tests/main/database/variant-filter-builder.test.ts` with snapshots of the generated SQL and parameters (`.compile()` output) across a matrix of filters: each variant type, extension filters and sorts, each annotation scope, panel intervals below and at 50, and each inheritance mode. Add a test that runs the same `column_filters` through Path 1 and through `variant-where-builder` and checks they return the same rows.
2. **Split `build()` into small ordered steps** under `src/main/database/variant-filter/`. Each step is a function that takes `(query, filter, ctx)` and returns the updated query:
   - `type-and-extension-joins`
   - `scalar-filters` (simple, array, range and internal-AF filters)
   - `search-filters` (FTS, exact match, tags)
   - `panel-intervals`, including the temp-table setup and cleanup
   - `annotation-scope-filters` (starred, comment, ACMG with one scope switch)
   - `inheritance-filters`

   `VariantFilterBuilder` stays as a thin wrapper that runs these steps, so its callers don't change.
3. **Remove the duplicate translator.** Add a Kysely-aware output to `variant-where-builder.ts` so all three query paths share one `column_filters` translator, then delete the bare-key copy. Cohort, shortlist and Postgres must keep matching the case view; follow the `varlens-cohort-parity` skill.
4. **Refactor `useAnnotations`:**
   - Move the LRU cache and scope tracking into `annotation-cache.ts`.
   - Add `createScopedAnnotationOps(scope: 'case' | 'global')` so each operation is written once.
   - Keep `useAnnotations()` as a wrapper that returns exactly the same object shape, so existing components and `useAnnotations.test.ts` work unchanged.
5. **Close-out.** Delete both baseline entries and run `make agent-check`, `make typecheck` and `make rebuild-node && make test`. The renderer change also needs the `make ci-full` gate and a visual check of starring, ACMG and comments in both scopes.

**Non-goals:** changing filter behavior, implementing `consider_phasing`, and splitting `import-pipeline.ts`.

I only checked line counts, function layout, the baseline and test coverage. I didn't run `make agent-check` (it needed approval) or any tests, because nothing was changed. Several MCP servers failed to connect or need authorization in claude.ai connector settings; none were needed for this review.
