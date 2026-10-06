# Local-first CI and Build Optimization Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation, with the user-requested independent Claude Code Opus 5.5 review before implementation and again for the final change. The user approved the design and explicitly requested end-to-end execution after review; no additional approval checkpoint is required.

**Goal:** Enforce complete applicable local verification before push while removing repeated CI work and reducing build time and payloads.

**Architecture:** Share explicit Make targets and repository-owned gate selection between local execution and Actions. Run Node work before Electron work, preserve all hosted release gates, and reuse only content-verified caches and successful passes bound to their complete inputs.

**Tech Stack:** Node 24.15.0, npm 11, Make, Vitest, electron-vite, Playwright, Docker BuildKit, GitHub Actions.

**Spec:** `.planning/specs/2026-10-06-local-first-ci-build-optimization.md`

## Global Constraints

- Keep full hosted tests and all-platform installers for ready code PRs; full coverage and release-producing artifacts on main.
- Preserve actual native ABI assertions, Electron fuses, signing and exact-SHA artifact promotion.
- No lower coverage, lint, typecheck, or scan thresholds; no force-native rebuilds.
- Serialize heavyweight local gates and Node/Electron ABI consumers; retain bounded Vitest/compiler workers.
- Never deploy, publish, push, merge, or change remote branch rules as part of local validation.
- All source edits stay in this dedicated worktree; sibling repositories remain read-only.
- Source modules should remain under 600 lines, normally 150–400.

## Review Focus

- Renamed, deleted, unknown, and unstaged inputs must not silently skip a required lane (Task 3).
- Different pushed refs, dirty trees, changed environment/toolchain, and missing/corrupt outputs invalidate receipts (Task 3).
- A cancelled child must stop later work, clean up owned resources, and never write a passing receipt (Task 3).
- A corrupt cache entry cannot corrupt shipped assets or suppress a diagnostic (Tasks 1–2).
- Hosted event selection must handle draft-to-ready transitions and missing/cancelled selected jobs (Task 4).

## Task 1: Sound quality/native caching and desktop dependency boundaries

**Files:** `package.json`, `package-lock.json`, `scripts/native/rebuild-native.mjs`, `tsconfig.{node,renderer,web}.json`, `tests/scripts/native-runtime.test.ts`, `tests/scripts/build-pipeline-guardrails.test.ts`.

**Interfaces:** `resolveNativeTarget(argument, environment)` accepts explicit `node`/`electron`, or the `install` mode plus `VARLENS_NATIVE_RUNTIME`; install defaults to Electron and invalid values fail. CLI explicit rebuild commands override install environment. Existing cache validation is unchanged.

- [ ] Add and run failing runtime-selection tests, including invalid input and explicit target precedence; replace Electron-only postinstall assertion with behavioral selection coverage.
- [ ] Add the `install` CLI mode, retain ABI assertions, and set postinstall to it.
- [ ] Make authoritative `lint:check` uncached; retain cached edit-time lint separately. Give Prettier an explicit `.cache/prettier/` location and content strategy, invalidating on lock/plugin/config changes through a small wrapper if needed.
- [ ] Remove `assumeChangesOnlyAffectDirectDependencies`, retaining normal incremental state; verify warm transitive diagnostics using a temporary compiler fixture.
- [ ] Restrict desktop `build.files` to main/preload/renderer output and explicit resources. Audit emitted runtime imports; move only renderer-exclusive libraries to dev dependencies and regenerate lockfile without version upgrades.
- [ ] Run targeted scripts tests, fresh lint/typecheck, and build output inventory checks. Record exact dependency decisions and any warnings.

## Task 2: Reusable asset compression

**Files:** `scripts/web/precompress-assets.mjs`, new `scripts/web/compression-cache.mjs`, `tests/scripts/precompress-assets.test.ts`, web Vite build config only as necessary.

**Interfaces:** Preserve `precompressDirectory(dir)` and its existing summary fields; allow optional `{ cacheDir }` for isolated tests and expose hit/miss counts. Default cache lives under `.cache/precompress/`.

- [ ] Write failing tests for warm reuse, changed raw content, corrupt payload, compressor identity invalidation, atomic cache writes, bounded cleanup, and stale siblings after an asset becomes small/incompressible.
- [ ] Cache q11 Brotli/gzip-9 results by raw SHA-256, parameters, and Node/zlib/Brotli versions; verify restored bytes round-trip to the source with bounded decompression.
- [ ] Treat corruption as a miss; remove obsolete `.br`/`.gz` siblings instead of leaving prior bytes. Keep the existing compression threshold and release quality.
- [ ] Verify decompressed output equals source and warm/cold output is byte-identical. Measure with the existing harness and the same built asset corpus.

## Task 3: Shared local gate runner, receipts, hooks, and tool setup

**Files:** new focused modules under `scripts/ci/` (`changes.mjs`, `stages.mjs`, `run.mjs`, `process.mjs`, `receipt.mjs`, `tools.mjs`, `containers.mjs`, `hooks.mjs`), `.githooks/pre-push`, `Makefile`, `AGENTS.md`, `tests/scripts/ci-*.test.ts`, `tests/web-gate/web-ci-target.test.ts`.

**Interfaces:** `classifyChanges(paths)` returns booleans `{code, web, docker, docs, screenshots, full}` plus reasons. Unknown paths select full. CLI `node scripts/ci/changes.mjs` supports base/head arguments and GitHub output. `node scripts/ci/run.mjs` supports `--full`, `--clean-install`, `--dry-run`, and `--base`; hook invokes `node scripts/ci/hooks.mjs pre-push` with original ref-update stdin. Child commands use argv arrays and sanitized Git environment.

- [ ] First test selection on doc-only, source/shared/main imports, scripts, native/dependency/config, unknown paths, rename/delete, and untracked files. Establish exported selector and use NUL-delimited Git paths.
- [ ] Test stage composition with an injected command executor: setup once; format/workflow/secrets; quality and coverage; web/database and Docker; then Electron/build/package/smoke; docs/screenshots; no duplicated stage and immediate failure propagation.
- [ ] Implement pinned/checksummed local tool acquisition for actionlint, ShellCheck, Gitleaks, Trivy. Match current release scan severity and flags; cache downloads, never scan verdicts. Validate all SHA-pinned action references and invoke the same workflow checks on hosted runners.
- [ ] Implement unique disposable PostgreSQL/network/container resources with cleanup on signals and failures. Runtime Docker smoke must invoke health/native behavior after prune. Do not use developer `.env` or existing databases. Bound builder resources and do not change the user's default builder.
- [ ] Implement receipts with committed input fingerprints, base SHA, validated install, environment/tool identities, selected gates, and output digests; require clean tree before/after recording. Mutable advisories and remote base are refreshed on push. Fingerprint native cache inputs independently of current ABI so deliberate sequential switches do not corrupt reuse.
- [ ] Add tests for wrong-ref, multiple refs, deletion, tag, missing/corrupt receipt, changed base/toolchain/env/output, dirty tree, changed files during run, missing required tooling, cancellation, and sanitized nested Git fixtures.
- [ ] Install hooks only in this worktree when requested through Make; preserve unrelated hooks and global config. Validate actual pushed commits, with explicit failures for unsupported/non-HEAD refs; tags additionally require exact-SHA hosted prerequisites.
- [ ] Refactor Make composition to avoid repeated install/build/startup. Separate web static from integration execution and require bundles/PostgreSQL in authoritative integration. Preserve usable standalone commands and desktop-default `make ci`.
- [ ] Update AGENTS and Make help with the mandatory preflight/push workflow, exact validation reporting, draft-first batching, tool setup, and limitations. Keep detailed policy in `.planning/`.

## Task 4: Hosted parity, Docker reuse, and release image identity

**Files:** `.github/workflows/{build,web-ci,publish-web,docs}.yml`, `.github/dependabot.yml`, `Dockerfile`, `.dockerignore`, workflow contract tests under `tests/scripts/`, and gate manifest from Task 3.

**Interfaces:** Workflows call shared Make targets and `scripts/ci/changes.mjs`; `VARLENS_NATIVE_RUNTIME=node` precedes Node installs. Native cache keys separate runtime and ABI/toolchain inputs. Stable CI aggregate checks expected lanes against actual job outcomes.

- [ ] Test event fixtures for draft, ready, docs-only, unknown input, dependency, main and dispatch. Test failure/cancellation/missing output never yields a successful selected gate.
- [ ] Remove duplicate PR web workflow trigger; retain explicit web-branch/manual validation. Add draft job conditions and `ready_for_review` event without skipping secret checks.
- [ ] Use Node-targeted install in test/web lanes, runtime-separated caches, correct Prettier paths, fresh typed lint, and the shared gate commands. Keep full platform matrix and immutable SHA action pins.
- [ ] Enable bounded BuildKit layer caches with trusted-main writes and PR-scoped writes/restores that cannot overwrite trusted entries. Narrow Docker build inputs while preserving workers, migration SQL, and runtime native probes.
- [ ] Build/load and scan the web image once; tag/push that same image ID and report verified registry digest. Do not invoke a second build for publication.
- [ ] Select screenshot capture from actual app/fixture/config inputs; prose-only docs use tracked screenshots. Keep the docs build/deployment contract and deterministic capture behavior.
- [ ] Add separate Dependabot security groups while preserving native/Electron major exceptions; document version batching without skip-CI merges.
- [ ] Run actionlint/ShellCheck, gate contract tests, and Docker build/runtime checks.

## Task 5: End-to-end verification, measurements, and independent final review

**Files:** updated audit/performance report, `.planning/code-review/` reports, targeted regression tests for review findings.

- [ ] Run `make ci`, `make agent-check`, and complete applicable/full local preflight on clean committed inputs; include coverage, disposable PostgreSQL, web/static/integration, Docker build/scan/smoke, desktop installers/startup/packaged smoke, docs build/capture, and release metadata.
- [ ] Verify a second unchanged run reuses only validated deterministic work; invalidate on changed source, output, lock/config, base, and required environment.
- [ ] Compare cold/warm build harness results to saved baselines, plus asar/installer/container bytes. No performance percentage without comparable measurements; do not infer aggregate memory from one process RSS.
- [ ] Send final diff, spec/plan, evidence and limitations to Claude Code Opus 5.5. Reproduce and fix actionable findings, run covering tests, then request a scoped re-review.
- [ ] Keep work committed on the dedicated PR branch. Report validation and remaining OS/hosted obligations honestly; do not push/merge/publish without instruction.
