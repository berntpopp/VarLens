What this change does: A cohort row is now identified by six fields (chromosome, position, ref, alt, variant type, genome build) instead of four. Both backends build the row key from all six and look up carriers with all six, so two rows at one coordinate no longer share a key, an expansion state or a carrier list. The new request shape is carried through IPC, preload, the worker, the web route, OpenAPI, the renderer query and the dev mock.

I assumed the usual load: one desktop user or a small web team, cohorts up to about 10k exomes.

**Must fix**

1. **Cohort details panel now shows a false "Imprecise" label on SV rows** (`src/renderer/src/components/VariantDetailsPanel.vue:53`, `src/renderer/src/components/variant-details/ExtensionDetailsSection.vue:65-70`)
   - **What this is:** The details panel renders `ExtensionDetailsSection` for every variant, in case view and cohort view. The section shows itself when the row's `variant_type` is `sv`, `cnv` or `str`.
   - **Problem:** Cohort rows had no `variant_type` before, so the section stayed hidden. Now they have one, so clicking an SV row in the cohort view shows "Structural Variant", "Length —" and "Precision: Imprecise" for every SV, because the cohort row has no `_sv_is_precise` field. CNV and STR rows show a section of dashes.
   - **Fix:** Add `v-if="mode === 'case'"` to line 53, plus one small panel test with a cohort row of type `sv`. The diff does not touch this file and no test covers it.
   - **If we skip it:** A geneticist reads "Imprecise" on a precise structural variant in the cohort view.

**Nice to have**

2. **PostgreSQL still selects the stored key that nobody reads** (`src/main/storage/postgres/postgres-cohort-summary-query.ts:108`)
   - **What this is:** The select list for cohort pages and exports.
   - **Problem:** `toCohortVariant` now builds the key itself and no longer reads `row.variant_key`, but `cvs.variant_key` is still fetched for every row. SQLite already dropped it.
   - **Fix:** Delete the line.
   - **If we skip it:** One unused text column per row on the wire, and a reader who thinks the stored key is still used.

3. **The paging helper columns now duplicate real columns** (`src/main/database/cohort-keyset-page.ts:24-25,66-75`, `postgres-cohort-summary-query.ts` in `buildSummaryPageSql`, `postgres-cohort-summary-page.ts`)
   - **What this is:** Both backends select `variant_type` and `genome_build` a second time as `_keyset_variant_type` and `_keyset_genome_build` for the paging cursor, then strip them.
   - **Problem:** The rows now carry both fields under their own names, so the aliases and the strip loop do nothing new.
   - **Fix:** Build the cursor from `last.variant_type` and `last.genome_build`; delete the aliases and the `delete row._keyset_*` loop.
   - **If we skip it:** Nothing breaks; about 12 lines stay that must be kept in step by hand.

Checked and found correct:
- **Both backends:** both summaries take `variant_type` and `genome_build` raw from `variants` and `cases`, and both carrier queries filter on exactly those columns, so count and list agree.
- **Cohort view:** the row key is used only as an opaque value in the table, expansion, selection and the carriers cache.
- **Callers:** every caller of `getCarriers` in `src/` sends the object, and old four-argument requests are rejected before storage on IPC and on the web route.
- **Export:** it uses a fixed column list, so the new key does not leak into files.

Verdict: Ship.

## Applied fixes (Round 1 follow-up)
1. Added `v-if="mode === 'case'"` to `ExtensionDetailsSection` in `VariantDetailsPanel.vue` so that cohort rows lacking per-call SV fields like `_sv_is_precise` do not show a false "Imprecise" label. Added test coverage in `VariantDetailsPanel.cohort-mode.test.ts`.
2. Removed unused `cvs.variant_key` from PostgreSQL cohort summary select list in `postgres-cohort-summary-query.ts`.

