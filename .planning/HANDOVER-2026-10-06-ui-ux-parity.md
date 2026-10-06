# Handover: UI/UX follow-ups + desktop↔web parity (2026-10-06)

This note is for the next agent. It records what shipped, what is still in flight, the decisions the user has made, and the gotchas that cost time in this session. Read `AGENTS.md` and `CLAUDE.md` first. This file adds to them and does not replace them.

## 1. Where things stand

| Item | State |
|---|---|
| **v0.74.0** | Released. PR #432 (`integration/ui-ux-followups-2026-10`), tag on `4687e8ad`, which also contains PR #433 (variant simulator). 10 assets, signed Windows build. |
| **PR 2: parity + leftovers** | Branch `integration/parity-2026-10`, intended as **v0.75.0**. See §3. |
| Dependabot | All 18 PRs superseded by #432 are closed. One alert is still open: **#142 sprintf-js**. There is no upstream fix, and it is only used at build time through the electron-builder chain, never shipped. Triage: `.planning/code-review/security-2026-10-06/dependency-alerts.md`. |
| CodeQL #16–#25 | Fixed in #432 (`src/web/server/dispatcher-errors.ts`). They should close after the next scan of `main`. If they don't, check again. |

### Evidence folders
- Audit: `.planning/code-review/ui-ux-audit-2026-10-06/00-COMBINED-REPORT.md`
- Per-track before/after: `.planning/code-review/ui-ux-audit-2026-10-06/followups/<track>/`
- Parity spec / plan / inventory: `.planning/specs/2026-10-06-desktop-web-parity-spec.md`, `.planning/plans/2026-10-06-desktop-web-parity-plan.md`, `.planning/code-review/desktop-web-parity-2026-10-06/`

## 2. What v0.74.0 shipped (PR #432)

| Area | Change |
|---|---|
| Chromosome order | Natural 1..22, X, Y, MT on case, cohort and shortlist, backed by an index. Helpers live in `src/shared/sql/chromosome-order.ts`. SQLite v33 and PG 0017. |
| Responsive | Views scroll on short or zoomed screens. The details panel docks at ≥1440 px with width min(800px, 45vw). Column priority, a tooltip for truncated cells, rem typography. Electron minimum window size is 1024×640. |
| Tables | Cheap functional cells (`simple-cells.ts`) and shared row menus. Rows get result-set keys. No layout shift on sort, cohort switch, shortlist case switch or panel dock. |
| Web mode | Account menu, sign-out and user management (multiple admins, PG 0019). Theme. URL state for case, tab, filters, search and sort. ACMG confirm + undo. Gene panels. Explicit "not available in web" states. Streamed CSV export. |
| Non-blocking (desktop) | A single SQLite writer thread. Frequency upkeep, cohort export, ZIP handling and case delete run in workers. The window shows before the DB opens. |
| Non-blocking (web) | PG pool of 10. Cached auth for 5 s. Batched read audits, drained on SIGTERM. Case delete is a batched background job (PG 0018). Keyset paging. |
| Correctness | `case_data_info` was never written on import; fixed, with a backfill in SQLite v35. Allele counts after multi-file append. PG prepared-statement name collisions. Desktop preload was dropping its encryption methods. The case-list context menu now opens at the cursor. |
| Shortcuts | Alt+Shift+C/Q/L/D/O. Row shortcuts ignore Ctrl/Cmd/Alt. |
| CI gates | `make ui-gates` (axe in 5 states × light/dark, plus Lighthouse desktop budgets) and `make perf-interaction-gates` (CLS/INP, one query per sort, no stale render). |
| Deps / security | Grouped bumps, @vueuse/core 15, dispatcher XSS and stack-trace fixes. |

## 3. PR 2: `integration/parity-2026-10` (target v0.75.0)

Merged or being merged, in this order: the parity spec, **P-A**, **P-B**, `main`, **P-D**, **P-C**, **L2**, **L1**.

| Branch | Content |
|---|---|
| P-A `feat/parity-gate-capabilities` | A parity manifest classifies every `window.api` method (`src/shared/ipc/parity-manifest.ts`, with slices in `parity-manifest/`). Contract gate in `make test`. Startup check (`src/web/server/method-resolution.ts`). Per-session capability document (`src/shared/ipc/capability-document.ts`) feeding a fail-closed `capabilityStore`. A typed web client replaces the Proxy. Renderer gate check `scripts/parity/check-renderer-gates.mjs`, which runs in `make agent-check`. Hardening: alias routes removed, API docs require auth, IGV CSP, role-scoped activity log. |
| P-B `feat/parity-errors-jobs-import` | Error envelope with fixed codes mapped to HTTP statuses (name clashes return 409). Owner-checked cancel, which closes a security hole. Jobs in web, plus SSE with heartbeat, replay and session revalidation, closed on logout. Plain-ZIP fix with shared batch-import logic. PG bulk delete and admin-only delete-all. A reusable **job panel** with progress and cancel. |
| P-D `feat/parity-roles-exports` | Roles **viewer < analyst < admin**: legacy `user` becomes analyst, new accounts default to viewer. One security map, `src/web/server/security/operation-security-map.ts`, applied by a single `secure()` wrapper with an AsyncLocalStorage request context. An audit-or-exempt registry enforced by a test. Enumeration-safe password reset (returns 202). Exports as signed single-use download tokens (`export:prepareDownload` POST, then `GET /api/download/:token`) for CSV, XLSX (streaming writer) and BED. Read-only UI for viewers. |
| P-C `feat/parity-reference-services` | Web serves the protein view (UniProt, InterPro, AlphaFold, Ensembl, gnomAD, ClinVar), HPO search (bundled ontology), the rest of the panel tooling, ReferenceServices with an **egress policy** (admin, per service, default off, audited, LRU cache of 5000 entries for 7 days), and cohort association on PG (1 run per user, 2 per server). Parity pending count is **0**. |
| L2 `perf/backend-leftovers` | Case delete is incremental, so it no longer rebuilds the search index and cohort summary (5M rows: 42 s → 13 s). The full rebuild runs per chromosome and can be cancelled. Cohort keyset paging covers the carrier-count sort. SQLite migrations run in a worker (main-thread block 1357 → 41 ms). Desktop auth writes go through the writer thread. |
| L1 `feat/ui-followups-leftovers` | One compact **Links** column (case, cohort and shortlist), so ClinVar is visible at 1366. Default column order changed: ClinVar, gnomAD AF and CADD now come after Gene. rem column widths. The app bar is 3rem tall. "Auto (fit)" page size. |

Migration numbering is assigned by the integrator. Check `git log` on the branch for the final numbers. Expected: PG 0020 roles, 0021 cohort keyset; SQLite v36 roles, v37 cohort keyset. A test enforces unique and contiguous PG migration numbers.

If PR 2 is not merged when you start: push `integration/parity-2026-10`, open the PR, merge when CI is green, then follow the release procedure in §6.

## 4. Binding user decisions

- **Web egress:** each external lookup (VEP, MyVariant, SpliceAI, PanelApp, STRING, protein sources, gnomAD, ClinVar) is admin-configurable per service, **default OFF**, and every outbound call is audited. The UI shows the precise reason when a service is off.
- **Multi-user data:** **shared** across users, with writes gated by role (viewer / analyst / admin). No per-case ownership.
- **Multiple admins:** allowed. The last active admin cannot be demoted.
- **W10** (handler-factory migration, spec §4.1, plan "PR-W10.x") is **deferred** to its own PR series.
- Shortcuts use the Alt+Shift scheme. Import is Alt+Shift+**O**, because Alt+Shift+I opens Chrome's feedback form.

## 5. Open work (prioritised)

**P1, finish first**
1. **W10 handler-factory migration**, one domain per PR. Follow the plan section "PR-W10.x" and Limin's pattern (`/home/bernt-popp/development/limin`: `limin-api-handlers.ts`, `ipc-handlers.ts`, `dispatcher.ts`).
2. **Viewer UI gaps** (P-D): these editors still rely on the server's 403 instead of disabling the control: case metadata card, case comments tab, metrics, panel editor, presets, region files, transcript switch, and the overview tag/cohort editors. Use `usePermissions()`.
3. **Multi-file VCF append in the import worker** (L2 item 1, audit M-2). It still runs on the Electron main thread. Keep track 11's frequency property test green.
4. **Re-key and plaintext→encrypted migration off the main thread** (L2 item 2, audit M-5).

**P2**
5. Remember the Electron window size, position and maximised state (L1 item 5), clamped to visible displays and respecting the 1024×640 minimum.
6. URL state for per-column header filters and the active saved-preset chip (L1 item 6).
7. A shortlist case-switch CLS check in `tests/e2e/renderer-perf-phase1.e2e.ts` (L1 item 7, budget ≤ 0.02).
8. Large exports as background jobs that show in the job panel (P-D, depends on P-B jobs). `export:progress` events exist, but no UI uses them yet.
9. Persistent PG jobs table and shared replay buffer; signed download tokens kept in a shared store. Needed only for multi-instance web deployments, which today need sticky sessions.
10. Audit or proxy the browser's direct AlphaFold model download (P-C).
11. Remaining axe findings that predate this work: gene-structure tab contrast (5 nodes), the association group picker "Select all" (`aria-checked=mixed`), and the case-metadata Age field target size.
12. Approximate or capped row counts for big tables. This needs a UX decision first.
13. A per-user rate limit for reference lookups.

**P3**
14. Re-measure the mobile Lighthouse runs on a quiet machine. Mobile TBT was about 600 ms after track 2 and was noisy under load. Consider making the mobile budget gating.
15. Drop the throwaway Postgres DBs and schemas listed in §8.

## 6. How to work here without losing time

- **Heavy gates** always go through `flock /tmp/varlens-heavy-gate.lock systemd-run --user --scope -p MemoryMax=16G make <target>`. The machine is shared.
- **Before every push, run locally what GitHub runs:** `make ci`, `make agent-check`, `make ci-full`, `make perf-interaction-gates` (xvfb 1280×960, same as CI), `make ui-gates`, and `make web-gate-postgres` on a fresh DB. Two CI failures this session would have been caught that way:
  - **XPASS fails CI.** When you fix something listed in `KNOWN_FAILURES` / `KNOWN_INTERACTION_FAILURES`, remove the entry in the same commit. Both lists are empty now; keep them that way.
  - **Ubuntu 24.04 runners block Chrome's sandbox.** Lighthouse's Chrome needs `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. That step exists in `build.yml` and `web-ci.yml` before `make ui-gates`. Never add `--no-sandbox`.
  - The interaction gate also runs at ≥1440 px, where the panel docks. CI only runs at 1280, so test both sizes locally.
- **Parity manifest:** every new `window.api` method needs a manifest entry, or typecheck fails. When you serve a pending method, flip its entry and lower `scripts/parity-baseline.json` (now 0, so keep it 0). Renderer calls to desktop-only methods must be capability-gated, which `agent-check` enforces. Renderer tests need `installCapabilities()` from `tests/renderer/helpers/capabilities.ts`.
- **Security map:** every web method needs a policy in `operation-security-map.ts` that is audited or exempt with a reason. The registry test fails otherwise.
- **Migrations:** check the current max on `main` before you pick a number. PG numbers must be unique and contiguous, which a test checks. SQLite version assertions are spread across tests (grep `LATEST_SQLITE_SCHEMA_VERSION` and the version literals). A dev DB migrated by a newer branch cannot be opened by an older build, so use throwaway DBs (`CREATE DATABASE varlens_<x>`) and never `make pg-reset`.
- **Web servers you start** need their own port, their own `VARLENS_METRICS_PORT` (9090 is taken), their own `VARLENS_PG_SCHEMA`, and `VARLENS_RECOVERY_KEY_DIR=/tmp/varlens-<x>`. Never touch :8787/:9090, and never use `pkill -f server.cjs`.
- **Worktrees:** run `npm ci` in each one. **Never symlink `node_modules`.** Never `git add -A` without reading `git status` first; a symlink once shipped in v0.73.0.
- **Release** (memory `reference_release_procedure`):
  1. Merge the PR.
  2. `npm version minor --no-git-tag-version`, then commit `chore(release): vX.Y.Z` on `main` and push.
  3. Wait for `Build` to go green on **that** SHA, then `git tag -a vX.Y.Z -m vX.Y.Z <sha>` (signed) and push the tag.
  4. Check `gh release view vX.Y.Z --json isDraft,assets`.

  **Gotcha:** pushing anything else to `main` while the release commit's `Build` is queued *cancels* that run. Then tag the newer SHA, which still carries the version bump, once its `Build` is green.
- `gh pr edit` silently fails on this repo (Projects classic). Use `gh api -X PATCH repos/berntpopp/VarLens/pulls/<n>`.
- `/tmp` is a shared tmpfs (30 GB) and has filled up mid-build. Keep build output in the worktree or your scratchpad.

## 7. User's dev server (:8787)

It runs from worktree `.claude/worktrees/devserver-integ` (built from the integration branch) on **schema copy `web_dev_varlens_integ`**. The original `web_dev_varlens` was left untouched, because newer migrations are one-way.

To update it:
1. Check out the new code in that worktree (`git checkout --detach <sha>`).
2. Run `npm ci` if the lockfile changed.
3. Run `VARLENS_WEB_BASE=/ npm run build:web` under the lock.
4. Stop the PID in the scratchpad file `devserver.pid`, or find it with `ss -ltnp | grep :8787`.
5. Start `node out/web/server.cjs` with the same env, loaded literally rather than through the shell (the password hash contains `$`).

The user can go back to plain `make web-dev` from the main checkout at any time.

## 8. Cleanup still owed
- Throwaway PG databases on 127.0.0.1:55434: `varlens_integ_gates`, `varlens_integ_1b`, `varlens_integ_1b_r2`, `varlens_integ_2a`, `varlens_integ_w3`, `varlens_integ_final`, `varlens_track4`, `varlens_track11`, `varlens_nbweb`, `varlens_parity_b`, `varlens_parity_c`, `varlens_parity_d`, `varlens_parity_d_gate`, `varlens_pa_gate`, `varlens_pa_wg`, `varlens_l2`, plus any `varlens_integ2_*`.
- Schemas in `varlens_dev`: `web_dev_track2`, `web_dev_track3`, `web_dev_track13`, `web_dev_parity`, `web_dev_l1` and others named `web_dev_track*`/`web_t12_*`. **Keep** `web_dev_varlens` and `web_dev_varlens_integ`.
- Agent worktrees under `.claude/worktrees/agent-*`. Remove them once their branches are merged (`git worktree remove`). Leave `devserver-integ` in place while the dev server runs from it.
- Untracked files in the main checkout that this work didn't create: `.planning/issues/` and `scripts/sync-github-issues.sh`. Ask the user before touching them.
