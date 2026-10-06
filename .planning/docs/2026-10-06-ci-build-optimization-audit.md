# CI, local verification, and build optimization audit

2026-10-06. Analysis and proposed changes, not an implemented optimization.
See the [measurement record](../artifacts/perf/build/audit-2026-10-06.md) and
[proposed design](../specs/2026-10-06-local-first-ci-build-optimization.md).

## Objective

Catch reproducible format, lint, type, test, build, Docker, packaging, and
deployment-contract failures locally before starting Actions. Reduce repeated
computation locally and remotely, without weakening native ABI checks, Electron
security, test coverage, or exact-commit release provenance. Update the agent
contract and enforce the local workflow mechanically.

VarLens is public. Standard hosted runners for public repositories are free;
runner time, queue latency, artifact storage, and developer feedback still
matter. Do not price these observations as private-repository billed minutes.
See [GitHub runner billing](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job).

## What matters most

| Finding                                                  | Evidence                                                                                                  | Proposed response                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Two PR workflows repeat web validation and Docker builds | One app PR: 269 of 1,434 summed job-seconds duplicated; 12 dependency PRs: 72.63 redundant runner-minutes | One canonical web lane per event                                        |
| Test/web installs compile an unused Electron binary      | Dependency PR logs show about 106 s per affected Node job before switching ABI                            | Select Node or Electron before root postinstall; separate native caches |
| Local full CI repeats setup and builds                   | Dry run: three installs, two desktop builds, two startup smokes                                           | Compose each stage once; retain standalone targets                      |
| Typed lint's warm cache can return a false pass          | Two-file probe: imported type changes, warm pass, fresh failure                                           | Fresh typed lint in authoritative gates                                 |
| Hosted Prettier restores the wrong path                  | Cache restored at `.prettiercache`; tool writes under `node_modules/.cache/prettier/`                     | Explicit persistent cache location and matching workflow path           |
| Change detection can silently miss build inputs          | Code allowlist omits `scripts/**`, `resources/**`, `build/**`, `.nvmrc`, `tests/setup.ts`                 | Shared conservative classifier: unknown input selects full gates        |
| Local web output leaks into desktop installers           | `out/**/*` includes 46.94 MB under `out/web` in inspected package                                         | Explicit desktop output allowlist; build-order regression check         |
| Renderer dependencies ship twice                         | Asar includes Mol* 67.68 MB and Vuetify 42.48 MB alongside renderer bundles                               | Move proven renderer-only dependencies to dev dependencies              |
| Asset compression repeats costly identical work          | Brotli q11: 10.30 s for 63 actual assets; q9: 0.665 s but 10.2% larger                                    | Cache q11 results by content and compressor identity                    |

No savings in this table have been measured after implementation. Asar inventory
bytes are not compressed installer bytes. Individual observations must not be
added into a promised end-to-end percentage.

## Comparison with sibling repositories

Inspected working copies were clean and left untouched:

- `../limin`: `ce4cca82d4150ebde773fdabdbe3d9feedebcee3`.
- `../hum-clinical-reporting`: `99721f0ec0a1f7ba49d68ef362b5b049bfa3c922`
  (the requested directory's spelling was corrected).
- VarLens baseline: `8a662b89f75983d513f6c4b6cf52ac57b271946c`.

The sibling repositories are private, have different workloads, and cannot be
ranked against VarLens using raw elapsed times. Their current executable files
take precedence over older optimization proposals.

| Area               | Limin, current implementation                                                                      | HUM, current implementation                                                            | Transfer to VarLens                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Local completion   | `make ci` executes local counterparts of its workflow jobs; pre-push requires a passing local gate | AGENTS requires `make ci`, `make docker-test`, and `make e2e` for application changes  | One complete applicable preflight before pushing                                           |
| Work in progress   | Draft PRs skip expensive CI; agents batch pushes                                                   | Draft PR quality gate skipped; `ready_for_review` triggers verification                | Document draft-first work; retain a small visible status                                   |
| Native setup       | Shared setup selects Node/Electron; actual binding probes                                          | Python/uv stack; no Electron ABI problem                                               | Adopt runtime selection and actual load checks, not package-manager migration              |
| Test scope         | Related tests with fixed baseline; unknown/config/rename/delete fall back to full                  | Exhaustive coverage local/manual; routine hosted quality and focused portability       | Keep full VarLens unit coverage locally; defer remote test reduction until measured        |
| Local pass records | Tree-based gate stamps under Git directory, enforced by hook                                       | Tree-based receipts; annotated release tag can select focused release tests            | Strengthen local stamp inputs; never substitute them for VarLens hosted release provenance |
| Docker             | Dedicated bounded builders and cache trust scopes                                                  | Reusable container gate; dependency-layer cache restored by PRs, saved by trusted main | Restore trusted layers, isolate writes, test actual runtime image                          |
| Resource limits    | Memory-aware bounded scheduler and heavy-work coordination                                         | Parallel independent Make gates; two CI workers                                        | Preserve serial TypeScript-heavy gates until aggregate-memory evidence justifies overlap   |
| Release policy     | Main merge CI skipped; regression dispatched for release                                           | Receipt permits focused container verification; no receipt runs full suite             | Preserve VarLens full main Build and exact-SHA artifact promotion                          |

Limin's relevant sources are `AGENTS.md`, `.githooks/pre-push`,
`scripts/local-gate.mjs`, `scripts/ci-local.mjs`, `scripts/run-checks.mjs`,
`scripts/test/select-tests.ts`, `.github/actions/setup/action.yml`, and
`.github/workflows/check.yml`. Its tree stamp is useful local convenience,
but the tree alone does not identify toolchain, fresh base, or advisory state.
Its generic workflow interpreter is more machinery than VarLens needs if both
environments call a shared, explicit gate manifest.

HUM's relevant sources are `AGENTS.md`, `Makefile`, `scripts/gate_receipt.py`,
`.github/workflows/ci.yml`, `container-gate.yml`, `full-ci.yml`, and `release.yml`.
Its September 29 proposal still describes some old behavior (including serial
CI). Current Make runs independent CI gates concurrently, and current release
does inspect the receipt. The receipt validates declared tree/gate fields; it
does not independently prove that tests executed. Do not copy that trust model
over VarLens's stronger hosted artifact provenance.

One substantive Limin Check run summed to 4,207 job-seconds, with the web UX lane
and unit shards dominating. A docs-only run skipped those lanes. A HUM PR sample
summed to 632 job-seconds; its main sample took 798, including documentation
work. These are workload observations, not proof that either design is faster
than VarLens. Compare mechanisms and coverage, then measure locally.

## Caches must preserve failures

The local lint probe agrees with the typescript-eslint maintainers: ESLint's
per-file cache cannot track imported type changes. Use fresh typed lint for
preflight and Actions. A successful whole-gate result can be reused for an
identical validated input set; a per-file lint result cannot provide that
guarantee. See the [typed lint cache explanation](https://typescript-eslint.io/troubleshooting/faqs/eslint/).

Keep TypeScript incremental state, but remove
`assumeChangesOnlyAffectDirectDependencies` from authoritative configurations.
TypeScript documents the shortcut as incomplete; this audit's two small probes
did not reproduce a missed diagnostic. Do not conflate the documented risk with
the demonstrated ESLint failure. See [TypeScript's option reference](https://www.typescriptlang.org/tsconfig/assumeChangesOnlyAffectDirectDependencies.html).

Set a persistent Prettier cache path outside `node_modules`; key its hosted
archive on the lockfile and configuration, including plugin versions. Prettier
already supports content-based reuse, but does not include plugin implementation
in its internal key. See the [Prettier CLI](https://prettier.io/docs/cli).

Actions cache entries are immutable and scope-restricted. Saving both native
ABIs under a key first populated by only Electron prevented Node jobs from
adding their binary. Separate runtime caches and retain binary-hash and actual
ABI verification. Initially retain the full lockfile fingerprint. Narrowing it
requires a tested native dependency/build-tool closure, not removal of safety
inputs. See [GitHub cache behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

## Build and distribution work

The official electron-vite guidance recommends renderer dependencies in
`devDependencies`, since the renderer bundles them while packaging includes
production modules. Audit main, preload, workers, web server, and dynamic asset
imports before moving each dependency. Test the packaged visualizations as
well as startup; a successful launch does not exercise lazy Mol* or chart code.
See [electron-vite dependency handling](https://electron-vite.org/guide/dependency-handling).

Use a content-addressed cache for Brotli q11 and gzip outputs, validated on
restore. Preserve release compression quality. For disposable packaging,
unpacked output or `compression: store` can accelerate feedback, but does not
prove every installer format. Full distribution validation remains part of
local applicable preflight and main/release-producing builds. See
[electron-builder configuration](https://www.electron.build/v26/docs/configuration/).

Docker already puts dependency install before source copy, but a broad context
still invalidates subsequent layers on unrelated changes. Explicit build inputs,
production dependency pruning, and trusted BuildKit caches should help both local
and hosted builds. Test actual SQLite/argon2 invocation after pruning, preserve
the migration SQL and workers, and smoke the runtime image with disposable
PostgreSQL. Publish the same image that passed scanning rather than invoking a
second build. See [Docker cache guidance](https://docs.docker.com/build/ci/github-actions/cache/).

For docs, preserve tracked screenshots on prose-only changes. Regenerate when
their actual app/fixture/capture inputs change; replace fixed sleeps only when
a deterministic readiness assertion exists. Do not trade missing screenshots
or a race for a shorter build.

## Three implementation approaches

1. **Recommended: local preflight plus retained hosted verification.** Complete
   local gates, pre-push enforcement, draft-first agents, shared commands,
   corrected caches, smaller artifacts, and removal of duplicated work. Keep
   full tests and all platform packaging on ready code PRs initially. This
   catches failures earlier without changing the release coverage contract.
2. **More aggressive hosted selection.** Keep exhaustive local/main gates;
   routine PRs use cross-platform unpacked packages or related tests with full
   fallback. Potentially saves more, but requires an explicit policy change,
   tested impact classification, and new evidence about missed installer risks.
3. **Local-only or workstation-hosted CI.** Removes more hosted computation but
   introduces machine availability, trust, and clean-environment gaps. Not
   recommended for this public repository and its signed multi-platform app.

The recommended design addresses the user's request to move work locally by
making the first complete failure discovery happen there and avoiding repeated
WIP Actions runs. Hosted verification still provides independent environments.

## Boundaries and measurement

Linux cannot validate macOS signing/notarization, Windows installer execution,
GitHub permissions, or future vulnerability feeds. A green local gate is
evidence for its recorded scope, not a guarantee that every hosted job passes.

The repository API returned no branch protection or rulesets in this audit.
A hook and AGENTS instructions protect participating local workflows, but cannot
enforce a server-side merge rule. Remote policy changes need their own concrete
review; they are not silently included in this code change.

Measure cold and warm gates separately with the existing build harness. Compare
wall time, process RSS, artifact bytes, and total hosted job time. Measure
aggregate process-tree or cgroup memory before enabling overlapping heavy gates.
Keep all known warnings and opt-in WGS benchmarks explicitly documented.
