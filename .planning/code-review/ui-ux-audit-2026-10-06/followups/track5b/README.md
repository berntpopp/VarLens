# Track 5b: web/Postgres non-blocking backend

Branch `perf/non-blocking-web`, based on `perf/non-blocking-desktop` (track 5a), which already contains `fix/chromosome-natural-order` (track 1) through the rebase. This work covers the web half of audit report `05-blocking-analysis.md`: findings W-1, W-5 and D-3.

## What changed

| Finding | Change |
|---|---|
| W-5 pool | `DEFAULT_PG_POOL_MAX` is now 10 (was 4). `VARLENS_PG_POOL_MAX` still overrides it. |
| W-5 auth | The per-request live-user check is now cached. The cache is single-flight with a 5 s TTL (`VARLENS_AUTH_USER_CACHE_TTL_MS`, 0 disables it). Logout, login, deactivate, password reset and password change invalidate the entry immediately. |
| W-5 audit | `api_read` rows go into an `AuditBuffer`. It writes one multi-row INSERT every 250 ms or at 200 rows, and also on SIGTERM/SIGINT through Fastify `onClose`, before the pool closes. A failed flush re-queues its rows, and at 10k pending rows the buffer applies backpressure. Write and auth audits stay synchronous and fail-closed. |
| W-1 delete | Case deletion now runs as the shared `case_delete` job (5a contract: `cases:startDelete`, `jobs:changed` SSE, `jobs:cancel`). In Postgres it has four phases. **hide**: one row-lock-only transaction applies the case-scoped flag, summary and `variant_frequency` decrements, then sets `import_status='deleting'` (migration 0018). **recompute**: cohort frequency. **batched purge**: 5000 rows per transaction. **finalize**. There is no TRUNCATE and no table-wide lock. Interrupted purges resume at the next boot. |
| D-3 keyset | Keyset paging is opt-in for the case variant list. It applies when the order is ascending over NOT NULL terms, which includes the default natural order `(rank, chr COLLATE "C", pos, id)` served by track 1's `idx_variants_case_chr_rank`. Every other sort falls back to OFFSET. |

## Measurement: reads during a large case delete

Script: `delete-latency.cjs` (see its header for usage). Setup:
- Postgres 18.3 in the local dev container, database `varlens_nbweb`.
- The victim case has 1,000,000 variants. Two more cases stay in the database: a 2,000,000-row "resident" case and a 20,000-row "bystander" case.
- 8 concurrent readers page the bystander case with `PostgresVariantReadRepository.queryVariants` (with COUNT), using the production pool settings (10 connections, `lock_timeout` 5 s, `statement_timeout` 30 s).
- **before** is `main`'s `PostgresCaseLifecycleRepository.deleteCase`. **after** is this branch's version. Both run on the same schema and use the same read code.

| Mode | Delete wall time | Reads during delete | Read errors | p50 / p95 / p99 (ms) | Max (ms) |
|---|---|---|---|---|---|
| before (main) | 119.7 s | 13,025 | **64 × `canceling statement due to lock timeout`** | 45.9 / 96.0 / 123.5 | **2,029** |
| after (branch) | 82.7 s | 14,921 | **0** | 42.8 / 86.0 / 106.4 | **163** |

Baseline before the delete, for both modes: p50 about 48 ms, p95 about 87–92 ms, max about 125 ms, 0 errors.

In the before run, `TRUNCATE variant_frequency` plus the GROUP BY rebuild over the remaining 2M rows holds ACCESS EXCLUSIVE until COMMIT. Every read that joins `variant_frequency` queues behind it, and reads that wait more than 5 s fail. In the after run, latency during the delete stays at baseline and no read fails. The case leaves every read as soon as the hide transaction commits, which happens in the first seconds of the job. The rest of the work is storage reclamation.

A smaller run with 1M victim rows and no resident case still showed a worst read of 565 ms before versus 194 ms after. The blocking window grows with the total number of variants left in the database.

## Verification

- Unit tests: `tests/main/web/auth/user-lookup-cache.test.ts`, `tests/main/web/server/{audit-buffer,case-delete-jobs}.test.ts`, `tests/main/storage/{postgres-case-lifecycle-repository,postgres-variant-keyset,postgres-audit-log-repository}.test.ts`, and `tests/web-gate/dispatcher-audit-buffer.test.ts`.
- Postgres e2e (`VARLENS_RUN_POSTGRES_E2E=1`, `varlens_nbweb`): `postgres-case-lifecycle-repository.e2e.test.ts` and `postgres-variant-keyset.e2e.test.ts`. The keyset test checks that keyset pages are identical to OFFSET pages, including ties. The lifecycle test checks that a held purge batch does not block a concurrent read that runs with a 200 ms lock timeout.
- web-gate integration: `case-delete-job.test.ts`, and `audit-buffer-sigterm.test.ts`. The SIGTERM test runs the built server with a 60 s flush interval, makes 25 reads, sends SIGTERM, and checks that all 25 `api_read` rows reached `varlens_audit.audit_log`.

## Gates (final)

- Locked `make ci`: exit 0. Test Files 445 passed, 8 skipped. Tests 4764 passed, 112 skipped.
- Locked `make web-gate-postgres` (`VARLENS_PG_URL=…/varlens_nbweb`, `VARLENS_METRICS_PORT=9160`): exit 0. Integration: 19 files passed, 1 skipped; 42 tests passed, 2 skipped.
- Locked `npx vitest run --project web-gate` with the same database: 57 files passed, 1 skipped. Tests: 319 passed, 1 expected fail, 2 skipped.
- `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/main/storage tests/main/web` against `varlens_nbweb`, with `public` migrated and `out/web` built: 81 files passed. 696 tests passed, 11 skipped.
- `make agent-check`: passed.

## Integration notes

- The 5a delete contract is implemented on the web side: `cases:startDelete` returns `{jobId}`; `cases:delete`, `cases:deleteBatch` and `cases:deleteAll` wait for the job; `jobs:list`, `jobs:get`, `jobs:progress` and `jobs:cancel` are available; `jobs:changed` is pushed over SSE to the user who started the job. The web server uses its own `JobRunner` instance. One-line edit to 5a's `JobRunner.ts`: it now imports `toSerializableError` from `ipc/serializable-error` instead of `ipc/errorHandler`, so the web bundle does not pull in MainLogger/electron.
- `POSTGRES_CAPABILITIES.cases.deleteMany` and `deleteAll` are still `false`. The web routes support both now, but desktop-on-Postgres goes through 5a's SQLite-only job path. Flipping the flags needs a decision for desktop PG too.
- Postgres migration 0018 (`case_deleting_status`) sits after track 1's 0017.
- Deferred: keyset paging for the cohort view. Its default `carrier_count DESC NULLS LAST` order is not a row-value seek. Also deferred: async or approximate counts. The COUNT still runs per filter change; a capped count would change the pagination UI and needs a UX decision.
