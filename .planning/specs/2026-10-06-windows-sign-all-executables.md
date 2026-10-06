# Windows releases: sign every executable

- **Date:** 2026-10-06
- **Issue:** #365 (gap 2; gap 1 was closed by `ci/release-unsigned-visibility`, which this branch stacks on)
- **Decision (owner):** sign all Windows executables, accepting the higher eSigner quota use.
- **Cost:** **5 signatures per release** (was 2). Quota is 20/month.

## 1. Current state, verified on v0.75.0

`release.yml` does not rebuild. It downloads the installers `build.yml` produced for the
tagged SHA, verifies provenance and checksums, signs `Varlens-Setup-<v>.exe` and
`Varlens-Portable-<v>.exe` with SSL.com eSigner, patches `latest.yml`, and publishes.

The three Windows assets of the published **v0.75.0** release were downloaded with
`gh release download`, extracted with 7-Zip (the installers twice: NSIS container, then the
embedded `app-64.7z`), and every PE file checked with `osslsigncode verify`:

| Published asset | File | Signed today |
| --- | --- | --- |
| `Varlens-Setup-0.75.0.exe` | the installer itself | yes (`CN=Bernt Popp`) |
| | `Varlens.exe` (what gets installed) | **no** |
| | `resources/elevate.exe` | **no** |
| | `Uninstall Varlens.exe` | **no** |
| `Varlens-Portable-0.75.0.exe` | the portable executable itself | yes (`CN=Bernt Popp`) |
| | `Varlens.exe` | **no** |
| | `resources/elevate.exe` | **no** |
| `Varlens-Setup-0.75.0.zip` | `Varlens.exe` | **no** |

So the issue's suspicion holds beyond the zip: a user who runs the signed installer ends up
with an unsigned application, an unsigned elevation helper and an unsigned uninstaller. Two
of seven executables in the installers are signed; none in the zip.

Why: electron-builder signs inside-out during packaging (`winPackager.signApp` → app exe;
`nsisUtil.CopyElevateHelper` → `elevate.exe`; `NsisTarget.computeScriptAndSignUninstaller` →
uninstaller; `NsisTarget.buildInstaller` → installer). `build.yml` packages with no
certificate, so all of those are skipped, and signing the finished installer afterwards
cannot reach inside it.

Other findings from the same inspection:

- The zip did **not** contain `resources/elevate.exe` while both installers did. The zip
  target runs concurrently with the NSIS target's helper copy, so the zip's content is a race.
- `latest.yml` references only the Setup exe. Nothing consumes the Windows zip: the updater
  uses the installer, `docs/guide/installation.md` lists installer and portable only.
- `resources/app-update.yml` carries no `publisherName`, so electron-updater does not check
  the publisher of an update. Unchanged by this work; see §8.
- The comment in `release.yml` said signing used `batch_sign`; the code actually called
  `sign` once per file with a 31 s retry.
- DLLs and native modules (`.node`) are out of scope — see §7.

## 2. Design question: sign at package time vs. "release does not rebuild"

Signing every executable has an ordering constraint no design can avoid: each layer embeds
the previous one. The app exe must be signed before it is archived into the installer, the
uninstaller before the installer is linked, the installer last. **The installers that ship
therefore cannot be the installer bytes `build.yml` produced** — their payload changes. The
question is only what is allowed to change, and where.

| | (a) sign in `build.yml` | (b) `--prepackaged` re-wrap in release | (c) extract-sign-repack in release |
| --- | --- | --- | --- |
| Mechanism | hook active in the Windows package job | release signs the app exe, then `electron-builder --prepackaged` rebuilds only the installers around `build.yml`'s app dir | unpack artifacts, sign, pack again |
| Signatures | 5 per signed build | **5 per release** | 3 if zip-only; installers cannot be repacked |
| Fits the trigger model | **no** — `build.yml` runs on push-to-main, PRs and dispatch, never on tags; signing there costs 5 per merge, or needs a tag-triggered rebuild, which is exactly the rebuild `release.yml` was changed to avoid | yes | yes |
| Credentials | eSigner secrets enter the workflow that runs on every PR | stay in the `release` environment | stay in the `release` environment |
| Covers the installed app | yes | yes | **no** — an NSIS installer can be extracted but not re-linked without `makensis` and electron-builder's script, i.e. (b) |
| What differs from `build.yml`'s bytes | n/a (nothing to compare with) | installer containers; app payload identical except signatures — **checked** | zip container only |

**Chosen: (b).** (a) contradicts how releases are triggered and widens secret exposure;
(c) cannot reach the installed executables, which is the gap being closed. (b) keeps
`build.yml` the only place the app is compiled and packed, spends the minimum number of
signatures that covers every executable, and — unlike (a) — leaves a `build.yml` artifact to
verify the result against.

### What `--prepackaged` does (app-builder-lib 26.15.3, read from `node_modules`)

- `platformPackager.doPack` returns immediately when `prepackaged != null`. Skipped with it:
  file copying, asar creation, `beforePack`/`afterPack` (so `scripts/configure-fuses.mjs` does
  **not** run again), `doAddElectronFuses`, and `doSignAfterPack` → `signApp`.
- Consequence 1: **fuses and the asar-integrity resource are preserved, not re-applied.**
  They were written into `Varlens.exe` by `build.yml` before any signature existed, and
  nothing rewrites the exe afterwards. Order "fuses first, signature last" holds.
- Consequence 2: **`--prepackaged` does not sign the app exe.** The release must sign it
  itself before invoking electron-builder. It does (§3, step 2).
- The targets still run in full, and still call the hook: elevate helper, uninstaller,
  installer, portable.
- `latest.yml` is computed after `signIf(installerPath)` (`NsisTarget.buildInstaller`: sign,
  then `createBlockmap`, then `emitArtifactBuildCompleted`), so electron-builder itself writes
  hashes of the final bytes. The PowerShell regex patch is gone.

Verified locally (§6): fuse wire of `Varlens.exe` before and after the re-wrap is identical,
`0,1,0,0,1,1,0,1,1` — the baseline in `scripts/configure-fuses.mjs`.

### How the provenance guarantee is kept

1. The app directory comes from `Varlens-Setup-<v>.zip`, which is in `build.yml`'s
   `SHA256SUMS` and is verified by `verify-promoted-artifacts.mjs` before anything else. No
   `build.yml` change is needed: the zip target already is a checksummed image of the fused
   app dir.
2. After the re-wrap, each installer is opened again and its payload compared with that
   directory, file by file (`windows-signing/payload.mjs`): sha256 for every file, and for
   executables a digest that masks exactly what Authenticode may change — the PE checksum, the
   certificate-table directory entry, the certificate table, 8-byte padding. Any other
   difference fails the release. Only `resources/elevate.exe` may be added.
3. The same comparison runs with signing disabled, where it must hold byte for byte.

What is knowingly given up: the installer **containers** (NSIS stub, compression, the
uninstaller, which exists only inside the installer) are produced in the release job from the
pinned electron-builder and its NSIS toolset, not promoted. There is no reference to compare
the uninstaller against.

## 3. Design

All logic lives in `scripts/release/`; the workflow steps are thin.

1. **Extract** the promoted zip to a work dir. Drop any `resources/elevate.exe` (race, §1).
   Snapshot the tree. Check the plan: the only executable may be `Varlens.exe`; anything else
   fails **before a signature is spent**.
2. **Sign `Varlens.exe`**, then immediately confirm its masked digest is unchanged. If a
   signer ever altered more than the signature this costs one signature, not five.
3. **`electron-builder --win nsis portable --x64 --prepackaged <dir> --publish never`.** The
   hook (`win.signtoolOptions.sign` → `scripts/release/windows-sign-hook.mjs`) is called for
   `elevate.exe`, the uninstaller, the installer, the portable exe.
4. **Stage** exactly `Varlens-Setup-<v>.exe`, `Varlens-Portable-<v>.exe`, `latest.yml`.
5. **Verify**: `latest.yml` against the staged bytes; every executable in every artifact
   signed; payload identity; ledger equals the plan (five roles, once each).

Steps 1–5 are `rewrap-windows.mjs`. `release.yml` then repeats the verification
independently on what it is about to upload (`verify-latest-yml.mjs`,
`verify-windows-signatures.mjs`) and finally with Windows' own verifier
(`assert-authenticode.ps1`: `Get-AuthenticodeSignature … -ne 'NotSigned'` on all seven
executables, and no file signed by the rehearsal certificate).

### Constraints

| Constraint | How it is met |
| --- | --- |
| `ESIGNER_ENABLED` kill switch stays | Every signing step is gated on it. Off → `build.yml`'s installers are published untouched, with the existing loud warning. |
| Enabled run fails if any shipped exe is unsigned | Three layers: the script, the independent re-inspection (`--require-signed`), `Get-AuthenticodeSignature`. An installer that cannot be opened, or lacks an executable it must contain, also fails. |
| `latest.yml` regenerated after the last byte change | Written by electron-builder after signing; verified unconditionally on the staged files. |
| sha256 only | `signingHashAlgorithms: ["sha256"]`. The hook additionally refuses a `sha1` or nested request, so losing the setting fails loudly instead of doubling the cost. |
| TOTP replay | See below. |
| Secrets never echoed | Passed as step `env`, never interpolated into script text; given to exactly one step; tool output is redacted before printing. |
| Actions pinned, `--publish never` | Both workflows pass `make workflows`; `--publish never` is fixed in `electronBuilderArgs` and unit-tested. |

### TOTP replay

`batch_sign` exists because one OTP cannot be reused, but it needs all files at once, and
here they never exist at once — the installer does not exist until the files inside it are
signed. Collect-then-batch would need at least three batches and a hook that returns before
signing, which electron-builder's sequence (sign → embed → sign) does not allow.

So: **one `sign` call per file, spaced by TOTP time step.** CodeSignTool derives the OTP
from the secret at an unknown moment during its run, so the rule is conservative: a call may
only start in a 30-second step strictly later than the step in which the previous call
*finished*, plus 2 s against clock skew. The last step is persisted in the ledger file, so
it holds across the two processes involved (the script, then electron-builder). Cost: at
most ~32 s of waiting per file, about two minutes per release.

### Quota protection

- **Allowlist.** `signing-plan.mjs` names the five roles. The hook refuses any other path.
- **Ledger.** One signature per role; a repeat request for the same file is a no-op (this is
  what makes electron-builder's own retry loop harmless); at most 7 attempts in total.
- **Proof by bytes.** Success is the signature being present afterwards, not the exit code.
  One retry, in a fresh TOTP step, and only if the file is still unsigned.
- **Free rehearsal first.** Before the paid step, the release job runs the entire pipeline
  with a throwaway self-signed certificate on the same runner and the same bytes. Extraction,
  the hook sequence, NSIS, `latest.yml` and all verifications must pass before the first paid
  signature.

### The hook is inert by default

`win.signtoolOptions.sign` is set in `package.json`, so electron-builder always calls it.
It returns immediately unless `VARLENS_WINDOWS_SIGNING` is `selfsigned` or `esigner`; any
other non-empty value throws. Ordinary packaging (`make dist-win`, `build.yml`) is unchanged
— confirmed by a local run (§6).

### The Windows zip

Kept as a `build.yml` target: it is the transport for the app directory. **No longer
published.** Nothing needs it, and publishing it is what shipped an unsigned `Varlens.exe`.
Users who want no installation have the portable executable. `expectedArtifacts('win')`
(what `build.yml` must hand over) still lists it; `publishedWindowsArtifacts()` does not.

## 4. Signatures per release

| # | File | Signed by | Ends up in |
| --- | --- | --- | --- |
| 1 | `Varlens.exe` | `rewrap-windows.mjs` | installed app; inside installer and portable |
| 2 | `resources/elevate.exe` | hook (NSIS target) | installed app; inside installer and portable |
| 3 | uninstaller | hook (NSIS target) | `Uninstall Varlens.exe`, inside the installer |
| 4 | `Varlens-Setup-<v>.exe` | hook (NSIS target) | release asset, `latest.yml` |
| 5 | `Varlens-Portable-<v>.exe` | hook (portable target) | release asset |

**5 signatures. Before: 2.** The NSIS and portable targets share one app archive, so signing
the app once covers both. Seven executables carry a signature in the end.

## 5. Quota

| | Signatures |
| --- | --- |
| Clean release | 5 |
| Clean releases per month | 4 (20 ÷ 5) |
| Owner's target of ~3 per month | 15, leaving 5 — exactly one full repeat |
| Worst case for one run | 7 attempts (ceiling) |
| Rehearsal | 0 |

**A failed run is not resumable.** Re-running `sign-windows` starts from the promoted bytes
and signs all five again. Signed intermediates are deliberately not carried between attempts:
trusting bytes from a failed run is a larger risk than 5 signatures.

What can still fail only in the paid step, after the rehearsal passed: eSigner
authentication, TOTP rejection, network, an exhausted quota. All of these hit the first call
(`Varlens.exe`), so the expected loss is 0–2 attempts. Whether SSL.com charges a failed
attempt is not known; the ledger assumes it does.

The job summary and a `::notice` state the count for every run, including failed ones.

## 6. Verification performed

| Check | Result |
| --- | --- |
| v0.75.0 assets, `osslsigncode verify` per PE file | §1 |
| `verify-windows-signatures.mjs` on v0.75.0 | same 2-of-7 result; payload of both installers identical to the zip (plus `elevate.exe`) |
| Full `rewrap-windows.mjs` on Linux: real v0.75.0 zip, electron-builder 26.15.3, NSIS under wine, self-signed certificate via `osslsigncode` | passed in 37 s; hook called exactly 4 times + 1 direct = 5 signatures |
| Output of that run, `osslsigncode verify` | all 7 executables signed |
| Masked digest of a really signed `Varlens.exe` vs. the unsigned original | equal |
| Fuse wire before/after | identical |
| `latest.yml` of that run vs. the signed installer | matches |
| Ordinary `electron-builder --win nsis portable zip` with the mode unset | succeeds, everything unsigned |
| Unit tests (`tests/scripts`: 267, of which 78 new) | pass |
| `make workflows`, `make format-check`, `make lint-check`, `make agent-check` | pass |

## 7. Not covered

- **DLLs and native modules.** Per installed app: six unsigned Electron DLLs (`ffmpeg`,
  `libEGL`, `libGLESv2`, `dxcompiler`, `vk_swiftshader`, `vulkan-1`; `d3dcompiler_47` and
  `dxil` are Microsoft-signed) and seven `.node` files. Signing them is `signExts` plus
  thirteen plan entries: **18 signatures per release, one release per month.** Not done.
- **NSIS plugin DLLs** inside the installer stub (`System.dll`, `nsis7z.dll`, …) come from the
  NSIS toolset and are covered only by the installer's own signature.
- **Resumable signing** (§5).

## 8. What cannot be verified locally

1. **The eSigner call.** CodeSignTool arguments are the ones the previous workflow used, but
   the new code path (Node `spawn`, credentials via environment) has never talked to SSL.com.
2. **That one TOTP step of spacing is enough.** 30 s is the standard TOTP step and the
   previous workflow's retry waited 31 s, but SSL.com's replay window was not measured.
3. **That CodeSignTool changes nothing but the signature.** Authenticode requires it, and it
   holds for `osslsigncode`. If it does not hold for CodeSignTool, the release fails after
   the first signature with "signing changed Varlens.exe beyond its signature".
4. **Everything Windows-specific.** `7z` on the runner's PATH and its NSIS support;
   `New-SelfSignedCertificate` / `Set-AuthenticodeSignature` in the rehearsal;
   `Get-AuthenticodeSignature` on paths containing `$PLUGINSDIR` / `$R0`;
   `npm ci --ignore-scripts` followed by `electron-builder --prepackaged` with native NSIS;
   backslash paths through bash steps. Local runs were Linux + wine.
5. **The workflows themselves.** Statically checked (actionlint, ShellCheck, pin policy,
   contract tests). Never executed.
6. **Runtime behaviour of the signed app on Windows** — start-up with asar integrity
   enforced, SmartScreen, auto-update from an older version. Only static evidence (§6).

Items 4 and 5 are what the rehearsal workflow is for; 1–3 can only be answered by the first
signed release, where the release job's own rehearsal step shields them from 4 and 5.

## 9. First signed release — checklist

1. Merge. Dispatch **Build** on `main` (or use the push run) and wait for green.
2. Dispatch **Windows signing rehearsal** with that run id:
   `gh workflow run windows-signing-rehearsal.yml -f build_run_id=<id>`.
   Expect seven rows, all `signed`. `Get-AuthenticodeSignature` will report `UnknownError`
   (untrusted root) for the self-signed certificate — expected; only `NotSigned` fails.
   Fix anything red here; it costs nothing.
3. In the SSL.com dashboard confirm **at least 7 signatures remain** this month.
4. Confirm `ESIGNER_ENABLED` is `true` and the four `ES_*` secrets are reachable from the
   `release` environment.
5. Tag as usual. In `sign-windows`, the rehearsal steps run first, then the paid step logs
   `signed <file> (<role>, esigner, attempt 1)` five times with ~30 s waits, and the notice
   `esigner: 5 signature(s) in 5 attempt(s)`.
6. On a Windows machine, from the published release: Properties → Digital Signatures on both
   downloads; install; check `Varlens.exe`, `resources\elevate.exe` and
   `Uninstall Varlens.exe` in the install directory; start the app; update an older install.

If the paid step fails: read the notice for what was spent, and the error. Do not re-run
blindly — each re-run can spend five more.

## 10. Rollback

- **Immediate, no code change:** set `ESIGNER_ENABLED` to anything but `true`. The next
  release publishes `build.yml`'s unsigned installers, with the existing warnings. This path
  runs no new signing code; it does use the new staging and inspection steps.
- **A release stuck at the signing step:** set the variable as above and re-run the failed
  jobs; if the re-run does not pick up the new value, delete the draft release and re-tag.
- **Back to two outer signatures:** revert this branch's commits. The zip then returns as a
  release asset, with its unsigned `Varlens.exe`.
- The `package.json` hook entry can stay through any of these; it is inert without the mode.

## 11. Files

- `scripts/release/rewrap-windows.mjs` — orchestration and proof
- `scripts/release/windows-sign-hook.mjs` — electron-builder hook
- `scripts/release/windows-signing/` — `signing-plan` (allowlist, count), `sign-file`
  (ledger, TOTP spacing, proof), `signing-backends` (eSigner, self-signed), `pe-signature`,
  `payload`
- `scripts/release/verify-windows-signatures.mjs`, `assert-authenticode.ps1` — verification
- `.github/workflows/release.yml` (`sign-windows` job),
  `.github/workflows/windows-signing-rehearsal.yml`
- `package.json` — `build.win.signtoolOptions`
- `tests/scripts/windows-*.test.ts`, `rewrap-windows.test.ts`, `support/`
