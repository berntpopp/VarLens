# Claude Opus 5.5 implementation review

Requested independent read-only review through Claude Code CLI using explicit model `claude-opus-5-5`; session `cabb35a3-e503-46c2-8471-5b326e66f5da`. The implementation was integrated with current main during review; applicability is adjudicated below.

## Disposition

- I-1 accepted: reject ignored source/config inputs that hosted checkout cannot see; explicit generated-fixture exceptions only.
- I-2 accepted: bound retained image ownership per worktree and remove superseded owned images.
- I-3 accepted: handle SIGHUP and kill remaining process-group descendants after their leader exits. A real subprocess heartbeat test reproduced the surviving descendant before the fix.
- The UI/interaction parity observation was stale during integration: current Build runs those gates in its web and package jobs, and local preflight mirrors them.
- Stale-lock reclamation and old local command logs are follow-up maintenance items; neither permits a gate to pass.
- Actual container readiness/network behavior is covered by the end-to-end build/smoke/scan run.

## Review

**Verdict: approve after three Important fixes.** I found no Critical issues. None of the three lets a hosted gate pass wrongly. Two let a *local* pass not match the hosted result (the clean-tree check and a stale reused receipt), and one leaks processes and resources. The files changed while I was reading (`run.mjs`, `stages.mjs`), so everything below is against their latest contents.

## What I checked and found correct

- **Environment isolation:**
  - Child processes start from a fixed allowlist of host variables (`scripts/ci/process.mjs:6-46`).
  - `git()` strips `GIT_*` variables.
  - PostgreSQL variables reach only the stages declared `environment: 'postgres'` (`stages.mjs:141-145`, `run.mjs:120`), so desktop tests no longer inherit `VARLENS_PG_URL`.
  - Packaging runs with `--publish never` and `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- **Fresh outputs:**
  - `desktop-build` now runs before `desktop-tests` and requires `out/main/db-worker.js` (`stages.mjs:11-21`, `run.mjs:130-132`). Without it, `DbPool.test.ts:22-24` would silently skip or run against a stale worker; hosted `checks` already rebuilds first.
  - `web-build` and `package` delete their output directories before building.
- **Receipt binding:**
  - The receipt key covers commit, tree, merge-base, policy files, toolchain, tool hashes, dependency fingerprint, stage list, `requiredOutputs`, the screenshot fingerprint and `electronNoSandbox` (`run.mjs:292-303`).
  - `matchesReceipt` requires the exact set of output paths and re-hashes them (`receipt.mjs:52-75`).
  - `--clean-install` disables reuse.
- **Live checks on reuse:** Gitleaks reruns on `<HEAD> --not --remotes=<remote>` after a fresh fetch. Trivy uses a database created for that run, rejects one older than 24 hours, and scans the image recorded in the receipt (`containers.mjs:240-300`). Nothing cached replaces either check.
- **Pre-push hook:**
  - Every non-deleted ref is peeled with `^{commit}` and must equal the clean `HEAD` (`hooks.mjs:28-39`).
  - Version tags are checked against `package.json`, and their reachability from a freshly fetched `<remote>/main` is checked.
  - The wrapper fails closed when the runner is missing (`.githooks/pre-push:5-8`).
  - Installation refuses an existing `core.hooksPath` or existing non-sample hooks.
  - Pushes to a URL or a remote without `main` fail closed.
- **Hosted lane selection and aggregation:**
  - `selectionForEvent` forces full validation for `main`, manual runs, a zero `before` and non-ancestor history. Any error falls back to full.
  - The aggregator requires every lane to be selected outside `pull_request`. A selected lane fails if it is skipped, cancelled or failed; draft status only relaxes PR runs.
  - `release.yml:88-92` ignores `pull_request` runs, so a green draft-PR run cannot satisfy the tag gate.
- **Publication identity:** `publish-web.yml:208-271` scans an image ID, pushes that ID, pulls it back and compares IDs and digests. The Trivy version and gating flags are pinned.
- **Docs:** deployment uses only a capture whose manifest fingerprint and PNG digests verify; tracked PNGs are never used as a fallback (`docs-screenshots.mjs:88-142`).
- **Caches:**
  - The compression cache is content-addressed and checked by decompressing (`compression-cache.mjs:32-49`).
  - The Prettier cache key includes `package.json` and uses the `content` strategy.
  - TypeScript incremental builds are sound now that `assumeChangesOnlyAffectDirectDependencies` is removed.
- **Moved dependencies:** none of the moved renderer packages is imported from `src/{main,web,shared,preload}`. The web server's externals are an explicit list (`vite.web.config.ts:94-103`), and the Dockerfile tests the bundle after pruning.
- **Native module:** the dependency fingerprint excludes only `better-sqlite3-multiple-ciphers/{build,.forge-meta}`, and the ABI is asserted after each rebuild.

## Important findings

### I-1. Ignored or globally-excluded files in input directories can change results, and the clean check can't see them

- **Where:**
  - `scripts/ci/receipt.mjs:76-82` (`snapshotSource` relies only on `git status --porcelain --untracked-files=all`)
  - `run.mjs:249-251`
  - `.dockerignore:11-15` (`!src/**`, `!scripts/web/**`)
  - `.gitignore:92-93,182` (ignored files under `src/`)
- **Scenario:** a developer commits `import './foo.local'`, where `src/.../foo.local.ts` is hidden by `.git/info/exclude`, the global `core.excludesFile`, or a repository ignore rule such as `src/__impeccable_provider_smoke_*.html`.
  - `git status` still reports clean.
  - Typecheck, Vite builds, tests, the Docker context and the screenshot fingerprint all read the file.
  - The receipt records a pass. Later edits to the hidden file don't change the receipt key, so it is also reused.
  - Hosted fails with "module not found". Ignored files under `src/renderer/public/` are also copied into local renderer and web bundles.
- **Impact:** a local pass, or a reused receipt, for a tree hosted CI can't build. Design item I1 was accepted, but only output directories and `.env` files were addressed.
- **Smallest fix:**
  1. In `snapshotSource`, also run `git ls-files -z --others --ignored --exclude-standard -- src tests scripts resources docs`.
  2. Add the root config files to that list: `electron.vite.config.ts`, `vite.*.ts`, `tsconfig*.json`, `playwright*.ts`.
  3. Have `assertCleanSnapshot` reject anything it returns, except a short named allowlist (e.g. `tests/e2e/test-data/*.gz` if the screenshot test leaves it behind).
  4. Add one test that uses a `.git/info/exclude` entry.

### I-2. Each Docker-lane run keeps a new image that nothing ever removes

- **Where:** `scripts/ci/containers.mjs:343-368` (`varlens-ci-web-<uuid>:local`, `retained = true`), called from `run.mjs:155-161`.
- **Scenario:** every preflight that selects the Docker lane builds a new uniquely tagged image and keeps it so later reuse can rescan it. Earlier receipts' images are never removed. The build passes no `--label`, so even `docker image prune --filter label=org.varlens.ci…` can't find them.
- **Impact:** disk use grows without limit (several hundred MB per run), which runs against the bounded-resource goal.
- **Smallest fix:**
  1. Add `--label org.varlens.ci=receipt-image` to the `buildx build` arguments.
  2. Tag with a fixed per-worktree name, e.g. `varlens-ci-web:<sha256(stateDir).slice(0,12)>`.
  3. After `writeReceipt`, run `docker image rm` on the previous receipt's `container.imageId` when it differs (ignore "in use" errors).

  Reuse stays fail-closed, because `scanContainer(prior.container.imageId)` throws when the image is missing.

### I-3. Interrupting preflight in some ways leaves detached processes and containers running

- **Where:**
  - `process.mjs:65-71`: `detached: true` calls `setsid`, so gate processes are outside the terminal session.
  - `process.mjs:95-104`: `cleanup()` cancels the SIGKILL escalation when the group leader exits.
  - `run.mjs:258-259`: only SIGINT and SIGTERM are handled.
  - `container-lifecycle.mjs:15-16`: same.
- **Scenario 1:** the terminal or SSH session closes during `git push` or `make preflight`. Node gets SIGHUP, has no handler, and exits without running `finally`. The detached Vitest, electron-builder and xvfb/Electron processes keep running in their own sessions. So do the disposable PostgreSQL container, internal network and buildx builder container, which only the in-process scope would have removed.
- **Scenario 2:** on SIGINT, if `npx` exits promptly but a group member ignores SIGTERM, `close` fires, the 3-second SIGKILL timer is cleared, and that member survives.
- **Impact:** leftover CPU and memory load, plus Docker resources (labelled, but nothing sweeps them).
- **Smallest fix:**
  1. Register `SIGHUP` alongside SIGINT/SIGTERM in `run.mjs` and `containerScope`.
  2. In `runCommand`, when `signal.aborted`, send `process.kill(-child.pid, 'SIGKILL')` on `close` (ignore `ESRCH`) instead of clearing the escalation timer.
  3. Optional: when a stale heavy lock is recovered, remove `docker ps -aq --filter label=org.varlens.ci=disposable` and the matching networks.

## Smaller items (not blocking)

- **Hosted counterparts for new stages:** `ui-gates` and `interactions` (`stages.mjs:72-84`) are marked `side: 'both'`. I found no hosted step for either in `build.yml` or `make web-ci`, and the Makefile I read has no `ui-gates` target, though `AGENTS.md:141` lists `make ui-gates` (the Makefile may still be mid-edit). This makes local stricter, not a false pass. Either add the hosted steps or tag them `local-only` so the side-tag contract test means what it says.
- **Command logs:** `stateDir/logs/<timestamp>/commands.log` (`run.mjs:272-274`) collects all output from every run and is never pruned.
- **Stale-lock race:** two processes recovering the same stale lock can both unlink and then both acquire it (`lock.mjs:47-52`). That is rare and only affects the concurrency bound. Re-reading the lock after `unlinkSync` and before the `wx` write narrows it.

## Not verified

I didn't run anything. One behaviour needs your in-progress integration runs to confirm: the web smoke publishes `127.0.0.1::8080` while the container is on an `--internal` network (`containers.mjs:160-219`). Depending on the Docker Engine version, that port may be unreachable from the host. If so, the smoke fails closed rather than passing wrongly, but it would block the Docker lane both locally and in the hosted `docker` job.

## Scoped follow-up verdict

The same explicit Opus5.5 Claude Code session reviewed the fix diff and returned **approve**, with all three Important findings resolved and no new Critical or Important blockers. It reviewed the new production dependency stage and internal-network smoke approach; actual runtime validation remains a separate required gate.

**Verdict: approve.** I read only `review-fixes.diff`. All three Important findings are resolved, and I found no new Critical or Important blockers in it. Nothing below comes from running anything.

## The three findings

**I-1 (ignored inputs): resolved.**
- `snapshotSource` now lists ignored files under the input directories with `git ls-files --others --ignored --exclude-standard` (diff 294-339). That covers repository ignore rules, `.git/info/exclude` and the global excludes file, plus relevant root files through `:(top,glob)*`.
- `assertCleanSnapshot` rejects anything listed except the 16 named generated fixtures.
- Those fixtures' SHA-256 hashes go into the snapshot, so a change during the run is caught. They also go into the receipt key (`generatedFixtures`, diff 426), so a changed fixture can't reuse an old receipt.
- The new test covers all three cases: an `info/exclude` source file, a changed fixture, and an injected file inside the fixture directory.
- Anything else ignored under those directories (stale downloads, leftover `.gz` temp files, the old `pdbe-molstar` public files) now blocks preflight. That is the correct direction.

**I-2 (retained images): resolved.**
- Each worktree keeps one stable tag, `varlens-ci-<hash>:validated`, carrying receipt and worktree labels.
- The tag is only moved if its current owner labels match. Older images are removed only after their labels are checked again, so images belonging to other worktrees are never touched.
- The per-run unique tag is now removed with a plain `image rm` rather than `--force`, so the validated image survives through the stable tag.
- If something fails after retention, the stable tag is restored or the new image discarded.
- One consequence, not a blocker: going back to an older receipt fails closed, because its image has been replaced. The hint to rerun with `--clean-install` is heavier than needed; a normal rerun would do.

**I-3 (processes and resources): resolved.**
- SIGHUP is now handled in both `run.mjs` and `containerScope`, and the handlers are removed afterwards.
- On abort, `close` kills the whole process group (`terminate(true)`) before cancelling the escalation timer. The real regression test (descendant ignoring SIGTERM, heartbeat stops) shows this works.
- The temporary web-state directory is removed in `finally`.
- Remaining risk, not a blocker: after a real hangup, gate output is still written to the terminal that has gone away. In Node that could raise an unhandled stream `error` partway through cleanup. Check this once with an actual SSH disconnect. If it happens, the fix is a no-op `process.stdout`/`process.stderr` `'error'` listener installed in the abort path.

## Other changes in this diff (no blockers)

- **Smoke without host ports:**
  - The web readiness check now runs inside the container with `docker exec … node -e fetch(...)`. Non-200 responses, non-JSON bodies and `db.open !== true` all exit non-zero.
  - PostgreSQL on the private network is no longer published to the host. The standalone PostgreSQL still uses a loopback port chosen by Docker.
  - This fixes the internal-network problem from the earlier review.
- **Production-dependency stage in the Dockerfile:**
  - The runtime image now copies `node_modules` from a stage that runs `npm ci --omit=dev --ignore-scripts`. The probe runs against exactly that tree.
  - The SQLite binary is copied from the builder. It comes from the same base image and the same lockfile version, and only SQLite and argon2 were ever rebuilt, so the set of native modules is unchanged.
  - Argon2's platform binary arrives through optional dependencies, and the probe's `hash()` call exercises it.
  - BuildKit still builds this stage, probe included, when the target is `runtime`, so the hosted `docker` job is covered too.
- **Error redaction:** PostgreSQL URLs and `POSTGRES_PASSWORD` values are masked before Docker stderr is added to error messages.
- **Order of cache publication:** the layer cache is now published before smoke and scan. That's acceptable because the cache is only content-addressed build reuse, never a pass/fail result.

**Still unconfirmed:** your Docker rerun in progress is the only evidence for the new readiness check and the production-dependency stage on a real image.
