# RESUME — Web PRs #283/#284/#289/#290 review-fix effort

Full finding→fix inventory: `.planning/plans/2026-07-03-web-pr-review-fixes-plan.md`.

## Goal
Resolve every posted code-review finding on the 4 open cross-repo web PRs and get GitHub
Actions **green on all 4**. PRs are from `robspan/VarLens-upstream-fork` (maintainerCanModify=true).
**User has AUTHORIZED force-push to robspan's branches.** `robspan-fork` remote is already added.

## Environment must-knows
- Heavy runs: `systemd-run --user --scope -p MemoryMax=16G <cmd>` (megalodon).
- Native dual-rebuild: `make rebuild-node` before Vitest.
- **`make ci` (web-gate-static) does NOT run the Postgres integration suite.** The GitHub
  "Web CI" job runs `make web-ci` = `web-gate-postgres`, which is what caught two real bugs.
  ALWAYS validate with: `export VARLENS_PG_URL='postgres://varlens:varlens_dev_password@127.0.0.1:55434/varlens_dev'`,
  `export VARLENS_RECOVERY_KEY_DIR="$(mktemp -d)"` (else buildApp tests EACCES on `/data`),
  reset schema if polluted (`DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO varlens`),
  then `make web-gate-postgres` (or `npx vitest run --project web-gate tests/web-gate/integration`).
- Commit trailers: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01J2A6iMmSL4An41C8BCUkGZ`.

## DONE + PUSHED (all locally green incl. full web-gate-postgres = 40 integration tests)
- **#283** `web/11-hosted-db-foundation` tip **b5a6e553**: A1 migration-compat gate, A3 client-pool
  budget, A4 activity-aware idle close, A5a control-scoped migration set, A5b 0014 idempotency,
  A5c readyz split, B2 write-URL fallback, B3 0015 public-annotation migration, B4b provision-user
  `--password`, **A2 (HIGH) inline-license-matrix bundle gate**, + the **ledger/workspace fix (b5a6e553)**.
- **#284** `web/12-operations-telemetry` tip **34e9efaf**: rebased on #283 + C1 (success-not-error),
  C2 (operationMetric allowlist), C3 (genReqId UUID), C4 (upload audit required).
- **#289** `web13-public-record-keys` tip **2511a6f0**: cherry-picked the 12 shared #283 fixes (A2
  conflict against the CSQ refactor resolved) + B1 (private_case_data read filter) + B4a (batch
  snapshot hoist) + ledger fix.
- **Ledger/workspace fix = commit `b5a6e553`** (isolate public-annotation migration ledger into
  `public_annotation_schema_migrations`; migrate workspace DBs in hosted-routing integration test).
  On #283/#284(rebase)/#289. **#290 does NOT have it yet.**

## REMAINING
1. **#290** `web14-platform-identity` — the worktree agent FINISHED and committed all findings, but
   the branch is **NOT ready** (uncommitted changes, no ledger fix, not pushed). Its work lives in
   the git worktree at `.claude/worktrees/agent-a808808be11c9e33a` on branch `web14-platform-identity`.
   - **Committed there (D-findings, tip b8f86a77):** D2f token strength (bd1d4166), D1f drop
     provisioning endpoint (8bb134ef), D5a opaque-access-token (900ee31e), D5b legacy-URL warning
     (877a4c78), D3g adoption-guard placeholder (d70bef40), D5c negative tests (3358faa1), D4f splits
     (2be2850f split platform-identity.ts; b8f86a77 extract PostgresPlatformUserStore — reported
     PostgresWebAuthService.ts now 561 lines). Cherry-picked shared foundation is underneath.
   - **BLOCKERS to resolve, in order:**
     a. **Uncommitted changes** in the worktree: `M src/web/auth/PostgresWebAuthService.ts` and
        `M tests/main/web/auth/postgres-web-auth-service.test.ts`. Inspect them (agent stopped mid
        `make ci`); decide to commit or discard, and make the worktree clean.
     b. Branch does **NOT** contain the ledger fix — **`git cherry-pick b5a6e553`** onto it
        (foundation byte-identical to #283 → expect clean; needed or Web CI fails on the 0015/A1 bugs).
     c. Verify: `VARLENS_WEB=1 make ci` + `systemd-run ... make agent-check` (must exit 0 — D4f) +
        `make web-gate-postgres` (fresh schema, VARLENS_RECOVERY_KEY_DIR set).
     d. Push: `git push robspan-fork web14-platform-identity --force-with-lease` (remote still at 08a3f952).
   - Read the agent's finding-by-finding report if needed: its transcript / final message. If any
     D-finding looks wrong, re-verify per plan §"Cluster D".
2. **Verify GitHub Actions GREEN on all 4** (`gh pr checks <n> --repo berntpopp/VarLens`). #290's
   original Windows-package failure was a flake — should clear on the fresh run.
3. **Post one short "addressed: …" review reply per PR** (`gh pr comment <n> --repo berntpopp/VarLens`),
   summarizing what was fixed. User explicitly asked for this.
4. Restore main checkout clean (`git checkout main`).

## Decisions already made — do NOT re-ask
Force-push authorized · A2=inline matrix · A5a=carve control migration set · fix all invasive items ·
D1f=remove provisioning HTTP route (use CLI). All findings were verified real before implementing.
