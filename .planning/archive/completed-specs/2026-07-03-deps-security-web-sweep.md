# Spec: Dependabot + security sweep, v0.69.4 release, web-PR rebase & review

**Date:** 2026-07-03
**Author:** automated (Claude) under owner authorization
**Status:** ✅ COMPLETED 2026-07-03 — executed end-to-end (see Outcome below)
**Scope:** clear all 11 open Dependabot security alerts, land all outstanding Dependabot
updates, cut a patch release (v0.69.4, signed tag), then rebase and deep-review the four
open web-track PRs.

---

## 1. Current state (verified)

### Open PRs (11)
- **Dependabot (7):** #277 undici 6.25→6.27 (dev), #278 actions/checkout 6→7 (MAJOR),
  #282 @types/node 25→26 (MAJOR, dev), #285 actions/cache 5→6 (MAJOR), #286 actions/setup-java
  5.2→5.4, #287 production-dependencies group (8 updates), #288 development-dependencies group (13 updates).
- **Web (4)** — all cross-repo from `robspan/VarLens-upstream-fork`, `maintainerCanModify=true`:
  #283 web-11 hosted DB foundation (on current main tip), #284 web-12 telemetry (**draft**, stacked on #283),
  #289 web-13 public annotation bridge (**63 behind main**, 1 planning-doc conflict), #290 web-14 platform identity (on current main tip).

### Open Dependabot security alerts (11) — all build/dev-chain, none shipped in the installer
- undici ×9 (#62–#72), incl. two **HIGH** (SOCKS5 TLS bypass, SOCKS5 cross-origin routing).
- @babel/core #60 (low), esbuild #56 (low).

### Key finding from the Dependabot→alert mapping
- **#277 alone clears all 9 undici alerts** — its lockfile regen re-resolves `@electron/get`'s
  optional undici to 7.28.0, covering both the 6.x and 7.x lines.
- **#56 (esbuild) and #60 (@babel/core) are fixed by NONE of the 7 PRs.** They are stale
  transitive pins whose parents already permit the patched versions; clearing them needs
  `npm audit fix` (non-`--force`), and esbuild's fix requires **#288 to land first**
  (it widens vite's esbuild range to allow 0.28.x).
- **Merging all 7 PRs therefore still leaves 2 alerts open.** The residuals must be closed
  explicitly.
- **#282 (@types/node 26) is CAUTION:** two majors ahead of the pinned Node 24.15.0 runtime,
  risking type surfaces absent at runtime.

### Release mechanics (verified)
- `main` is unprotected (direct push allowed; no required checks).
- `release.yml` triggers on tag `v*.*.*`, asserts tag == `package.json` version, and polls for a
  green `build.yml` run on the tagged SHA. `build.yml` runs on push-to-main and PRs.
- Commit + tag signing configured (SSH, `commit.gpgsign=true`, `tag.gpgsign=true`); last three
  release tags are signed. Push identity: `berntpopp` (owner).
- Version bump convention: manual `chore(release): vX.Y.Z` commit (package.json + lock); recent
  0.69.x patches did not touch CHANGELOG.

---

## 2. Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Deps merge strategy | **One consolidated sweep PR** (`chore/deps-security-sweep`) reproducing #287+#288 + the 3 actions bumps, then `npm install` + `npm audit fix` | 1 CI cycle vs. 4+ rebase cycles; clears the 2 residual alerts in the same pass; Dependabot auto-closes the superseded npm PRs |
| D2 | @types/node 26 (#282) | **INCLUDE** (owner override, 2026-07-03) — take `@types/node` 26 in the sweep like the other bumps; gate hard on `make typecheck` | Owner accepts the runtime-mismatch risk; #282 then auto-closes on merge |
| D3 | Version bump | **0.69.3 → 0.69.4**, `chore(release): v0.69.4` on `main`, + a concise `## [0.69.4]` CHANGELOG entry documenting the security sweep | Patch-level; a security release deserves a changelog note |
| D4 | Release tag | **Signed `v0.69.4`**, pushed only after `build.yml` is green on the release SHA | Honours the release-gate; publishes signed installers |
| D5 | Web-PR update method | **Rebase + force-push** each onto the new main; #283→#284 preserve stack order; #289 resolve the 1 planning-doc conflict | User-chosen; all four are maintainer-editable and touch no dep/CI files, so rebases are clean |
| D6 | Review verdicts to post | #283 → comment (APPROVE-WITH-NITS); #284/#289/#290 → **request-changes** | Matches the deep-review findings (3 PRs carry HIGH items) |

---

## 3. Execution phases

**Phase 0 — safety branch/tag of current main** (so every step is trivially revertible).

**Phase 1 — consolidated deps + security sweep (PR):**
1. Branch `chore/deps-security-sweep` from `origin/main`.
2. Apply the 3 GitHub Actions pin bumps (#278, #285, #286) — cherry-pick from their `dependabot/*` branches.
3. Apply #287 (prod) + #288 (dev) `package.json` edits; `make rebuild-node && npm install` to regenerate one consistent lockfile (undici auto-resolves to 6.27.0 + 7.28.0 → clears 9 alerts).
4. `npm audit fix` (non-`--force`) → esbuild 0.27.7→≥0.28.1 (#56) and @babel/core→≥7.29.6 (#60).
5. Verify: `npm audit` clean; **both** undici lockfile entries present (6.27.0 AND 7.28.0); no unexpected major drift.
6. Full local gate: `make ci-full` (lint-check, format-check, typecheck, rebuild-node, test, startup-smoke) + `VARLENS_WEB=1 make test` (web layer) + `make agent-check`. Fix, don't suppress, any failure. Native `better-sqlite3-multiple-ciphers` 12.11.1 and electron 40.10.5 make the rebuild + startup-smoke mandatory.
7. Push branch, open PR, wait for `build.yml` green, merge to `main`. Dependabot auto-closes #277/#287/#288; close #282 with rationale (D2).
8. **Verify 0 open Dependabot alerts** via `gh api`.

**Phase 2 — release v0.69.4:**
9. On `main`: bump `package.json` + lockfile version to 0.69.4, add CHANGELOG `## [0.69.4]` entry, commit `chore(release): v0.69.4`, push.
10. Wait for `build.yml` green on the release SHA.
11. Create signed tag `v0.69.4` (`git tag -s`), push → `release.yml` builds + publishes signed installers.

**Phase 3 — rebase the 4 web PRs (force-push):**
12. #283: rebase `web/11-hosted-db-foundation` onto new `main`; force-push (`--force-with-lease`).
13. #284: `git rebase --onto <new-283> <old-283> web/12-operations-telemetry` (replays the single telemetry commit); force-push.
14. #289: rebase `web13-public-record-keys` onto new `main`, resolve the one `.planning/web/backlog/web-browser-upload-and-downloads.md` conflict; force-push. Re-check `src/web/server/metrics.ts` typechecks against main's refactor.
15. #290: rebase `web14-platform-identity` onto new `main`; force-push.

**Phase 4 — post deep reviews:**
16. Post the four staged review bodies via `gh pr review` (#283 `--comment`; #284/#289/#290 `--request-changes`).

---

## 4. Guardrails / stop conditions
- **Never lower a threshold** to make CI pass (coverage/lint/typecheck) — fix or add tests.
- If `make ci-full` fails on the sweep for a reason that isn't a trivial format/lint fix, **stop and report** — do not merge a red sweep.
- If `npm audit fix` wants `--force` (i.e. a breaking transitive bump), **stop** — reassess with an `overrides` entry instead.
- Do **not** push the tag until `build.yml` is green on the exact release SHA.
- Force-push only with `--force-with-lease`, and only after confirming the remote branch OID matches the fetched PR head (no clobbering a concurrent push by robspan).
- All four web reviews explicitly note they were reviewed against v0.69.4 and are unaffected by the dependency sweep.

## 5. Rollback
- Sweep PR: revert the merge commit; alerts reopen but state is restored.
- Release: a bad tag can be deleted before the release build finishes; a bad bump is one revert commit.
- Web rebases: original PR head OIDs are recorded (Phase 0) and can be restored via force-push, since `--force-with-lease` preserved them locally.

## 6. Out of scope
- Actually fixing the code findings in the four web PRs (that's robspan's follow-up; we only review + rebase).
- Merging any web PR (all four are REQUEST-CHANGES or APPROVE-WITH-NITS with open items).
- Realigning `@types/node` to `^24` (optional follow-up, not this sweep).

---

## Outcome (2026-07-03)

Executed full-auto per owner authorization. Two rounds:

**Round 1 — security sweep + v0.69.4**
- Consolidated PR **#291** merged: cleared **all 11 Dependabot alerts** (undici 6.27.0/7.28.0
  incl. 2 HIGH, esbuild 0.28.1, @babel/core 7.29.7). Local gate green + full CI green.
  @types/node 26 included per owner override (D2), validated by `make typecheck`.
- Dependabot PRs #277/#278/#282/#285/#286/#287/#288 auto-closed.
- **v0.69.4** released — signed tag, 10 signed installers published.
- 4 web PRs (#283/#284/#289/#290) rebased onto v0.69.4 main + force-pushed; 4 deep reviews
  posted (#283/#284 comment, #289/#290 request-changes).

**Round 2 — follow-up deps + v0.69.5** (owner request: #292 + #293)
- Consolidated PR **#294** merged: markdown-it 14.3.0, @electron/fuses 2.1.3, vue-tsc 3.3.6.
  Full local gate run first — caught a latent vue-tsc 3.3.6 type error in
  `PanelEditorDialog.vue` (null `v-select` emit), fixed with a null-guard (not suppressed).
- **v0.69.5** released — signed tag, 10 signed installers published.
- 4 web PRs re-rebased onto v0.69.5 main + force-pushed (clean; inherited the fix only).

**Left as-is:** pre-existing `elliptic → pdbe-molstar` npm-audit chain (5 low, `--force`-only,
breaks the molstar viewer) — out of scope; recorded in project memory.

Final state: 0 open Dependabot alerts; main @ v0.69.5; open PRs = the 4 web PRs only.
