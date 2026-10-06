# Claude Code Opus 5.5 design review

CLI: 2.1.291. Verified model: `claude-opus-5-5` in result modelUsage.
Session: `4c2d19fc-4511-460d-a6fb-2bb7e6ac0883`. Read-only review; no implementation changes by reviewer.

**Verdict: approve. Nothing blocks implementation.** I found no Critical defects. The design keeps hosted full tests, all-platform installers, exact-SHA artifact promotion, and current coverage and security thresholds, so the local records really are only a convenience layer. Eight items below are Important. Each is a gap or ambiguity that could produce a false local pass or a parity mismatch. They should be settled while implementing, without another approval round.

## Important findings

**I1. Files ignored by Git can change gate results, and the clean-tree check won't see them.**

- `git status` doesn't report ignored paths. Examples:
  - An old `out/` changes behaviour: `web-gate-integration` is "skipped until out/web/ exists" (`Makefile:206`), and the desktop package still takes `out/**/*` (`package.json:121`).
  - The spec also wants a developer's `.env.*.local` files never used, but the gate runner itself must enforce that, because ignored files are invisible to the clean check.
- **Fix:**
  - Each lane deletes its declared output directory before building, or builds into a directory scoped to the run.
  - The output hashes in a record must come from outputs produced by that same run.
  - The gate runner never sources `.env.*.local` files.

**I2. The environment needs an allowlist, not just fingerprinting.**

- The spec only records "relevant build-mode variables" (line 127). Inherited variables can still quietly change behaviour:
  - `VARLENS_WEB=1` is exported to every sub-make (`Makefile:40`) and changes `make test`.
  - Others with the same risk: `COVERAGE`, `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`, `VARLENS_E2E_NO_SANDBOX`, `VARLENS_PG_URL`, `CSC_*`, `GH_TOKEN`.
  - `npm run dist*` uses `--publish onTag` (`package.json:23-26`).
- **Fix:**
  - The runner starts from an explicit allowlisted environment and sets lane variables itself.
  - It forces `--publish never` and removes publishing and signing credentials.
  - A test proves that a contaminating variable can't change the selected gates or produce a pass.

**I3. The secret-scan result must be tied to the exact outgoing commits, not the tree.**

- Records "bind to committed tree and commit where versioning … uses it" (line 123).
- Two different histories can end at the same tree, for example a rebase with an intermediate commit that added and then removed a secret. A tree-bound Gitleaks pass would wrongly cover the new commits.
- **Fix:**
  - The Gitleaks result is bound to the outgoing range `<sha> --not --remotes=<remote>`.
  - A new branch arrives with an all-zero remote SHA in the hook input. That case must not fall back to "nothing" or to an unbounded scan by accident.
  - Add hook-input tests for: new branch, several refs in one push, annotated tag (peel with `^{commit}`), and deletion.

**I4. Hook installation conflicts with worktrees and older branches.**

- Default hooks live in the shared common Git directory, so one install affects every worktree, including branches that don't contain the gate runner (for example a hotfix from an older tag).
- **Fix:**
  - The wrapper finds the runner inside the worktree being pushed from.
  - If the runner is missing, it fails closed with a concrete message. It must not silently pass.
  - Document that any per-worktree `core.hooksPath` needs `extensions.worktreeConfig`. `hooks-install` must detect an existing `core.hooksPath` or existing hooks and refuse rather than overwrite (spec line 35).

**I5. The tag pre-push rule clashes with the current release flow.**

- Line 117: "version tags also require the existing exact-SHA hosted release prerequisites."
- `release.yml:71-131` deliberately polls up to 10 minutes because the tag is often pushed before Build on `main` finishes.
- A hook that demands Build success would reject that normal flow, and it would need authenticated `gh` access.
- **Fix:** the hook checks only the things it can verify locally:
  - the tag matches `package.json` version (the same check as `release.yml:46-55`);
  - the tagged commit is reachable from the freshly fetched remote `main`;
  - the local release-contract lane passed.

  The Build-success check stays in `release.yml`.

**I6. "Base freshness" is undefined, and so is the PR merge-commit gap.**

- If freshness means "remote `main` hasn't moved", every merge to `main` makes all local records stale. If it means "merge-base unchanged", that is consistent with lane selection.
- Separately, a `pull_request` run checks out `refs/pull/N/merge`, while local runs check the branch head.
- **Fix:**
  - Bind the record to the merge-base and recompute it at push time.
  - Report "result of merging into the current `main`" as a hosted-only obligation.
  - Hosted push selection treats an all-zero or non-ancestor `before` (force-push, new ref) as "full validation", matching the local rule (line 49).

**I7. Docs screenshots: reusing the tracked files can make the published site go backwards.**

- `docs.yml:140-147,187-191` regenerates screenshots and deploys them without committing, so the tracked PNGs (`.gitignore:155-157`) can be older than what is live.
- If a prose-only push then deploys the tracked PNGs (spec line 185), the site reverts to older pixels.
- Separately, a local capture writes into tracked files, which breaks the after-run clean check.
- **Fix:** choose one model:
  - **(a)** Fingerprint the capture inputs and restore the last captured set for that fingerprint from cache or artifact. Never deploy tracked PNGs whose fingerprint doesn't match.
  - **(b)** Require committed screenshots whenever capture inputs change, enforced by a check.

  In both cases the local capture writes to a temporary directory. Its comparison rule must tolerate differences in host font rendering (pixels may legitimately differ between the local host and CI).

**I8. Several gates exist on only one side, and the manifest needs to say so.**

- `agent-check` and the proposed local Trivy scan and runtime smoke don't run on hosted PRs: hosted PRs only `docker build` (`build.yml:522-524`). Hosted PRs run plain tests, while `main` runs coverage (`build.yml:205-211`).
- Trivy's version isn't pinned (`publish-web.yml:197` has no `version:` input). Hosted Gitleaks is downloaded without checksum verification (`build.yml:93`), yet the spec requires verified local downloads.
- **Fix:**
  - Each manifest gate is tagged `both`, `local-only` or `hosted-only`, and the contract test checks both sides.
  - Pin the Trivy binary and its gating flags (`severity: CRITICAL`, `ignore-unfixed`) in the manifest and the workflow.
  - Add checksum verification to the hosted Gitleaks download.
  - Record the Trivy vulnerability database's `UpdatedAt` in the record and define a maximum age. Otherwise "live advisories rechecked" (line 133) is ambiguous.

## Smaller clarifications (fold into implementation)

- **Docker image identity** (`publish-web.yml:184-237` builds twice): scan once and publish exactly that image.
  - Push it once to a staging tag, scan `repo@sha256:…`, then add the release tags to that digest with `buildx imagetools create`.
  - Or `docker push` the loaded tag and check that the pushed digest matches what was scanned.
  - A local Trivy pass must never count as evidence for publishing.
- **Installed-dependency check** (line 96): define what it checks and what it costs. If it hashes `node_modules`, exclude the native `.node` binary. That binary legitimately switches from Node to Electron inside one run, and including it would invalidate the record the run just made. A full content hash fits clean-install mode; routine runs need something cheaper and still meaningful.
- **Prettier cache key:** the Prettier config sits in `package.json:220-227`, but the hosted key hashes only `package-lock.json`, `eslint.config.mjs` and `.prettierignore` (`build.yml:171`). Add `package.json` (or the extracted config) to the key.
- **Make on hosted runners:** if workflows call Make targets, the Windows and macOS package jobs depend on Make being available, and the Makefile uses POSIX shell (`Makefile:6`). Identify each gate by its command in the manifest, and keep those package steps as `npm`/`npx` commands.
- **Docker resource limits:** "bounded parallelism" needs a named `docker-container` buildx builder with a `buildkitd.toml` `max-parallelism` setting and a memory limit, created idempotently. The default builder can't be limited. Docker also can't use `.cache/` (it's in `.dockerignore`), so the compression cache needs a BuildKit cache mount. `type=gha` doesn't export mount contents, so hosted Docker builds won't benefit; don't claim savings there.
- **Shared heavy-work lock** in the common Git directory: handle stale locks (owner process ID, host, start time).

## Optional improvements

- Store records in the common Git directory, keyed by tree, merge-base and environment fingerprint, so that pushing the same commit from another worktree can reuse them.
- An edit made and reverted during a run gets past the before/after clean check. Accept this as a documented residual risk; the records aren't attestations.
- Pin `--platform linux/amd64` for the local scan, to match the image that gets published.

## Scope and tests

- **Scope:** the spec's four areas should be four or more separate PRs, as `AGENTS.md` asks, in this order:
  1. cache correctness, native runtime selector, removing duplicate web runs;
  2. payload allowlist and compression cache;
  3. gate runner, classifier, records, hook, `AGENTS.md`;
  4. hosted orchestration, Docker identity, draft PRs.

  Moving renderer dependencies to dev dependencies should be its own PR, with packaged Mol* and chart checks. One branch covering everything won't be reviewable and makes the required Windows/macOS evidence hard to attribute.

- **Tests to add** beyond spec lines 220-224:
  - hook input cases (I3);
  - missing runner in an old worktree (I4);
  - environment contamination (I2);
  - stale ignored `out/` (I1);
  - screenshot fingerprint mismatch (I7);
  - manifest side tags in the contract test (I8);
  - a fixture where `before` is all zeros or force-pushed (I6).

## Implementation adjudication

- I1–I4 accepted: fresh lane outputs, allowlisted child environments, history-bound secret scans, and worktree-aware fail-closed hooks.
- I5 rejected where it permits tags before hosted success: AGENTS.md explicitly requires green Build on the tagged commit. The release workflow poll is a safety net, not authorization to bypass that rule. Keep the pre-push tag prerequisite.
- I6 accepted: fetch the current base and bind deterministic receipts to the merge-base; explicitly report hosted merge-result validation separately. Main/dispatch remain full.
- I7 accepted using fingerprinted screenshot artifacts/cache, with local capture outside tracked docs. Never fall back to old tracked screenshots for a new capture fingerprint.
- I8 accepted: explicit gate-side manifest, checked tool downloads, explicit Trivy 0.70.0 (the existing pinned action already defaults to that version), fresh database metadata and max age of 24 hours.
- Keep platform package commands as argv-based npm/npx commands; Make remains the documented local interface.
- Use separate focused commits in this integration worktree. No remote PRs are opened or merged in this task; the final handoff will identify reviewable commit boundaries.
