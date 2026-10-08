**What this change does:** The gene burden test now uses only variants on chromosomes 1-22, in cases of one genome build, at sites where every selected sample has a usable call. It weights by minor allele frequency and reports per gene how many sites were used and left out, and per run how many variants were skipped for not being on chromosomes 1-22. Both backends (SQLite and PostgreSQL) and the result table and export were changed.

I could not run `make typecheck` or any test here (the commands needed approval), so everything below comes from reading the code. Load assumed: one desktop user on SQLite, a few web users on PostgreSQL.

## Must fix

1. **The burden tab can no longer load its cases** (`src/renderer/src/components/association/GeneBurdenView.vue:L186-248`)
   - **What this is:** The screen where the user picks two groups of cases and starts the burden test. The plan asked for three small additions here; the last commit (`c262b6de`) rewrote the whole script block instead.
   - **Problem:** Four things break:
     - `loadCasesWithMetadata()` returns `{ cases, cohortGroups }`, but the new code calls `.map` on it. That throws, so the case list stays empty and "Failed to load cases" shows.
     - It calls `window.api.cases.cohortGroups()`, which does not exist anywhere in the preload or shared contracts.
     - `defineExpose({ refresh })` is gone, but `CohortView.vue:152` still calls `burdenViewRef.value?.refresh()`. That throws when the burden tab is active.
     - Two `any` types were added (`no-explicit-any` is an error in the ESLint config), and the scroll style (`overflow-y`, `max-height`) was removed.
   - **Fix:** Restore the script and style blocks from the merge base (`a5e18286a`). Then re-add only the planned lines: `sites_excluded` and `non_autosomal_variants` in the two interfaces, and the `:non-autosomal-variants` prop.
   - **If we skip it:** Nobody can pick groups, so the burden test cannot be started from the app. Typecheck and lint should also fail.

## Should fix

2. **No test mounts the burden screen** (`tests/renderer/components/association/`)
   - **What this is:** The only `GeneBurdenView` test was added on this branch and deleted again in `c262b6de`.
   - **Problem:** Finding 1 passed unnoticed because nothing loads this component in a test.
   - **Fix:** Add one mount test with `useAssociation` mocked. Assert that the cases reach `AssociationConfigPanel` and that `refresh` is exposed.
   - **If we skip it:** The next rewrite of this file breaks the feature the same way.

3. **Unplanned toolbar changes in the result table** (`src/renderer/src/components/association/AssociationResultsTable.vue:L3-24`)
   - **What this is:** The search box, gene counter and Export button above the results.
   - **Problem:** The same commit removed the "N genes" chip and replaced the field's label "Search genes" with a placeholder. A placeholder is not a label, so a screen reader announces an unnamed field. The plan asked for none of this.
   - **Fix:** Restore the toolbar from the merge base. Keep the two note paragraphs and the "Excluded sites" column; the disabled-when-empty Export button is fine to keep.
   - **If we skip it:** Users lose the gene count, and the field has no accessible name.

4. **Two copies of the result row type** (`GeneBurdenView.vue:L124-147`, `src/renderer/src/utils/association-results.ts:L19-44`)
   - **What this is:** The shape of one gene's result, written out once in the view and once in the new util.
   - **Problem:** Both must change together. This branch already had to add `sites_excluded` in both places.
   - **Fix:** Import `AssociationResultRow` in `GeneBurdenView.vue` and delete the local `AssociationResult` interface.
   - **If we skip it:** The next new field is added in one copy and forgotten in the other.

## Nice to have

5. **Removed filters are still dropped without a message** (`src/shared/types/ipc-schemas.ts:L724-734`)
   - **What this is:** The check on a burden run request. `acmg_classifications` and `max_internal_af` were removed from it, as the plan says.
   - **Problem:** A web API caller who sends `max_internal_af: 0.01` gets an unfiltered result and no error. That is still "accepted then dropped" (#510), only one layer earlier. The plan chose this, and the test comment "they are not accepted now" overstates it.
   - **Fix:** Put `.strict()` back on the `filters` object so unknown keys are rejected. `c262b6de` removed it; I did not find out why, so check the panel's payload first.
   - **If we skip it:** The app is unaffected, because the panel never sends these keys. Only direct API callers can be misled.

6. **Unrelated edits in the mock API** (`src/renderer/src/mocks/mockApi.ts:L216-224`)
   - **What this is:** The fake API for browser dev mode.
   - **Problem:** A loop was reshaped and a "Wave 4 — unified shortlist" comment was added. Neither belongs to this change.
   - **Fix:** Revert both; keep only `non_autosomal_variants: 0`.
   - **If we skip it:** Nothing breaks; the diff just carries noise.

7. **`chr1` and `1` are still two different sites** (`AssociationDataBuilder.ts:L135-141`, `PostgresAssociationDataBuilder.ts:L173-179`)
   - **What this is:** The site key is the stored text `chr:pos:ref:alt`. This is older than this branch.
   - **Problem:** If group A's files say `chr1` and group B's say `1`, the same variant becomes two sites. "Variants used" doubles, each frequency is halved, and an unknown call in one spelling does not exclude the other. Carrier counts stay right.
   - **Fix:** Compare the chromosome without its `chr` prefix in the join and the key. This is a follow-up, not part of this plan.
   - **If we skip it:** Weights and site counts are slightly off when the two groups come from pipelines with different chromosome naming.

The statistics code (`contingency.ts`, `weights.ts`, `gene-tests.ts`) and both SQL builders read correctly against the spec. Both backends do the build check, the autosome filter, select-then-collect and the skipped-variant count, and the mixed-build error reaches the user with its message.

Verdict: fix 1 first; 2 and 3 belong in the same commit.
Lean: -25 lines possible.
Not checked: `make typecheck`, lint and every test, including the PostgreSQL-gated parity test. Also the query time of the new second read and the extra count query on a large database, which the plan itself leaves to review.
