What this change does: It limits the gene burden test to chromosomes 1–22 of one genome build. It drops any site where a selected sample has an unknown or conflicting call, weights by minor allele frequency, and reports how many sites were left out. Both database builders (SQLite and PostgreSQL) and the shared matrix code were changed; the result view got a new column and a warning.

I could not run anything: `vitest`, `make typecheck` and `prettier` all need approval in this session. Every finding below comes from reading the code.

The backend is sound and matches the spec on both SQLite and PostgreSQL. The result view, the export and the docs (plan Tasks 7 and 8) were not built as planned.

## Must fix

1. **The new "Sites" column shows `NaN`** (`src/renderer/src/components/association/AssociationResultsTable.vue:41`, `:110`)
   - **What this is:** A new table column that should show how many sites each gene's test used.
   - **Problem:** It computes `n_variants - sites_excluded` as if `sites_excluded` were a number. The backend sends an object (`{ missing_call, conflicting_calls, no_called_alleles }`), so every row shows `NaN`. Even with a number it would be wrong, because `n_variants` already is "sites used". The test passes only because it feeds a fake `sites_excluded: 2` and checks that the page contains an "8" somewhere.
   - **Fix:** Delete the "Sites" column and rename "Variants" to "Sites used". Add one "Excluded" column that prints the three counts. Give the test the real object shape and assert on the cell.
   - **If we skip it:** Every burden result shows `NaN` next to each gene.

2. **The required sentence and the exclusion counts are missing from view and export** (`AssociationResultsTable.vue:190-233`, `GeneBurdenView.vue:41-51`)
   - **What this is:** Spec item 7 requires the view and the TSV export to state: "Samples without a stored call are treated as reference. Use data called and filtered the same way for both groups." It also requires the excluded sites per reason.
   - **Problem:** The sentence appears nowhere in `src/`. The export is unchanged: no sites excluded, no non-autosomal count, no sentence. The per-reason counts are shown nowhere. The planned `src/renderer/src/utils/association-results.ts` and its test were not created.
   - **Fix:** Implement plan Task 7 as written: one small util for the sentence, the labels and the TSV text, used by both the table and the export.
   - **If we skip it:** A gene with all sites excluded appears with 0 sites and no p-value, and the user cannot see why. The one assumption the spec says must be stated is never stated.

3. **The docs say the opposite of what the code does** (`docs/features/cohort-analysis.md:42-46`, `.planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md:54-80`, `:94-95`)
   - **What this is:** The user documentation and the decision record for genotype handling.
   - **Problem:** The user doc says "Partial or missing calls … do not disqualify the variant". In the code a `./.` in any selected sample removes the site for everyone. The one-build rule, conflicting duplicates and the required sentence are not mentioned. The decision record got a new paragraph ("Phase 16", "boolean manner", "avoiding data loss") that is wrong, and four old statements were left in that are now false: the association test uses "highest dosage", it "has no missing dosage yet", "an explicit unknown call is dosage 0", and the weight "uses the ALT allele frequency".
   - **Fix:** Replace both texts with the ones written out in plan Task 8, Steps 1 and 2.
   - **If we skip it:** Users are told missing calls are harmless while their sites vanish. The next developer reads a decision record that contradicts the code.

## Should fix

4. **The `no_called_alleles` reason can never be counted** (`src/main/statistics/contingency.ts:181-185`, `tests/main/statistics/contingency.test.ts:131-141`)
   - **What this is:** A site should be excluded when no tested sample calls an allele. Plan Review Focus 4 says that when no sample has complete covariates, every site is `no_called_alleles`.
   - **Problem:** The code adds a fallback (`?? altAlleleFrequency(calls, allIds)`) that the plan does not have, and the plan's test was rewritten to assert the opposite. With the fallback the counter is always 0. Example: the covariate "age" is recorded for nobody. The plan excludes and reports every site; the code keeps them, Fisher runs, and the logistic test returns `NO_SAMPLES`.
   - **Fix:** Decide one way. Either remove the fallback and restore the plan's test (one line), or keep it and delete the dead reason from the type, the counts and the docs. Keeping Fisher alive is defensible, but it is your call to make.
   - **If we skip it:** A reported counter that is always zero, and behaviour that silently differs from the approved plan.

5. **The new engine test is malformed** (`tests/main/statistics/integration.test.ts:320-354`, `:484`)
   - **What this is:** A new test that the run result carries the non-autosomal count.
   - **Problem:** Its body is not indented and its closing `})` is missing. An extra `})` at the end of the file balances it, which puts the whole "parallel execution" suite inside the "DbPool" suite, so that suite's setup now runs for both. Line 180 is also over 100 columns. `make format-check` covers `tests/`, so `make ci` will very likely fail (not run).
   - **Fix:** Close the test where it ends, delete the last line of the file, and run prettier on the file.
   - **If we skip it:** A red format gate, and two suites silently sharing setup.

6. **Renderer fields that do not exist** (`GeneBurdenView.vue:163`, `src/renderer/src/mocks/mockApi.ts:711`, `mockApi.ts:224`)
   - **What this is:** The view's result type and the browser mock.
   - **Problem:** Both add a run-level `sites_excluded: number`. The backend has no such field; it is per gene. The same commit also deleted an unrelated comment about the shortlist stub.
   - **Fix:** Delete the two `sites_excluded` lines and restore the comment.
   - **If we skip it:** The next person trusts the type and reads a field that is always undefined.

## Nice to have

7. **`.strict()` instead of dropping the two filters** (`src/shared/types/ipc-schemas.ts:735`)
   - **What this is:** The plan removes two unused filters from the schema and lets zod drop unknown keys.
   - **Problem:** The code rejects every unknown key instead. The config panel sends only allowed keys today, so nothing breaks now. But its payload type is the full shared filter set, so the first new shared filter that reaches it fails every run with a validation error. Any API client still sending the old fields gets HTTP 400.
   - **Fix:** Remove `.strict()` and use the plan's test, or keep it on purpose and say so in the PR.
   - **If we skip it:** A fragile coupling that surfaces as "burden test broken" after an unrelated filter change.

8. **Wrong comment in the fixture** (`tests/main/database/support/burden-fixture.ts:57`)
   - **What this is:** The shared test dataset for both backends.
   - **Problem:** The comment says `chr1:400`, but the site is `chr1:90`.
   - **Fix:** Change the comment.
   - **If we skip it:** A reader miscounts the expected matrix columns.

Verdict: fix 1, 2, 3 and 5 first.

Lean: about -10 lines possible (findings 4, 6, 7).

Not checked:
- **No test or gate was run.** That includes the PostgreSQL parity test, which is gated behind `VARLENS_RUN_POSTGRES_E2E=1`.
- **Query time of the new collect step is unmeasured.** For each selected site it reads the rows of every case in the database before filtering by case. A run with no filter on a small selection from a 10,000-exome database may be much slower than before. The plan itself left this for review.
- **The two smaller adjusted test files were not read:** `conflicting-genotype-calls.test.ts` and `postgres-split-genotype-zygosity.test.ts`.
- **The cohort view needs no counterpart.** The burden test only exists there, and the web client uses the same components.

The empty untracked file `.planning/code-review/2026-10-08-burden-test-eligible-sites-ponytail-review.md` was already there; I left it untouched and changed no file.
