# PR #524 follow-up review

What this change does: The PR gives cohort rows a build/type-aware identity, adds a
maximum carrier count, and restricts burden tests to eligible sites. This review
traced both storage backends, IPC/web adapters, renderer state, and exports, with
three parallel reviewers. Expected use is case/cohort analysis on a local desktop
or the existing PostgreSQL web deployment.

## Must fix — fixed

1. **Duplicate order changed CADD-weighted burden results.**
   - What this is: Multiple stored transcript/call rows become one call per case/site.
   - Problem: The new resolver took the first non-null CADD score, so reversing
     agreeing phased/unphased rows changed their burden weight.
   - Fix: Retain the existing genotype representative, with a deterministic maximum
     CADD tie-break for equal call keys, in `statistics/contingency.ts`.
   - If skipped: Backend query ordering can change the statistical result.

2. **Excluded samples still changed CADD weights.**
   - What this is: Logistic regression excludes samples missing selected covariates.
   - Problem: Their CADD scores still entered the mean; one excluded sample changed
     a tested site's mean from 20 to 21.333333.
   - Fix: Compute CADD means using the same complete-covariate sample set as allele
     frequencies. The regression test verifies the fitted coefficient stays unchanged.
   - If skipped: A sample outside the fitted dataset can change its burden result.

3. **Valid large carrier caps crashed PostgreSQL queries.**
   - What this is: The API accepts positive safe integers for the maximum case count.
   - Problem: PostgreSQL inferred a 32-bit parameter and rejected 3,000,000,000 with
     SQLSTATE `22003`.
   - Fix: Cast the parameter to `bigint`; keep the indexed column untouched.
   - If skipped: Valid requests fail for cohort pages, counts, and streamed exports.

4. **Imported gene strings could become spreadsheet formulas in TSV exports.**
   - What this is: The PR extracts the existing burden TSV exporter into a utility.
   - Problem: Raw gene text such as `=1+1` remains a formula, and tabs/newlines split
     cells or rows. This issue existed in the previous inline exporter too.
   - Fix: Move the existing CSV escaping into a shared utility, preserving its CSV
     API, and use tab-aware escaping for the exported gene cell.
   - If skipped: Imported text can run as a spreadsheet formula or corrupt an export.

## Should fix — fixed

5. **Browser demo carrier results disagreed with the new identity.**
   - What this is: The browser mock now groups variants by genome build and type.
   - Problem: It ignored those query scopes, divided frequency by all builds,
     advertised only GRCh38, and returned duplicate carrier rows.
   - Fix: Derive build counts, apply selectors, and resolve one call per case using
     the existing genotype resolver. Tests assert actual carrier lists.
   - If skipped: Browser checks can show or validate incorrect cohort behavior.

## Verification

- Every finding has a regression observed failing before its fix.
- `make ci`: passed; 659 files and 7,440 tests passed, 275 opt-in tests skipped.
- `make agent-check`: passed.
- Focused live PostgreSQL checks cover caps of 3 billion and
  `Number.MAX_SAFE_INTEGER`, including case reads, cohort pages/counts and exports.
- Existing CSV tests pass unchanged. A separate review checked TSV quoting through
  the installed spreadsheet parser, including formula and delimiter edge cases.
- Clean-commit `make preflight-full` and the pre-push gate remain mandatory for
  publication; their exact results are recorded by the local gate receipts.

No dependencies or migrations added. The oversized mock API grows by three lines
to apply its existing build/type selectors; carrier resolution lives in its existing
identity helper. A broader mock API split would be unrelated to these fixes.

Known limits remain as specified: case-view frequency keys omit build/type, and
burden analysis assumes a missing stored row is reference. No performance benchmark,
Windows/macOS package execution, or signing/publication claim is made here.

Verdict: Ship after the mandatory clean-commit preflight passes.
