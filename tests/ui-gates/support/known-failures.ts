/**
 * Explicitly-known pending failures, each owned by an in-flight follow-up
 * track. A listed check is run as an expected failure (Playwright
 * `test.fail()` / Lighthouse XFAIL): it still executes and is reported, and
 * the gate goes red the moment it unexpectedly PASSES, so the entry must be
 * deleted in the PR that fixes it. Never add an entry to make a new
 * regression green — only for defects already tracked elsewhere.
 *
 * Key format: `axe:<theme>:<state>` or `lighthouse:<step>:<check>`.
 */
export const KNOWN_FAILURES: Readonly<Record<string, string>> = {
  // TODO(track 4, web-mode completeness: theme toggle + fixed dark tokens):
  // `.select-case-hint` is #324252 on #7BAED4 = 4.34:1 in warmDark.
  'axe:dark:home': 'dark-theme contrast: home ".select-case-hint" 4.34:1 (track 4)',
  // TODO(track 2, table render perf; listed with mobile TBT in the
  // 2026-10-06 follow-ups): Case -> Cohort switch shifts the layout, CLS ~0.08.
  'lighthouse:switch-cohort:cls': 'Case->Cohort switch CLS ~0.08 (track 2)'
}

export function expectedFailureFor(key: string): string | undefined {
  return KNOWN_FAILURES[key]
}
