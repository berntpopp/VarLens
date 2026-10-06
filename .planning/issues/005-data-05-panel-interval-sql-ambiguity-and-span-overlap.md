---
id: "DATA-05"
number: 5
title: "Panel interval filter SQL column ambiguity and point-in-interval SV span miss"
priority: "P1 - Critical"
tags: ["data-integrity", "filtering", "database", "parity", "bug"]
affected_files:
  - "src/main/database/VariantFilterBuilder.ts"
  - "src/main/database/cohort.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [DATA-05] Panel interval filter SQL column ambiguity and point-in-interval SV span miss

| Attribute | Value |
|---|---|
| **Priority** | **P1 - Critical** |
| **Tags** | `data-integrity` `filtering` `database` `parity` `bug` |
| **Affected Files** | `src/main/database/VariantFilterBuilder.ts`, `src/main/database/cohort.ts` |
| **Audited Snippet** | `In VariantFilterBuilder.ts:377, eb('chr', '=', iv.chr) emits unqualified 'chr', causing 'ambiguous c...` |

---

## Technical Context & Audited Impact
Panel filtering crashes on joins or silently omits large SVs intersecting target regions.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

# DATA-05 review: panel interval filter (column ambiguity and SV overlap)

## 1. Technical assessment

**Both defects are real in `HEAD` (`8a662b89`). Two of the three code paths are already fixed. The fix for the last one exists only as uncommitted changes in your working tree, on the unrelated `feat/variant-simulator` branch.**

| Path | Ambiguous `chr` | Misses spanning SVs | Status |
|---|---|---|---|
| `VariantFilterBuilder.build()`, fewer than 50 intervals (OR chain) | **Yes**: `eb('chr','=',…)`, `eb('pos',…)` | Yes | Fixed in working tree only |
| `VariantFilterBuilder.build()`, 50 or more intervals (`_panel_intervals` temp table) | No (qualified as `variants.chr`) | Yes: `variants.pos BETWEEN pi.start_pos AND pi.end_pos` | Fixed in working tree only |
| `cohort.ts:110-121` (SQLite cohort) | No | No | Fixed in `HEAD` (`6e178eaa`, schema v30 added `end_pos`) |
| `postgres-variant-clinical-filter-sql.ts:38-45` (Postgres) | No | No | Already correct |

**Root cause of the crash.** `build()` always LEFT JOINs `variant_frequency as vf` on `chr, pos, ref, alt` (`VariantFilterBuilder.ts:124-130`). `variant_frequency` has its own `chr` and `pos` columns (`migrations.ts:1243-1244`). Kysely's `eb('chr', …)` produces a bare `"chr"`, so SQLite fails with `ambiguous column name: chr`. The finding says this happens "when joined". In fact the join is unconditional, so **every** single-case panel filter with fewer than 50 intervals fails. That is the common case for a curated gene panel. It only stayed hidden because large panels take the temp-table path.

**Root cause of the SV miss.** The code tests whether the start position falls inside the interval. It should test whether the variant's span overlaps the interval: `pos <= iv.end AND COALESCE(end_pos, pos) >= iv.start`. Example: a 2 Mb deletion starting upstream of a panel gene that covers the whole gene is silently dropped. For SNVs and indels (`end_pos IS NULL`) the result is the same as before.

**Edge cases the fix should handle:**
- **Breakends (BND/TRA):** `end_pos` must not hold the mate's position on another chromosome, or the span becomes meaningless. Check what `VcfMapper` writes to `end_pos` for `SVTYPE=BND`. Either store `NULL` there, or guard the overlap with `end_pos >= pos`.
- **Coordinate convention:** if panel intervals come from BED files (0-based, half-open), the inclusive `<=`/`>=` bounds are off by one at the start. Confirm the conversion happens where intervals are created.
- **Index use:** in the overlap predicate only `pos <= end` can use the `(chr, pos)` index, so queries scan from the start of the chromosome. That is acceptable at case scale. For whole-genome (WGS) cases, consider adding a lower bound such as `pos >= start - MAX_SV_LEN` so the index can narrow the range.
- **Cohort parity:** the cohort SQLite and Postgres paths are already on overlap semantics. Fixing `VariantFilterBuilder` brings the single-case view into line.

## 2. Severity and priority

**P1 (Critical).**
- **Crash:** the panel filter, a core clinical feature, throws on every typical (fewer than 50 intervals) single-case query. That is a complete loss of the feature for most panels.
- **Silent false negatives:** in a diagnostic tool, a filter that hides causal SVs/CNVs covering a panel gene is a data-integrity failure. The user gets no signal that anything is missing.

It is not P0 because a workaround exists (gene-symbol filtering) and no data is corrupted.

## 3. Labels

`bug`, `data-integrity`, `parity`, `sql`, `structural-variants`, `clinical-safety`

## 4. Issue specification

**Title:** `fix(db): panel interval filter crashes with ambiguous "chr" and misses spanning SVs in single-case view`

**Description and reproduction**
1. Import a case that contains an SNV at `1:250` and a deletion with `pos=100`, `end_pos=500` (for example from `tests/test-data/vcf/` plus an SV record).
2. In the single-case view, apply a panel filter with one interval `{chr:'1', start:200, end:300}`.
   - **Actual:** the IPC call returns `SqliteError: ambiguous column name: chr`.
3. Apply 50 or more intervals, so the query takes the temp-table path.
   - **Actual:** the SNV is returned and the deletion is not.
4. Run the same interval in the cohort view or the Postgres backend.
   - **Actual:** both variants are returned. The single-case view and the cohort view disagree.

**Expected behavior**
- Both interval paths qualify every column (`variants.chr`, `variants.pos`).
- Both paths use closed-interval overlap: `variants.chr = :chr AND variants.pos <= :end AND COALESCE(variants.end_pos, variants.pos) >= :start`.
- The single-case view, SQLite cohort and Postgres cohort return the same result set for the same panel.

**Proposed fix**
1. **Land the existing working-tree change as its own PR** on `fix/panel-interval-overlap`, off `main`, not on `feat/variant-simulator`. It touches:
   - `src/main/database/VariantFilterBuilder.ts`: a raw `sql` overlap predicate on both paths, plus an index on `_panel_intervals (chr, start_pos, end_pos)`;
   - the matching tests in `tests/main/database/variant-filter-builder.test.ts` (spanning SV, flanking non-overlap, point SNV, and the temp-table path).
2. **Add a regression test that would have caught the crash:** execute (not just compile) a fewer-than-50-interval filter through `build()` with the `variant_frequency` join present.
3. **Prevent recurrence:** inside `build()`, ban bare `eb('<col>')` references, because every query there has the `vf` join. Add a short note in the builder, or a test that compiles each filter field and asserts no unqualified `"chr"`/`"pos"` appear.
4. **Breakend guard:** confirm `end_pos` is `NULL` or the same-chromosome end for BND records. If it is not, add `AND (variants.end_pos IS NULL OR variants.end_pos >= variants.pos)`, and apply the same predicate in all three backends so they stay consistent.
5. **Verification:** `make typecheck`, then `make rebuild-node && make test`. Run `VARLENS_WEB=1 make test` as well, to confirm Postgres results still match.

**Scope note:** I did not execute the old query to reproduce the crash. That conclusion comes from reading the code: the join is unconditional, both tables have `chr`/`pos`, and Kysely emits bare identifiers. Steps 1–2 of the reproduction (or the new tests run against `HEAD`) will confirm it.
