# Parity P-B: errors, job ownership, jobs + SSE, ZIP, bulk delete

Branch `feat/parity-errors-jobs-import`. Plan items PR-W4, PR-W6, PR-W9a and
PR-W9b, plus the renderer job progress/cancel UI deferred by track 5a.

## Built web instance check (2026-10-06)

`VARLENS_WEB_BASE=/ npm run build:web`, server on :8980, schema `parity_b`,
`VARLENS_PG_DELETE_BATCH_SIZE=100`, four seeded 20k-variant cases. Harness:
`harness/verify-jobs-ui.cjs` (headless Chromium + axe-core 4, CSP bypassed
only to inject axe). Result: `jobs-ui-verification.json`.

| Check | Result |
|---|---|
| `cases:startDelete` | 200, job id returned |
| Panel in case view | "Deleting cases · Deleting · 0 of 4 cases", Cancel button |
| Progress bar | `role=progressbar`, `aria-label="Deleting cases progress"`, `aria-valuenow` set |
| Live region | "Deleting cases started." (polite, atomic) |
| Panel in cohort view | visible |
| Cancel reachable by Tab, activated with Enter | yes; job ends "Cancelled", announced "Deleting cases: Cancelled." |
| axe serious/critical, case view with panel | 0 |
| axe serious/critical, cohort view with panel | 0 |
| 390 px width, no horizontal scroll | yes |

Screenshots (`*.png`, gitignored) were taken locally.

Observation for track 5b (not changed here): a cancel requested while the
first case of a Postgres delete job was still in its hide phase left that case
`ready` (nothing deleted). That is consistent with "cancel lands between
cases", but the panel reports "Cancelled" with 0 of 4 done.

## Gates

- locked `make ci`: exit 0 (474 files / 4992 tests passed, 117 skipped)
- `make agent-check`: passed; renderer parity gate OK
- locked `make web-gate-postgres` (own DB `varlens_parity_b`, metrics 9280): exit 0
