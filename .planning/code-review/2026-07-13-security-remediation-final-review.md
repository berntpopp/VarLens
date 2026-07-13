# Security remediation PR set — final review record

Date: 2026-07-13

Scope: PRs #306–#314, reviewed against `origin/main` and again after corrective commits.
Release target: 0.70.0.

## Method

Each PR received an initial implementation review, blocker-focused correction, and a fresh
adversarial review of its exact corrected branch head. Reviewers traced owning contracts and
nearest behavior boundaries and ran focused tests. The integrated merge was reviewed separately
for cross-PR races, conflict drift, path-authority continuity, cleanup ownership, and web/desktop
transport differences. Acceptance requires no blocker or major finding and a score above 9/10.

## Final scores

| PR | Area | Corrected head | Score | Status |
| --- | --- | --- | ---: | --- |
| #306 | IPC result handling and renderer races | `825c975d` | 9.4 | Accepted |
| #307 | Failure propagation and ZIP lifecycle | `ef9f68e5` | 9.3 | Accepted |
| #308 | VCF annotation/genotype correctness | `40d5c9fd` | 9.4 | Accepted |
| #309 | Transcript IMPACT/SO model | `a16a814b` | 9.5 | Accepted |
| #310 | Import resource hardening | `c25ca19f` | 9.4 | Accepted |
| #311 | URL, navigation, and path authority | `961824b9` | 9.1 | Accepted |
| #312 | Logging and SQL sink cleanup | `4c350b38` | 9.5 | Accepted |
| #313 | CSP and session hardening | `a16e6c98` | 9.5 | Accepted |
| #314 | Encryption by default and recovery | `467e6f41` | 9.4 | Accepted |

## Material blockers corrected during review

- Import cancellation now retains run ownership until the original promise/event terminates;
  database-switch generations isolate queued writes and in-flight reads.
- VEP/SnpEff ambiguous allele mappings fail closed, standard compound ANN forms are supported,
  and AD vectors follow declared header semantics.
- SQLite and PostgreSQL transcript migrations recover only provable legacy IMPACT/SO values.
- ZIP extractions use independent capabilities, bounded decoding/concurrency, retryable cleanup,
  and extraction-scoped path enrollment/revocation.
- Batch-import progress and completion events carry explicit run identities across desktop and
  web transports; terminal ownership is consumed once, ZIP cleanup follows its owning run, and
  rejected concurrent starts cannot clear or steal cancellation ownership from the active worker.
- PostgreSQL imports publish through hidden provisional rows, bounded batch commits, ready-only
  views, bounded cleanup/recovery, and advisory ownership; cancellation is checked through final
  bookkeeping and immediately before visibility/commit.
- Credential redaction covers structural multi-word passphrases, prefixed fields, and common
  uppercase assignment identifiers without weakening prose false-positive guards.
- CSP is applied to app-document main-frame and subframe responses, preserving exact packaged
  navigation authority.
- Damaged key registries fail closed and preserve recoverable/displaced key material; recovery
  candidates are verified by SQLite before registry reconciliation.

## Integrated verification

All corrected source heads are ancestors of the integration branch:

- `825c975d`, `ef9f68e5`, `40d5c9fd`, `a16a814b`, `c25ca19f`, `961824b9`,
  `4c350b38`, `a16e6c98`, and `467e6f41`.
- PR310 exact head `c25ca19f` has green GitHub CodeQL, Build, Web CI, package,
  and secrets checks.
- PR311 exact head `961824b9` has green GitHub CodeQL, Build, Web CI, package,
  and secrets checks.
- PR312 exact head `4c350b38` has green GitHub CodeQL, Build, Web CI, package,
  and secrets checks.

Local command evidence on integration source candidate `5979dee2`:

- `make ci`: passed; 409 Vitest files passed, 4 skipped; 4,526 tests passed, 91 skipped.
- `VARLENS_WEB=1 make ci` with `.env.postgres.local` sourced: passed; 441 Vitest files passed,
  16 skipped; 4,729 tests passed, 1 expected fail, 121 skipped.
- `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage/postgres-import-visibility.test.ts
  tests/main/storage/postgres-migration-definitions.test.ts`: passed; 2 files, 5 tests, no type
  errors.
- `make ci-full`: passed; Ubuntu checks, startup smoke, Linux packaging, and packaged smoke all
  completed successfully.
- `make docs`: passed; VitePress build completed.
- `make rebuild-node && make agent-check`: passed; no new oversized source files and no grown
  baseline source files (`ImportWizard.vue` improved from 876 to 862 lines; `mockApi.ts` remained
  1225 lines).
- `git diff --check`: passed.
- `package.json` and `package-lock.json`: both report version `0.70.0`.
- Ancestor verification: all nine corrected PR heads listed above are ancestors of the integration
  candidate.

If this review record is committed after the source-candidate verification, the exact branch head
must be re-verified before push/merge. The release remains unaccepted until `make ci`,
`VARLENS_WEB=1 make ci`, real PostgreSQL migration/import visibility tests, `make ci-full`,
`make docs`, `make agent-check`, `git diff --check`, version checks, and clean worktree checks pass
on that exact final head.
