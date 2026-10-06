---
id: "ARCH-02"
number: 14
title: "PostgreSQL vs SQLite query parity gaps in clinical filters and type handling"
priority: "P1 - Critical"
tags: ["parity", "data-integrity", "filtering", "web", "bug"]
affected_files:
  - "src/main/storage/postgres/postgres-variant-clinical-filter-sql.ts"
  - "src/main/database/VariantFilterBuilder.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [ARCH-02] PostgreSQL vs SQLite query parity gaps in clinical filters and type handling

| Attribute | Value |
|---|---|
| **Priority** | **P1 - Critical** |
| **Tags** | `parity` `data-integrity` `filtering` `web` `bug` |
| **Affected Files** | `src/main/storage/postgres/postgres-variant-clinical-filter-sql.ts`, `src/main/database/VariantFilterBuilder.ts` |
| **Audited Snippet** | `Discrepancies in handling NULL values, regex operators, and interval boundaries between SQLite Kysel...` |

---

## Technical Context & Audited Impact
Inconsistent filtering behavior between desktop and web modes.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

I reviewed both builders against each other. ARCH-02 points at a real problem, but the audit text gets the details wrong: there are no regex operators anywhere, and the base NULL handling already matches between the two backends. The real gap is in **panel filtering**, where each backend can drop variants the other keeps. This is a static review only: I ran no queries or tests.

---

## 1. Technical assessment

**Claims that don't hold up**
- **Regex operators:** neither backend uses them. Text matching is `LIKE … COLLATE NOCASE` in SQLite and `ILIKE` in Postgres, and both are case-insensitive.
- **NULL handling in the shared filters:** the two backends match. `gnomad_af_max`, `cadd_min` and `max_internal_af` keep NULLs in both (`VariantFilterBuilder.ts:307-334` vs `PostgresVariantReadRepository.ts:144-158`). Range filters on base columns default to keeping empty values in both. Range filters on extension columns (`sv.*`, `cnv.*`, `str.*`) default to dropping them in both (`variant-extension-registry.ts:268` vs `PostgresVariantReadRepository.ts:292`).
- **Starred, comment, ACMG and inheritance filters:** these are equivalent. The trio inheritance SQL (de novo, recessive, compound het) is copied line-for-line.

**Confirmed gaps**

| # | Gap | SQLite (desktop) | Postgres (web) |
|---|---|---|---|
| A | How a variant is matched to a panel region (single-case view) | Variant's start position must fall inside the region: `pos >= start AND pos <= end` (`VariantFilterBuilder.ts:377`). The temp-table path for 50+ regions does the same: `pos BETWEEN` (`:384`). | Variant must overlap the region: `pos <= end AND COALESCE(end_pos,pos) >= start` (`postgres-variant-clinical-filter-sql.ts:43`) |
| B | How the active panel is turned into a filter (single-case view) | Always converted to genomic regions: gene coordinates ± `panel_padding_bp` (default 5 kb) for the chosen genome build (`db-worker-dispatch.ts:63-118`) | **Never converted.** `PostgresVariantReadRepository` has no region resolver, so the filter falls back to `pg.symbol = v.gene_symbol`, joined through `case_active_panels` (`postgres-variant-clinical-filter-sql.ts:49-58`). Padding and genome build are ignored. |
| C | Column filter with a non-numeric value on a numeric column (e.g. `cadd < 'abc'`) | SQLite sorts every number before every text value, so `cadd < 'abc'` is true for all non-NULL rows. The filter silently passes everything. | Throws `22P02 invalid input syntax for type double precision`. The whole query fails. |

**Root cause:** the overlap fix ("Pass-9 #7", see the comment in `cohort.ts:110-118`) went into the SQLite cohort query only, not the single-case builder. Region resolution likewise exists only in `PostgresCohortRepository.resolvePanelParams`, not in the Postgres single-case path. The two backends have no shared filter definition and no test that compares their results, so each fix landed in one place only. There is even a TODO in `VariantFilterBuilder.ts:508` noting the duplicated logic.

**Edge cases that matter clinically**
- **Gap A (desktop drops variants):** a large deletion or duplication that starts before a panel gene and covers it (e.g. a CNV over an entire gene) is **excluded** on desktop but included on web and in the desktop cohort view. That is a missed diagnosis.
- **Gap B (web drops variants):** web excludes variants within the padding outside the gene (splice-region, UTR, promoter), structural variants with no `gene_symbol`, variants annotated with an old or alias gene symbol, and multi-gene symbol strings. An `active_panel_ids` list that isn't stored in `case_active_panels` returns **zero rows**.

## 2. Severity: **P1 (Critical)**

Gene panels are the main clinical restriction in VarLens. Gap A affects desktop users today, and desktop is the shipped product. Gap B means the same case and panel give different variant counts on web and desktop. Both failures are silent missed findings, with no error shown. Gap C is lower risk (P3) on its own and is folded in here.

## 3. Labels

`bug`, `data-integrity`, `parity`, `clinical-safety`, `architecture`, `backend:sqlite`, `backend:postgres`

## 4. Issue specification

**Title:** `fix(filters): single-case panel filter diverges between SQLite (start-position-only) and Postgres (gene-symbol fallback, no padding)`

**Description and reproduction**
1. Create a case containing:
   - a CNV DEL with `pos = geneStart - 10000` and `end_pos = geneEnd + 10000`;
   - an SNV at `geneEnd + 2000` with `gene_symbol = NULL` (intergenic, inside the 5 kb padding);
   - an SNV inside the gene.
2. Activate a panel containing that gene (padding 5000, GRCh38) and run `variants:query`.
3. **Desktop:** returns {SNV in gene, SNV in padding} and drops the spanning CNV.
   **Web (`VARLENS_WEB=1`):** returns {SNV in gene, CNV} (the CNV only if it carries the gene symbol) and drops the SNV in the padding.
   **Desktop cohort view:** returns all three.
4. Separately, apply a column filter `{ cadd: { operator: '<', value: 'abc' } }`. SQLite returns every row with a CADD score; Postgres returns an error.

**Expected behavior**
- Every backend and view (desktop single-case, desktop cohort, web single-case, web cohort) returns the same set of variants for the same panel filter.
- That set uses the overlap rule: `chr = ? AND pos <= end AND COALESCE(end_pos, pos) >= start`.
- Regions are resolved the same way everywhere: gene coordinates ± padding for the chosen genome build.
- An invalid numeric column-filter value is rejected the same way on both backends, at the shared validation step before any SQL is built.

**Proposed fix**
1. **SQLite single-case (`VariantFilterBuilder.ts:370-387`):** switch both the OR-chain path and the 50+ region path to the overlap rule. Add `end_pos` handling via `COALESCE(variants.end_pos, variants.pos)` in the temp-table `EXISTS`. Check that `idx_variants_case_coords` still serves the query, and keep the start-position bound so the index can still be used.
2. **Postgres single-case:** move `resolvePanelParams` / `resolvePanelIntervals` out of `PostgresCohortRepository` into a shared Postgres panel-region resolver. Call it from `PostgresVariantReadRepository` (and from `PostgresShortlistService` / export) before the SQL is built. Delete the gene-symbol `EXISTS` fallback in `addPanelFilter`. If resolution fails, throw. Never silently widen the query: this matches the contract documented in `panelIntervalHelper.ts`.
3. **Type handling:** add a check in `src/shared/` that each column-filter value fits the column type (`numeric` vs `categorical`, reusing `POSTGRES_VARIANT_COLUMN_DEFINITIONS[*].kind`). Reject a non-finite numeric value with a validation error on both backends.
4. **Architecture guardrail:** add a two-backend parity test, alongside `tests/web-gate/parity/`, that runs one table of filters (panel regions including the spanning-SV and padding cases, NULL-inclusive ranges, annotation scope, inheritance modes) through both `VariantFilterBuilder` and `buildPostgresVariantQueryParts` on the same fixture and checks the returned variant IDs are identical. Longer term, resolve the `VariantFilterBuilder.ts:508` TODO with a single shared filter representation that each backend translates to its own SQL.
5. **Scope:** the same change must cover cohort views, as the project's parity rule requires. The cohort SQLite path already uses the overlap rule, so the main work is the single-case fixes plus the parity test.
