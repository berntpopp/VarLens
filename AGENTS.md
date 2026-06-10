# AGENTS.md

Canonical agent contract for VarLens. Any coding agent (Codex, Claude Code, Cursor, Copilot, OpenCode, Zed, Factory, …) should read this file before doing any work. `CLAUDE.md` imports this file and only adds Claude-specific notes on top.

Keep this file lean. If an instruction belongs to only one agent, put it in that agent's own file.

## Project Overview

VarLens is an Electron desktop app for **offline genetic variant analysis**. It imports annotated variant data (JSON or VCF), stores it in a local SQLite database, and provides filtering, cohort analysis, ACMG classification, HPO matching, and export. The app is distributed as signed installers for Windows, macOS (Apple Silicon), and Linux.

The target user is a clinical geneticist or researcher working with case-level variant data. **There is no backend service** — all data stays on the user's machine.

## Tech Stack

| Layer         | Choice                                                              |
| ------------- | ------------------------------------------------------------------- |
| Runtime       | Electron 40 (main + preload + renderer)                             |
| Renderer      | Vue 3.5 + Vuetify 4 + Pinia 3 + Vue Router                          |
| Build         | electron-vite 5 + Vite 7                                            |
| Language      | TypeScript 6, strict mode                                           |
| Database      | `better-sqlite3-multiple-ciphers` (encrypted SQLite, synchronous)   |
| Query builder | Kysely (used for types — not as a dialect abstraction)              |
| Tests         | Vitest (unit/integration, happy-dom) + Playwright `_electron` (E2E) |
| Docs site     | VitePress (`docs/`)                                                 |
| CI/CD         | GitHub Actions on Windows / Ubuntu / macOS runners                  |

Node version is pinned by `.nvmrc` — match it before running anything (`24.15.0` at time of writing). npm ≥ 11 is required.

## Repository Layout

```
src/
  main/          Electron main process (IPC handlers, database, import/export workers)
  preload/       contextBridge API (typed, domain-organized under preload/domains/)
  renderer/      Vue 3 SPA (composables, stores, views, components)
  shared/        Cross-process types, IPC domain contracts, filters, SQL templates
tests/
  e2e/           Playwright Electron tests (startup smoke, perf, workflows)
  ...            Vitest unit/integration tests mirror src/ layout
.planning/       Specs, plans, code reviews, artifacts, research notes — NOT user docs
docs/            VitePress user-facing documentation (what ships to users)
scripts/         Build helpers, gene reference builder, perf comparison
.github/         CI (build.yml, release.yml) + PR/issue templates
Makefile         Canonical command surface — mirrored by GitHub Actions workflows
```

## Setup

```bash
npm ci                 # install deps; postinstall rebuilds native module for Electron
make dev               # rebuild for Electron + start electron-vite dev server
```

On Windows, `@electron/rebuild` requires **Visual Studio Build Tools** with the "Desktop development with C++" workload. GitHub Actions `windows-latest` has this pre-installed.

## Critical Gotcha: Native-Module Dual-Rebuild

`better-sqlite3-multiple-ciphers` is a native Node.js addon that must be compiled against the **Node ABI of whoever is loading it**. Electron's Node ABI differs from system Node's. Tests run under system Node; the app runs under Electron. The rebuild has to match.

The canonical sequence:

```bash
npm ci                    # postinstall rebuilds for Electron
make rebuild-node         # rebuild for Node before running Vitest
make test                 # Vitest against Node-ABI binary
make rebuild              # rebuild for Electron before packaging or running the app
make dist                 # package
```

**If tests fail with `ERR_MODULE_NOT_FOUND` on `out/main/db-worker.js`** or native-load errors, the binary is built for the wrong ABI. Run `make rebuild-node` (for tests) or `make rebuild` (for the app) and retry.

Do **not** use `electron-builder install-app-deps` — it has been broken for Electron 20+. `postinstall` uses `@electron/rebuild` directly. `electron-builder`'s `npmRebuild: false` is intentional.

## Canonical Commands

The **Makefile is the source of truth**. GitHub Actions workflows mirror it target-for-target. When in doubt, run the `make` target, not the underlying npm script.

| Command                                                             | Purpose                                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `make dev`                                                          | Rebuild for Electron, start hot-reload dev server                                             |
| `make lint` / `make lint-check`                                     | ESLint with / without auto-fix                                                                |
| `make format` / `make format-check`                                 | Prettier with / without write                                                                 |
| `make typecheck`                                                    | `vue-tsc` (renderer), then `tsc` (node), serialized to bound peak memory                      |
| `make test`                                                         | Vitest once (run `make rebuild-node` first)                                                   |
| `make test-watch` / `make test-coverage`                            | Vitest watch / with coverage                                                                  |
| `make agent-check`                                                  | Check LLM-sustainable source size and context guardrails                                      |
| `make build`                                                        | `electron-vite build` into `out/`                                                             |
| `make dist` / `make dist-linux` / `make dist-mac` / `make dist-win` | Build + package                                                                               |
| `make ci`                                                           | Local minimum: lint-check + format-check + typecheck + rebuild-node + test                    |
| `make ci-full` / `make ci-actions`                                  | Full local mirror of GitHub Actions pipeline                                                  |
| `make ci-startup-smoke`                                             | Playwright Electron startup smoke under xvfb (Linux)                                          |
| `make docs-dev` / `make docs`                                       | VitePress user docs                                                                           |
| `VARLENS_WEB=1 make ...`                                            | Mode toggle: extends `dev` / `test` / `ci` to include the web layer (see "Mode toggle" below) |

**Before claiming work is done, run `make ci` at minimum.** This target intentionally serializes the heavyweight gates to keep local peak memory bounded. For anything touching Electron lifecycle, IPC, workers, or packaging, run `make ci-full`.

### Mode toggle: desktop (default) / web (opt-in)

`VARLENS_WEB=1` extends `make dev`, `make test`, and `make ci` to include the web layer. Default is desktop. Direct targets (`make web-gate-static`, etc.) still work for web-only invocations.

```
make test                    # desktop suite (main + renderer + refactor-checkpoint)
VARLENS_WEB=1 make test      # adds web-gate static + integration

make ci                      # desktop CI gate
VARLENS_WEB=1 make ci        # desktop + web

make dev                     # Electron dev server
VARLENS_WEB=1 make dev       # local Postgres-backed web server at http://localhost:8787/
make web-dev                 # same web server target without setting VARLENS_WEB
```

This matches the desktop-default, web-opt-in model. A desktop-only contributor never needs to set the var; a web-track contributor sets it once per shell.

## Testing

- **Unit / integration**: Vitest. Files live next to source (e.g. `src/main/foo.ts` → `tests/main/foo.test.ts`). Happy-dom is the renderer environment. Run `make rebuild-node` first or the native module will ABI-fail.
- **E2E**: Playwright's native Electron support (`_electron.launch`) against the built `out/main/index.js`. See `tests/e2e/helpers/electron-app.ts` for the shared launcher (isolated `userData`, perf-mode hooks, failure capture). `make build` first.
- **Startup smoke**: `tests/e2e/startup-smoke.e2e.ts` asserts `app-ready`, `window-created`, `renderer-interactive` perf milestones. It is a first-class CI gate on Linux via `xvfb-run`. Treat failures as release blockers.
- **Perf**: `tests/e2e/renderer-perf-phase1.e2e.ts` + `scripts/perf/compare-phase1.mjs` produce reproducible frozen-fixture comparisons under `.planning/artifacts/perf/phase1/`. Any renderer-perf claim must come with a before/after comparison from this harness.
- **WGS perf benchmarks**: Phase 9 introduced gated WGS import benchmarks for both backends. They are opt-in (`VARLENS_RUN_WGS_PERF=1`) and never run in CI.

  ```bash
  scripts/postgres/download-wgs-fixture.sh   # one-time; idempotent; writes to tests/.cache/wgs/ (gitignored)
  make pg-reset && make pg-up
  VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/postgres-vcf-wgs-import.perf.test.ts
  VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/sqlite-vcf-wgs-import.perf.test.ts
  node scripts/perf/compare-wgs-import.mjs
  make pg-down
  ```

  Each run writes a per-backend baseline artifact and a comparison file under `.planning/artifacts/perf/wgs-import/` (also gitignored). `BUDGET_S` per backend is `1.5×` the baseline. The Phase 9 escalation rule is "PG/SQLite ≤ 2.0×"; sustained ratios above that trigger a follow-up phase.

  PostgreSQL WGS query benchmarks are opt-in via `VARLENS_RUN_WGS_QUERY_PERF=1`. They write artifacts under `.planning/artifacts/perf/postgres-query/` and should be used before adding query indexes.

  **Current state (Phase 16/16.1/16.2, 2026-04-26):** PG VCF imports use `COPY FROM STDIN` via `pg-copy-streams`, with `search_document` populated by STORED generated columns on `variants`/`variant_sv`/`variant_str` (no FTS triggers, no per-batch bulk UPDATE). The dev container ships tuned postgresql.conf flags via `docker-compose.postgres.yml` (`max_wal_size=8GB`, `shared_buffers=2GB`, `wal_level=minimal`, etc.). Latest GIAB HG002 v4.2.1 numbers: **PG 97.28s vs SQLite 52.65s, ratio 1.85×** — comfortably under the ≤2.0× gate. Postgres is not yet strictly faster than SQLite (the residual gap is dominated by the COPY wire protocol vs SQLite's in-process call overhead); pushing under SQLite would require additional levers (binary COPY format, dropping per-batch ID reservation) tracked under future phases. The previous Phase 16 design that wrote `search_document` via a per-batch bulk UPDATE was 38.9% slower than the trigger path it replaced — confirmed via the `VARLENS_PG_IMPORT_PROFILE=1` instrumentation in `src/main/storage/postgres/postgres-import-profile.ts`, kept available for future debugging.

- **Preload contract**: `tests/shared/types/preload-contract.test.ts` locks the IPC surface to `IpcResult<T>` return types. If you touch IPC, this test is your first-line guardrail.
- **Coverage**: `COVERAGE=1 vitest run --coverage`. **Do not lower thresholds to make a failing suite pass** — add tests or fix the code.

## Code Style (non-obvious rules only)

A linter enforces formatting and generic TypeScript rules. What follows is what the linter cannot know.

- **Never use `console.log / console.error / console.warn` in application code.** Use the structured loggers:
  - Main process: `mainLogger` from `src/main/services/MainLogger` — `mainLogger.error(msg, 'source')`
  - Renderer: `logService` from `src/renderer/src/services/LogService` — `logService.error(msg, 'source')`
  - Documented exceptions: `logStore.ts` (bootstrap), `main.ts` (dev mode), `preload/index.ts` (no IPC yet), worker threads (no Electron IPC).
- **IPC channels use `domain:action` naming** — `cases:list`, `variants:query`, `filter-presets:save`. Handlers are registered in `src/main/ipc/handlers/<domain>.ts` and return through `wrapHandler(...)`, which produces `IpcResult<T | SerializableError>`. The renderer **must** call `unwrapIpcResult(...)` at the edge — see `src/renderer/src/utils/ipc-result.ts` and its broad use across the renderer.
- **IPC domains now follow the domain-module pattern by default**: `src/shared/ipc/domains/<name>.ts` (contract) + `src/preload/domains/<name>.ts` (preload binding) + `src/main/ipc/domains/<name>.ts` (handler registration). Most shipped app-facing domains are already on this shape. The remaining flat registrations are intentional (`shell`, `shortlist`, `system`, `updater`), so new work should follow the domain-module pattern rather than the old flat style.
- **Vue components** use `<script setup lang="ts">` with Composition API. Props via `defineProps<T>()`, emits via `defineEmits<{...}>()`. Prefer composables in `src/renderer/src/composables/` for shared logic — do **not** put shared logic in components.
- **Don't add try/catch for control flow in main-process IPC paths** — `wrapHandler` already converts thrown errors into `SerializableError` with structured fields. Let errors throw.

## LLM-Sustainable Development

VarLens should stay easy for coding agents and humans to inspect in bounded context. Treat these as review gates for all new or substantially changed code:

- **Keep source files under 600 lines** whenever practical. Prefer 150-400 lines. If a touched file exceeds 600 lines, either split it by responsibility or explain in the PR why the boundary would be worse. Generated code, static fixtures, migrations, snapshots, and lockfiles are exempt.
- **Run `make agent-check` before PRs that touch authored source structure.** Existing oversized files are tracked in `scripts/agent-health-baseline.json`; they must not grow unless the PR explains why the added code cannot be split safely.
- **Keep functions small and purpose-built.** A function over ~80 lines or with several unrelated branches should usually become smaller named helpers. The helper names should explain the domain step, not just the syntax.
- **One module, one reason to change.** Do not mix UI rendering, IPC calls, parsing, persistence, and business rules in one file unless the surrounding pattern already does so and the file remains small.
- **Make boundaries explicit.** Shared behavior belongs in typed contracts, composables, services, or parser modules with clear inputs and outputs. Avoid hidden global state and cross-layer imports that force agents to read half the repository to make a local change.
- **Prefer narrow context and narrow edits.** Before changing code, identify the owning module, nearest tests, and public contract. Do not perform opportunistic rewrites outside that scope.
- **Add or update tests at the behavior boundary.** For parser, IPC, storage, import/export, classification, and filtering changes, test the externally visible behavior rather than private implementation details.
- **New persistent data paths declare their retention data class.** Every new table, volume, or export states in its introducing PR whether it holds **case data**, **audit events**, or **technical logs** (platform retention contract). Do not add productive auto-deletion for case data or audit events — retention periods are operator decisions; technical TTLs for transient copies (e.g. upload staging) are the only exception and must be justified as such.
- **Leave durable breadcrumbs only where useful.** If a repeated agent mistake needs prevention, add a short rule here or to the relevant `.planning/` note. Do not add broad advice like "write clean code"; if removing the sentence would not cause mistakes, cut it.
- **Split large work into reviewable PRs.** If a task touches more than one major boundary (for example import pipeline + storage + renderer), prefer staged PRs with `.planning/` specs or plans unless atomicity is required.
- **Preserve agent context hygiene.** Keep `AGENTS.md` lean and stable: commands, non-obvious architecture, project-specific rules, and gotchas belong here; long explanations, inventories, and volatile research belong in `.planning/`.

## UI / Vuetify Rules

Full pattern catalog in `.planning/docs/UI-PATTERNS.md`. The two that bite hardest:

- **Never use `surface-variant` for background colors.** VarLens's warm palette maps `surface-variant` to `#f5f2ef` against `surface` `#faf8f6` — white-on-white, invisible. Use `bg-grey-lighten-3` for subtle contrast (nested tables, expanded rows) or `secondary` `#424242` for strong contrast (tabs, toolbars).
- **`v-data-table-server` expand API**: `v-model:expanded` emits an **array of item keys (strings)**, not `{ value, item }` objects. Passing the wrong shape silently breaks row expansion.

## Domain Conventions

VarLens stores data from two very different input formats in **one unified schema**. Field naming follows a deliberate convention that is easy to get wrong:

- **`consequence`** → IMPACT level: `HIGH` | `MODERATE` | `LOW` | `MODIFIER`
- **`func`** → Sequence Ontology consequence term: `missense_variant`, `stop_gained`, `splice_acceptor_variant`, …

Both JSON-format imports and VCF imports (via VEP `CSQ` or SnpEff `ANN`) populate the same two fields with the same meaning. Don't swap them.

VCF import lives in `src/main/import/vcf/`. The pipeline is deliberately modular: `vcf-header-parser → vcf-line-parser → vcf-allele-splitter → vcf-annotation-parser → vcf-genotype-parser → VcfMapper → VcfStrategy`. `info-field-registry.ts` maps configured INFO fields to DB columns; everything else lands in the `info_json` column. Multi-sample VCFs create **one case per selected sample**.

Test data lives at `tests/test-data/vcf/` (GIAB Chinese Trio, chr22:29M–30.5M, annotated with VEP + SnpEff). Regenerate via `scripts/prepare-test-data.sh`.

## Planning & Documentation

- **All plans, specs, design docs, code reviews, and research notes go in `.planning/`.** Never put them in `docs/`.
- `.planning/specs/` for specifications, `.planning/plans/` for execution plans, `.planning/code-review/` for reviews, `.planning/artifacts/` for machine-generated artifacts (perf runs, inventories), `.planning/docs/` for long-form research notes that inform decisions.
- `docs/` is VitePress — **user-facing documentation only**. What ships on the website.

## Commit & PR Conventions

- **Branch & PR workflow.**
  - Never commit feature/work changes directly to `main`.
  - All implementation work must happen on a dedicated branch.
  - Every branch must be intended for a PR.
  - Use git worktrees when useful or when the current checkout should stay clean.
  - Only documentation/archive housekeeping may be committed directly to `main` if explicitly requested.
- **Conventional Commits.** Types used in this repo: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `chore`, `ci`, `merge`. Optional scope in parentheses: `refactor(ipc): …`, `fix(renderer): …`. Read `git log --oneline -30` before opening a PR if you're unsure of current phrasing.
- **Release flow.** Versions are tagged `vX.Y.Z`. `.github/workflows/release.yml` **refuses to publish** if `build.yml` has not passed on the exact tagged SHA. Do not tag until CI is green on the commit you're tagging.
- **PRs.** Small, focused, green CI. If a change spans shell + IPC + database, split it unless the atomicity is load-bearing. Reference the `.planning/` plan or review that motivates the change.

## Workflow Maintenance

- **GitHub Actions must stay pinned to full commit SHAs, not floating tags.** Use the form `uses: owner/repo@<full-sha> # owner/repo@vX.Y.Z` so the reference is immutable and Dependabot can still update it cleanly.
- `.github/dependabot.yml` already tracks the `github-actions` ecosystem. When updating or adding workflow actions, keep the human-readable tag comment on the same `uses:` line so Dependabot preserves and refreshes it.

## Security Defaults

- Electron window creation enforces `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. See `src/main/index.ts`. **Do not weaken these.**
- Packaged builds harden Electron fuses via `scripts/configure-fuses.mjs`, invoked from electron-builder's `afterPack` hook. See the "Electron fuse baseline" subsection below.
- Large renderer-side runtimes such as `pdbe-molstar` should be loaded through Vite's asset graph, not via copied public JS files or raw `file://` script injection. Prefer lazy `import(...)` over bespoke script-tag loaders so Electron packaging stays deterministic across platforms.
- Renderer talks to main only through the typed `window.api` exposed by `src/preload/index.ts` — no raw `ipcRenderer`. Adding a new IPC channel means adding to the shared contract, preload, main handler, and (ideally) the preload contract test.
- External URLs are validated before `shell.openExternal`. Do not add a shortcut path that skips that validation.
- SQLite databases can be encrypted (`better-sqlite3-multiple-ciphers`). User keys are never logged; tests must not commit real user data.

### Electron fuse baseline

`scripts/configure-fuses.mjs` owns the packaged fuse configuration. `strictlyRequireAllFuses: true` forces the baseline to declare every fuse known to the pinned `@electron/fuses` version — an Electron upgrade that introduces a new fuse makes the build fail until the baseline declares an explicit value.

Current baseline (read the script for the authoritative list):

- `RunAsNode: false` — blocks repurposing the packaged binary as a generic Node.js runtime.
- `EnableCookieEncryption: true` — at-rest cookie encryption for the session.
- `EnableNodeOptionsEnvironmentVariable: false` — disables `NODE_OPTIONS` injection paths.
- `EnableNodeCliInspectArguments: false` — disables CLI inspector attachment.
- `EnableEmbeddedAsarIntegrityValidation: true` — validates the shipped asar against its hash; pairs with `OnlyLoadAppFromAsar` per Electron guidance (see https://www.electronjs.org/docs/latest/tutorial/asar-integrity).
- `OnlyLoadAppFromAsar: true` — refuses to launch the main app from any location other than `app.asar`.
- `LoadBrowserProcessSpecificV8Snapshot: false` — current default preserved.
- `GrantFileProtocolExtraPrivileges: true` — current default preserved; tightening this fuse is a separate, deliberate decision.
- `resetAdHocDarwinSignature: true` — re-ad-hoc-signs the macOS binary after fuse flipping so local ad-hoc builds remain launchable.

`@electron/fuses` 2.x exposes `WasmTrapHandlers`, but Electron 40's fuse wire and electron-builder's bundled fuse implementation cannot configure it yet. Do not add it to the baseline until the packaged Electron binary supports that fuse.

The baseline lives only in `scripts/configure-fuses.mjs`. Do not reintroduce `build.electronFuses` in `package.json`; the hook owns the flip and `doAddElectronFuses` short-circuits when the declarative block is absent.

## What NOT to do

- Do not introduce `console.*` calls.
- Do not widen IPC surface without adding types to `src/shared/ipc/domains/` (or `src/shared/types/api.ts` for legacy handlers).
- Do not import from a child of `src/renderer/src` into `src/main`. The renderer and main do not share a runtime; shared code goes through `src/shared/`.
- Do not lower coverage / lint / typecheck thresholds to make a failing suite pass. Add tests or fix the code.
- Do not put plans, specs, or reviews in `docs/`. Use `.planning/`.
- Do not commit `.planning/artifacts/perf/phase1/` run outputs — they are gitignored on purpose.
