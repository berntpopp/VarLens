# Web import scaling: handover (2026-10-07)

Goal (owner, 2026-10-06): the import must scale to 10,000+ exomes, be fast and parallel,
never block the UI, and show each sample in the case list and cohort as soon as it lands.
PostgreSQL/web first; SQLite/desktop must reach parity and be improved as far as possible
(owner, 2026-10-07). The normalised data model is in scope. Existing PostgreSQL workspaces
are converted in a maintenance step, not online.

Approved plan: `~/.claude/plans/ethereal-waddling-squirrel.md`.
Nothing is pushed. No PRs exist. Issues filed: #460 (unique-variant counter), #461
(transcript switch leaves the cohort summary stale).

## Where the code is

Worktrees live outside the repository on purpose (other sessions move ignored files and
`.claude/worktrees/*` out of the main checkout during preflight). Never run
`git worktree prune`.

| Worktree (`~/development/VarLens-wt/…`) | Branch | Head | Content |
|---|---|---|---|
| `web-import-ux` | `integration/web-import-scale` | `d0f63f68` | Everything below merged, plus two fixes found on the integrated build |
| `import-ui-defects` | `fix/import-ui-defects` | `5886699d` | UI defect fixes (already merged into stage 2) |
| `cohort-aggregates` | `perf/import-stage4a-cohort-aggregates` | `122e2e42` | Maintained gene/tile aggregates |
| `sqlite-parity` | `perf/import-sqlite-parity` | in progress | SQLite parity agent's branch |

Stacked branches (all in the `web-import-ux` repo view):

1. `perf/import-stage0-benchmark` `0014d837`: simulator shares variants across a cohort
   (`--shared-fraction`, default 0.9); `scripts/perf/bench-web-batch-import.mjs`.
2. `perf/import-stage1-constant-publication` `bf8bbff5`: cohort frequency derived at read
   time (migration 0022); no request-path summary rebuild; summary write lock
   (`cohort-summary-lock.ts`); column-meta cache versioning; set-based annotation flags.
3. `perf/import-stage2-parallel-pool` `ca9b067a`: parallel batch pool
   (`VARLENS_IMPORT_CONCURRENCY`, default min(4, cores/2), 1 = sequential), worker lease
   mode (`postgres-import-lease.ts`), `batch-import-pool.ts`; contains the merged UI fixes.
4. `feat/import-stage3-live-updates` `447c0755`: `batch-import:fileComplete` event on web
   and desktop, in-place refresh of case list and cohort, progress view with files in flight.
5. `perf/import-stage4a-cohort-aggregates` `122e2e42`: `cohort_gene_summary`,
   `cohort_gene_variant_summary` (migration 0023).
6. `integration/web-import-scale`: 3 + 4 + 5 merged, plus
   `b533d4d5` (parity test for read-time frequency; belongs with stage 1) and
   `d0f63f68` (publication fast for a just-imported case; polling write lock).

`origin/main` has moved since the branches were cut (now past v0.76.1): rebase before PRs.
Migration numbers 0022/0023 must be re-checked against main at that point.

## Measured (simulated 60,000-variant exomes, shared cohort, PostgreSQL 18)

| | `main` | Now |
|---|---|---|
| 20 samples | 346 s | 47 s (stage 2 build, 4 workers) |
| Per sample as cohort grows | 8 → 22 s, rising | ~2.5 s flat through sample 100 (stage 2 build) |
| 100 samples | hours (extrapolated) | ~4.5 min (stage 2 build) |
| Gene burden, 100 samples | 11.1 s | 86 ms |
| Cohort tiles, 100 samples | ~6 s | ~0.45 s |
| New case visible in UI | at batch end | ~1 s after its file finishes (seen in Chrome) |

Parallel results equal the sequential baseline (0 differences in 344,063 summary rows).
The machine was shared with other workloads: trends are solid, absolute times approximate.
Use `VARLENS_PG_IMPORT_PROFILE=1` and compare per-phase ratios.

## Verification status

- Per branch: `make typecheck`, lint, format, `agent-check`, `make test`, `make web-gate-static`
  were green when each stage was committed (integration: 6,168 unit tests).
- Full gated PostgreSQL suite (`make web-gate-postgres-tests`) on integration: 222 passed,
  1 failed; that test was fixed (`b533d4d5`). **The full suite has not been re-run since,
  and not at all after `d0f63f68`.** Run it first.
- Confirmed after `d0f63f68` (integration build, 4 workers): 100 samples in 387 s with a
  flat interval (3.2 s → 3.6 s; the regressed build needed 758 s), and an 8-file overwrite
  batch finished 8 × `success` (115 s). The stage 2 build without gene aggregates did the
  same 100 samples in about 270 s: publication is serial and now costs ~3.7 s per sample
  (summary upsert 2.3–4 s, variant frequency 0.8 s), so it bounds throughput.
- Chrome check done on the live-updates build with 12 files: welcome button, copy, case
  names, per-file sidebar updates, cohort counts. Not checked: cancel mid-batch, a second
  user, dark-theme polish, the jobs toggle, desktop.
- `make preflight` has not been run on any branch.

## Known defects and gaps

- `cohort:getColumnMeta` takes 2.8 s at 100 samples (scans the whole summary whenever the
  summary version changes). Needs maintained metadata or sampling.
- Summary upsert still costs ~1.5–2.5 s per sample: every carrier-count change rewrites all
  8 index entries of the row. `idx_cvs_covering_common` and `idx_cvs_filters` showed zero
  scans in dev; evaluate dropping them.
- Gene aggregates add ~0.35–0.7 s per sample (pair-table upsert).
- A pooled connection's 30 s client `query_timeout` still applies to long maintenance
  statements (background summary rebuild, `hideCase` on very large cases).
- The batch import is one HTTP request held open for the whole batch; a proxy timeout
  would cut it. It should return a job id and report through events.
- Case-list soft refresh merges only the first page: more than 50 cases finishing between
  two refreshes leaves a gap until the final refresh.
- Storage is unchanged: ~6 GB per 100 exomes. Only the normalised model fixes this.
- Uploads are sequential; no drag-and-drop. `BatchImportService.ts` and
  `BatchImportDialog.vue` look unused.
- The import summary dialog was drawn partly off-screen after a scripted route change while
  it was open; not confirmed as reachable by a user.

## Remaining work, in recommended order

1. Confirm the open verification run; run the full gated suite on integration.
2. Take the SQLite parity agent's result (`perf/import-sqlite-parity`), review, verify.
3. Rebase the stack on `origin/main`, re-check migration numbers, `make preflight`, open
   draft PRs per stage (0, 1, 2 + UI fixes, 3, 4a).
4. Cheap follow-ups from "Known defects" (column meta, unused indexes, job-based batch start).
5. Normalised data model (plan stage 4): `variant_call` fact hash-partitioned by case,
   `variant_locus`, content-addressed `variant_annotation`, transcript sets, compatibility
   views for `variants_all` / `variants` / `variant_transcripts`, staged fast writer,
   per-case conversion job. Start with the old-versus-new diff harness; the design notes
   from the planning agents are summarised in the plan file.
6. Final 100-exome run in Chrome, write-up under `.planning/specs/`, issues #460 and #461.

## Local environment

- PostgreSQL: dev container on port 55434 (`.env.postgres.local` in each worktree).
  Throwaway test database for gated tests: `varlens_import_ux`
  (`VARLENS_PG_URL=…/varlens_import_ux VARLENS_RUN_POSTGRES_E2E=1 VARLENS_RECOVERY_KEY_DIR=/tmp/varlens-bench-keys`).
- All scratch schemas of this work (`web_dev_import_*` in `varlens_dev`) were dropped on
  2026-10-07 and the test server was stopped. The throwaway database `varlens_import_ux`
  still exists for gated tests; drop it when the work is finished.
- Test server: port 8797 (8787 belongs to another session). Start with
  `VARLENS_PG_SCHEMA=<schema> VARLENS_WEB_PORT=8797 VARLENS_METRICS_PORT=9097 VARLENS_RECOVERY_KEY_DIR=/tmp/varlens-bench-keys VARLENS_LOG_LEVEL=warn node out/web/server.cjs`
  after sourcing `.env.postgres.local` and `.env.web.local`; send stdout to a file on disk.
  Test admin: `admin`; password on the "Test password" line of `.env.web.local`.
- Simulated cohort: `tests/.cache/sim-cohort/` (100 × 60,000 variants, gitignored);
  regenerate with `npx tsx scripts/simulate-variants.ts --samples 100 --variants 60000 --formats vcf --out tests/.cache/sim-cohort`.
- Wrap heavy runs: `systemd-run --user --scope -q -p MemoryMax=16G …`.
- Run `make rebuild-node` after any `npm ci` (the web server and Vitest need the Node ABI).
