**Scope note:** the range you named also contains the five row-identity commits (#503), because the merge base is the docs commit `a5e18286`. I reviewed the eleven carrier-cap commits (`b0fc3f17..HEAD`) in depth and only skimmed the #503 part. I changed no file; the empty `.planning/code-review/2026-10-08-max-carrier-cases-filter-ponytail-review.md` is untouched.

What this change does: It adds a filter "seen in at most N cases" to the case view and the cohort view, on SQLite and PostgreSQL. The case view reads the per-variant case count (`variant_frequency.case_count`), the cohort view reads the stored carrier count of the cohort summary. It also adds one built-in preset, "Rare, not recurrent", through SQLite migration v45 and PostgreSQL migration 0028.

I found no wrong result, no missed backend and no missing cohort counterpart.

**Should fix**

1. **The committed code does not pass the format gate** (`src/renderer/src/utils/filters/activeFilters.ts:1`, `filterSerialization.ts:1`, `presetApplication.ts:123`, `src/renderer/src/composables/useFilters.ts:197-198`, plus nine test files)
   - **What this is:** The last commits added imports and test lines for the carrier cap.
   - **Problem:** At `HEAD` two imports use double quotes and sit above the file header comment, several lines are too long, and `filters.value.maxCarriers = null` is written twice. The fixes exist only as uncommitted changes in 13 files, and the pre-push check tests the committed state.
   - **Fix:** Commit the 13 working-tree files. Move the two import lines below the header comment in the same commit.
   - **If we skip it:** `make ci` and the pre-push hook fail on `format-check`.

2. **The case-view export does not say that the cap was on** (`src/main/ipc/handlers/export-logic.ts:150-165`, `src/main/workers/export-pipeline.ts:127-139`, `src/shared/types/export-worker.ts:42-49`, `src/web/server/downloads/export-artifacts.ts:155-166`)
   - **What this is:** The export writes a metadata sheet that lists the active filters, so a reader knows why rows are missing.
   - **Problem:** With the cap on, the exported rows are filtered, but the sheet lists only gene, impact, consequence, ClinVar, gnomAD and CADD. The cohort export does write "Max Carrier Cases". The internal frequency filter has the same gap already.
   - **Fix:** Add `carrier_count_max` to `ExportFilterSummary`, to `buildFilterSummary`, to the web `filterSummary` and as one row in `export-pipeline.ts`. That is about five lines plus one assertion in the export test.
   - **If we skip it:** A colleague opens the file, does not find a recurrent variant, and nothing in the file explains it.

**Nice to have**

3. **A very large number gives an error instead of "no limit"** (`src/renderer/src/utils/filters/maxCarriers.ts:7-15`, `src/shared/types/ipc-schemas.ts:131-136,243-248`)
   - **What this is:** The field accepts any whole number of at least 1 and sends it to the query.
   - **Problem:** In the cohort view on PostgreSQL, `3000000000` passes the schema, but `carrier_count` is a 32-bit column (`0010_cohort_summary.sql:25`), so PostgreSQL rejects the value. A 17-digit number fails the schema's integer check on both backends. I derived this from the code and did not run it.
   - **Fix:** Clamp in `parseMaxCarriers` and `activeMaxCarriers`, for example `Math.min(Math.floor(typed), 1_000_000)`.
   - **If we skip it:** A slip on the keyboard shows an error where the user expects an unfiltered table. It goes away when the number is corrected.

4. **The filtering page of the user docs does not mention the new field** (`docs/features/filtering.md:42-47`)
   - **What this is:** The page lists the filters of the drawer; the preset page already describes the new preset.
   - **Problem:** A user who sees "Seen in at most N cases" finds no explanation that N counts the open case too, or that the case view and the cohort view can differ while the summary is being rebuilt.
   - **Fix:** One bullet under "Population & Scores".
   - **If we skip it:** Users guess what N means.

Verdict: fix 1 first; 2 belongs in the same PR.

Not checked: I could not run any test, typecheck or Prettier here (the session blocked `node` and `vitest`), so everything above is from reading the code, and finding 1 rests on what the uncommitted diff changes. I did not open the app, so I did not confirm whether the field keeps showing a typed `0` or `2.7` while the applied cap is off or `2`.
