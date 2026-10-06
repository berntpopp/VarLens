# Local-first CI and build optimization

Date: 2026-10-06. Status: approved by the user; Opus 5.5 review incorporated; implementation in progress.

Evidence: [comparison and audit](../docs/2026-10-06-ci-build-optimization-audit.md),
[baseline measurements](../artifacts/perf/build/audit-2026-10-06.md).

## Intent and success criteria

The user wants lint, format, typecheck, tests, builds, Docker, CI/CD contracts,
and agent instructions to catch failures locally before GitHub Actions runs.
They also want builds optimized and useful practices transferred from Limin
and HUM clinical reporting.

The design makes every applicable, locally executable release/CI gate available
through one preflight. Git hooks and the agent contract require it before push.
Unchanged verified inputs can reuse successful work. Changed inputs, a failed
gate, or unavailable required tooling cannot produce a passing record.

Preserve full hosted tests and all-platform installers for ready code PRs in
this first rollout. Draft work avoids heavy hosted jobs. Main builds continue
to produce complete exact-SHA artifacts, and release promotes those artifacts.
Reducing routine hosted test or installer coverage is a separate later decision.

## Command contract

| Command                            | Intended role                                                        |
| ---------------------------------- | -------------------------------------------------------------------- |
| `make quick`                       | Optional edit-time feedback, clearly insufficient for push           |
| `make ci`                          | Existing complete desktop quality/test gate, with sound caching      |
| `make preflight`                   | All applicable local lanes for changes against freshly resolved base |
| `make preflight-full`              | Every locally supported lane, independent of change selection        |
| `make ci-full` / `make ci-actions` | Compatibility aliases for the full local preflight                   |
| `make workflows`                   | Workflow syntax, shell, pinning, and gate-contract validation        |
| `make hooks-install`               | Install repository hooks without silently replacing unrelated hooks  |

Standalone desktop/web/docs commands remain usable. The canonical Make targets
and a small explicit gate manifest are shared with Actions. Do not create a
general interpreter for GitHub workflow YAML. A contract check verifies the
workflows invoke the expected gates and declare their required environments.

Validation tools need explicit version pins, verified downloads, and a local
cache outside product dependencies. Setup must provide actionlint, ShellCheck,
Gitleaks, and Trivy consistently with the hosted policy. Tool absence is a setup
failure, not permission to omit its selected check. Actionlint covers inline
workflow shell; separately selected external scripts need their own shell check.

`make preflight` reports selected lanes and reasons before running them. It
fetches/resolves the configured comparison base and records its commit. Failure
to resolve the base selects full validation; an unavailable required remote
freshness check cannot stamp the run as ready for push.

## Gate coverage

| Lane                 | Local checks                                                                                                                                                             | Selection                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Hygiene and workflow | Format, workflow syntax and shell checks, action SHA pins, agent guardrails, secret scan of outgoing history                                                             | Every push; authored source guardrail where applicable                       |
| Quality and tests    | Fresh typed lint, serial complete typecheck plus contract assertions, full desktop tests with existing coverage thresholds                                               | Application/test/config changes; unknown paths                               |
| Web and database     | Build web once; fixture/static gate and integration once; required PostgreSQL cases against a disposable database                                                        | Web, shared, imported main code, database, fixtures, build/dependency inputs |
| Docker               | Compose/config validation, runtime build, post-prune native probes, runtime smoke against disposable PostgreSQL, current vulnerability scan with existing release policy | Web/runtime/container/dependency inputs                                      |
| Desktop              | Assert Electron ABI, one build, startup smoke, native-platform installers, artifact/metadata validation, packaged smoke where supported                                  | Desktop/renderer/shared/worker/native/build inputs                           |
| Docs                 | VitePress build; screenshot capture only when capture inputs change                                                                                                      | Docs inputs or app/fixture inputs used by screenshots                        |
| Release contracts    | Version/tag and artifact verifier tests, updater metadata checks, promotion policy assertions                                                                            | Release scripts, packaging, versions, workflow changes                       |

Checks requiring credentials or another operating system are reported as hosted
obligations, never falsely marked passed locally. Local runs do not deploy,
sign with production credentials, publish images, or create releases. WGS
performance suites remain opt-in and outside routine preflight.

Static web tests and integration tests must form explicit non-overlapping sets.
A required integration lane fails if its bundle, database, or fixture is absent;
it must not pass by skipping. Existing deliberate test skips remain documented.

## Change selection and failure behavior

Use one repository-owned classifier locally and in Actions. Start conservatively:
only known prose/planning-only changes skip application lanes. New or unknown
paths, configuration, workflow, toolchain, native dependencies, and build scripts
select all relevant lanes. Shared/imported main code includes web validation.
Recognize old and new rename paths, deletions, and untracked files for local
preflight. NUL-delimited Git output avoids filename parsing bugs.

Resolve PR changes against the merge base; main and dispatch use full validation
when needed to produce release artifacts. A stable aggregate hosted check
distinguishes intentional skip from failed, cancelled, missing, or unfinished
selected jobs. No new workflow-level path exclusions that strand required checks.

Abort dependent stages on failure, preserve logs and stage timings, and clean up
only resources created by that run. Exit nonzero on cancellation. Never write
a success stamp after a failure, signal, missing selected stage, or source change.

## Local execution and resource handling

Perform dependency setup once when the lock/toolchain fingerprint changes. Offer
an explicit clean-install verification mode for dependency/build-system changes.
Do not run `npm ci` independently in every composed lane. A setup receipt must
verify the actual installed dependency tree; lockfile equality alone is not
proof of an intact installation.

Run all Node-native lanes before switching the workspace binary to Electron.
Node and Electron consumers cannot run simultaneously against one dependency
tree. Acquire a per-worktree execution lock; where multiple agents share this
host, coordinate heavy runs through the repository common Git directory.
Use separate worktree dependency directories, not mutable native hardlinks.

Keep heavyweight quality gates serialized and existing worker limits. Any later
parallelism change requires measured aggregate memory within the host/container
budget. Docker builders receive bounded parallelism. PostgreSQL uses a unique
throwaway project/container, synthetic fixtures, ephemeral ports, and cleanup
on success or failure. Never reuse or reset a developer's existing database.

## Pre-push enforcement and successful-pass reuse

Install a small pre-push wrapper calling the gate runner. Parse every ref update
from Git's hook input and verify the actual commit being pushed. A clean HEAD
cannot authorize a different pushed commit. Branch deletions require no build;
version tags also require the existing exact-SHA hosted release prerequisites.
Non-HEAD pushes without a matching record fail with a concrete checkout/preflight
instruction. Do not silently validate the wrong revision.

Store atomic pass records under the worktree Git directory. Records bind to:

- committed tree and commit where versioning or release metadata uses it;
- resolved base commit and selected gate set;
- gate runner, policy, scripts, relevant source/config, and lockfile fingerprints;
- Node/npm/native ABI, operating system/architecture, container base/image IDs,
  and relevant build-mode variables;
- completion results and hashes of required local build outputs.

Require a clean tracked/untracked worktree before recording push readiness, and
recheck it after execution. Ignore only declared generated outputs. A changed
dependency tree, corrupted output, or invalid record reruns the affected work.
Live security advisories and base freshness are rechecked before a push; a prior
successful scan is not perpetual approval.

The hook reuses a valid pass or runs preflight automatically. Failed or missing
required Docker/tooling checks block it with an actionable message. Strip Git's
inherited repository-routing environment variables from child test processes
that create their own fixture repositories. Install hooks explicitly during
project setup; do not modify unrelated user hook configuration or global Git.

Local records are conveniences for trusted contributors. They are not a security
attestation and do not replace hosted checks or release provenance. The agent
contract forbids using `--no-verify` or `[skip ci]` to evade completion gates.

## Correct and faster caches

1. Add a validated native runtime selector to root postinstall. Default desktop
   install remains Electron; tests/web request Node before install. Maintain
   actual binary ABI verification, manifest hashes, retry behavior, and bounded
   native compiler jobs. Separate hosted Node and Electron cache entries.
2. Point Prettier at `.cache/prettier/` with content strategy; align hosted paths
   and configuration/plugin invalidation. Keep format checks read-only.
3. Use fresh typed lint in authoritative gates. An optional edit-time cached
   lint command must say it is not push validation. Profile narrower TypeScript
   project ownership to recover cold lint cost without disabling rules.
4. Keep normal incremental compiler state, remove the direct-dependency-only
   shortcut, and test warm invalidation against transitive edits.
5. Cache web compression by raw bytes, algorithm parameters, and compressor
   identity. Validate cache payloads, use atomic writes, and bound retention.
   Preserve q11 Brotli and current gzip distribution output. Corruption is a
   cache miss followed by recomputation, not a shipped corrupt asset.

Do not loosen the native cache's lockfile fingerprint in the first rollout.
A narrower dependency-closure fingerprint can be evaluated separately with
mutation tests proving each compiler/native input invalidates it.

## Smaller and reproducible build outputs

Desktop packages allow only `out/main`, `out/preload`, and `out/renderer`, plus
their explicitly declared resources. Building web first must not change the
desktop payload. Preserve migrations, worker bundles, fuses, and native modules.

Audit each renderer-only production dependency before moving it to dev
dependencies. Check emitted runtime imports as well as source imports. Verify
packaged startup and lazy viewers/charts, and validate the pruned web container.
Record before/after asar inventory, installer sizes, Docker sizes, and timings.

Restrict Docker source inputs and reuse dependency/build layers with separate
trusted-main and PR cache scopes. PRs cannot overwrite trusted cache entries.
Publish the exact single-platform image that passed the vulnerability gate;
verify image identity/digest rather than treating a second cached build as
automatically identical. Preserve current scan severity and exception policy.

Docs-only prose updates reuse verified screenshot artifacts for the exact capture-input
fingerprint. Cache misses regenerate; never fall back to older tracked pixels.
Local captures write outside tracked documentation. Screenshot inputs include app
source, fixtures, capture scripts, tool versions, and build configuration.

## Actions and agent workflow

Remove the duplicate PR web trigger while retaining any intentionally distinct
web-branch/manual invocation through the canonical web job. Skip expensive jobs
for draft PRs and handle `ready_for_review` explicitly. Keep lightweight status
and secret checks visible. Ready code PRs still run full tests and platform
installers; main continues full coverage and artifact publication.

Add explicit Dependabot security-update grouping, distinct from existing
minor/patch version-update groups, with native/Electron exceptions preserved.
Batch release version changes into the reviewed release commit where practical
to avoid two immediate full main builds. Do not cancel release-producing builds
or introduce skip-CI merges.

Update `AGENTS.md` and the Make help with the command ladder, mandatory local
preflight before push/ready, setup and hook installation, failure handling,
exact validation reporting, and ABI/resource constraints. Keep detailed policy
in `.planning/`; agent wrappers should import the canonical contract.

Remote repository protection settings are outside these filesystem changes.
Prepare a concrete recommended required-check policy if needed, but do not
silently change repository permissions or merge rules.

## Verification and rollout boundaries

Keep changes reviewable in four areas: cache/selection correctness and duplicate
work; build payload/compression; local gate/hook and agent contract; hosted
orchestration/cache wiring. Introduce the shared gate contract before relying on
it to skip work. Existing coverage and security thresholds remain unchanged.

Behavior tests must cover false-pass risks: cross-file typed lint; native runtime
selection and corrupt cache; formatter config/plugin changes; unknown/deleted/
renamed paths; stale or wrong-ref receipts; failed stages; source changes during
execution; cancellation; missing Docker/PostgreSQL; contaminated package inputs;
and compressor corruption. Keep tests at these externally visible boundaries.

Existing tests in `tests/scripts/build-pipeline-guardrails.test.ts` and
`tests/web-gate/web-ci-target.test.ts` hard-code parts of today's Make composition
and Electron-only postinstall. Replace those particular assertions with behavior
tests for runtime selection, single execution of composed stages, and failure
propagation. Preserve their security, cache-integrity, and memory invariants;
do not merely remove assertions that reject the new wiring.

Run `make ci` and the complete applicable local preflight, including clean setup
and packaging for changes here. Validate workflows statically and use recorded
event fixtures for draft, ready, docs-only, unknown input, dependency, main, and
dispatch cases. Windows/macOS hosted evidence is still required before merge.

Use the existing build-performance harness for baseline comparisons. Report
cold/warm wall time and RSS, process-tree memory if concurrency changes, artifact
sizes, and total Actions work. A performance claim requires paired evidence;
passing an audit or writing this design does not constitute implementation.
