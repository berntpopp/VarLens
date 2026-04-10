# Release workflow optimization plan

**Status:** Proposed
**Date:** 2026-04-10
**Branch target:** `feature/multi-variant-type-import` (or a follow-up PR after #147 merges)
**Scope:** `.github/workflows/release.yml` + `.github/workflows/build.yml`

## Executive summary

`release.yml` is currently the slowest and most duplicative workflow in the
repository. After the `build.yml` refactor (diamond job graph, single Ubuntu
`checks` job + matrix `package` job, lint/prettier/tsbuildinfo caches) the PR
flow runs in ~5 min wall-clock / ~13 min runner-minutes. `release.yml` still
runs the full pipeline **three times** (once per OS), duplicating `lint`,
`typecheck`, and `test` despite the fact that the tagged SHA has already passed
all of them on `main`.

Four concrete, deploy-ready fixes cut per-release wall-clock by **~10–15 min**
and runner-minutes by **~17 min** without changing signing semantics.

| Metric                         | Current   | After plan |
|--------------------------------|----------:|-----------:|
| Release wall-clock             | ~15–18 min | ~5–8 min  |
| Runner minutes per release     | ~35 min   | ~18 min    |
| Signing OTP round-trips        | 2         | 1          |
| Sleep-on-retry dead time       | up to 93s | 0s         |
| `latest.yml` regen robustness  | fragile regex | parsed YAML via js-yaml |
| Quota protection               | none      | pre-sign smoke test |

## Problem statement

`release.yml` has four unaddressed issues:

1. **Duplicate CI work.** Each of `release-linux`, `release-macos`, and
   `release-windows` runs `npm ci` → `rebuild:node` → `lint` → `typecheck` →
   `test` → `rebuild:electron` → `electron-vite build` → `electron-builder`.
   The first four of those already ran on the exact same SHA via `build.yml`
   before the tag was pushed, so ~2–4 minutes per OS is wasted on every
   release.
2. **Serialised signing with mandatory sleep.** The current Windows step
   invokes `java -jar code_sign_tool.jar sign` per file in a loop. Each call
   costs an OAuth2 + OTP round-trip, and the retry-on-failure path burns a
   hard-coded 31-second sleep to avoid TOTP replay. Two files → worst case
   62–93 s of dead time.
3. **No native module cache.** `rebuild:electron` takes ~30–60 s per OS per
   release even when the Electron version and `package-lock.json` hash have
   not changed.
4. **Fragile post-sign metadata rewrite.** `latest.yml` is patched via a
   PowerShell regex that will break on any `electron-updater` schema change,
   and the NSIS blockmap is never regenerated — differential auto-updates can
   silently corrupt.

## Non-goals

- **Must not change signing semantics.** Certificate, TSA URL, credential ID,
  TOTP storage, the `ESIGNER_ENABLED` gate, the ordering (sign → metadata
  regen), and the "sign only Setup + Portable" allow-list all stay exactly
  as they are today.
- **Must not drop any existing test coverage.** Tests still run on every
  PR via `build.yml#checks`; release-time re-runs are pure duplication.
- **Must not introduce `workflow_call` indirection** for only 3 call sites
  in a single-package repo — the debugging friction is not worth it yet.
- **Must not use `--publish always`** — a post-build sign step lives between
  `electron-builder` and upload, so artifacts have to stay on the runner
  until the sign step completes.
- **Must not cache across Electron major versions or arches** — cache keys
  must include `${{ matrix.electron-version }}` (or equivalent extracted from
  `package.json`) and `${{ runner.arch }}`.

## Architecture overview

The shape of the release workflow stays the same: per-OS build jobs fan
out, then `publish-release` fans them back in. The changes are internal to
each job:

```
 create-release ── verify build.yml passed on tag SHA
        │
        ├──> release-linux      ┐
        │     install → rebuild:electron (cached) → build → upload
        │
        ├──> release-macos      ├──> publish-release (single-call upload)
        │     install → rebuild:electron (cached) → build → upload
        │
        └──> release-windows    ┘
              install → rebuild:electron (cached) → build
              → pre-sign smoke test
              → batch_sign (Setup + Portable, ONE OTP)
              → regenerate blockmap + latest.yml (js-yaml)
              → upload
```

## Deliverables, in priority order

### 1. Drop duplicated `lint`/`typecheck`/`test` from all three release jobs

**Why this is #1.** Biggest wall-clock win (6–12 min), lowest risk. Industry
standard for Electron release pipelines — see [electron-builder release
flow](https://shahid.pro/blog/2023/02/20/release-electron-app-to-github-using-semantic-release-and-electron-builder/),
[samuelmeuli/action-electron-builder](https://github.com/samuelmeuli/action-electron-builder),
[electron/forge ci.yml](https://github.com/electron/forge/actions/workflows/ci.yml).

**Edits in `release.yml`:**

1. Delete the following steps from each of `release-linux`, `release-macos`,
   and `release-windows`:
   - `Rebuild native modules for Node.js`
   - `Run linter`
   - `Run type check`
   - `Run tests` (or `Run tests with coverage` on Linux)
2. Add a belt-and-suspenders gate in `create-release` that confirms
   `build.yml` passed on the tagged SHA. If someone bypasses branch
   protection and pushes a tag on a failing commit, the release aborts.

```yaml
- name: Verify build.yml passed on tagged SHA
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    SHA=$(git rev-parse ${{ github.ref_name }})
    STATUS=$(gh run list --workflow=build.yml --commit="$SHA" \
      --json conclusion --jq '.[0].conclusion')
    if [ "$STATUS" != "success" ]; then
      echo "::error::build.yml did not succeed on $SHA (got: $STATUS)"
      exit 1
    fi
```

**Acceptance criteria:**

- `release-linux`, `release-macos`, `release-windows` each go from
  ~8–12 min → ~4–6 min.
- A tag pushed on a commit whose `build.yml` run failed aborts at
  `create-release` before any OS builder spins up.

### 2. Use `batch_sign` instead of the per-file `sign` loop

**Why.** CodeSignTool v1.2.0+ supports `batch_sign`, which signs up to 100
files with a **single OTP round-trip** — eliminates the 31 s TOTP retry sleep
entirely and produces bit-identical output to the per-file `sign` path.

**Quota caveat.** SSL.com's docs say batch_sign "signs up to 100 files with
one OTP" but don't explicitly state whether monthly quota is metered per-file
or per-batch. The [eSigner pricing page](https://www.ssl.com/guide/esigner-pricing-for-code-signing/)
implies per-file ("$1 per each signature over the limit"). **Action item:
email Support@SSL.com to confirm** — if batch_sign counts as one quota slot,
the savings double (20 signings/month → 40 files/month).

**Edits in `release.yml#release-windows`:** replace the entire "Sign Windows
installer with CodeSignTool" step with:

```yaml
- name: Sign Windows artifacts with CodeSignTool batch_sign
  if: vars.ESIGNER_ENABLED == 'true'
  shell: pwsh
  run: |
    $version = "${{ needs.create-release.outputs.version }}"
    $signDir = Join-Path $env:GITHUB_WORKSPACE "release\to-sign"
    $signedDir = Join-Path $env:GITHUB_WORKSPACE "release\signed"
    New-Item -ItemType Directory -Force -Path $signDir, $signedDir | Out-Null

    Copy-Item "release\Varlens-Setup-$version.exe"    $signDir -ErrorAction Stop
    Copy-Item "release\Varlens-Portable-$version.exe" $signDir -ErrorAction Stop

    Push-Location $env:CST_DIR
    java -jar $env:CST_JAR batch_sign `
      -username="${{ secrets.ES_USERNAME }}".Trim() `
      -password="${{ secrets.ES_PASSWORD }}".Trim() `
      -credential_id="${{ secrets.ES_CREDENTIAL_ID }}".Trim() `
      -totp_secret="${{ secrets.ES_TOTP_SECRET }}".Trim() `
      -input_dir_path="$signDir" `
      -output_dir_path="$signedDir"
    if ($LASTEXITCODE -ne 0) { throw "batch_sign failed" }
    Pop-Location

    Move-Item -Force "$signedDir\*.exe" "release\"
```

**Signing semantics delta:** none. `batch_sign` uses the same certificate,
TSA, and EV flow as per-file `sign`. Output binaries are byte-identical to
what the current loop produces.

**Acceptance criteria:**

- Guaranteed wall-clock saving of 31 s (no more retry sleep).
- Both Setup.exe and Portable.exe sign with one OAuth2 + OTP round-trip.
- Signing quota behavior documented in a comment pending SSL.com support
  confirmation.

### 3. Cache `rebuild:electron` native module output

**Why.** `@electron/rebuild -f` takes ~30–60 s per OS per release. The
produced `.node` binary is deterministic given (OS, arch, Electron ABI,
native module source). Cache it keyed on those inputs; skip the rebuild
step on cache hits.

**Edits in BOTH `release.yml` (all three OS jobs) AND `build.yml#package`
(all three matrix legs):**

```yaml
- name: Extract Electron version
  id: electron-ver
  shell: bash
  run: echo "ver=$(node -p "require('./package.json').devDependencies.electron")" >> "$GITHUB_OUTPUT"

- name: Cache native module for Electron ABI
  id: native-cache
  uses: actions/cache@v4
  with:
    path: node_modules/better-sqlite3-multiple-ciphers/build/Release
    key: native-electron-${{ runner.os }}-${{ runner.arch }}-${{ steps.electron-ver.outputs.ver }}-${{ hashFiles('package-lock.json') }}

- name: Rebuild native modules for Electron
  if: steps.native-cache.outputs.cache-hit != 'true'
  run: npm run rebuild:electron
```

**Cache key rationale:**

- `runner.os` — ELF/PE/Mach-O differ.
- `runner.arch` — matters for macOS arm64 vs x64.
- Electron version — different Electron majors ship different Node ABIs.
- Lockfile hash — any native-module source upgrade busts the cache.
- No `restore-keys` fallback — a partial-hit cache would leave a wrong-ABI
  binary on disk and silently corrupt the build.

**Acceptance criteria:**

- First release after merge: cache miss, behavior identical to today.
- Second release (or second `build.yml#package` run on the same lockfile):
  cache hit, `rebuild:electron` step is skipped, ~30–60 s saved per OS.
- No build cross-contamination between Electron major-version upgrades.

### 4. Proper `latest.yml` regeneration + single-call upload

**Why.** The current PowerShell regex rewrite of `latest.yml` is fragile and
doesn't regenerate the NSIS blockmap. When electron-updater's differential
update path reads a stale blockmap against a newly-signed installer, the
delta resolution fails and users fall back to a full re-download.

**Edits in `release.yml#release-windows`:** replace the
"Regenerate latest.yml with signed artifact hashes" step with:

```yaml
- name: Regenerate blockmap + latest.yml with signed hashes
  if: vars.ESIGNER_ENABLED == 'true'
  shell: pwsh
  run: |
    $appBuilder = (Get-ChildItem node_modules\app-builder-bin\win\x64\app-builder.exe).FullName
    $version = "${{ needs.create-release.outputs.version }}"

    # Regenerate NSIS blockmap for differential update support
    & $appBuilder blockmap `
      --input="release\Varlens-Setup-$version.exe" `
      --output="release\Varlens-Setup-$version.exe.blockmap" `
      --compression=gzip | Out-File blockmap.json
    $bm = Get-Content blockmap.json | ConvertFrom-Json

    # Update latest.yml via proper YAML parse/dump (not regex)
    # js-yaml is a transitive dep of electron-builder
    node -e "
      const fs=require('fs'), yaml=require('js-yaml');
      const doc=yaml.load(fs.readFileSync('release/latest.yml','utf8'));
      const bm=JSON.parse(fs.readFileSync('blockmap.json','utf8'));
      doc.sha512=bm.sha512;
      doc.files[0].sha512=bm.sha512;
      doc.files[0].size=bm.size;
      fs.writeFileSync('release/latest.yml', yaml.dump(doc, {lineWidth:-1}));
    "
```

**Edits in `release.yml#publish-release`:** replace the shell `for` loop
with a single `gh release upload` call (parallelises internally):

```yaml
- name: Upload all assets to release (single call)
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: gh release upload "${{ github.ref_name }}" artifacts/* --clobber --repo ${{ github.repository }}
```

**Acceptance criteria:**

- `latest.yml` SHA512 + size fields match the signed installer's on-disk
  values (verify with a downstream `electron-updater` schema check).
- `.blockmap` file next to the installer has a post-sign SHA that matches
  the installer, so differential updates resolve cleanly.
- `publish-release` uploads all assets in a single `gh` invocation (no
  bash loop).

### 5. Pre-sign smoke test (quota protection)

**Why.** ~5 seconds of cheap validation before burning a $1+ signing quota
slot. Catches catastrophic build failures (missing exe, truncated exe,
corrupt NSIS archive) before they cost a signing operation.

**Edits in `release.yml#release-windows`:** add this step BEFORE the
`Sign Windows artifacts` step:

```yaml
- name: Smoke test unsigned build (pre-sign quota guard)
  if: vars.ESIGNER_ENABLED == 'true'
  shell: pwsh
  run: |
    $version = "${{ needs.create-release.outputs.version }}"
    $setup = "release\Varlens-Setup-$version.exe"
    if (-not (Test-Path $setup)) { throw "Setup exe missing at $setup" }
    if ((Get-Item $setup).Length -lt 50MB) { throw "Setup exe suspiciously small" }
    # Verify it's a well-formed NSIS archive before spending signing quota
    7z l $setup > $null
    if ($LASTEXITCODE -ne 0) { throw "Setup exe is not a valid archive" }
```

**Acceptance criteria:**

- Runs in under 10 seconds.
- Fails the job before `batch_sign` is invoked if the installer is
  missing, truncated, or unparseable.
- Skipped entirely when `ESIGNER_ENABLED != 'true'`.

## Things explicitly out of scope

| Anti-pattern                                              | Why skipped                                                        |
|-----------------------------------------------------------|--------------------------------------------------------------------|
| Reusable `workflow_call` via `_setup.yml`                 | Over-engineering for 3 consumers in a single-package repo         |
| `workflow_run` trigger from `build.yml` to `release.yml`  | Tag events don't propagate; PAT requirements; debugging pain       |
| `electron-builder --publish always` with `GH_TOKEN`       | Would upload UNSIGNED artifacts before the sign step               |
| `--config.compression=store`                              | Trades user-facing download size for build speed                   |
| `@electron-prebuilds-preview/*` native builds             | Unofficial fork, production risk                                   |
| Parallelising sign + hash regeneration                    | `batch_sign` already collapses into one JVM invocation             |

## 2026 gotchas to keep in mind while editing

- `actions/cache@v3` is deprecated → keep on `@v4`.
- `actions/upload-artifact@v3` was retired January 2025 → keep on `@v4`.
- `actions/checkout@v6`, `setup-node@v6`, `setup-java@v5` are current.
- `electron-builder v27` (future) will remove implicit publish detection —
  always pass `--publish` explicitly. Already true in the current workflow.

## Signing invariants (must remain true at every commit)

1. Certificate, TSA URL, credential ID — unchanged.
2. TOTP secret only via `secrets.ES_TOTP_SECRET`, never echoed to logs.
3. Sign step runs BEFORE any metadata regeneration step.
4. `ESIGNER_ENABLED` gate wraps every signing-related step (dry-run mode
   works without SSL.com secrets).
5. Only `Varlens-Setup-*.exe` and `Varlens-Portable-*.exe` are signed —
   never the `.zip`, never the `.blockmap`.
6. CodeSignTool reads `./conf/code_sign_tool.properties` relative to CWD,
   so the batch_sign step must `Push-Location $env:CST_DIR` before the
   `java -jar` call.

## Task breakdown (suggested commit layout)

Each task is an atomic commit so rollback is easy if anything regresses.

### Task 1 — perf(release): gate on build.yml + drop duplicated checks

**Files:** `.github/workflows/release.yml`
**Risk:** Low
**Wall-clock savings:** 6–12 min

- [ ] Add `Verify build.yml passed on tagged SHA` step in `create-release`.
- [ ] Delete `Rebuild native modules for Node.js` from all 3 release jobs.
- [ ] Delete `Run linter` from all 3 release jobs.
- [ ] Delete `Run type check` from all 3 release jobs.
- [ ] Delete `Run tests` / `Run tests with coverage` from all 3 release jobs.
- [ ] Manually smoke-test by pushing a `v0.0.0-test` tag to a throwaway
      branch and verifying:
  - Release jobs no longer include lint/typecheck/test steps in the UI.
  - Per-OS job duration drops as expected.
  - The build.yml-pass gate aborts when the tagged SHA has a failing CI run.

### Task 2 — refactor(release): batch_sign + proper blockmap regen

**Files:** `.github/workflows/release.yml`
**Risk:** Medium (touches signing — must test end-to-end with signing
enabled on at least one tag)
**Wall-clock savings:** 31–93 s guaranteed

- [ ] Replace the `Sign Windows installer with CodeSignTool` step with the
      `batch_sign` version.
- [ ] Add the `Smoke test unsigned build (pre-sign quota guard)` step
      BEFORE the sign step.
- [ ] Replace the `Regenerate latest.yml with signed artifact hashes` step
      with the `app-builder blockmap` + `js-yaml` version.
- [ ] Run a signed dry-run tag (`vX.Y.Z-rc1`) and verify:
  - `batch_sign` exits cleanly with one OTP.
  - Both `Varlens-Setup-*.exe` and `Varlens-Portable-*.exe` are signed
    (check certificate via `Get-AuthenticodeSignature` on a downloaded
    artifact).
  - `latest.yml` SHA512 matches the signed installer.
  - `.blockmap` file is present and has a non-empty size.
- [ ] Document the per-file vs per-batch quota question in a code comment
      and leave a TODO to update once SSL.com confirms.

### Task 3 — perf(ci): cache electron-rebuild native module

**Files:** `.github/workflows/release.yml`, `.github/workflows/build.yml`
**Risk:** Low (step is gated on cache-hit miss; worst case is a miss,
which is today's behavior)
**Wall-clock savings:** 90–180 s on cache hits

- [ ] Add `Extract Electron version` step to each of:
      `release-linux`, `release-macos`, `release-windows`, `build.yml#package`.
- [ ] Add `Cache native module for Electron ABI` step to all four above.
- [ ] Gate the `Rebuild native modules for Electron` step on
      `steps.native-cache.outputs.cache-hit != 'true'`.
- [ ] Validate by running `build.yml` twice in a row on the same lockfile
      and confirming the `rebuild:electron` step skips on the second run.
- [ ] Validate by bumping the Electron version and confirming the cache
      auto-invalidates.

### Task 4 — perf(release): single-call artifact upload

**Files:** `.github/workflows/release.yml#publish-release`
**Risk:** Low
**Wall-clock savings:** ~5–10 s (small, but it's free)

- [ ] Replace the `for file in artifacts/*; do gh release upload ...` loop
      with a single `gh release upload ${{ github.ref_name }} artifacts/* --clobber`.
- [ ] Verify all assets still land on the draft release (check the GitHub
      web UI after a test release).

## Rollout strategy

Tasks 1 and 3 are safe to bundle into a single PR — they touch the same
files and neither affects signing. Task 2 should be its own PR so any
signing regression can be bisected cleanly. Task 4 can piggyback on either.

**Suggested PR layout:**

- PR A (low-risk): Task 1 + Task 3 + Task 4. Can be merged on any tagged
  release cycle.
- PR B (medium-risk, must be tested with signing enabled): Task 2. Requires
  a dry-run `v*-rc*` tag against a branch with `ESIGNER_ENABLED=true` to
  validate end-to-end before merge.

## Verification checklist

Before declaring each task done:

- [ ] CI green on `build.yml`.
- [ ] Full test suite still passes (no test was removed).
- [ ] A dry-run tag (`v0.0.0-plan-test`) produces artifacts in the expected
      per-OS folders.
- [ ] `latest.yml`, `latest-mac.yml`, `latest-linux.yml` all present and
      have non-empty SHA512 fields.
- [ ] For Task 2 only: downloaded Setup.exe passes
      `Get-AuthenticodeSignature` on a Windows machine, certificate chain
      resolves to SSL.com, timestamp is recent.
- [ ] For Task 3 only: `rebuild:electron` step skips on the second run
      with an unchanged lockfile.

## References

- [electron-builder Publish docs](https://www.electron.build/publish.html)
- [electron-builder Build Hooks](https://www.electron.build/hooks.html)
- [SSL.com CodeSignTool Command Guide](https://www.ssl.com/guide/esigner-codesigntool-command-guide/) — `batch_sign` parameters, 100-file limit
- [SSL.com Automate eSigner EV Code Signing](https://www.ssl.com/how-to/automate-esigner-ev-code-signing/)
- [SSL.com eSigner Pricing](https://www.ssl.com/guide/esigner-pricing-for-code-signing/)
- [SSLcom/codesigner-samples](https://github.com/SSLcom/codesigner-samples)
- [actions/cache v4](https://github.com/actions/cache)
- [actions/setup-node](https://github.com/actions/setup-node)
- [electron-builder blockmap regeneration gist](https://gist.github.com/harshitsilly/a1bd5a405f93966aad20358ae6c4cec5)
- [electron-userland/electron-builder#5267](https://github.com/electron-userland/electron-builder/issues/5267) — manual blockmap regen discussion
- [samuelmeuli/action-electron-builder](https://github.com/samuelmeuli/action-electron-builder) — reference release workflow
- [gh release upload manual](https://cli.github.com/manual/gh_release_upload)
- [GitHub community discussion #25281](https://github.com/orgs/community/discussions/25281) — `workflow_run` + PAT gotchas
- Current `build.yml` after the diamond-graph refactor (commit `cc14d59`)
- Current `release.yml` (unchanged since before the `build.yml` refactor)
