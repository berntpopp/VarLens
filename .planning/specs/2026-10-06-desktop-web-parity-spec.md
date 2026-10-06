# Desktop ↔ Web Parity

**Date:** 2026-10-06
**Status:** Proposed. Research, audit and spec only; no product code changed.
**Branch:** `docs/desktop-web-parity-spec`
**Plan:** `.planning/plans/2026-10-06-desktop-web-parity-plan.md`
**Evidence:** `.planning/code-review/desktop-web-parity-2026-10-06/`

| File | Content |
|---|---|
| `01-static-inventory.md` / `.json` | Every `window.api` method (217), how web serves it, classification, capability flags, renderer gates, event channels, test blind spots |
| `02-limin-comparison.md` | How Limin gets parity, with file:line citations, and a pattern-by-pattern adoption table |
| `03-best-practices.md` | 2025–2026 sources on dual-target apps, contract tests, downloads, capabilities, jobs, settings scope, RPC-over-HTTP security |
| `04-empirical-web-crawl.md`, `empirical/` | Headless Playwright crawl of a built web instance as admin: 102 steps, an authenticated probe of 103 API methods, and screenshots of the failures |

User mandate: *"Electron and web need full parity — fix it deeply, research best practices, compare with ../limin."*

---

## 1. Problem

VarLens ships one renderer to two runtimes:

- **Desktop:** Electron, with IPC to the main process and SQLite (or the experimental Postgres profile).
- **Web:** a browser that implements the same `window.api` over HTTP against a Fastify server and Postgres.

The shared renderer gives the illusion of parity. Underneath, the two backends drifted:

- **Static.** Of 217 `window.api` methods, **132 PARITY · 9 DEGRADED · 3 BROKEN · 33 MISSING · 40 LEGITIMATELY-DESKTOP-ONLY** (`01-static-inventory.md` §Summary).
- **Empirical.** 102 crawl steps: **78 OK, 17 ERROR, 7 NOT-FOUND-IN-UI**. The API probe returned **22 × 404 "unknown method"** and **17 × 501 "not available in web mode"** (`04-empirical-web-crawl.md`).
- **No guardrail.** No test fails when a desktop channel has no web implementation. The existing gates either assert the 501s (`dispatcher-adapters-*.test.ts` locks the gaps in) or run opt-in with parity fixtures switched on, which makes production 501s look like parity. The opt-in parity E2E is probably stale: it seeds through server-path import, which has been hard-disabled since `37167a54`.

### 1.1 Correction to the brief

The brief said "the whole Settings and admin area is reportedly broken in web". The crawl shows a more specific picture:

- **Works:** Database Overview, External Links, Custom Tags, Application Preferences, Reset Columns and Reset Filters.
- **Broken:** Gene Panels (geneRef 501, six panel methods 404) and Delete All Cases (capability-disabled on Postgres).
- **Never mounted:** user management, logout and change password have no UI anywhere (`UserManagement.vue` is mounted nowhere). Server-side, `auth:createUser` returns 501 ("single-tenant release") and there is no role-change method.

### 1.2 Root causes (architectural, not per-feature)

1. **Two handler implementations per channel.** Desktop logic sits in `src/main/ipc/handlers/*` and web logic in `src/web/server/routes/*` (76 overrides) plus the `READ_TASK_TYPES` / `WRITE_TASK_TYPES` executor lists (`src/web/server/task-types.ts`). Only the storage layer (`StorageSession`) is shared. ADR `.planning/web/context/decisions/adr/0002-parallel-maintainability.md` already asks for one `<domain>-logic.ts` shared by both transports, but batch-import, checkDuplicates, variants.query, transcripts and annotations still duplicate it.
2. **Permissive web client.** `src/web/client/api.ts:559` (`createApi()`) is a Proxy, so any property is a function:
   - An unknown method becomes a runtime 404 instead of a compile error.
   - Any `on*` subscription without a bridge is a silent no-op (`api.ts:361`).
   - Feature detection such as `typeof api.hpo.search === 'function'` (`HpoTermSelector.vue:96`, `useCohortData.ts:191,234`) is always true.

   The Phase 3 plan (`.planning/web/backlog/phase3-execution-plan.md`) wanted hand-written shims typed against each `*DomainContract`. What shipped dropped that compile-time completeness.
3. **No declared availability per method.** Nothing records whether a method is "shared", "desktop-only, and here is the web UX", or "pending, tracked in issue N". Each gap is therefore an accident discovered by users:
   - 501 from `unsupportedWebCapability` (`src/web/server/routes/common.ts`).
   - 404 from `dispatcher.ts:412`.
   - Fixture-only behaviour behind `webParityFixturesEnabled()`.
4. **Capability gating is backend-only and fails open.** `StorageCapabilities` (`src/shared/types/storage-capabilities.ts`) describes SQLite vs Postgres. `src/web/server/routes/database.ts:5` overlays export flags to false. `backend-capabilities.ts:98` returns `true` while capabilities are still loading. Runtime differences (web vs Electron, role, external-network policy) are scattered `isWebRuntime()` checks (19 sites) and are not served by the backend.
5. **External reference services exist only in the Electron main process.** VEP, MyVariant, SpliceAI, gnomAD, HPO, PanelApp, StringDB, protein and gene reference live in `src/main/services/api/*` and are never constructed in the web server. In web they become 501 (fixture-gated) or 404 (not wired). The web build replaces the gene reference loader with a throwing stub (`src/web/stubs/gene-reference-loader-stub.ts`).
6. **The error envelope carries no status semantics.** `T | SerializableError` is recognised by shape. A unique-constraint conflict therefore surfaces as HTTP 500 "An unexpected error occurred" (presets, region files, duplicate import case name), and the renderer prints `[object Object]` for the association 501.

---

## 2. Goals and non-goals

**Goals**

- G-1: Every `window.api` method has exactly one declared web policy, and CI fails when one is missing or a declared-shared method is not served.
- G-2: One handler implementation per method, used by both IPC and HTTP. A transport adapter only does transport work: dialogs, file delivery, the event bridge and the actor context.
- G-3: Users never hit a raw 404 or 501. Unavailable features are hidden or explained, driven by a server-advertised, role-aware capability document that fails closed.
- G-4: Close the user-visible gaps in impact order (§5), without duplicating in-flight tracks 4, 5b and 8.
- G-5: Fix the desktop defects found on the way (§5, gap P-03).

**Non-goals**

- Making desktop-only concepts exist in web. Local DB files, SQLCipher keys, worker-thread count, the auto-updater, `showInFolder` and Postgres connection profiles each get an explicit web UX decision instead (§4.6).
- Migrating to oRPC or tRPC now. oRPC is the reference design (`03-best-practices.md` §1); the spec stays on the existing zod domain contracts, which are already ahead of Limin.
- Collapsing the 29 typed domains into a generic `entity:action` channel. Limin does this; VarLens should not (`02-limin-comparison.md`).

---

## 3. What Limin does that VarLens should adopt

Limin (`/home/bernt-popp/development/limin`, Electron 42 + Vue 3.5 + Postgres web) is described with full citations in `02-limin-comparison.md`. Its parity rests on one rule: **backend logic is one handler object that both transports mount.**

| # | Pattern | Limin | VarLens today | Decision |
|---|---|---|---|---|
| L1 | Shared handler factory, two thin mounts | `src/main/api/limin-api-handlers.ts:82-89` (never imports Electron); IPC mount `src/main/ipc-handlers.ts:333-414`; HTTP mount `POST /api/:domain/:method` in `src/web/server/dispatcher.ts:103-199`, `src/web/server.ts:329-337` | Shared only at `StorageSession`; handlers duplicated in `routes/*` | **Adopt.** Per-domain factory, migrated domain by domain |
| L2 | Platform adapter port (dialogs, shell, local files, downloads) | `limin-api-handlers.ts:58-76`, `src/main/api/electron-adapters.ts:61`, `src/web/server/web-adapters.ts:54-97` | Dialogs inline in IPC handlers; web pickers overridden client-side | **Adopt** |
| L3 | One security/audit operation map applied by a single wrapper; actor in a request context | `src/main/security/api-security-map.ts`, `secure()` at `limin-api-handlers.ts:213+`, `src/main/security/request-context-storage.ts:7-40`, `electron-principal-resolver.ts` | Audit only in the web dispatcher for `WRITE_TASK_TYPES`; ad-hoc `requireAdmin`; no actor on desktop | **Adopt** |
| L4 | Server refuses to start if any operation is unclassified | `src/web/server/capability-policy.ts:51-99,166-286`, `src/web/server.ts:339-350`, `src/shared/web-capabilities.ts` | Unknown method → 404 at request time | **Adopt**, as the parity manifest (§4.2) plus a startup assertion |
| L5 | Role-aware, per-session capability document; one renderer store; client refuses disallowed calls | `src/web/server/session-capabilities.ts:43-88`, `src/renderer/stores/transport-capability-store.ts:10-80`, `src/web/client/api.ts:171-196` | `database:capabilities` covers the backend only and fails open | **Adapt** (§4.3) |
| L6 | Explicit typed web client + test that it covers every handler method | `src/web/client/api.ts:163-339`, `tests/web-gate/web-client-api.test.ts:42-55` | Permissive Proxy | **Adopt** |
| L7 | `{ ok }` result envelope, closed error-code set, HTTP status mapping | `src/shared/api/api-result.ts:16-165`, `src/web/client/session-coordinator.ts:118-153` | `T \| SerializableError` by shape | **Adapt.** Keep `IpcResult`, add codes and the status map |
| L8 | File tokens for uploads; download routes run the same secured handler | `src/shared/import-file-source.ts`, `src/web/client/file-upload.ts:42-75`, `src/web/server/view-export-routes.ts`, `src/web/server/file-routes.ts:60-193`, `src/web/client/file-download.ts` | Upload staging exists (`routes/upload-staging.ts`); download is 501 | **Adopt** the download half |
| L9 | Every write must be audited or exempt with a reason | `audit-coverage-registry.ts` + test | Web-only audit tests | **Adopt**, folded into the manifest's `audit` field |
| L10 | Event stream revalidates the session and closes on revoke | `src/web/server/events.ts:25-34,97-121` | `src/web/server/events.ts` has no revalidation, heartbeat or replay | **Adopt** |
| L11 | Fast both-transports security smoke + role × capability matrix | `src/main/security/__tests__/transport-backend-security-smoke.test.ts`, `tests/web-gate/role-matrix.test.ts` | Heavy opt-in Electron+PG parity suite only | **Adapt** |
| L12 | Cheap web gates in default `make ci` | pre-push runs `make ci` including the web gate | Web gates opt-in (`VARLENS_WEB=1`) | **Adapt.** Move the parity manifest test into default `make test` |

**VarLens already has, and should keep:** zod contracts plus OpenAPI; typed per-domain IPC modules; cookie sessions with Fetch-Metadata CSRF (equivalent to Limin's `web/server/auth.ts:103-116,224-233`); a viewer-prefs-in-localStorage vs install-settings-on-server split; and live SSE push events (Limin only polls). Keep the push events as hints on top of a pollable jobs API.

---

## 4. Target architecture

```
renderer (Vue) ── window.api (typed WindowAPI) ──┬── Electron preload ── ipcMain ──┐
                                                 └── web client (typed, generated   │
                                                     from manifest) ── HTTP ────────┤
                                                                                     ▼
                         transport mount (IPC | Fastify)  → builds RequestContext{actor, runtime, signal}
                                                                                     ▼
                         secure(policy) wrapper: authz · zod validation · audit · timeout · error codes
                                                                                     ▼
                         create<Domain>Handlers({ session, platform, services })   ← ONE implementation
                                     │                 │                     │
                              StorageSession     PlatformPort         ReferenceServices
                            (SQLite | Postgres) (dialogs/files/     (VEP, HPO, PanelApp…
                                                 downloads/shell)    with egress policy)
```

### 4.1 One handler per method (L1, L2, L3)

- Each domain exports `create<Domain>Handlers(deps): <Domain>Handlers`, typed as `{ [M in keyof <Domain>DomainContract]: Handler }`. The existing `src/main/ipc/handlers/<domain>-logic.ts` modules are the starting point. Logic modules must not import `electron`; enforce this with an ESLint `no-restricted-imports` rule on `*-logic.ts` and `src/main/handlers-core/**`.
- `PlatformPort` covers everything that differs per runtime:
  - Desktop: `pickFile`, `pickSaveLocation`, `revealPath`, `openExternal`.
  - Web: `deliverArtifact(artifact)`, which saves via a dialog on desktop and registers a signed download URL on web.
  - Both: `resolveImportSource(source)`, where the source is a local path on desktop and an upload id on web.

  Desktop implementation: `src/main/platform/electron-platform.ts`. Web implementation: `src/web/server/platform/web-platform.ts`.
- `RequestContext` uses `AsyncLocalStorage` and carries `{ actor: { id, role }, runtime: 'desktop'|'web', signal }`. Desktop resolves a fixed local principal. Handlers read the actor (audit attribution, per-user scoping, cancel-own-job) from context, never from arguments.
- The IPC mount is `src/main/ipc/domains/<domain>.ts`, as today, and calls the factory.
- The HTTP mount becomes the generic dispatcher (`src/web/server/dispatcher.ts`) resolving `manifest[domain][method]` to the factory. `routes/*` overrides shrink to genuinely web-only transport concerns (upload staging, download, SSE). The `READ_TASK_TYPES` / `WRITE_TASK_TYPES` lists and the alias autoroutes that skip zod validation (`variants:filterOptions`, `cohort:query`, `cohort:summary`, `cohort:columnMeta`, `cohort:carriers`, `cohort:geneBurden`, `database:overview`) are removed.

### 4.2 Parity manifest: the single declaration of availability (L4, L9)

New file `src/shared/ipc/parity-manifest.ts`:

```ts
type WebPolicy =
  | { web: 'shared' }                                   // same handler, served over HTTP
  | { web: 'adapter'; via: 'upload' | 'download' | 'sse' | 'client' } // transport-specific shim
  | { web: 'desktop-only'; webUx: string }              // never reachable over HTTP; renderer must gate
  | { web: 'pending'; tracking: string; webUx: string } // temporary gap; ratcheted (may only shrink)

interface ChannelPolicy {
  policy: WebPolicy
  authz: 'public' | 'user' | 'admin'
  audit: 'write' | 'read' | { exempt: string }
  capability?: CapabilityPath            // feature flag the renderer gates on
}

export const PARITY_MANIFEST = { … } satisfies {
  [D in keyof WindowAPI]: { [M in keyof WindowAPI[D]]: ChannelPolicy }
}
```

- `satisfies` over the mapped type makes a new method without a policy a **typecheck failure**, and a stale entry an excess-property error (`03-best-practices.md` rec. 2).
- The web server asserts at startup that every `shared`/`adapter` method resolves to a handler and that no `desktop-only` method is mounted (L4). A failed assertion stops the server from starting.
- Today's gaps enter as `pending` with a tracking reference. `scripts/parity-baseline.json` records the pending count, and CI fails if it grows. This is the same ratchet as `scripts/agent-health-baseline.json`.

### 4.3 Capability document, role-aware and fail-closed (L5)

- Extend `database:capabilities` into a `system:capabilities` method that returns:

  ```
  { runtime: 'desktop'|'web', backend: 'sqlite'|'postgres', role, storage: StorageCapabilities,
    features: { [CapabilityPath]: { enabled: boolean, reason?: string } },
    limits: { uploadMaxBytes, exportMaxRows, … }, externalLookups: { enabled, providers[] } }
  ```

  The server computes it from the manifest, the backend, the session role and instance settings. It replaces the overlay in `src/web/server/routes/database.ts:5`.
- One Pinia store (`capabilityStore`) loads the document before the shell renders. `canUse(path)` returns **false while loading** (fail-closed), which reverses `backend-capabilities.ts:98`. The `reason` text drives the "not available in web" UX copy (owned by track 4).
- Remove every `typeof api.x.y === 'function'` detection, and every `isWebRuntime()` branch that encodes a *feature* decision rather than a *transport* detail. `isProteinViewerAvailable()` (`runtime-features.ts:17`), `AppSidebar.vue:24`, `AppToolbar.vue:122` and `ApplicationPreferences.vue:135` become capability reads.
- Generate a typed web client from the manifest (L6). Methods are explicit, so an undeclared method is a compile error. `desktop-only` methods throw locally with code `UNSUPPORTED_RUNTIME` and never reach the network. Every `on*` without a bridge is a typed error, not a silent no-op.

### 4.4 Error envelope (L7)

- Keep `IpcResult<T>` and `unwrapIpcResult`. Add a closed `ErrorCode` set: `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, `UNAUTHENTICATED`, `UNSUPPORTED_RUNTIME`, `UNAVAILABLE_UPSTREAM`, `CANCELLED`, `INTERNAL`.
- Add a single status map in the dispatcher: 400, 404, 409, 403, 401, 501, 502, 499/409, 500.
- `wrapHandler` (desktop) and the dispatcher (web) share one `toSerializableError()`, so a Postgres `23505` and a SQLite `SQLITE_CONSTRAINT_UNIQUE` both become `CONFLICT`.
- The renderer's `formatError()` always produces a string. This removes `[object Object]`.

### 4.5 Files, exports and jobs (L8, L10)

- **Uploads:** keep `routes/upload-staging.ts` and the `ImportSource = { kind: 'path', path } | { kind: 'upload', uploadId }` token. Desktop resolves paths; web resolves staged uploads. Multi-GB WGS uploads go to tus later (`03-best-practices.md` rec. 9). Note that `@fastify/multipart` silently truncates at its `fileSize` limit.
- **Exports:** a handler returns `ExportArtifact { name, mime, stream | path }`, and `PlatformPort.deliverArtifact` finishes the delivery:
  - Desktop: save dialog, then write.
  - Web: persist to a per-user artifact store with a TTL, then return a short-lived HMAC-signed `GET /api/download/:token`. The server streams it with `Content-Disposition: attachment` and the browser fetches it by navigation, not `fetch` + Blob (blob memory limits, rec. 7).

  Large cohort exports run as jobs.
- **Jobs:** a VarLens-owned Postgres `jobs` table (`id, owner, kind, state, progress, artifact_id, error, created_at`) with the `jobs:*` domain wired in web.
  - Polling is the source of truth.
  - SSE carries hints, adding `id:` + `Last-Event-ID` replay from a bounded ring, a 15 s heartbeat and session revalidation (L10).
  - Cancellation is by job id and checks the owner. This replaces the process-global `cancelImport()` that lets one user cancel another's import.
  - Desktop keeps worker threads behind the same `jobs:*` contract.

### 4.6 Desktop-only decisions (each needs an explicit web UX)

| Desktop concept | Web decision |
|---|---|
| Local DB file lifecycle (open/create/delete/recent/showInFolder) | Hidden. Single hosted workspace item (already done in `DatabasePicker.vue:20,301`). Manifest: `desktop-only` |
| SQLCipher key, rekey, migrateToEncrypted, recovery passphrase | Hidden. Encryption at rest is operator concern (PG TDE / disk); the About dialog states it |
| Postgres connection profiles | Hidden. The server's connection is operator config |
| Worker-thread count (`system.setWorkerThreads`) | Hidden for users. Optional admin instance setting for server import concurrency. The control is currently shown and silently no-ops |
| Auto-updater, `perf.*`, `debug.*`, `logs.onMessage` | Hidden. The About dialog shows web build version + server git SHA (fixes "Electron vweb") |
| Native file dialogs | Browser `<input type=file>` + upload token (done); downloads via signed URL (§4.5) |
| `shell.openExternal` / user link domains | `window.open` with the same URL validator; `shell.updateDomains` becomes a per-user setting (currently a silent no-op) |
| Local IGV broadcast (`http://localhost:60151`) | CSP blocks it today. Either add `connect-src http://localhost:60151 http://127.0.0.1:60151` behind an instance setting, or hide it with a reason. Decide in PR-W4 |

### 4.7 Settings scope

Tag every setting `user | instance | device` (`03-best-practices.md` rec. 12):

- **User:** presets, tags (shared vs private needs an owner + visibility flag), external-link domains, column layouts. In web, store these server-side per user.
- **Instance:** external-lookup egress policy, upload limits, import concurrency. Admin only.
- **Device:** theme, density, panel widths. Keep these in localStorage.

Desktop maps user and instance to the same local store.

### 4.8 External reference services in web

The services in `src/main/services/api/*` are pure HTTP clients. Construct them in the web server under a `ReferenceServices` facade with these controls:

1. Instance setting `externalLookups.enabled`, plus a per-provider allowlist. Sending variant coordinates to EBI, Broad or NCBI from a clinical server is a policy decision, so the default is **off with a visible reason**.
2. A Postgres-backed response cache shared across users.
3. Per-user rate limits.

HPO search does not need egress: serve it from the bundled ontology. The renderer already ships `useHpoBundled.ts`, so the fastest fix is a client-side `adapter` and the durable one is a server-side shared handler. The gene reference DB (`geneRef`) ships with the server image so that `validateSymbols`, `autocomplete`, `exportBed` and cohort gene-panel filters work. This replaces `src/web/stubs/gene-reference-loader-stub.ts`.

---

## 5. Gap list (ordered by user impact)

Severity: **P0** = wrong or lost clinical data, a security issue, or a core workflow unavailable. **P1** = major feature unusable. **P2** = degraded or confusing. **P3** = cosmetic or hardening. Overlap columns: **T4** (web-mode completeness: settings/admin/logout/theme/URL state, ACMG confirm/undo), **T5b** (PG pool, auth cache, audit batching, delete job, keyset paging), **T8** (web export hotfix).

| ID | Sev | Gap | Evidence | Fix (PR) | Overlap |
|---|---|---|---|---|---|
| P-01 | P0 | **Export unavailable in web.** Case and cohort CSV return 501, capability overlay sets `export.*=false`, panel BED returns 404. Even with fixtures, the export writes to the server tmpdir and returns a server path | crawl A-042, B-017, B-027; `routes/export.ts`, `routes/database.ts:5` | T8 unblocks variants/cohort; PR-W5 adds artifact + signed download + BED + job-backed large export | **T8** (hotfix), then PR-W5 generalises |
| P-02 | P0 | **No account controls in web.** No logout, no change-password and no user-management UI (`UserManagement.vue` mounted nowhere). `auth:createUser` returns 501 "single-tenant"; no role-change method; `auth:resetPassword` returns 200 for a non-existent user; deactivating an unknown user returns 500 | crawl C8/C9, api-probe | UI mount + logout: **T4**. Multi-user server (create, role, reset correctness, deactivate errors, role × capability matrix test): PR-W8 | **T4** (UI), PR-W8 (server) |
| P-03 | P0 (desktop) | **Desktop preload drops methods.** `src/preload/window-api/core-api.ts:109-128` omits `database.migrateToEncrypted`, `deletePlaintextBackup` and `setRecoveryPassphrase`, so `databaseStore.ts:202,216,227` calls `undefined`. `create: (path, password)` drops `setupPassphrase`. An `as WindowAPI['database']` cast hides all of it | static inventory §Desktop defects; verified by reading the source | PR-W1 (hotfix + per-method preload completeness test) | none |
| P-04 | P1 | **HPO term search returns 501.** Clinicians cannot add phenotypes to cases in web, so HPO matching never fires | crawl A-044; `HpoTermSelector.vue:111` | PR-W7a: bundled-ontology handler | T4 owns "not available" copy only |
| P-05 | P1 | **Gene panel tooling.** `geneRef.info` returns 501 on every manager open. `panels.validateSymbols`, `autocomplete`, `searchPanelApp`, `importPanelApp`, `generateStringDb` and `exportBed` return 404, so panels cannot be built in web. The gene-list editor accepts `NOTAGENE1` as recognised | crawl B-023..B-027 | PR-W7b: ship gene reference DB to the server; shared handlers; PanelApp/StringDB via ReferenceServices | none |
| P-06 | P1 | **Cohort query with gene panels may throw.** `PostgresCohortRepository.ts:683` calls `getGeneReferenceDb()`, which the web build stubs to throw | static; not reproduced empirically (crawl could not apply a panel) | PR-W7b; add an integration test first | none |
| P-07 | P1 (security) | **Import cancel is process-global.** `import.cancel` / `batchImport.cancel` cancel any user's running import | static `import.cancel` | PR-W6: cancel-by-job-id with owner check; interim one-line owner guard can ride PR-W4 | **T5b** (job infra) |
| P-08 | P1 | **ZIP batch import broken in web.** An unencrypted ZIP reports "password-protected": `testZipPassword` returns `{success:false}` and `extractZip` returns `[]` | crawl; `empirical/scripts/zip-probe.cjs` | PR-W9a (batch-import shared logic; ADR-0002 violation) | none |
| P-09 | P1 | **Variant enrichment.** `vep.fetch` returns 501; `myvariant.fetch` and `spliceai.fetch` return 404. The details panel shows errors | crawl A-027; `useVepEnrichment.ts:156` | PR-W7c (ReferenceServices + egress policy); until then gate via capabilities (PR-W3) | none |
| P-10 | P2 | **Conflicts surface as HTTP 500** "An unexpected error occurred": preset name, region-file name, duplicate import case name | crawl steps 22, regionFiles, import HG005 | PR-W4 (error codes, 409) | none |
| P-11 | P2 | **Ungated failures and fail-open gating.** A Proxy makes `typeof` detection always true; `canUseFeature` returns true while loading; `setWorkerThreads` and `shell.updateDomains` silently no-op; the association error shows `[object Object]` | static §Renderer gates | PR-W3 (capability store) + PR-W4 | **T4** ("not available" copy for HPO/protein/ClinVar, hide Worker Threads, About text) |
| P-12 | P2 | **Bulk case delete and delete-all disabled on Postgres** (`cases.deleteMany/deleteAll=false`). The menu item stays enabled and then shows a snackbar | crawl B-032 | After T5b's delete job: PR-W9b adds bulk/all on the same job | **T5b** (delete job) |
| P-13 | P2 | **No jobs surface in web.** `jobs:*` returns 404. The SSE hub is in-memory per process, has no heartbeat or replay, and never revalidates the session | static §Events; crawl C10 | PR-W6 | **T5b** (shares job table; T5b lands first) |
| P-14 | P2 | **Protein / lollipop / gnomAD viewer hidden in web** (`runtime-features.ts:17`); `protein.*` returns 501, `gnomad.*` 404 | crawl A-029 | PR-W7d | none |
| P-15 | P2 | **Cohort association** returns 501 with an ungated Run button | crawl B-016; `.planning/web/backlog/web-cohort-association-support.md` | PR-W3 gates it; PR-W13 implements on Postgres or records desktop-only | none |
| P-16 | P2 | **`audit.getByEntity` is admin-only in web**, so non-admin users get 403 in `ActivityLogPanel` | static | PR-W8 (entity-scoped read for owners) | T5b (audit batching) adjacent |
| P-17 | P2 | **No URL state.** Reload loses case, tab and filters | crawl C11 | **T4** | **T4** |
| P-18 | P2 (security) | **Alias autoroutes bypass zod** (`variants:filterOptions`, `cohort:query`, `cohort:summary`, `cohort:columnMeta`, `cohort:carriers`, `cohort:geneBurden`, `database:overview`) | static §Dead/alias routes | PR-W2 marks them; PR-W11 removes them | none |
| P-19 | P3 | **Multi-file VCF import menu hidden in web** (`AppSidebar.vue:24`, `AppToolbar.vue:122`) although `import.startMultiFile` is served; sibling BED discovery forced to `[]` | static | PR-W3 (capability instead of `isWebMode`) | T4 (web shell) adjacent |
| P-20 | P3 | **Local IGV broadcast blocked by CSP**, with no feedback | crawl A-039 | PR-W4 decision (§4.6) | none |
| P-21 | P3 | **`/api/openapi.json` and `/api/docs` served unauthenticated** | api-probe | PR-W11 (auth or instance flag) | none |
| P-22 | P3 | **`annotations.deleteGlobal` argument mismatch** (route passes `(chr,pos,ref,alt)`, executor expects `[coords]`). Latent: no UI caller | static | PR-W2 test exposes it; fix in PR-W11 | none |
| P-23 | P3 | **Orphan desktop emits** `cases:deleted` and `export:progress` have no subscriber | static | PR-W5 wires `export:progress` into jobs; drop `cases:deleted` | none |
| P-24 | process | **No completeness gate.** The parity E2E is stale (server-path import seeding), runs with fixtures ON, and the dispatcher tests lock 501s in | static §Existing parity tests | PR-W2 (gate) + PR-W12 (revive E2E with upload seeding, fixtures-off variant) | T6 (CI gates) adjacent |
| P-25 | P3 | Cohort view lacks the Inheritance / analysis-group filter that the case view has (cohort-parity rule, not a web gap) | crawl B-012 | Separate cohort-parity follow-up | T2/T3 own the table files |

---

## 6. The parity contract gate

**Requirement:** CI fails whenever a channel exists on desktop but has no web implementation and no explicit declaration. It has three layers, all in default `make test` and `make typecheck` with no Postgres or Electron needed.

1. **Typecheck (`make typecheck`).** `PARITY_MANIFEST satisfies { [D in keyof WindowAPI]: { [M in keyof WindowAPI[D]]: ChannelPolicy } }`. A missing or extra method fails compilation. The generated web client is typed `WindowAPI` with no casts.
2. **Unit test `tests/shared/ipc/parity-manifest.test.ts` (`make test`):**
   - Build the desktop `window.api` with `createWindowApi()` and a fake `ipcRenderer`. Assert that every manifest method is a function **and invokes a channel**. This would have caught P-03; it replaces the top-level-key-only check in `preload-contract.test.ts`.
   - Build the web dispatcher's resolution table, without a network, by importing the route registry and task tables:
     - every `shared`/`adapter` method resolves;
     - every `desktop-only` method does **not** resolve;
     - no resolvable route is missing from the manifest, which catches the alias routes.
   - Fastify `inject()` smoke over a mocked `StorageSession`: each `shared` method returns neither 404 nor 501. Each `pending` method's count is compared to `scripts/parity-baseline.json` and may only go down.
   - Every `audit: 'write'` method writes an audit row in the mocked session, and every `exempt` entry carries a reason (L9).
3. **Renderer gate lint:** a script, `scripts/parity/check-renderer-gates.mjs`, joined to `make agent-check`. Every renderer call site of a `desktop-only` or `pending` method must sit behind `capabilityStore.canUse(manifest[...].capability)`. It reuses the ts-morph setup already in `handler-seam.test.ts`.

The existing `dispatcher-adapters-*` assertions that pin 501s get rewritten to read the expected status from the manifest, so they stop locking gaps in. `tests/web-gate/handler-seam.test.ts` stops treating `unsupportedWebCapability` as a passing verdict.

Behavioural parity, meaning the same inputs give the same outputs on SQLite and Postgres, stays in the opt-in suite (PR-W12). It is revived with upload-staging seeding, run once with fixtures **off** (production truth), and scheduled nightly.

---

## 7. Coordination with in-flight tracks

| Track | Owns (do not duplicate here) | This program depends on / follows with |
|---|---|---|
| **T4** web-mode completeness | Web shell UI: logout, admin mount (`UserManagement.vue`), theme toggle + dark tokens, URL state, "not available in web" copy for HPO/protein/ClinVar, hiding Worker Threads, About text, ACMG confirm/undo | PR-W3 replaces T4's ad-hoc `isWebRuntime()` hides with capability reads after T4 merges (mechanical). PR-W8 provides the server side for T4's admin UI |
| **T5b** web/Postgres non-blocking backend | PG pool, auth cache, audit batching, case delete as a background job, keyset paging | PR-W6 generalises T5b's delete-job table into the `jobs` table and wires `jobs:*`. PR-W9b builds bulk delete on it. PR-W2's audit-coverage check must tolerate batched audit writes |
| **T8** web export hotfix | Unblocking `export.variants` / `export.cohort` past the parity-fixture gate in `routes/export.ts` | PR-W5 replaces the hotfix delivery with ExportArtifact + signed download and adds BED and job-backed large exports. It keeps T8's tests |
| **T6** CI quality gates | axe, Lighthouse CI, CLS/INP | PR-W2's gate is a plain vitest and should not conflict. PR-W12's nightly job reuses T6 workflow conventions |
| T1/T2/T3/T5a | Table/sort/layout/main-process workers | No overlap except PR-W10 (handler-factory migration) touching `src/main/ipc/handlers/*-logic.ts`; sequence after T5a merges |

---

## 8. Risks and decisions needed

1. **External-lookup egress from a clinical server (P-05, P-09, P-14).** This is a product and policy decision. The default is off with a visible reason; an admin enables providers. Owner: the user.
2. **Multi-user scope (P-02).** The server currently declares itself single-tenant. Enabling `createUser` needs a role model (admin/analyst/viewer) and per-user data ownership (presets, tags, comments are global today). The decision needed is whether case data is shared across users or owner-scoped.
3. **Migration cost of handler factories (§4.1).** This touches every domain. Mitigate by migrating one domain per PR with the manifest gate preventing regressions, starting with the domains that already have `*-logic.ts`.
4. **Gene reference DB in the server image.** This adds image size, measured at the size of the gene reference SQLite file, and needs an update path (`geneRef.update` is admin-only in web).
5. **Generated web client vs hand-written.** Generation from the manifest is preferred. If the codegen proves brittle, a hand-written client typed `satisfies WindowAPI` gives the same compile-time guarantee (Limin's approach, L6).

## 9. Acceptance criteria

- `PARITY_MANIFEST` exists, typechecks against `WindowAPI`, and the default `make test` includes the three-layer gate (§6).
- `pending` count at or below the baseline and strictly decreasing across the plan. The target at the end of the plan is 0 `pending`; everything else is `shared`, `adapter` or `desktop-only` with a `webUx`.
- Re-running `empirical/scripts/crawl*.cjs` against a built web instance gives 0 ERROR steps and 0 responses of 404 "unknown method" or 501. Remaining unavailable features show a capability reason.
- No `typeof window.api…` detection and no feature-deciding `isWebRuntime()` remain in `src/renderer`.
