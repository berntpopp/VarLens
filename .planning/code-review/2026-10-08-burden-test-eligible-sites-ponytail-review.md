**What this change does:** The gene burden test now uses only variants on chromosomes 1-22, in cases of one genome build, at sites where every selected sample has a usable call. It weights by minor allele frequency, reports per gene the sites used and left out, and reports per run the variants skipped for not being on chromosomes 1-22. Both backends (SQLite and PostgreSQL), the result table and the export are changed.

I found no wrong result and no broken caller, but I could not run anything: `make typecheck`, `npx vitest` and `node -e` all needed approval. Everything below comes from reading the code. Load assumed: one desktop user on SQLite, a few web users on PostgreSQL.

## Should fix

1. **The two removed filters are still accepted and then ignored** (`src/shared/types/ipc-schemas.ts:724-732`)
   - **What this is:** The check on a burden run request. `acmg_classifications` and `max_internal_af` were removed from it.
   - **Problem:** The schema silently strips unknown keys. A web API caller who sends `max_internal_af: 0.01` gets an unfiltered result and no error, and `tests/shared/types/association-config-schema.test.ts` asserts exactly that. The spec says this closes the "accepted then dropped" item of #510; it does not.
   - **Fix:** Add `acmg_classifications: z.never().optional()` and `max_internal_af: z.never().optional()` to `filters`, and flip the test to expect a rejection. `.strict()` is not an option, because the config panel sends other keys of the shared filter shape; it never sets these two.
   - **If we skip it:** The app is unaffected. Only direct API callers are misled, and #510 is closed on a false claim.

2. **The reason `no_called_alleles` can never be counted** (`src/main/statistics/contingency.ts:157-167`, `:259`)
   - **What this is:** One of the three reasons a site is left out, shown in the tooltip, the export column and the docs.
   - **Problem:** Since the last commit (`83e1bd71`) the frequency falls back to all samples when no sample has complete covariates. Every sample then adds at least one called allele, so the count is always 0. No test expects a non-zero value. The plan (Review Focus 4) and `SPLIT-GENOTYPE-ZYGOSITY.md` still say this case is reported under that reason.
   - **Fix:** Delete the reason: the union member, the counter, the null return of `altAlleleFrequency`, the label part and the TSV column. Or keep it as a guard and correct the doc. Either way, add the fallback to the "Frequency" line of the doc.
   - **If we skip it:** Users see a column and a tooltip entry that are always 0, and the doc describes behaviour the code does not have.

3. **No test shows the mixed-build message reaching the user** (`tests/web-gate/web-association-route.test.ts`, `tests/main/statistics/integration.test.ts`)
   - **What this is:** A run with cases of two genome builds is rejected with a clear message. Both builders are tested for the throw.
   - **Problem:** The message then crosses the desktop worker boundary or the web route's `catch`, and nothing tests that path.
   - **Fix:** One test in the web route file: `build` throws `InvalidParametersError`, expect HTTP 400 and the message in `userMessage`.
   - **If we skip it:** A later change to the route's `catch` could turn the message into "unknown error" unnoticed.

## Nice to have

4. **An empty result cannot be exported** (`src/renderer/src/components/association/AssociationResultsTable.vue:23`)
   - **What this is:** The Export button is now disabled when there are no result rows. The plan did not ask for this.
   - **Problem:** A chrX-only run is empty, and its export would carry the line that says why. `buildAssociationTsv([], 7)` is tested, but the app cannot reach it.
   - **Fix:** Remove the `:disabled` line.
   - **If we skip it:** The user sees the reason on screen but cannot save it.

5. **"N genes tested" counts genes that were not tested** (`src/renderer/src/components/association/GeneBurdenView.vue:71`)
   - **What this is:** The green summary line above the results.
   - **Problem:** A gene whose every site was left out is now listed with 0 sites and no p-value, yet it is counted as tested.
   - **Fix:** Count only rows with `n_variants > 0`, or say "genes listed".
   - **If we skip it:** The number is slightly too high when sites are excluded.

## What I checked and found in order

- **Backends:** both builders do the build check, the autosome filter, select-then-collect and the skipped-variant count with the same SQL shape. Row order is bytewise on both, and a NULL dosage is carried through on both.
- **Callers:** the desktop engine, the database worker, the in-process web runner and the mock API all take the new `{ genes, non_autosomal_variants }` shape. The statistics worker's new import chain pulls in nothing from Electron.
- **Cohort view:** no counterpart is missing. The burden tab is part of the cohort view; the cohort summary and carrier list keep "highest dosage" on purpose, and the docs say so.
- **Statistics:** the conflict rule, the complete-site rule, the label-swap symmetry, `min(p, 1 - p)` and "no Fisher test without a site" read correctly and have tests.

Verdict: Ship.

## Applied fixes (Round 3 follow-up)
1. Rejected cohort-summary filters (`acmg_classifications`, `max_internal_af`) explicitly in `AssociationConfigSchema` with `z.never().optional()`, verified via test.
2. Updated `SPLIT-GENOTYPE-ZYGOSITY.md` to document fallback to all samples for burden allele frequency. Guard retained.
3. Caught `InvalidParametersError` in `cohort:runAssociation` returning HTTP 400 with `userMessage`, tested via `web-association-route.test.ts`.
4. Removed `:disabled` on Export button in `AssociationResultsTable.vue` to allow export of 0-result runs.
5. Used `testedCount` in `GeneBurdenView.vue` for genes tested count.

