# Changelog

All notable changes to VarLens are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.70.0] — 2026-07-13

Security, data-correctness, and failure-handling release consolidating PRs #306–#314.

### Added

- New SQLite databases are encrypted by default with managed per-database keys,
  crash-recoverable provisioning, optional recovery-passphrase sidecars, and a
  consented, reversible migration flow for existing plaintext databases.
- Transcript records now store IMPACT in `consequence` and the Sequence Ontology term
  in `func` consistently across JSON, VEP, SnpEff, SQLite, PostgreSQL, and the UI.

### Security

- Import readers now enforce decompressed-byte, line-length, gzip-expansion, BED-entry,
  ZIP archive, ZIP entry-count, and decoded-size limits while retaining streamed WGS
  support. Malformed VCF coordinates and quality values are rejected with counted reasons.
- File and navigation authority is restricted to explicit selections or derived extraction
  paths. Resolved symlink targets are pinned, one-shot capabilities are revoked after use,
  and the boundary covers renderer navigation, redirects, external URLs, database selection,
  BED files, and ZIP extraction.
- Session-level CSP is locked to the renderer policy, denies framing, and covers global
  windows, redirects, and webviews without breaking the Mol* viewer.
- Structured logging redacts additional credential forms; SQL directions, association
  filters, and PostgreSQL health checks now use allowlists or bound parameters.
- Encryption key-registry mutation fails closed on damaged registries, preserves displaced
  recovery keys, and avoids overwriting recoverable key material.

### Fixed

- Renderer IPC consumers consistently unwrap `IpcResult`, surface structured failures,
  serialize metadata mutations, isolate database-switch generations, and prevent stale
  import promises/events from overwriting a later run.
- ZIP imports no longer turn extraction failures into apparent success. Each extraction has
  independent cleanup authority, bounded concurrency, retryable plaintext cleanup, and
  lifecycle cleanup on failure, cancellation, back, close, and stale completion.
- VEP/SnpEff multi-allelic matching now fails closed on ambiguity, supports standard compound
  ANN alleles, respects declared allele vectors, and maps genotype AD using header semantics.
- Transcript selection preserves canonical impact/SO semantics and repairs provable legacy
  values equivalently in SQLite and PostgreSQL migrations.
- Panel interval failures, import failures, dialog failures, and other formerly discarded
  errors now reach the user instead of silently degrading behavior.

### Changed

- PostgreSQL BED persistence is chunked transactionally, and web BED imports use the shared
  bounded streaming reader instead of materializing the full input text.

## [0.69.7] — 2026-07-06

Dependency maintenance release.

### Changed

- Bumped fastify to 5.10.0, fastify-type-provider-zod to 7.0.0, Kysely to 0.29.3,
  Plotly.js basic to 3.7.0, and Vitest/coverage to 4.1.10.

## [0.69.6] — 2026-07-05

GitHub Actions maintenance release.

### Changed

- Updated pinned paths-filter, Docker build/login, and CodeQL upload actions while retaining
  immutable full-SHA references.

## [0.69.5] — 2026-07-03

Dependency maintenance release.

### Changed

- Bumped markdown-it 14.3.0 (production dependency) and @electron/fuses 2.1.3 +
  vue-tsc 3.3.6 (development dependencies).

### Fixed

- `PanelEditorDialog` ambiguous-gene `v-select` now guards the null (cleared)
  `update:model-value` emit, a latent unsoundness surfaced by the vue-tsc 3.3.6 upgrade.

## [0.69.4] — 2026-07-03

Security + dependency maintenance release.

### Security

- Cleared **all 11 open Dependabot security alerts** by updating build/dev-chain
  dependencies: **undici** to 6.27.0 / 7.28.0 (9 advisories, including two HIGH SOCKS5
  CVEs — TLS certificate-validation bypass and cross-origin request routing), **esbuild**
  to 0.28.1 (dev-server arbitrary file read), and **@babel/core** to 7.29.7
  (`sourceMappingURL` arbitrary file read). None of these dependencies ship in the
  packaged installer, so real-world exposure was low.

### Changed

- Bumped production dependencies: fastify 5.9.0, pg 8.22.0,
  better-sqlite3-multiple-ciphers 12.11.1, vuetify 4.1.2, @fastify/rate-limit 11.1.0,
  adm-zip 0.5.18, nanoid 5.1.16, pg-query-stream 4.16.0.
- Bumped development dependencies: electron 40.10.5, vite 7.3.6, vue 3.5.39,
  typescript-eslint 8.62.0, eslint 10.6.0, prettier 3.9.1, @types/node 26,
  @playwright/test 1.61.1, @electron/rebuild 4.0.6, and others.
- Bumped GitHub Actions: actions/checkout 7.0.0, actions/cache 6.1.0,
  actions/setup-java 5.4.0.

## [0.68.0] — 2026-05-29

Sprint A — Foundations for 1000-genome scale. Four independently-reviewed PRs
(#241–#244) plus a follow-up fix (#245).

### Added

- **Materialised PostgreSQL cohort summary** (`cohort_variant_summary`,
  `cohort_column_meta`, `cohort_summary_state`; migration `0010`) with incremental
  add/remove maintenance inside the import transaction, column-meta refresh,
  per-build `cohort_frequency` recompute, staleness state, and cohort-read
  `warnings.staleSummary` with synchronous/background rebuild bootstrap.
- **`JobRunner` tracking wrapper** over the five long-running-work sites
  (Postgres single/multi import, batch import, gene-burden compare, SQLite import),
  preserving existing behaviour and single-flight guards.
- **`jobs:` IPC domain** (registered, not yet consumed) and **`debug:` IPC domain**
  for query-counter observability.
- **Multi-project architecture design doc** and a **projects registry** migration
  (PG `0011` / SQLite `v31`).

### Changed / Performance

- **Annotation `getBatch`** reduced from N+1 to 1–2 batched SELECTs per call on
  both SQLite and PostgreSQL, backed by a `(chr, pos, ref, alt)` covering index
  (PG `0009` / SQLite `v29`); per-case lookups defensively reject spoofed variantIds.
- **PostgreSQL named/prepared statements** (`runNamed` / `runNamedDynamic`) rolled
  out across the top read sites, with UNNEST-array batch bindings and a coverage gate.
- **Renderer IPC param sanitisation** via `stripVueProxies`; `cloneForIpc` now
  backed by `structuredClone`. Deferred mount for the case + cohort filter toolbars;
  `shallowRef` + `markRaw` for the shortlist row buffer.
- **SQLite cohort SV/CNV interval-overlap parity** with PostgreSQL (`end_pos` on
  `cohort_variant_summary`, migration `v30`).

### Fixed

- Renderer `mockApi` now implements the `jobs` domain so it satisfies `WindowAPI`.

## [0.59.5] — 2026-05-25

### Security

- **Main-process log redaction now protects PHI before persistence and IPC.**
  HGVS notation, genomic coordinates, and patient/sample identifiers are
  scrubbed before `electron-log` writes to disk and before log messages are
  forwarded to renderer windows.

### Fixed

- **Release workflow now refuses tag/package version mismatches.** Tags such as
  `vX.Y.Z` must match `package.json` before release artifacts can be published.

### Internal

- **CHANGELOG history backfilled for 13 tagged releases** from `v0.56.8`
  through `v0.59.3`, and the release runbook now requires promoting
  `[Unreleased]` before bumping `package.json`.

## [0.59.3] — 2026-05-21

### Changed

- **Agent-health guardrails added** (#209) to keep authored source files within
  LLM-sustainable review bounds. The repository now has a Make target and
  baseline-backed checks that flag oversized source growth before PRs land.
- **LLM-sustainable coding rules documented** in `AGENTS.md`, making the
  source-size, boundary, testing, and planning expectations explicit for all
  coding agents.

### Internal

- **Dependabot maintenance releases consolidated** across runtime and
  development dependencies (#203, #206).
- **Agent-health planning and review notes archived** under `.planning/`,
  including the derived-data consistency plan, the 2026-05-21 follow-up review,
  and the implementation plan for guardrails.

## [0.59.0] — 2026-04-30

### Added

- **PostgreSQL connection manager UI added** so users can configure and switch
  hosted PostgreSQL workspaces from the app instead of relying only on local
  development wiring.
- **Hosted PostgreSQL smoke tooling added** for exercising the hosted-workspace
  path and capturing WGS query readiness evidence before future query-index
  work.

### Changed

- **PostgreSQL migration lifecycle hardened** so hosted and local PostgreSQL
  workspaces can be brought forward through schema changes more reliably.
- **Final PostgreSQL parity gates satisfied** across the product-parity work,
  completing the storage-backend parity push that started in the 0.56.x series.

### Security

- **PostgreSQL profiling secret lifecycle cleaned up** so profiling support no
  longer leaves sensitive connection material around longer than required.

### Internal

- **PostgreSQL product-parity specs and completed plans archived** under
  `.planning/`, preserving the audit trail for the parity release work.

## [0.58.3] — 2026-04-30

### Added

- **Clinical variant filter parity added for PostgreSQL** so clinical filtering
  workflows can run against the PostgreSQL backend.
- **Cohort, export, and audit-log parity added for PostgreSQL**, closing the
  remaining high-level workflow gaps between SQLite and PostgreSQL-backed
  workspaces.

### Fixed

- **Database picker now shows the active workspace** when PostgreSQL support is
  enabled, reducing ambiguity during backend switching.
- **Shortlist IPC errors are handled in the renderer** instead of surfacing as
  unhandled failures.
- **Shortlist behavior corrected for PostgreSQL workspaces.** Unsupported
  shortlist states are hidden where needed, PostgreSQL shortlist parity is
  implemented, and the SQLite shortlist read task is routed through the storage
  executor.

### Internal

- **PostgreSQL parity roadmap status refreshed and final plans archived** under
  `.planning/`.

## [0.58.2] — 2026-04-30

### Internal

- **Dependency updates consolidated** into a single maintenance release.

## [0.58.1] — 2026-04-30

### Internal

- **Compatible Dependabot updates consolidated** into one dependency-maintenance
  release.

## [0.58.0] — 2026-04-30

### Added

- **PostgreSQL VCF imports switched to `COPY FROM STDIN`.** The import path now
  uses `pg-copy-streams`, reusable COPY text encoders, pre-reserved IDs, and
  worker-thread orchestration for JSON, VCF, and multi-file imports.
- **PostgreSQL generated search documents added** for variants and extension
  tables, replacing the earlier per-batch bulk-update approach with STORED
  generated columns.
- **PostgreSQL backend capability matrix, schema migration lifecycle, variant
  filter parity, export/delete overview parity, workflow-domain parity, and
  hosted-operations foundation added** as the next product-parity layer.
- **WGS import and query benchmark harnesses added** for PostgreSQL and SQLite,
  including the GIAB HG002 fixture downloader and comparison scripts.

### Changed

- **PostgreSQL bulk-load performance tuned** through Docker PostgreSQL
  configuration changes and batch-level worker commits. The recorded Phase
  16/16.1/16.2 WGS state documents PostgreSQL imports at 1.85x SQLite for the
  GIAB HG002 v4.2.1 benchmark.
- **PostgreSQL import-worker contracts tightened** around cancellation,
  transaction scoping, SSL config mapping, stream error handling, large-allele
  handling, and hash-keyed `variant_frequency` joins.
- **PostgreSQL storage-roadmap work advanced** from Phase 16 implementation
  into the broader parity roadmap, with the completed phase archives moved into
  `.planning/`.

### Fixed

- **PostgreSQL COPY worker bundling fixed** by using the named `pipeline`
  import that survives the worker bundle.
- **Large-allele frequency rebuilds fixed** by adding `coord_hash` generated
  columns, hash-keyed indexes, and hash-only joins for `variant_frequency`.
- **PostgreSQL parity review comments addressed** before the 0.58.0 tag.

### Internal

- **COPY text encoding gained property and boundary tests** with a dedicated
  coverage gate for the encoder module.
- **PostgreSQL import E2E coverage expanded** across COPY cancellation,
  large-allele scenarios, VCF single-sample import, extension tables, BED
  filtering, multi-file import, partial failure, pre-existing rejection, and
  cancellation responsiveness.
- **Phase 9, 9.1, 16, and roadmap planning artifacts archived** under
  `.planning/`.

## [0.56.14] — 2026-04-26

### Added

- **Storage import executor contract added** with SQLite and PostgreSQL
  implementations for JSON imports, giving the active storage session ownership
  of import writes.
- **PostgreSQL import worker pipeline added** for JSON, VCF, and multi-file
  imports, including worker-thread message contracts, transaction-scoped
  repositories, BED filtering, pre-mapping filters, per-file transactions, and
  post-loop bookkeeping.
- **PostgreSQL VCF import support added** for single-sample, multi-file,
  extension-table, large-allele, and cancellation scenarios.
- **WGS import benchmark tooling added** with the GIAB HG002 fixture downloader,
  PostgreSQL and SQLite benchmark tests, and comparison artifacts.
- **Large-variant coordinate hashing added** for PostgreSQL via `coord_hash`
  generated columns and hash-keyed indexes.

### Changed

- **Import start IPC now routes through the active storage session**, keeping
  import execution aligned with the selected backend.
- **PostgreSQL import repositories made transaction-scoped** and shared
  PostgreSQL import configuration helpers extracted for reuse.
- **PostgreSQL import worker commits per batch** to improve WGS import
  performance while preserving cancellation and failure behavior.

### Fixed

- **Import-executor lifecycle and concurrency guards hardened** to avoid invalid
  import states.
- **PostgreSQL import worker stream errors handled** so unhandled worker errors
  do not escape cancellation and failure paths.
- **PostgreSQL large-allele frequency rebuilds fixed** by upserting and joining
  `variant_frequency` through `coord_hash`.
- **PostgreSQL worker review comments addressed** before release.

### Internal

- **PostgreSQL parity Phase 8 and Phase 9 planning artifacts archived and
  refreshed** under `.planning/`, including the large-coordinate index design.
- **WGS benchmark state documented** in `AGENTS.md`, and the GIAB fixture SHA256
  pinned for reproducible performance runs.

## [0.56.13] — 2026-04-24

### Added

- **PostgreSQL variant read schema and seed data added** for the storage parity
  path.
- **PostgreSQL variant read paths added** for small reads and query reads,
  allowing variant lookup and query workflows to execute through PostgreSQL
  storage sessions.

### Changed

- **SQLite variant reads now route through storage executors**, matching the
  new backend-neutral read boundary.
- **Variant read IPC now routes through storage sessions** instead of directly
  coupling to the legacy SQLite path.

### Fixed

- **PostgreSQL variant-read review comments addressed** before release.

### Internal

- **Variant read executor contracts and E2E coverage added** for PostgreSQL
  variant reads.
- **PostgreSQL variant read parity planning archived** under `.planning/`, with
  variant filter metadata explicitly deferred.

## [0.56.12] — 2026-04-24

### Added

- **PostgreSQL case metadata repository added** with metadata filter support for
  the storage parity path.

### Changed

- **Case metadata moved behind executor contracts** for both SQLite and
  PostgreSQL, and IPC now routes case metadata through storage sessions.
- **PostgreSQL write-executor dependencies narrowed** as the storage boundary
  continued to separate read and write responsibilities.

### Fixed

- **PostgreSQL case metadata integers normalized** so metadata responses match
  SQLite expectations.
- **PostgreSQL distinct HPO responses aligned** with the existing SQLite
  contract.

### Internal

- **PostgreSQL case metadata dev-mode E2E coverage added**.
- **Phase 5 storage docs archived and Phase 6 PostgreSQL parity planning
  added** under `.planning/`, along with a PostgreSQL WGS readiness inventory.

## [0.56.11] — 2026-04-24

### Added

- **Storage session read-executor contract added** as the next backend-neutral
  storage boundary.
- **PostgreSQL cases query executor added**, enabling `cases:list` to run
  through PostgreSQL-backed storage sessions.

### Changed

- **Legacy database-pool access bridged through storage sessions** so IPC paths
  can migrate without breaking existing SQLite behavior.
- **SQLite read execution and cases queries moved under storage executors**,
  aligning SQLite with the new session boundary.
- **Available builds migrated to the storage executor** and file-backed worker
  writes marked SQLite-only.

### Internal

- **Storage executor files formatted** and completed phase docs archived.
- **Branch and PR workflow requirements added to `AGENTS.md`**.
- **Storage Phase 5 planning added** under `.planning/`.

## [0.56.10] — 2026-04-24

### Fixed

- **Release workflow gate now uses the correct Build workflow name**, restoring
  the tagged-release check that waits for the matching build workflow run.

## [0.56.9] — 2026-04-24

### Added

- **`cases:list` PostgreSQL vertical slice added** (#174), extending the storage
  session scaffold with the first user-facing read path backed by PostgreSQL.

### Internal

- **Completed storage planning documents archived** under `.planning/`.

## [0.56.8] — 2026-04-23

### Added

- **PostgreSQL storage session Phase 2 scaffold added** (#173), continuing the
  backend-neutral storage-session work after the initial 0.56.7 boundary landed.

## [0.56.7] — 2026-04-23

### Changed

- **Phase 1 storage-session boundary scaffold landed on `main`.** VarLens now
  has explicit `StorageSession` / `StorageManager` contracts, a
  `SqliteStorageSession` wrapper over the existing SQLite runtime, and a
  session-backed `DatabaseManager` that preserves current `DatabaseService`
  compatibility while establishing the seam for future PostgreSQL-backed work.
- **Local PostgreSQL development workflow added** with a localhost-only Compose
  stack, configurable nonstandard port (`55432` by default), bootstrap SQL,
  `.env.postgres.example`, and `pg-up` / `pg-down` / `pg-logs` / `pg-psql` /
  `pg-reset` Make targets for workstation setups that run multiple local
  database projects in parallel.

### Internal

- **CI and release secrets scanning no longer depend on the deprecated
  Node-20-only `gitleaks` GitHub Action.** Both workflows now download and run
  a pinned `gitleaks` CLI release directly, eliminating the GitHub Actions
  runtime deprecation warning while keeping deterministic secrets scanning in
  place.

## [0.56.6] — 2026-04-23

### Security

- **`onlyLoadAppFromAsar` fuse enabled** on packaged builds. The main
  process now refuses to launch from any location other than `app.asar`,
  pairing with the existing `enableEmbeddedAsarIntegrityValidation` per
  Electron's hardening guidance. Addresses Priority A of the 2026-04-22
  codebase review (#169).

### Changed

- **Fuse configuration moved to an `afterPack` hook**
  (`scripts/configure-fuses.mjs`) with `strictlyRequireAllFuses: true`.
  Electron upgrades that introduce new fuses now fail the build until
  the baseline declares an explicit value for each — a deliberate drift
  detector, not a regression. `build.electronFuses` in `package.json`
  is intentionally removed so electron-builder's internal
  `doAddElectronFuses` short-circuits.
- **Lockfile regenerated under `.nvmrc`-pinned Node 24.14.1** to restore
  optional peer deps that a prior resolution under Node 24.5.0 had
  dropped (`@electron/windows-sign`, `cross-dirname`, `postject`,
  `fs-extra`, `commander`, `jsonfile`, `universalify`). `npm ci` now
  succeeds on a clean tree.
- **ESLint now ignores the `release/` directory** so a local `make dist`
  no longer poisons subsequent `make ci` runs.

### Added

- **Linux packaged-binary smoke test**
  (`tests/e2e/packaged-smoke.e2e.ts`) that spawns
  `release/linux-unpacked/varlens` directly and waits for the
  `IPC handlers registered` log line. Catches boot regressions caused
  by fuse flipping that the existing unpacked startup smoke cannot.
  Wired into `make ci-packaged-smoke-linux`, `make ci-full`, and the
  Linux job in `.github/workflows/build.yml`.
- **`AGENTS.md` "Electron fuse baseline" subsection** listing each
  fuse and the single-source-of-truth rule.

## [0.56.1] — 2026-04-12

### Changed

- **CI actions bumped to Node-24-compatible majors** ahead of GitHub's
  June-2026 forced cutover: `actions/cache@v4 → v5`,
  `actions/upload-artifact@v4 → v5`, `actions/download-artifact@v4 → v6`.
  `gitleaks/gitleaks-action` stays at `@v2` (no v3 upstream; flagged as
  a follow-up risk in the PR body).
- **macOS build is now explicitly Apple Silicon-only.** `package.json`
  `build.mac.target` switched from the string form to the object form
  with `arch: ["arm64"]` declared. Previously the build silently
  depended on the `macos-latest` runner's host architecture. Intel Mac
  support is dropped; `README.md` and `docs/guide/installation.md`
  updated to state the requirement explicitly.

### Fixed

- **Coverage thresholds restored** to their pre-`5dc2beb` values via
  added tests instead of by lowering the gates. Commit `5dc2beb` had
  lowered `src/main/services/scoring/**` from 95/90/95/95 to 92/90/95/90
  and `src/renderer/src/components/shortlist/**` from 75/65/75/75 to
  70/60/70/70 to unbreak main-branch CI. This release restores both
  thresholds and adds two new test files:
  - `tests/main/services/scoring/score-row-uncovered-paths.test.ts`
    exercises the `scoreRow()` dispatcher's `default` switch branch
    and `catch` block in `src/main/services/scoring/index.ts`, which
    the existing per-type scorer tests never routed through because
    they called each scorer directly.
  - `tests/renderer/components/shortlist/shortlist-render-paths.test.ts`
    covers the `variantCell()` switch for every variant type
    (SV/CNV/STR/SNV with and without HGVS), HGVS prefix idempotence,
    the actions `v-menu` click handlers (`row-click` and `open-in-tab`
    via `targetTabFor`, including the `indel → snv` fallback), and
    three `ShortlistPanel` branches (`onToggleStar` `api=undefined`
    guard, `onToggleStar` catch block, `dismissError`).
  - Coverage after this release: scoring glob `97.05%` lines, shortlist
    glob `95.6%` lines — both well above the restored thresholds.

### Internal

- `chore(format):` reformat `package.json` `build.mac.target` to match
  the project's Prettier config. `make lint` + `make typecheck` don't
  run Prettier on `package.json`; only `make ci`'s Prettier step did,
  catching the violation on the first branch CI run.
- `docs(planning):` new scoring-via-filters vision document at
  `.planning/docs/2026-04-11-scoring-via-filters-vision.md` captures
  the architectural direction for eventually replacing the current
  formula-based scoring with a weighted composition of filter-predicate
  matches (three Phase-1 scoring gaps — SV/CNV/STR rarity, inheritance
  forwarding, HPO phenotype — share a single root cause and will be
  addressed together via future subsystem specs). Not a deprecation of
  the current scoring module; the existing code stays in `main` until
  a concrete replacement spec lands.
- `test(shortlist):` `ShortlistTable.vue` gains a `data-testid` on its
  actions `v-menu` activator button (matching the existing
  `shortlist-star-${item.id}` convention on the star button) so unit
  tests can reliably open the menu without depending on Vuetify
  internal class selectors. Render-output only; no user-visible
  behavior change.

### Deferred

- **Two open Dependabot CVEs** targeting `vite` (GHSA-4w7w-66w2-5vf9)
  and `esbuild` (GHSA-67mh-4wv8-2f99) remain open. The vulnerable
  instances are nested inside `vitepress@1.6.4` (not top-level deps).
  `vitepress` 1.x constrains `vite` to `^5.x` and 2.x is alpha-only,
  so no clean patch path exists. Dev-server-only impact, zero user
  blast radius. Tracked in GitHub issue #154 for a future
  vitepress/vite upgrade spec.

## [0.56.0] — 2026-04-11

### Added — Unified case shortlist

- **Shortlist tab** — a ranked, cross-type variant view that appears in
  `CaseView` whenever a case contains at least one variant type
  (SNV/indel, SV, CNV, or STR). Surfaces top candidates in one sorted
  list so triage doesn't require jumping between per-type tabs. On
  single-type cases the same tab still appears because the algorithmic
  ranking is valuable regardless of type count.
- **Three built-in shortlist presets** seeded by migration v27:
  _Tier 1 candidates_ (strict, cross-type, ClinVar P/LP and starred
  rows pinned to top), _All rare damaging_ (broad, score-driven, no
  pins), and _Recessive candidates_ (SNV/indel only). Switch between
  them from the preset picker in the panel header.
- **Algorithmic scoring pipeline** — two-stage Stage 1 candidate
  generation (shared `buildBaseWhere` + extension JOINs + per-case
  annotation join, ordered by `v.id` for deterministic cap) + Stage 2
  pure-TypeScript per-type scorers (`scoreSnv` / `scoreSv` / `scoreCnv`
  / `scoreStr`) feeding a normalized weighted `combine()` and a
  `compareScoredRows` partition sort (starred → clinvar-pinned →
  rank_score DESC → configurable tie-breakers → id ASC).
- **Rank score tooltip** — hover any row's score badge to see the
  per-component breakdown (impact / pathogenicity / rarity / ClinVar /
  phenotype) with any active pin flag.
- **Auto-refresh on annotation** — starring, commenting, or
  ACMG-classifying any variant in the current case (from any tab,
  including Shortlist itself) triggers a same-case shortlist refetch
  within one IPC round-trip via the new `variants:annotationChanged`
  broadcast. No manual Refresh click needed.
- **Row-level actions** — row click opens `VariantDetailsPanel`
  unchanged (`ShortlistRow extends Variant` structurally); kebab menu
  offers "View details" and "View in \<type\> tab" to switch to the
  per-type tab with state preserved via `v-show`.
- **HGVS c. / p. notation on SNV/indel rows** — the variant cell now
  shows a stacked layout with the genomic coordinate on top and HGVS
  cDNA + protein notation underneath (in monospace, muted caption
  style). Annotator-prefixed and bare notation forms are both
  normalized without double-prefixing.
- **Scrollable paginated table** — the Shortlist table body scrolls
  independently of the footer, paginates at 50 rows/page by default
  with a `[25, 50, 100, 250, 500]` per-page selector.

### Added — Case View preferences

- **Default active tab** preference under **Gear menu → Application
  Preferences → Case View**. Choose between `Shortlist (ranked view)`
  (default) and `SNV/Indel (per-type table)`. The setting persists
  across sessions (localStorage) and takes effect the next time any
  case opens. The Shortlist tab itself is still always shown on
  non-empty cases — the preference only controls which tab is
  default-active, not whether it exists.

### Added — Scoring config module + reference docs

- **`scoring-config.ts`** (`src/main/services/scoring/scoring-config.ts`)
  — every numeric threshold used by the Shortlist scorer lives in a
  single typed config object: CADD saturation ceiling (40), rarity AF
  cutoff (0.01), SV precise/imprecise factors and length bucket
  threshold (1 kb), CNV copy-number branching, STR status and
  known-locus shortcut, VEP IMPACT and ClinVar lookup tables. No magic
  numbers anywhere in the per-type scorers. Tuning a constant is a
  one-file edit.
- **Scoring heuristic reference** at
  `.planning/docs/shortlist-scoring-heuristic.md` — developer-facing
  reference documenting every component, every formula, every null
  fallback, every built-in preset, and every Phase-1 limitation.
  Single source of truth for the scorer.
- **User-facing feature page** at `docs/features/shortlist.md` —
  clinician / researcher reference with annotated screenshots,
  preset descriptions, sort order explanation, row actions, and a
  walkthrough of the Case View gear-menu preference.

### Added — Database

- Migration **v27**: `filter_presets.kind` discriminator column
  (`'filter' | 'shortlist'`) with a CHECK constraint, a new
  `idx_filter_presets_kind` index, and `INSERT OR IGNORE` seeding for
  the three built-in shortlist presets. Existing rows backfill to
  `kind='filter'`. Safe to replay.

### Added — IPC

- New `variants:shortlist` handler — Zod-validated discriminated
  union params (`presetId | adHocConfig`), both branches `.strict()`
  so ambiguous payloads carrying both keys are rejected. Service-layer
  sort-key allowlist + post-resolution tie-breaker key normalization
  (dotted `sv.vaf` → flat `sv_vaf` aliases) so both preset and ad-hoc
  configs produce identical comparator behavior.
- New `variants:annotationChanged` broadcast from the
  `annotations:upsertPerCase` handler wrapper. Drives same-case
  shortlist refresh in the renderer via the new `useShortlistQuery`
  composable subscription.
- **Preset payload validation at load time** — `ShortlistService`
  validates `preset.filterJson.shortlist` through `ShortlistConfigSchema`
  before using it, so a hand-edited or older-schema preset surfaces a
  `DatabaseError` with structured Zod issues instead of producing `NaN`
  limits downstream.

### Added — UI polish

- **Distinct Shortlist tab treatment** — a 3px leading accent bar in
  `primary` (slate navy) + bolder font + right-border separator signals
  the tab as categorically different from the raw per-type tabs. Icon
  is `mdiStarFourPoints` in `primary` tonal harmony with other tab
  labels. Intentionally restrained (Material 3 accent-border pattern +
  clinical-dashboard conventions — signal hierarchy through restraint,
  not color blocks).
- **Proper `@mdi/js` icon imports** across `CaseView.vue`,
  `ShortlistPanel.vue`, and `ShortlistTable.vue`. Fixes the
  `<path> attribute d: Expected number, "mdi-..."` console warnings
  that were surfacing because VarLens uses Vuetify's `mdi-svg` icon set
  (which expects SVG path strings from `@mdi/js`, not `mdi-*` CSS
  class names).
- `data-testid="app-settings-menu"` added to the gear button in the
  top toolbar as a stable E2E testing seam.

### Fixed

- **Singleton preset store** — `useFilterPresetStore` is now a proper
  shared singleton (module-level refs) so `ShortlistPanel` and
  `FilterToolbar` read the same preset list. Previously each consumer
  got a fresh empty store, leaving the shortlist picker perpetually
  blank on cold starts. `useShortlistQuery` also calls
  `loadPresets()` defensively on setup for race-free first render.
- **Concurrent-fetch race guard** in `useShortlistQuery` —
  monotonically increasing request id + active-id tracking ensures a
  slower earlier fetch can't overwrite `result` with stale data when
  preset / case / annotation / refresh events all fire together.
- **`ShortlistQueryError extends DatabaseError`** so Stage-1 failures
  surface as `ErrorCode.DB_ERROR` with a meaningful message in the
  retry banner, not a generic `ErrorCode.UNKNOWN`.
- **`RankScoreTooltip` reactivity** — row list is now a `computed()`
  derived from `props.components` instead of a setup-time const, so
  the tooltip updates when a component instance is reused across
  table re-renders.
- **`ShortlistConfigSchema.perTypeOverrides`** uses `z.partialRecord`
  instead of `z.record`, so presets can specify overrides for a subset
  of variant types without Zod rejecting the missing keys. Fixes the
  Tier 1 preset which only sets sv/cnv/str overrides.

### Changed

- **`docs/` tree is now version-controlled.** Previously the entire
  VitePress docs site was local-only via two broad gitignore rules
  (`.vitepress/` and `docs/public/screenshots/*.png`). Tightened the
  rules to keep only `docs/.vitepress/{dist,cache}/` ignored, and
  added an explicit negation exception for `docs/public/screenshots/*.png`.
  The 29 existing feature-doc screenshots plus the 2 new
  Shortlist-specific ones now ship with the repo so anyone building
  the docs site sees the published images without needing a local
  Playwright + ONT-fixture run.
- **`VariantTable.vue`** — new optional `interactive?: boolean` prop
  (default `true`) gates all seven `onKeyStroke` handlers (ArrowUp /
  ArrowDown / Enter / Escape / s / c / a). `CaseView` sets
  `:interactive="selectedVariantType !== 'shortlist'"` so hidden
  per-type-table keystrokes don't fire while the Shortlist tab is
  active. Zero behavior change when `interactive=true`.
- **Shortlist shown on single-type cases** (previous CHANGELOG
  language said "more than one variant type" — corrected to "at least
  one"). The gating was loosened mid-development after user feedback:
  the Shortlist has two reasons to exist (cross-type comparison AND
  algorithmic ranking), and reason (2) applies even when a case has
  only SNVs.

### Developer / test infrastructure

- **Playwright monkey test** (`tests/e2e/shortlist-monkey.e2e.ts`) —
  env-gated end-to-end exercise of the full Shortlist flow on an
  obfuscated ONT multi-type case: imports 4 VCFs, navigates, asserts
  auto-selection, rotates every preset, hovers the rank-score
  tooltip, toggles star, opens-in-tab, opens `VariantDetailsPanel`,
  then random-walks for 10 steps. All 12 phases pass end-to-end;
  console error log empty.
- **Docs screenshot test** (`tests/e2e/shortlist-docs-screenshots.e2e.ts`)
  — captures the four reference screenshots for the user-facing doc
  and emits bounding-box JSON sidecars so post-run ImageMagick
  annotation is reproducible. Shortlist feature is the first in the
  repo with this pattern.
- Test suite grew from **2719 → 2905 tests** (+186 new across the
  Wave 0-7 rollout plus the review / audit / polish commits).
- Coverage thresholds raised per-file for every new Shortlist module
  (`src/main/services/scoring/**`, `ShortlistService.ts`,
  `shortlist-query.ts`, `src/main/ipc/handlers/shortlist.ts`,
  `useShortlistQuery.ts`, `src/renderer/src/components/shortlist/**`).

Spec: `.planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md`
Plan: `.planning/plans/2026-04-11-unified-shortlist-plan.md`
Scoring reference: `.planning/docs/shortlist-scoring-heuristic.md`
User-facing feature page: `docs/features/shortlist.md`

## [0.55.0] — 2026-04-11

### Added — Multi-variant type support

- **VCF import for SV, CNV, and STR** with auto-detection of caller type (Manta / Sniffles / DELLY / DRAGEN / CNVkit / ExpansionHunter / Straglr) from VCF header lines. Per-caller extension field parsers populate new `variant_sv` / `variant_cnv` / `variant_str` extension tables keyed by `variant_id`.
- **Import-time BED region filter** to restrict a VCF import to a set of regions before rows enter the database. The wizard auto-discovers sibling BED files next to the VCF.
- **Multi-file VCF import wizard** with auto-detection, per-file progress tracking, session-level housekeeping, and a "Continue in Background" affordance for long runs.
- **Variant type tabs** in the case view (SNV/Indel, SV, CNV, STR) with per-type column sets, type-specific detail sections, and auto-hiding of tabs with zero variants of that type.
- **Genome build and variant type selectors** in the cohort view with per-build case counts driving the available scopes.

### Added — Filter, sort, search across all variant types

- **Declarative extension registry** (`VARIANT_EXTENSION_REGISTRY`) shared between the main process and the renderer as a single source of truth for SV/CNV/STR filter and sort columns.
- **Shared `buildBaseWhere` where-clause builder** with scope gating (case / cohort-listing / cohort-burden) used by all three query paths — the case VariantFilterBuilder, cohort CohortSearch, and the burden AssociationDataBuilder.
- **Extension table JOINs and EXISTS predicates** so dotted filter keys like `sv.support`, `cnv.copy_number`, `str.repeat_count` work across all three paths.
- **FTS5 search across variant types** via two new virtual tables (`variant_sv_fts`, `variant_str_fts`, migration v26) and a new `search-clause-emitter` that UNIONs across all present FTS tables while keeping HGVS as a base-table LIKE at the outer combinator.
- **Sortable extension columns** in the variant table via Vuetify dotted-key support plus value getters that read the SELECT projection aliases.
- **`ExtensionColumnFilters` drawer** mounted in case view, cohort filter bar, and burden config panel with lazy per-column metadata loading and auto-hiding of empty type sections.
- **`FilterTypeNarrowingChip`** for feedback when a filter narrows results to a single variant type.
- **New IPC channels**: `variants:columnMeta` and `variants:typesPresent`, both routed through the database worker pool to keep aggregation queries off the main thread.
- **Burden analysis panel** (`AssociationConfigPanel`) migrated to the shared `FilterState` contract for Path 3 UI parity with the case and cohort views.

### Added — Cohort summary rebuild progress

- **Live phase progress** on the cohort summary rebuild indicator. The worker emits three phase events (`variant_summary` / `gene_burden` / `analyze`) between SQL statements; the renderer shows `phase label (i/N)` plus a live elapsed-time counter.
- **Soft ETA** derived from the previously observed rebuild duration, persisted in `localStorage`.
- **Compact shimmer notice** (~26 px, down from ~56 px) with a sweeping highlight band so the motion signal is visible even on empty tables. Honors `prefers-reduced-motion`.

### Changed

- **Optimistic case delete** — the sidebar now removes cases from the list immediately and fires the IPC asynchronously with rollback on failure, so the UI stays responsive during large deletes.
- **Cohort summary schema** — `cohort_variant_summary` and `gene_burden_summary` now group by `variant_type` and `genome_build`, and have a composite primary key reflecting the new grouping.

### Fixed

- **FTS5 trigger naming convention** — rebuild helpers now emit `_fts_`-infixed triggers (`variants_fts_ai` / `au` / `ad`) matching the production schema, preventing silent no-ops after migration.
- **Cohort burden scope** no longer references cohort-summary-only columns (`cohort_frequency`, `carrier_count`, `acmg_best`, `has_star`, `has_comment`) — those are now silently dropped for case / cohort-burden scopes so burden queries don't fail with column-not-found errors.
- **Extension column NULL semantics** — extension filters default to _excluding_ NULLs (opposite of base-column filters) so filtering by `cnv.copy_number` doesn't return cross-type noise from non-CNV rows.
- **Burden panel preset deselection** now correctly clears the derived filter state when you deselect the last impact / AF / CADD preset.
- **Case list pagination offset** is now decremented on optimistic delete (single + batch) so subsequent scroll loads don't skip or duplicate rows.
- **CaseView variant type default** — the SNV/Indel tab is no longer auto-selected for SV-only or CNV-only imports; the first non-empty tab is picked after the type counts resolve.
- **IPC clone of `columnFilters`** now deep-clones via `cloneForIpc` so nested Vue reactive proxies don't trip Electron structured-clone serialization.
- **CNV call classification** — variants with `./.` GT and SV callers emitting sequence ALTs are now correctly detected.

### Performance

- **CI pipeline** — lint (3 min → 1.4 s), test (66 s → 11.6 s), typecheck (8.4 s → 3 s) via cache, concurrency, project split, parallel runs, and path-filtered PR triggers.
- **Release workflow** — single-call artifact upload in publish-release; duplicated lint/typecheck/test dropped and gated on build.yml; native module caching across runs.
- **Cohort rebuild progress reporting** — worker-side `postMessage` events fire between SQL statements with sub-millisecond overhead vs. phases running in hundreds of ms to seconds (effectively zero impact on rebuild time).

### Tests

- **2704 vitest tests** pass (up from ~588 baseline), 17 skipped, zero regressions. Coverage: lines 33.9 → 35.52, functions 21.1 → 22.04, branches 28.0 → 31.42, statements 33.3 → 34.74.
- **7 new Playwright E2E smoke tests** in `tests/e2e/multi-variant-filter.e2e.ts` covering the filter / sort / search flows across SV / CNV / STR extension columns.
- **Synthetic test fixtures** for SV / CNV / STR / sibling BED / multi-file import scenarios.

[0.69.4]: https://github.com/berntpopp/VarLens/compare/v0.69.3...v0.69.4
[0.55.0]: https://github.com/berntpopp/VarLens/compare/v0.54.1...v0.55.0
