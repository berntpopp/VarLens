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
  // (empty) axe:dark:home fixed by track 4; lighthouse:switch-cohort:cls
  // fixed by track 2 (0.08 -> 0.007).
}

export function expectedFailureFor(key: string): string | undefined {
  return KNOWN_FAILURES[key]
}
