# Desktop ↔ Web Parity: Staged Plan

**Date:** 2026-10-06
**Spec:** `.planning/specs/2026-10-06-desktop-web-parity-spec.md`
**Evidence:** `.planning/code-review/desktop-web-parity-2026-10-06/`

Each PR is small, ships its own regression test, and flips manifest entries from `pending` to `shared`, `adapter` or `desktop-only`. **Rule from PR-W2 onward:** a PR that closes a gap must update `src/shared/ipc/parity-manifest.ts` and lower `scripts/parity-baseline.json`.

Gap IDs (P-xx) refer to spec §5. Tracks: **T4** web-mode completeness, **T5a** desktop non-blocking backend, **T5b** web/PG non-blocking backend, **T6** CI gates, **T8** web export hotfix.

## Sequence overview

```
Wave 0 (now, independent)   PR-W1 desktop preload hotfix
Wave 1 (foundation)         PR-W2 parity manifest + gate ──► PR-W4 error envelope
                                     │
Wave 2 (after T4 merges)             └──► PR-W3 capability document + typed web client
Wave 3 (after T8, T5b)      PR-W5 export artifacts    PR-W6 jobs    PR-W9b bulk delete
Wave 4 (feature gaps)       PR-W7a HPO  PR-W7b gene-ref+panels  PR-W7c enrichment  PR-W7d protein
                            PR-W8 multi-user auth (server for T4's admin UI)   PR-W9a ZIP/batch import
Wave 5 (architecture)       PR-W10.x handler-factory migration (one domain per PR)
Wave 6 (hardening/verify)   PR-W11 hardening   PR-W12 parity E2E revival (nightly)   PR-W13 association
```

---

## PR-W1: Desktop preload completeness hotfix (P-03)

- **Branch:** `fix/preload-database-methods`
- **Owns:**
  - `src/preload/window-api/core-api.ts` (the `database` block, lines ~109-128)
  - `tests/preload/window-api-completeness.test.ts` (new)
- **Do:**
  - Forward `migrateToEncrypted`, `deletePlaintextBackup` and `setRecoveryPassphrase`.
  - Pass `setupPassphrase` through `create`.
  - Remove the `as WindowAPI['database']` cast so the compiler checks the object (use `satisfies`).
  - Audit the other `as WindowAPI[...]` casts in `core-api.ts` / `app-api.ts` the same way.
- **Test:** build the API with `createWindowApi()` and a fake `ipcRenderer`. Assert that every method of every domain is a function and invokes a channel.
- **Gate:** `make typecheck`, `make rebuild-node && make test`, and `make ci-full` (preload is Electron lifecycle). Manual check: migrate a plaintext DB to encrypted in the dev app.
- **Overlap:** none.

## PR-W2: Parity manifest + contract gate (P-24, P-18 detection, P-22 detection)

- **Branch:** `test/parity-manifest-gate`
- **Owns (new):**
  - `src/shared/ipc/parity-manifest.ts`
  - `src/shared/ipc/parity-manifest-types.ts`
  - `tests/shared/ipc/parity-manifest.test.ts`
  - `tests/web-gate/dispatcher-resolution.test.ts`
  - `scripts/parity-baseline.json`
  - `scripts/parity/check-renderer-gates.mjs`
- **Owns (edit):** `tests/web-gate/handler-seam.test.ts` (stop accepting `unsupportedWebCapability` as a pass), `dispatcher-adapters-*.test.ts` (read expected 501s from the manifest), `Makefile` (`agent-check` runs the gate script), `vitest.config.ts` (only if the new test needs the default project).
- **Do:**
  1. Seed the manifest from `.planning/code-review/desktop-web-parity-2026-10-06/01-static-inventory.json` (217 methods):
     - PARITY → `shared`
     - client overrides, upload and SSE → `adapter`
     - LEGITIMATELY-DESKTOP-ONLY → `desktop-only` with `webUx`
     - MISSING, BROKEN and DEGRADED → `pending` with a tracking reference to this plan's PR.
  2. Type: `satisfies { [D in keyof WindowAPI]: { [M in keyof WindowAPI[D]]: ChannelPolicy } }`.
  3. Export the dispatcher's resolution table as a pure function from `src/web/server/dispatcher.ts` (`resolveWebMethod(domain, method)`), so tests can check it without a network. This is a minimal edit.
  4. Add the tests in spec §6, layers 1–3, including the `inject()` smoke over a mocked session and the "pending count ≤ baseline" ratchet.
  5. Add a startup assertion in `src/web/server.ts`: an unclassified or unresolved `shared` method fails startup in `NODE_ENV=production`, and is a warning in development.
- **Gate:** `make typecheck`, `make rebuild-node && make test`, `VARLENS_WEB=1 make test`, `make agent-check`.
- **Overlap:**
  - T6 (CI gates): a plain vitest test, so no workflow edits. Coordinate if T6 restructures `make agent-check`.
  - T4, T5b, T8: their merged PRs flip manifest entries. Whichever of W2 and those PRs lands second adjusts the manifest.

## PR-W3: Capability document, fail-closed store, typed web client (P-11, P-19, gating for P-09/P-14/P-15)

- **Branch:** `feat/capability-negotiation`
- **Prerequisites:** PR-W2, and T4 merged (W3 converts T4's hides mechanically).
- **Owns:**
  - `src/shared/ipc/domains/system-capabilities.ts` (new), plus its preload and main bindings
  - `src/web/server/routes/database.ts` (remove the overlay; the capability document is computed in `src/web/server/capabilities.ts`, new)
  - `src/renderer/src/stores/capabilityStore.ts` (new)
  - `src/renderer/src/utils/backend-capabilities.ts` (delegate, fail-closed)
  - `src/renderer/src/utils/runtime-features.ts`
  - `src/web/client/api.ts` (replace the Proxy with a client generated or derived from the manifest; `src/web/client/generated-client.ts`)
  - call sites: `HpoTermSelector.vue`, `useCohortData.ts`, `useVepEnrichment.ts`, `useAssociation.ts`, `PanelManagerDialog.vue`, `PanelEditorDialog.vue`, `PanelAppImportDialog.vue`, `StringDbGenerateDialog.vue`, `useGeneValidation.ts`, `ApplicationPreferences.vue`, `AppSidebar.vue`, `AppToolbar.vue`, `ActivityLogPanel.vue`, `externalLinksStore.ts`
- **Do:** follow spec §4.3. `canUse()` returns false while the document is loading. Every `pending` or `desktop-only` call site goes behind `canUse()` and shows the `reason`; the UX copy comes from T4. Unbridged `on*` subscriptions become typed errors.
- **Test:**
  - store unit tests (loading, fail-closed, role);
  - a web-client test that every manifest method exists on the client and that no undeclared property exists;
  - `check-renderer-gates.mjs` passes with zero exceptions.
  - Cohort parity: case and cohort views gate together.
- **Gate:** `make ci`. Built web instance: re-run `empirical/scripts/crawl*.cjs`, expecting 0 raw 404s or 501s reaching the UI. axe 0 serious on the touched dialogs.
- **Overlap:** **T4** owns the copy and the shell UI. W3 owns the mechanism. Rebase on T4 and keep each T4 component edit to swapping in a capability read.

## PR-W4: Error envelope + interim safety fixes (P-10, P-11 `[object Object]`, P-07 interim, P-20)

- **Branch:** `fix/ipc-error-codes`
- **Owns:**
  - `src/shared/types/errors.ts` (or the existing `SerializableError` home): add `ErrorCode`
  - `src/main/ipc/wrapHandler.ts` (or its current location): shared `toSerializableError()`
  - `src/web/server/dispatcher.ts` (error-to-status mapping only)
  - `src/renderer/src/utils/ipc-result.ts` (`formatError()`)
  - `useAssociation.ts` (message)
  - `src/web/server/routes/import.ts` and `routes/batch-import.ts`: interim owner guard on cancel (only the user who started the run may cancel)
  - CSP config for IGV (`src/web/server/` security headers), or hide IGV with a reason, per the spec §4.6 decision
- **Test:** unique conflicts on presets, region files and import case name return 409 / `CONFLICT` on both SQLite and Postgres; a non-admin cannot cancel another user's import; `formatError` never returns `[object Object]`.
- **Gate:** `make ci`, `VARLENS_WEB=1 make test`.
- **Overlap:** T5b may touch `dispatcher.ts` (auth cache). Keep W4's change to the error-mapping function.

## PR-W5: Export artifacts + signed downloads (P-01 full, P-23 `export:progress`)

- **Branch:** `feat/web-export-artifacts`
- **Prerequisites:** **T8 merged** (hotfix unblocks CSV), PR-W6 for job-backed large exports (it can ship sync-only first).
- **Owns:**
  - `src/shared/ipc/domains/export.ts` (artifact result type)
  - `src/main/ipc/handlers/export-logic.ts` (return `ExportArtifact`)
  - `src/main/platform/electron-platform.ts` (new; `deliverArtifact` = save dialog)
  - `src/web/server/platform/web-platform.ts` (new)
  - `src/web/server/routes/download.ts` (new; HMAC token, TTL, streamed `Content-Disposition`)
  - `src/web/server/routes/export.ts`
  - `src/web/client/file-download.ts` (new; navigation-based)
  - `panels.exportBed` handler
- **Test:**
  - Fastify `inject` streams CSV with the correct headers.
  - Token expiry, a wrong user, and replay are rejected.
  - Desktop export is unchanged (existing tests).
  - Playwright download event in the built web instance for case, cohort and BED.
- **Gate:** `make ci`, `make ci-full` (main-process export path), web crawl.
- **Overlap:** **T8.** Keep T8's tests and replace only the delivery path.

## PR-W6: Jobs in web + session-safe SSE (P-13, P-07 full)

- **Branch:** `feat/web-jobs`
- **Prerequisites:** **T5b merged** (delete-job table).
- **Owns:**
  - PG migration `jobs` (generalising T5b's table: `kind`, `owner`, `progress`, `artifact_id`)
  - `src/main/storage/postgres/PostgresJobRepository.ts`
  - `jobs` domain web wiring (`src/web/server/routes/jobs.ts` or a shared handler)
  - `src/web/server/events.ts` (event ids, bounded replay ring, `Last-Event-ID`, 15 s heartbeat, session revalidation and close-on-revoke)
  - import and batch-import cancellation by job id
- **Test:**
  - job lifecycle against Postgres (`make web-gate-postgres`);
  - SSE replay after reconnect;
  - a revoked session closes the stream;
  - user A cannot cancel or see user B's job.
- **Gate:** `make ci`, `VARLENS_WEB=1 make ci`, `make web-gate-postgres` (own DB, port 55434).
- **Overlap:** **T5b.** Build on its job table and do not re-implement the delete job.

## PR-W7a: HPO search in web (P-04)

- **Branch:** `feat/web-hpo-search`
- **Owns:** `src/main/ipc/handlers/hpo-logic.ts` (new or extracted; search over the bundled ontology without network), `src/web/server/routes/hpo.ts` (remove the 501), manifest entries.
- **Test:** shared handler unit test; web `inject` returns terms; crawl step "case metadata HPO term search add" passes.
- **Overlap:** none. It replaces the "not available" copy T4 adds for HPO.

## PR-W7b: Gene reference DB on the server + panel tooling (P-05, P-06)

- **Branch:** `feat/web-gene-reference`
- **Owns:**
  - delete `src/web/stubs/gene-reference-loader-stub.ts`
  - the web-server gene reference loader (path from `VARLENS_GENE_REFERENCE_PATH`, baked into the Docker image)
  - `Dockerfile` / `docker/*`
  - `geneRef.info` (shared); `geneRef.update` as admin-only `shared`
  - `panels.validateSymbols`, `autocomplete` and `exportBed` handlers
  - a regression test for cohort-query-with-panel on Postgres (P-06, written first)
- **Gate:** `make ci`, `make web-gate-postgres`, built-image smoke (`make pg-hosted-smoke` or the equivalent), crawl panel steps.

## PR-W7c: ReferenceServices + egress policy + enrichment (P-09, PanelApp/StringDB part of P-05)

- **Branch:** `feat/web-reference-services`
- **Prerequisites:** a decision on the egress policy (spec §8.1).
- **Owns:**
  - `src/web/server/reference-services.ts` (constructs the `src/main/services/api/*` clients)
  - instance setting `externalLookups` (admin)
  - PG response cache table
  - per-user rate limit
  - `vep.fetch`, `myvariant.fetch`, `spliceai.fetch`, `panels.searchPanelApp`, `panels.importPanelApp`, `panels.generateStringDb`
- **Test:** disabled policy produces a capability reason and no network call; enabled policy uses a mocked upstream; cache hits.
- **Overlap:** none.

## PR-W7d: Protein and gnomAD viewer in web (P-14)

- **Branch:** `feat/web-protein-viewer`
- **Prerequisite:** PR-W7c.
- **Owns:** `protein.*` and `gnomad.*` via ReferenceServices; remove the `isProteinViewerAvailable()` runtime gate in favour of a capability.
- **Gate:** includes the pdbe-molstar lazy load in the web bundle (AGENTS.md security note).

## PR-W8: Multi-user account server (P-02 server half, P-16)

- **Branch:** `feat/web-multi-user`
- **Prerequisite:** decision on the role and ownership model (spec §8.2).
- **Owns:**
  - `src/main/ipc/handlers/auth-logic.ts`
  - `src/web/server/routes/auth.ts`
  - role model (admin/analyst/viewer), `auth:setRole`, `auth:createUser` enabled behind instance setting `multiUser`
  - `resetPassword` returns `NOT_FOUND` for unknown users
  - deactivating an unknown user returns 404
  - `audit.getByEntity` scoped read for non-admins
  - role × capability matrix test (Limin L11)
- **Overlap:** **T4** mounts `UserManagement.vue`, logout and change password. W8 supplies the endpoints T4's UI calls. Agree the contract shape before either merges.

## PR-W9a: Batch import ZIP fix + shared batch-import logic (P-08)

- **Branch:** `fix/web-batch-import-zip`
- **Owns:**
  - `src/main/ipc/handlers/batch-import-logic.ts`
  - `src/web/server/routes/batch-import.ts` (remove the `startWebBatchImport` and `checkDuplicates` re-implementations, per ADR 0002)
  - ZIP probe for upload tokens
- **Test:** `empirical/scripts/zip-probe.cjs` scenario as a web-gate integration test; plain ZIP and encrypted ZIP both work.

## PR-W9b: Bulk and delete-all cases on Postgres (P-12)

- **Branch:** `feat/pg-bulk-case-delete`
- **Prerequisites:** T5b delete job, PR-W6.
- **Owns:** `cases.deleteBatch` and `cases.deleteAll` web handlers as jobs; flip `cases.deleteMany/deleteAll` in `POSTGRES_CAPABILITIES` (`src/main/storage/postgres/PostgresStorageSession.ts:49`).

## PR-W10.x: Handler-factory migration (spec §4.1, Limin L1–L3)

One PR per domain. The branch pattern is `refactor/handlers-<domain>`.

- **Order:** pick domains that already have `*-logic.ts` and many web overrides first: `variants`, `annotations`, `transcripts`, `cohort`, `cases`, `panels`, `import`, then the rest.
- **Owns per PR:**
  - `src/main/ipc/handlers/<domain>*.ts`
  - `src/main/ipc/domains/<domain>.ts`
  - the matching `src/web/server/routes/<domain>.ts` (shrinks or disappears)
  - `task-types.ts` entries for that domain
- **First PR (W10.0) also adds:**
  - `src/main/platform/platform-port.ts`
  - `src/main/security/request-context.ts` (AsyncLocalStorage actor)
  - `src/main/security/secure.ts` (zod validation + authz + audit + timeout from the manifest `authz`/`audit` fields)
  - ESLint `no-restricted-imports` banning `electron` in `*-logic.ts`
- **Gate per PR:** `make ci`, `VARLENS_WEB=1 make ci`, `make ci-full` when main-process registration changes.
- **Overlap:** **T5a** (main-process workers, startup order). Start W10 after T5a merges, and never touch two domains in one PR.

## PR-W11: Hardening (P-18, P-21, P-22)

- **Branch:** `fix/web-api-hardening`
- **Do:** remove the alias autoroutes from `task-types.ts`; fix the `annotations.deleteGlobal` argument shape; require auth (or an instance flag) for `/api/openapi.json` and `/api/docs`; add a test that `desktop-only` channels return 404 over HTTP (`03-best-practices.md` rec. 13).

## PR-W12: Revive behavioural parity E2E (P-24 runtime half)

- **Branch:** `test/parity-e2e-upload-seeding`
- **Owns:**
  - `tests/web-gate/parity/**` (seed via upload staging instead of server paths)
  - a second run with `VARLENS_WEB_PARITY_FIXTURES` **unset**
  - a nightly workflow (`.github/workflows/web-parity-nightly.yml`, SHA-pinned actions)
  - move the crawl scripts from `.planning/code-review/desktop-web-parity-2026-10-06/empirical/scripts/` into `tests/web-smoke/` as a Playwright spec
- **Overlap:** **T6** (workflow conventions, Lighthouse/axe jobs). Reuse its setup steps.

## PR-W13: Cohort association in web (P-15)

- Implement on Postgres per `.planning/web/backlog/web-cohort-association-support.md`, or declare it `desktop-only` with a `webUx`. PR-W3 gates it either way.

---

## Definition of done for the program

- `scripts/parity-baseline.json` pending count = 0.
- The crawl gives 0 ERROR steps. The API probe returns no 404 "unknown method" for any manifest method, and 501 only for `desktop-only` methods, which the renderer never calls.
- Spec §9 acceptance criteria are met.
- Each PR's verification follows CLAUDE.md: `make ci` minimum, `make ci-full` for preload/main/worker changes, and a built web instance plus Playwright for UI.
