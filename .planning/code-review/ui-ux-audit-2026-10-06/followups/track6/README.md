# Track 6 — CI quality gates: baseline on main (8a662b89 + this branch's two small fixes)

Date: 2026-10-06 · Branch `ci/quality-gates` · JSON run outputs stay local (`.planning/code-review/**/*.json` is gitignored); numbers below are copied from them. Host: local Linux, Postgres 16 dev container, Chromium 153 (Playwright 1.63), Electron 43 under xvfb.

## Gates added

| Gate | Command | Where in CI | Budget |
|---|---|---|---|
| axe, 5 key states x light/dark (web build) | `make ui-gates-axe` | `build.yml` web-ci job, `web-ci.yml` | 0 serious/critical (WCAG 2.0/2.1/2.2 A+AA) |
| Lighthouse user flow, desktop (median of 3) | `make ui-gates-lighthouse` | same | Perf >= 0.95, A11y = 1, BP = 1, CLS <= 0.02 per navigation; CLS <= 0.02 per interaction timespan; A11y/BP = 1 per snapshot |
| Lighthouse mobile | same | same | recorded only |
| Electron table interactions | `make perf-interaction-gates` | `build.yml` package job (Linux) | CLS <= 0.02 (CWV and incl. input-adjacent), INP < 200 ms, median of 3 rounds; 1 visible-page query per sort; latest sort wins under a 1.5 s delayed first response |
| Same-locus row identity (unit) | `make test` | checks job | already present: `tests/renderer/components/variant-table/useVariantRenderRows.test.ts` ("renders distinct rows for two variants sharing a locus") |

## Baseline results

### axe (`axe-summary.txt`)
- Light: 0 serious/critical in all 5 states **after** the a11y.css fix on this branch. Before: case table + details panel had the active case-list subtitle at 3.74:1 (#506683 on #C8CFD9); cohort had the Genome Build / Variant Type floating labels at 4.43:1 (#6E7176 on #F0F4F8).
- Dark: 1 known failure — home `.select-case-hint` 4.34:1 (#324252 on #7BAED4). Expected-fail, owned by track 4 (dark tokens).

### Lighthouse desktop (`desktop-budgets.md`, `desktop-metrics.json`)
| Step | Perf | A11y | BP | CLS | TBT | INP |
|---|---|---|---|---|---|---|
| login (nav) | 1.00 | 1 | 1 | 0 | 0 | — |
| home (nav) | 0.99 | 1 | 1 | 0.013 | 0 | — |
| open case (timespan) | 0.97 | — | 1 | 0.001 | 112–120 ms | 196–206 ms |
| case table (snapshot) | — | 1 | 1 | — | — | — |
| open details (timespan) | 1.00 | — | 1 | 0.010 | 0 | 36–41 ms |
| details panel (snapshot) | — | 1 | 1 | — | — | — |
| switch to cohort (timespan) | 0.97 | — | 1 | **0.080 (XFAIL, track 2)** | 46–72 ms | 29 ms |
| cohort (snapshot) | — | 1 | 1 | — | — | — |

Open-case INP sits at the 200 ms line on desktop Lighthouse (recorded, not gated there; the Electron gate covers table interactions).

### Lighthouse mobile (recorded only, `mobile-recorded.md`)
home Perf 0.84, LCP 4.06 s, CLS 0.061 · open case TBT 931 ms, INP 628 ms, CLS 0.081 · open details CLS 0.052 · switch cohort TBT 654 ms, CLS 0.18. These are track 2 (mobile render cost) / track 3 (scaling) territory.

### Electron interaction gates (`interaction-metrics.json`, median of 3 rounds)
| Interaction | CLS (CWV) | all shifts | INP |
|---|---|---|---|
| case sort | 0 | 0.010 | 40–48 ms |
| case page next / prev | 0 | 0 | 96–112 ms |
| case row select / reselect | 0 | 0–0.003 | 40–64 ms |
| cohort sort | 0 | **0.046 (XFAIL, track 2)** | 32–72 ms |
| cohort page next | 0 | 0 | 96–104 ms |

Sort: exactly 1 visible-page query + 1 idle prefetch of page 2, case and cohort. Stale-render: passes; mutation-tested by disabling the latest-request guard in `useOffsetPagination.ts` (gate failed as expected).

## Defects found while building the gates
1. **Fixed here (src/preload/window-api/core-api.ts):** `window.api.database.create` dropped `setupPassphrase`, and `migrateToEncrypted` / `deletePlaintextBackup` / `setRecoveryPassphrase` were missing from the desktop `window.api` (hidden by an `as WindowAPI['database']` cast). On a machine without an OS keyring, first-run DB creation looped on `needsPassphraseSetup`; the encryption-migration and recovery-passphrase UI called undefined functions. Regression test: `tests/main/ipc/preload-database-api.test.ts`.
2. **Fixed here (a11y.css):** the two light-theme contrast failures above.
3. **Not fixed:** the Postgres repositories derive prepared-statement names from the schema; a schema name over ~27 characters exceeds Postgres' 63-char identifier limit (`variants:filter_options_per_case:v1@<schema>`), which pg warns may cause conflicts. The gate keeps schema names short.
4. The perf E2E harness (`renderer-perf-phase1.e2e.ts`) could not run on main: fresh userData has no database, and import paths must be dialog-enrolled. `perf-fixture.ts` now creates the DB and enrolls the fixture through stubbed main-process dialogs.
