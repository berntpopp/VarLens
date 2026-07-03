# Web PRs #283/#284/#289/#290 — Code-Review Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (per PR-specific task) or superpowers:executing-plans. Shared-foundation fixes are DERIVED once on #283 and PROPAGATED as identical patches — they are NOT to be re-derived by parallel agents. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Resolve every posted code-review finding on the four open VarLens web PRs and land GitHub Actions green on all four.

**Architecture:** Four cross-repo PRs from `robspan/VarLens-upstream-fork` (maintainerCanModify=true). #283→#284 are a *literal* git stack (identical SHAs). #289 and #290 are *parallel re-implementations* carrying their own copies of the web-11/12/13 foundation with different SHAs — a `git rebase` will NOT carry a #283 fix into them, so shared fixes are propagated as identical patches per branch. Fixes are TDD'd; the bar is `VARLENS_WEB=1 make ci` + `make ci-full` green locally and all PR checks green on GitHub.

**Tech Stack:** Electron 40 / Vue 3 / TypeScript 6 (strict) / Fastify web layer / `pg` (Postgres) for web / Vitest (`web-gate` + `main` projects) / Playwright E2E.

## Global Constraints (verbatim, apply to every task)

- Node `24.15.0` (`.nvmrc`); npm ≥ 11. Native dual-rebuild: `make rebuild-node` before Vitest, `make rebuild` before the app.
- Wrap heavy runs on megalodon: `systemd-run --user --scope -p MemoryMax=16G make <target>`.
- No `console.*` in app code — `mainLogger` (main) / `logService` (renderer) / `app.log` (Fastify web). Web layer uses Fastify's pino logger via `app.log`/`request.log`.
- IPC stays `domain:action` + `wrapHandler`/`unwrapIpcResult`. Do not widen IPC surface without shared-contract types.
- Keep source files < 600 lines where practical; `make agent-check` must pass (it is NOT a CI gate but is a posted finding on #290).
- Never lower a coverage/lint/typecheck/test threshold to make a suite pass. Add tests or fix code.
- Web tests live in `tests/web-gate/**` (Fastify/topology/platform) or `tests/main/**` (storage/repo/sync). Put each new test in the project that already owns the unit under test.
- Push to the fork with `--force-with-lease` to `robspan-fork` (`https://github.com/robspan/VarLens-upstream-fork.git`). **Requires explicit user authorization (see Decision D1).**

---

## 1. Git topology (drives all propagation mechanics)

| Branch (robspan-fork) | PR | Relationship | Shared-foundation files vs #283 |
|---|---|---|---|
| `web/11-hosted-db-foundation` | #283 | Foundation owner (19 commits on main) | — |
| `web/12-operations-telemetry` | #284 | **Literal stack** = #283 SHAs + `c19af5c5` telemetry (draft) | inherits #283 by rebase |
| `web13-public-record-keys` | #289 | Parallel copy (own SHAs) | `hosted-user-db-router.ts`, `createPostgresStorageSession.ts`, `sync-public-annotations.ts` **byte-identical**; `public-annotation-bundle-records.ts` (+99) & `PostgresPublicAnnotationRepository.ts` (+28) **diverge** (CSQ refactor `0c64abdc`) |
| `web14-platform-identity` | #290 | Parallel copy (own SHAs) | all five foundation files **byte-identical** to #283 (forked before #289's CSQ refactor) |

**Propagation rule:** a fix to a byte-identical shared file is applied as the *same* patch to every branch carrying it (so the eventual sequential rebase drops the duplicate commit as empty). For the two files that diverge on #289, the shared fix is re-expressed against #289's variant.

## 2. CI-green bar (verified)

- **Checks (Ubuntu)** = `npm run lint:check`, `format:check`, `typecheck`, `rebuild:node`, `test`. (`test:coverage` is main-branch only; `agent-check` is NOT run.)
- **Web CI** = `make web-ci` + `docker build --target runtime`.
- **Package (ubuntu/macos/windows)** = `rebuild:electron` → `electron-vite build` → package (+ Linux startup smoke).
- Current status: #283/#284/#289 fully green. **#290 red only on Package(windows) → "CI" aggregate**: bare `exit code 1` at the electron-builder packaging step *after* a successful build; #290 adds only two `src/web/*.ts` files (not in the Electron package), identical `package.json`, no Windows-hostile paths; identical step passes on the other three PRs → **transient/flaky**. A fresh run (triggered by our push) is expected to clear it; confirm, don't assume.

---

## 3. Deduped finding inventory (all CONFIRMED by verification agents)

Severity as posted. "Carries" = branches whose diff-vs-main physically contains the vulnerable code. Anchors are at each branch's current tip.

### Cluster A — SHARED FOUNDATION (identical files unless noted; #284 inherits via rebase)

| ID | Finding | Sev | Owning file(s) + anchor | Posted on | Carries | Fix (recommended) | Test target |
|---|---|---|---|---|---|---|---|
| **A1** | Request-time migration-compat gate missing; `openSession` serves via `openPostgresStorageSessionWithoutMigrating` with no version validation → stale workspace DB yields raw `relation does not exist` 500s instead of controlled refusal | HIGH-ish (MED#289 / item2 #283) | `src/web/hosted-user-db-router.ts:42-44,108`; `src/main/storage/postgres/createPostgresStorageSession.ts:57-69` | #283-2, #289-4 | 283,289,290 (identical) | Add read-only compat probe in `openSession` after pool open, before returning: read max `version` from `<schema>.schema_migrations` (pattern in `PostgresHealthDiagnostics.ts:60`), compare to compiled head (`POSTGRES_MIGRATIONS`); **fail closed** (throw controlled `/migration.*incompatible/i`, do not cache session). No DDL. | `tests/web-gate/hosted-user-db-router.test.ts` — stub workspace `schema_migrations` older than head → `resolveSession` rejects, session not cached |
| **A2** | Bundle→public license-gate bypass: `annotation-bundle.v1` path writes chr/pos/ref/alt + gene/consequence/HGVS/**ClinVar** into public DB gated only by hardcoded `PUBLIC_SAFE_CSQ_FIELDS`; never validates `licenseMatrixChecksum`; snapshot schema *requires* `privacy.privateCaseData:true` | **HIGH** (#289) / nit (#283) | `src/web/sync-public-annotations.ts:157-185,180,206`; `src/web/public-annotation-bundle-records.ts:40-60,103`; gate exists only at `src/shared/annotations/public-snapshot.ts:44,238-255,503` | #283-3, #289-1 | 283,289,290 (**bundle-records diverges on 289**) | Fail-closed license gate on the bundle write path: require the referenced public snapshot to exist and assert its stored `license_matrix_checksum === manifest.publicSnapshot.licenseMatrixChecksum`; drive the field allowlist from license-cleared `(sourceId,fieldName)` matrix entries (`redistributionClass ∈ {public_redistributable,attribution_public}` / `licenseStatus:'allowed'`) instead of the hardcoded constant; refuse to write on unknown/blocked/missing matrix | `tests/main/web/sync-public-annotations.test.ts` — bundle whose referenced matrix marks ClinVar restricted / checksum-mismatch → writes 0 restricted rows (or throws) |
| **A3** | Connection budget caps **pool count** (`sessionsBySecretRef.size >= workspacePoolGlobalMax`), but each pool holds `workspacePoolMax`(=2) clients while contract documents GLOBAL_MAX as **total clients** → ~2× over-provision (20 pools × 2 = 40) | MED | `src/web/hosted-user-db-router.ts:57`; `src/web/topology.ts:144-145`; contract `.planning/web/backlog/web11-hosted-db-foundation-contract.md:62,230,239` | #283-1 | 283,289,290 (identical) | Cap in client units: reject when `(size+1)*workspacePoolMax > workspacePoolGlobalMax` (i.e. `maxPools = floor(global/poolMax)`). Update contract note if semantics deliberately kept. | `tests/web-gate/hosted-user-db-router.test.ts` — `poolMax:2, globalMax:2` → 2nd distinct workspace throws `/pool limit/i` |
| **A4** | Idle-pool TTL keyed off routing time, not activity; `scheduleIdleClose` fixed `setTimeout` never reset on query → a single request slower than `workspacePoolIdleMs` races pool teardown, later concurrent request opens a 2nd pool | LOW | `src/web/hosted-user-db-router.ts:52-55,116-130` | #283-4 | 283,289,290 (identical) | Activity-aware: track `lastActivity`/in-flight count; on timer fire, re-arm instead of close if activity within window (or refcount>0). | `tests/web-gate/hosted-user-db-router.test.ts` w/ `vi.useFakeTimers()` — activity at `idleMs-ε`, advance past `idleMs` → `close()` not called while active |
| **A5a** | Hosted `createPostgresStorageSession(controlStateUrl)` runs full `0001–0014` set against the CONTROL DB, creating (empty) case-data tables despite routing-only boundary | LOW (minor) | `src/web/server.ts:98,121`; `createPostgresStorageSession.ts:18-22` | #283-5a | server.ts diverges per branch | **Decision D3** — control-scoped migration subset is invasive; recommend defer + tracking note | (n/a if deferred) hosted-bootstrap test: control DB has no `variants` table |
| **A5b** | `0014` `ADD CONSTRAINT users_private_db_status_check` not idempotent (no `IF NOT EXISTS`; neighbors are guarded) | LOW | `src/main/storage/postgres/migrations/sql/0014_hosted_user_private_db.sql:12-15` | #283-5b | identical all | Wrap in `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_private_db_status_check') THEN ... $$`. | migration-idempotency test: apply 0014 twice → no error |
| **A5c** | Readiness `db.open` folds public-annotation health into control `db` signal (`allOpen`), so a down public DB reports control `db.open=false`; migration-compat + pool-saturation signals absent | LOW | `src/web/server.ts:206-219` | #283-5c | server.ts diverges per branch | `db.open = open && controlReadOpen` only; keep `publicAnnotationDb.open` separate. | `tests/web-gate` server readyz — public pool unhealthy, control healthy → `db.open===true`, `publicAnnotationDb.open===false` |

### Cluster B — #289 public-annotation-specific

| ID | Finding | Sev | Anchor | Fix | Test target |
|---|---|---|---|---|---|
| **B1** | Read repo does not filter `private_case_data=false` in `listSnapshots` and variant lookup (LATENT — both writers hardcode `false`; defense-in-depth) | HIGH (latent) | `src/main/storage/postgres/PostgresPublicAnnotationRepository.ts:201-231,122-174` (diverges on 289) | `WHERE s.private_case_data = false` in `listSnapshots`; restrict variant join to non-private snapshots | `tests/main/storage/postgres-public-annotation-repository.test.ts` — private snapshot excluded from batch refs + variant records |
| **B2** | `resolvePublicAnnotationWriteUrl` falls back to `VARLENS_PG_URL`; sync self-DDLs `CREATE TABLE IF NOT EXISTS public_annotation_*` → could create+populate public tables inside a private DB | MED | `src/web/sync-public-annotations.ts:78-86,227-287` (identical all) | Require `VARLENS_PUBLIC_ANNOTATION_WRITE_PG_URL`; throw if unset (drop the fallback) | `tests/main/web/sync-public-annotations.test.ts` — only `VARLENS_PG_URL` set → `resolvePublicAnnotationWriteUrl` throws `/required/` |
| **B3** | Public schema is ad-hoc CLI DDL, not a versioned migration | MED (2nd half of #289-4) | `src/web/sync-public-annotations.ts:227-287` (identical all) | **Decision D3** — move public schema into `0015_public_annotation_schema.sql`; CLI runs migrations instead of self-DDL. Recommend fix (tractable). | migrator applies 0015; CLI no longer self-DDLs |
| **B4a** | `getBatchReferences` attaches full snapshot list to *every* key (should be top-level) — requires `PublicAnnotationBatchReferences` API-shape change + consumers | MINOR | `PostgresPublicAnnotationRepository.ts:110-112`; `src/shared/types/api.ts:485-489` | **Decision D3** — API-shape change; recommend defer + tracking note | (n/a if deferred) |
| **B4b** | `provision-user.ts` accepts inline `--password` on argv (visible in `ps`/history); safer `--password-file`/`--password-hash-file` already exist | MINOR | `src/web/provision-user.ts:29,39` (identical all) | Drop `--password` (require file/hash) or gate behind explicit `--allow-insecure-password` | new `tests/main/web/provision-user.test.ts` — inline `--password` rejected, `--password-file` accepted |

### Cluster C — #284 telemetry-specific (delta commit `c19af5c5`)

| ID | Finding | Sev | Anchor | Fix | Test target |
|---|---|---|---|---|---|
| **C1** | `resultLooksLikeFailure` flags any non-empty top-level `errors[]` as failure, but `ImportResult.errors` is a *summary* array routinely non-empty on HTTP-200 (skipped rows) → successful imports recorded `result="error",failure_class="unknown"`. Same for `batch-import:extractZip` `{files,errors}`. (Multi-file paths unaffected — no top-level `errors`.) | **HIGH** | `src/web/server/dispatcher.ts:170-176` (esp. :174); `src/shared/types/import.ts:33` | Delete the `body.errors` branch; key failure on `statusCode>=400` + SerializableError `code`/`error` (already the first disjunct) | `tests/web-gate/dispatcher-adapters-core.test.ts` — `import:start` 200 with non-empty `errors[]` → metric `result="success"`, no `result="error"` |
| **C2** | `operationMetricForKey` `startsWith('import:')`/`('batch-import:')` folds selectFile/vcfPreview/vcfMultiPreview/cancel into `operation="import"` (and all `batch-import:*`) → picker/preview/cancel pollute the metric | MED | `src/web/server/dispatcher.ts:148-152` | Replace prefix match with explicit allowlist → only `import:start`,`import:startMultiFile`,`import:startAnnotationBundle`,`batch-import:start` map; else `undefined` | same test file — `import:selectFile` (200,null) emits no `operation="import"` line; `import:start` still does |
| **C3** | `requestIdHeader:'x-request-id'` adopts client header as `request.id`, reflects+logs it; no `genReqId`, no bound → spoof/collision + unbounded log injection on a directly reachable endpoint | MED | `src/web/server.ts:112-118,120-122` | Add `genReqId: () => randomUUID()`; drop `requestIdHeader` or validate+bound (`^[A-Za-z0-9._-]{1,64}$`, else generated) | new `tests/web-gate` server test — 10k-char / newline `x-request-id` → response id is bounded UUID |
| **C4** | `registerImportUploadRoutes` deps went optional (`deps?`) wrapping the append-only upload audit in `if (deps!==undefined)` → a caller can silently skip the audit | MINOR | `src/web/server/routes/upload-staging.ts:74,154-160` | Restore `deps: DispatcherDeps` (required); keep audit unconditional; leave `deps.metrics?.` optional-chained | `tests/web-gate/web-upload-boundary.test.ts` — successful upload records `import:upload` audit; `registerImportUploadRoutes` not callable without deps |

### Cluster D — #290 platform-identity-specific

| ID | Finding | Sev | Anchor | Fix | Test target |
|---|---|---|---|---|---|
| **D1f** | `POST /platform/provisioning/users` registered on the request-serving app; bearer-gated but mints `role:'admin'`, sets `privateDbSecretRef`, and via `adoptPlatformUserBySecretRef` a new subject on an existing secret ref **renames/rebinds the current non-admin owner → cross-tenant takeover + DoS**. Contradicts web-11 contract (provisioning "must not be reachable from request-serving runtime") | **HIGH** | `src/web/server/platform-identity.ts:711`; `src/web/server.ts:199`; `PostgresWebAuthService.ts:562,576-618`; contract `.planning/web/context/runtime-contract.md:22-24`, `.planning/web/backlog/web11-hosted-db-foundation-contract.md:132-134,303-306` | **Decision D2** — recommend: do NOT register the route on the serving app; provisioning stays in `provision-user.ts` CLI. (Combine with D4b split so the endpoint lives in its own module.) Also fixes D3g at the source. | `tests/web-gate/platform-identity.test.ts` — POST to route on serving app → 404 |
| **D2f** | `VARLENS_PLATFORM_PROVISIONING_TOKEN`/`_ENTITLEMENTS_TOKEN` accept any non-empty value; contrast 32-byte `VARLENS_SESSION_SECRET_HEX` enforcement | MED | `src/web/server/platform-identity-config.ts:103-104` vs `src/web/server/auth.ts:162-168` | Reject tokens below floor (≥32 chars / hex→≥32 bytes) when set; keep optional (absence=off) | `tests/web-gate/platform-identity-config.test.ts` — weak token throws `/at least 32/` |
| **D3g** | `adoptPlatformUserBySecretRef` guards only `role!==admin`; silently overwrites `password_hash`→sentinel and renames ANY non-admin holder, unlike by-username path which refuses to overwrite a local user | MED | `PostgresWebAuthService.ts:495-499` (username guard) vs `:576-618` (adoption) | Also `SELECT password_hash`; refuse unless current holder is adoptable placeholder (`password_hash===PLATFORM_DISABLED_PASSWORD_HASH`) or explicit `intent`/`expectedCurrentUsername` matches; reject active local user / foreign-owned ref | `tests/main/web/auth/postgres-web-auth-service.test.ts` — active local user (real argon2 hash) holding ref → adoption rejects + ROLLBACK |
| **D4f** | Size gate: `platform-identity.ts`=872 (not baselined→new) and `PostgresWebAuthService.ts`=782 (baselined 616→grown) → `make agent-check` exits 1 | MED | `scripts/agent-health-baseline.json:166-170`; `check-agent-health.mjs:409-413` | Split: extract OIDC/JWT service, route registration, and provisioning endpoint from `platform-identity.ts`; extract platform-user methods from `PostgresWebAuthService.ts` into `PostgresPlatformUserStore`. (Seams also enable D1f.) | `make agent-check` exits 0 |
| **D5a** | Opaque (non-JWT) IdP access tokens hard-fail platform login at the 3-segment check (`token.split('.')`) | non-block (partial) | `src/web/server/platform-identity.ts:176,505-509` | Verify id_token always; JWT-verify access_token only when configured (opaque access tokens are legitimate) | `tests/web-gate/platform-identity.test.ts` — opaque access_token + valid id_token → login succeeds when access-JWT-verify off |
| **D5b** | `legacySinglePgUrlPresent` computed but unused — no hosted-mode `VARLENS_PG_URL` startup warning | non-block | `src/web/topology.ts:22,148` | Emit `app.log.warn` in hosted boot when `topology.legacySinglePgUrlPresent` | `tests/web-gate/topology.test.ts` / server boot — warn logged when set |
| **D5c** | Missing negative tests: provisioning-driven adoption of active local user; minted-admin cannot get a session without valid entitlement+OIDC | non-block | `postgres-web-auth-service.test.ts:391,440` | Add both negative tests (adoption covered by D3g; entitlement gate holds via `resolveSessionUser`) | the two named tests |

---

## 4. Integration & fix order

Serial across PRs (shared-foundation derivation flows forward); PR-specific independent findings parallelize *within* a phase.

1. **Phase 1 — #283 (foundation, canonical):** TDD A1, A2, A3, A4, A5b, A5c (+ B2 & B3 & B4b, which live in shared foundation files present on #283). Derive + test every shared fix here. Push `web/11-hosted-db-foundation`.
2. **Phase 2 — #284 (telemetry):** `git rebase --onto <new-283-tip> <old-283-tip> web/12-operations-telemetry` (replays only `c19af5c5`), then TDD C1,C2,C3,C4. Push. (Draft stays draft.)
3. **Phase 3 — #289 (annotation bridge):** Propagate shared fixes — identical patches for the byte-identical files, re-expressed patches for the two diverged files (`public-annotation-bundle-records.ts`, `PostgresPublicAnnotationRepository.ts`) — then TDD the #289-only read-path items: **B1** (read filter), **A2** on #289's CSQ-refactored bundle-records, **B4a** (Decision D3). Push `web13-public-record-keys`.
4. **Phase 4 — #290 (platform identity):** Propagate shared fixes (all five foundation files identical → same patches), then TDD **D1f,D2f,D3g,D4f,D5a,D5b,D5c**. Push `web14-platform-identity`. Re-run to confirm the flaky Windows package clears.
5. **Phase 5 — verify + reply:** `VARLENS_WEB=1 make ci` + `make ci-full` green per branch locally; all PR checks green on GitHub; post one "addressed: …" review reply per PR.

**Propagation scope (Decision D4):** the #283-only nits (A3/A4/A5c) — apply to #289/#290 copies too (recommended: keeps the eventual rebase empty-drop clean and prevents reintroduction) vs. fix on #283 only.

---

## 5. Decisions (RESOLVED 2026-07-03)

- **D1 — Authorization: ✅ AUTHORIZED.** Force-push (`--force-with-lease`) to robspan's fork branches; post an "addressed:" reply per PR after green.
- **D2 — #290 provisioning (D1f): REMOVE the HTTP route from the serving app.** Provisioning stays in the existing `provision-user.ts` CLI / IAC job. Keep the underlying `upsertPlatformUser` for CLI use; extract into its own module (with D4f split) and do not register on `app`.
- **D3a (2026-07-03, A2 design): INLINE THE LICENSE MATRIX IN annotation-bundle.v1.** Extend the bundle schema to carry the full license matrix; validator enforces it fail-closed; sync validates the inline matrix's checksum against the declared `licenseMatrixChecksum`; `public-annotation-bundle-records.ts` writes a field only if its `(sourceId,fieldName)` is license-cleared in the inline matrix (fail closed otherwise). Update bundle producer (if in-repo) + test fixtures.
- **D3b (2026-07-03, A5a): CARVE A CONTROL-SCOPED MIGRATION LIST NOW.** Run only routing/auth/audit migrations against the control DB in hosted mode; add a live-Postgres hosted integration test proving the control DB lacks case-data tables and auth/session/routing still work. Trace control-DB table dependencies before choosing the subset; if the subset can't be cleanly determined, STOP and surface the specific dependency conflicts.
- **D3 — invasive/minor items: FIX ALL THREE NOW.** A5a (carve a control-scoped migration list so the control DB does not get case-data DDL), B3 (`0015_public_annotation_schema.sql` + CLI runs migrations instead of self-DDL), B4a (`PublicAnnotationBatchReferences` gets a top-level `snapshots` field; update all consumers). If any proves architecturally larger than a review-fix should carry, STOP and surface it rather than bulldoze.
- **D4 — propagation scope: APPLY shared fixes to all carrying branches.** Identical patches into #289/#290's byte-identical foundation files (incl. the #283-only nits A3/A4/A5c) so each PR is independently correct and the eventual rebase empty-drops the duplicates.

## 6. Verification gates (per phase, before push)

- `make rebuild-node` → targeted Vitest for the touched unit → `VARLENS_WEB=1 make test` → `npm run typecheck` → `npm run lint:check && npm run format:check`.
- Before declaring a PR done: `VARLENS_WEB=1 make ci` and (foundation/lifecycle-touching) `make ci-full`, wrapped in the megalodon memory cap.
- After push: `gh pr checks <n> --repo berntpopp/VarLens` green; confirm #290 Windows package cleared.
- No threshold lowered; every behavioral fix has a failing-test-first commit.

## 6a. Execution progress (2026-07-03)

**Phase 1 — #283 (web/11): ALL 10 FINDINGS FIXED + COMMITTED (10 commits on top of 0294715d).**
A1 migration-compat gate · A3 client-budget · A4 activity-aware idle close · A5b `0014`
idempotency · B4b provision-user `--password` · B2 write-URL fallback · A5c readyz split ·
**A2 inline-matrix bundle license gate (HIGH)** · B3 `0015` public-annotation migration ·
A5a control-scoped migration set. Validated: typecheck clean; touched unit tests green;
**A2 + B3 + A5a verified against real Postgres** (public-annotation sync writes 11
license-cleared rows; control schema gets `users` but not `variants`/`cases`). Full
`VARLENS_WEB=1 make ci` gate running before push.

**Propagation mechanics for later phases:**
- **#284 (literal stack):** `git rebase --onto <new-283-tip> 0294715d web/12` (replays only the telemetry commit), then C1–C4.
- **#289 / #290 (parallel copies):** cherry-pick the 10 #283 fix commits. #290's 5 foundation files are byte-identical → clean picks. #289 diverges on `public-annotation-bundle-records.ts` (A2 commit) + `PostgresPublicAnnotationRepository.ts` → resolve those two by hand, then add #289/#290-specific fixes.

## 7. Provenance

All findings CONFIRMED by four read-only verification agents against branch tips (2026-07-03). Authoritative contracts: `.planning/web/backlog/web11-hosted-db-foundation-contract.md`, `.planning/web/context/runtime-contract.md`, `.planning/specs/2026-06-22-public-private-annotation-db-boundary.md`.
