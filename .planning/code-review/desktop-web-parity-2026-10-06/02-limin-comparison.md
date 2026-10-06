# Limin vs VarLens: how desktop and web stay in parity

Research date: 2026-10-06. This was read-only research. Nothing in `/home/bernt-popp/development/limin` was modified, built or installed.

- Limin root: `/home/bernt-popp/development/limin` (written as `L:` below)
- VarLens worktree: `/home/bernt-popp/development/VarLens/.claude/worktrees/agent-a441a5be6bf38012d` (written as `V:` below)

## TL;DR

Limin gets parity from one idea: **one transport-neutral handler object, `LiminApiHandlers`, built once by `createLiminApiHandlers(deps)` and bound twice.** Electron binds it channel by channel through `ipcMain.handle`. Fastify binds it through one generic `POST /api/:domain/:method` route. The two builds differ only in a small `LiminApiPlatformAdapters` object, which holds the dialog, shell and file-system operations.

Everything that matters for correctness happens inside that shared object, in its `secure()` wrapper:

- input validation
- RBAC (`AuthorizationService.decide`)
- access logging and write auditing
- statement-class deadlines
- actor attribution, read from an `AsyncLocalStorage` request context that each transport fills

On the web side, a **fail-closed capability policy** classifies every operation, generic action and dedicated route as allowed or denied for each deployment profile. The server **refuses to start** if anything is unclassified. The session endpoint then returns a list of capabilities (profile policy intersected with the role's RBAC), and the UI uses it to hide or degrade features.

VarLens shares the **storage layer** (`StorageSession` read and write executors) between IPC and HTTP, but **not the handler layer**:

- `src/main/ipc/handlers/*` and `src/web/server/routes/*` are written separately.
- Validation, events, audit and authorization are each duplicated or exist on one side only.
- The web client is a permissive Proxy, so nothing stops an unimplemented method from being called.
- No per-method inventory forces a desktop-only or web-only decision.

---

## Part 1: How Limin does it

### 1. Transport abstraction

**One client interface.** `LiminApi` (`L:src/shared/api-type.ts:75-...`) is the single typed surface the renderer uses. It is installed as `window.api` and has two implementations.

- **Electron preload** (`L:src/main/preload.ts`):
  - An explicit object literal typed `LiminApi` (`:21-149`).
  - Every method is `invoke(IPC_CHANNELS.X, ...)`.
  - It strips Vue proxies before the call (`toIpcPlain`, `:7-19`).
  - It is exposed with `contextBridge.exposeInMainWorld('api', api)` (`:151`).
  - It also exposes two file helpers: `getPathForFile` and `registerFileForUpload` (`:152-157`).
- **Web client** (`L:src/web/client/api.ts`):
  - `createWebLiminApi(): LiminApi` (`:163`) returns an explicit object, **not a Proxy**.
  - Each method is one of three things:
    - `rpc(domain, method)`: `POST /api/${domain}/${method}` with body `{args}` (`:177-212`).
    - `webUnsupported(...)`: throws `UnsupportedWebOperationError` locally (`:23-27`).
    - A browser-native replacement, for example `openExternalUrlInBrowser`, which allows https only (`:29-35`).
  - Example call sites: `auth.*` (`:220-230`), `settings.openLocalDocumentStorage` (`:304-305`), `diagnostics.exportBundle` (`:310`).
  - Before any RPC, `rpc()` checks the session's capability list and fails closed if the call is not listed (`:181-196`).

**Selection is decided at build time, by entry point.**
- `L:src/web/bootstrap.ts:19-31` sets `window.__LIMIN_WEB__ = true` and `window.api = createWebLiminApi({session})`, then dynamically imports `../renderer/main`.
- Electron's renderer receives `window.api` from the preload instead.
- The two builds use separate configs: `vite.web-renderer.config.ts` for web and `electron.vite.config.ts` for Electron.
- At runtime the renderer reads `window.api.platform` (`'web'` or `process.platform`). `L:src/renderer/composables/use-platform.ts:13-21` and `L:src/renderer/stores/transport-capability-store.ts:11` both do this.

**Guardrail on top.** Vue components must not call `window.api.*` directly. Data access goes through Pinia stores, which serve as "the migration seam" (`L:AGENTS.md`, Architecture Guardrails).

### 2. Single service layer, handlers registered once and exposed twice

**Shared handler factory.** `createLiminApiHandlers(deps: CreateLiminApiHandlersDeps): LiminApiHandlers` lives in `L:src/main/api/limin-api-handlers.ts:89`. Its doc comment (`:82-88`) says:

> "Build the transport-neutral callable LiminApi surface ... Used by both the Electron IPC adapter (src/main/ipc-handlers.ts) and the Fastify HTTP dispatcher (src/web). Input validation lives here so both transports are protected identically. This module must not import `electron`."

**Platform adapters are the only per-transport difference.**
- `LiminApiPlatformAdapters` (`:58-76`) is commented "Never widen these to whole LiminApi domains". It holds the per-operation hooks: `exportView`, `openExternalUrl`, `openLocalDocumentStorage`, `selectLocalDocumentStorageDirectory`, `diagnosticsExportBundle`, `archiveExport`, `archiveImportPreview`, `feedback*`.
- Electron implementation: `L:src/main/api/electron-adapters.ts:61` (`createElectronPlatformAdapters`), using `dialog` and `shell`.
- Web implementation: `L:src/web/server/web-adapters.ts:54-97` (`createWebPlatformAdapters`). Most methods throw `UnsupportedWebOperationError`, which maps to HTTP 501. `exportView` instead renders into a request-scoped `AsyncLocalStorage` sink (`:22-40`), which the download route then streams.

**`secure()` wrapper** (`L:src/main/api/limin-api-handlers.ts:213-...`). Every handler method is written as `secure('<domain>:<method>', args, cb)`. Examples are `entity:create` and `entity:get` (`:398-405`) and `view:*` (`:527-558`). For each call the wrapper:
- Looks up `API_SECURITY_MAP[operation]` (`L:src/main/security/api-security-map.ts:7-...`). Each entry declares the operation as `readable`, `writable` or `destructive`, gives its access-log category, and supplies a `targetFromArgs` deriver.
- Calls `authorizationService.decide(principal, action, target)`. A denial throws `ApiClientError({code:'FORBIDDEN'})` and is recorded with `accessLog.recordDenied`.
- Resolves the actor from `getRequestContext()` (`context-principal` attribution).
- Opens a write-access-log ticket before running the handler, closing it with `succeeded` or `failed`, and supports rollback hooks.
- Runs the handler inside `runWithStatementClass(statementClassFor(op))`. This sets per-class PostgreSQL `statement_timeout`; a timeout turns into `BUSY`.
- Records reads in the access log for sensitive entity types.

**Electron binding** (`L:src/main/ipc-handlers.ts:333-394`):
- `registerIpcHandlers` builds the handlers with the Electron adapters (`:334-347`).
- Its local `handle(channel, fn)`:
  - wraps `fn` in IPC diagnostics and the shutdown gate;
  - resolves the Electron principal (`resolveElectronPrincipal`);
  - builds `createRequestContext({transport:'electron', clientInstanceId: event.sender.id})`;
  - runs the handler with `runWithRequestContext` (`:352-394`).
- The bindings themselves are one-liners, for example `handle(IPC_CHANNELS.ENTITY_CREATE, (_e, input) => handlers.entity.create(input))` (`:412-414`).

**Web binding** (`L:src/web/server.ts:329-350`, `L:src/web/server/dispatcher.ts:103-199`):
- `server.ts` builds the same handlers with the web adapters.
- `registerApiDispatcher` registers one route, `POST /api/:domain/:method`. For each request it:
  - calls `requireSession`;
  - builds `createRequestContext({transport:'http'})` and runs inside `runWithRequestContext`;
  - checks `policy.checkHandler(\`${domain}:${method}\`, args)` and answers 403 on denial;
  - calls `resolveOwnMethod` (own properties only), answering 404 if there is no handler;
  - runs `wrapApiResult(await handler(...args))`;
  - streams the result with `sendJsonInSlices` (`:207-254`), which applies backpressure and a drain timeout.

**No per-feature channels.** Features register actions in an `ActionRegistry` (`L:src/main/services/action-registry.ts`; `register` at `:131`, `listActionKeys` at `:218`, `getAccessAction` at `:304`). They are reached through one generic `entity:action(entityType, action, payload)` channel. `AGENTS.md` makes this a rule: "Domain features must not add dedicated IPC channels, `LiminApi` sections, or preload wiring." The contract is described in `L:.planning/docs/architecture/feature-system.md`. The result is that the transport surface stays at about 60 operations while features keep growing.

### 3. Contract definition

- There is **no zod, no OpenAPI and no codegen**. `package.json` has neither zod nor any OpenAPI library.
- The contract is made of:
  - the TypeScript `LiminApi` interface (`L:src/shared/api-type.ts`);
  - the `IPC_CHANNELS` constants (`L:src/shared/ipc-types.ts`);
  - the operation-keyed `API_SECURITY_MAP` (`L:src/main/security/api-security-map.ts`);
  - the web operation lists in `L:src/shared/web-capabilities.ts`: `WEB_READONLY_HANDLER_OPERATIONS` (`:18-51`), `WEB_READONLY_ACTION_KEYS`, `WEB_SYNTHETIC_WRITE_*` and `WEB_*_ROUTE_CAPABILITY`. The comment there reads: "Keep these exact operation identifiers in shared code so renderer controls and the server policy cannot drift."
- Validation is hand-written, centralized and shared by both transports: `L:src/main/api/api-validation.ts` and `src/main/services/entity-query-validation.ts`.
- The operation key (`domain:method`) is the one identifier used across the IPC channel, the HTTP path, the security map, the capability policy, the statement-class policy and the audit coverage registry.

### 4. Capability negotiation (server-driven, not build-time flags)

**Server policy** (`L:src/web/server/capability-policy.ts`):
- `createWebCapabilityPolicy({profile, importUploads})` (`:166-266`).
- There are two profiles (`L:src/shared/web-capabilities.ts:6`):
  - `staging-readonly` is the default and fails closed;
  - `synthetic-pilot` allows writes only on a guarded synthetic database.
- It keeps explicit deny lists: `DENIED_HANDLER_OPERATIONS` (`:51-99`) covers startup, auth, diagnostics, archive and local-file operations, and `DENIED_ACTION_KEYS` (`:107-129`).
- Allowed and denied sets must not overlap (`assertDisjoint`, `:137-143`).
- **Every `API_SECURITY_MAP` operation must be classified, or construction throws** (`:211-217`).
- `checkHandler`, `checkAction` and `checkRoute` all answer `Unclassified ...` (denied) for anything unknown (`:220-256`).

**Startup inventory.**
- `assertWebCapabilityInventory(policy, {handlerOperations, actionKeys, routeCapabilities})` (`:268-286`) is called in `L:src/web/server.ts:339-350`.
- It enumerates `Object.entries(handlers)` plus `actionRegistry.listActionKeys()` plus every dedicated route.
- **The server refuses to boot if any one of them is unclassified.**

**Per-session capabilities.**
- `describeWebSessionCapabilities` (`L:src/web/server/session-capabilities.ts:43-88`) intersects the profile policy with `AuthorizationService.decide` for the account's role.
- It returns `{operations, actions, routes, domainReadOnly, domainReadOnlyReason: 'role'|'workspace', manageAccounts, profile}`.
- This is attached to the identity on each request (`L:src/web/server/auth.ts`, `request.webIdentity = {account, capabilities}`), and the client fetches it from `/auth/session` (`L:src/web/client/session-coordinator.ts:186`).
- The client detects a role or capability change by fingerprint and resets state (`:188-193`).

**UI degradation.** `L:src/renderer/stores/transport-capability-store.ts:10-80` is described as "UI hints ... the server remains the enforcement boundary". It exposes:
- `readOnly`, `canMutate` and `domainReadOnlyReason`;
- `can('domain:method')` and `canAction('Type:action')`;
- `canUseDesktopFiles`, which is false on the web;
- `canTrackDbJobs`;
- `fileDelivery: 'open'|'download'`;
- `canExportWorkbook`, which checks `routes.includes('_export:view')`;
- `importUploadBlockedReason: 'role'|'unavailable'`.

In Electron, everything collapses to `!readOnly`. The client itself also fails closed until the identity has loaded (`L:src/web/client/api.ts:171-196`).

### 5. Contract and parity tests (both transports)

- **Web client covers every handler:** `L:tests/web-gate/web-client-api.test.ts:42-55`, "binds every operation of the shared handler surface". It builds `createLiminApiHandlers(...)`, enumerates `domain:method`, and asserts that `createWebLiminApi()` has a function for each one, either RPC or an explicit local refusal. The comment cites #80 M3.
- **Policy classification:**
  - `L:src/web/server/__tests__/capability-profiles.test.ts`: "classifies every API security map operation" (`:129`) and "treats unclassified operations as denied" (`:119`).
  - `capability-policy.test.ts` checks that an unclassified route fails the inventory.
- **Role × capability matrix:** `L:tests/web-gate/role-matrix.test.ts:46-...` covers both profiles and the four roles admin, researcher, auditor and readonly. It uses the real app container and the real dispatcher.
- **Same handlers, both transports, both backends:** `L:src/main/security/__tests__/transport-backend-security-smoke.test.ts`:
  - `logs sensitive Electron reads on SQLite` (`:273`);
  - Electron on PostgreSQL (`:310`);
  - HTTP on PostgreSQL (`:334`).
  - It mocks `ipcMain.handle` and calls the real `registerIpcHandlers` and `registerApiDispatcher`.
- **Audit coverage registry:** `L:src/main/services/audit/audit-coverage-registry.ts` with `audit-coverage.test.ts:165-187`. Every write operation and every action key must be either `audited` (with a fixture that proves exactly which audit rows it writes) or `exempt` (with a reason).
- **Static boundary gates:**
  - `L:tests/web-gate/electron-leak.test.ts`: no Electron in core, shared, web, container or handler code.
  - `browser-import-boundary.test.ts`: `src/main` stays out of the web client and renderer.
  - `scripts/web/verify-web-bundle.mjs`: gzip and route-chunk budgets.
- **Repository parity across backends:** `L:src/main/database/__tests__/repository-parity.ts` (`describeRepositoryParity`).
- **CI wiring:**
  - `pnpm web:gate` = `web:build` + `verify-web-bundle` + `vitest tests/web-gate`.
  - `make ci` runs every job of `.github/workflows/check.yml` locally, including the "web gate" and "PostgreSQL session acceptance" jobs, and the pre-push hook enforces it (`L:AGENTS.md` "Verification and CI").
  - Playwright has separate configs: `config/test/playwright.e2e.config.ts` for Electron `_electron`, and `config/test/playwright.web.config.ts`. The web config's projects are `development-mock`, `-populated`, `-import`, `staging-readonly`, `synthetic-pilot`, `demo-rehearsal` and the user-guide projects.
  - The web "mock" is the **real server** against a seeded PostgreSQL plus an S3 stack (`scripts/dev/web-mock-server.mjs`). It is not a JS stub.

### 6. Files: upload, download, export, dialogs

- **Opaque-token symmetry.** Desktop and web both turn a file into an opaque token, and the token is consumed by the same generic action (`_file:store`, or import with a `stagedUpload` source).
  - Desktop: `registerFileForUpload(file)`, then `webUtils.getPathForFile`, then IPC `FILE_REGISTER_LOCAL_UPLOAD`, then `localFileUploadPathStore.register(path)`, which returns a token (`L:src/main/preload.ts:153-157`, `L:src/main/ipc-handlers.ts:402-410`).
  - Web: `uploadWebFile(file, workspaceId)` streams the raw body (`application/octet-stream`, file name in the `x-limin-file-name` header) to `POST /api/file-uploads`. It uses XHR for upload progress, and the server checks session, origin, role, size and content, then issues the token (`L:src/web/client/file-upload.ts:42-75`; server side `L:src/web/server/file-upload-routes.ts`).
  - The source union lives in `L:src/shared/import-file-source.ts:1-8`: `{kind:'localPath'} | {kind:'bytes'} | {kind:'stagedUpload', token}`.
  - Import bytes are swapped for a staged token transparently inside the web client. The upload happens once per buffer and workspace, and is retried once if the token has expired (`L:src/web/client/api.ts:86-150`).
  - `assertJsonRpcSerializable` blocks raw bytes from ever travelling over JSON RPC (`:8-21`).
- **Downloads.**
  - `GET /api/files/open` (attachment) and `/api/files/preview` (inline) in `L:src/web/server/file-routes.ts:192-193`. Both are guarded by `checkRoute('_file:download')`, refuse non-`fetch` `Sec-Fetch-Dest` values (`:88-93`), and use RFC 5987 `content-disposition`.
  - The client fetches the file into a Blob and triggers it with an `<a download>` (`L:src/web/client/file-download.ts:24-53`).
- **View export.** `POST /api/view-exports` (`L:src/web/server/view-export-routes.ts`) runs the **same secured `export:view` handler** inside `runWithWebExportSink`, then streams the result. The client is `L:src/web/client/view-export.ts`. Exports are synchronous and size-capped (`VIEW_EXPORT_MAX_ROWS`). There are **no signed URLs, no tus or multipart, and no background-job-produced downloads**.
- **Native dialogs.** These appear only behind `LiminApiPlatformAdapters` on the server side, or as `webUnsupported` on the client. The renderer branches on `fileDelivery: 'open'|'download'` and `canUseDesktopFiles`.

### 7. Auth, sessions and roles; the actor in services

- **Web sessions.**
  - Cookie: `@fastify/secure-session` named `__Host-limin.sid` in production, with `httpOnly`, `secure`, `sameSite:'strict'` and a 4-hour lifetime (`L:src/web/server/auth.ts:224-233`).
  - Each request resolves a DB-backed token through `accounts.resolveIdentity(token, {touch})`. Only `/api/` traffic touches the session; `/api/events` and assets do not.
  - Login is rate-limited (`@fastify/rate-limit`, `auth-attempt-limiter.ts`).
  - CSRF uses Fetch Metadata: `Sec-Fetch-Site` is the primary signal, `Origin` is the fallback, and having neither fails closed. It applies to all unsafe methods (`L:src/web/server/auth.ts:103-116`, applied at `:461-468`).
  - The SSE stream is closed on session or principal revocation (`L:src/web/server/events.ts:25-34`).
- **Desktop user.**
  - In `disabled` security mode it uses a synthetic principal, `local-dev` with role admin (`L:src/main/security/request-context.ts:36-42`).
  - Otherwise it uses a real principal from Electron profile auth (owner setup, password, trusted-device unlock, recovery key), resolved by `L:src/main/security/electron-principal-resolver.ts:12-30`.
  - The `auth.*` LiminApi domain exists for Electron only; it is `webUnsupported` on the web and denied by policy.
- **Roles:** admin, researcher, auditor and readonly, enforced in `L:src/main/security/authorization-service.ts`.
- **How services receive the actor.**
  - Through `AsyncLocalStorage`: `runWithRequestContext`, `getRequestContext` and `requestActorId()` in `L:src/main/security/request-context-storage.ts:7-40`. The doc reads: "Inside a request the authenticated principal always wins, so a client cannot choose the recorded author".
  - Neither transport passes the actor as an argument.
  - `runOutsideRequestContext` is used for shared or background work.

### 8. Settings persistence

- **Per install / per deployment:** `AppShellSettingsService` stores a JSON file under `userDataPath` (`L:src/main/services/app-shell-settings-service.ts:13-29`). It holds startup mode, default workspace, locales and browser-locale detection, and is exposed as `settings:getAppShell` / `saveAppShell` on both transports. On the web the file belongs to the server, so the setting is deployment-wide and only admins can save it.
- **Per workspace:** workspace profiles and type configuration live in the DB (`types:*`). Saved views also live in the DB.
- **Per viewer:** browser `localStorage`, not synced:
  - theme: `limin:theme` (`L:src/renderer/theme-preference.ts:3`), applied before first paint in `L:src/web/bootstrap.ts:8`;
  - column and filter view preferences: `L:src/renderer/view-preferences/storage.ts`, keyed by workspace;
  - dashboard layout, sidebar state, recent workspaces.
- There is no server-side per-user preference sync.

### 9. Background jobs

- **Desktop DB jobs.** `L:src/main/db-jobs/*` runs a worker-thread job host with a write lease and a single job slot. It is exposed only through generic actions: `DbJob:list` and `DbJob:cancel` (`L:src/shared/db-job-types.ts:1-40`).
- **Progress by polling, with a server-dictated interval.** `DbJobListResult.pollAfterMs`, used in `L:src/renderer/stores/db-job-store.ts:25-60`. The job snapshot carries `phase` and `cancellable`.
- **Cancellation is cooperative** and refused while `writing`.
- **Web.** `DbJob:*` is denied (`capability-policy.ts:108-109`) and `canTrackDbJobs = !web`. Heavy web work runs synchronously on a compute worker pool (`L:src/main/compute/*`) with admission control, and returns `BUSY` with `Retry-After` when saturated.
- **SSE carries no data.** `/api/events` only sends heartbeats and closes on revocation. The preload exposes **no** `ipcRenderer.on` subscriptions. Limin is strictly request/response on both transports.
- **Durable server-side events.** `DataEvent` (`L:.planning/docs/architecture/data-event-system.md`) is claimed with `FOR UPDATE SKIP LOCKED`. A web runtime lease admits one server per schema (`L:.planning/docs/architecture/web-multi-user-write-policy.md`).

### 10. Error model

- **Envelope:** `ApiResult<T> = {ok:true,data} | {ok:false,error:ApiErrorBody}` (`L:src/shared/api/api-result.ts:36`).
- **Closed set of codes:** `ApiErrorCode` = BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, UNSUPPORTED, INTERNAL, BUSY, REASON_REQUIRED (`:16-26`).
- **Error body:** optional `fields` plus coded `issues: ValidationIssue[]` that the renderer translates.
- **Error classes:** `ApiClientError`, `ApiValidationError extends TypeError`, `UnsupportedWebOperationError`.
- **Serialization:** `serializeApiError` (`:92-137`) maps BUSY and limit codes, and redacts INTERNAL messages on the web. `httpStatusForApiError` (`:139-160`) maps codes to statuses, for example UNSUPPORTED→501 and BUSY→503.
- **On the web** the dispatcher returns the envelope. The session coordinator calls `unwrapApiResult` and throws `ApiClientError` (`L:src/web/client/session-coordinator.ts:118-153`).
- **On IPC** errors are *thrown*, because Electron serializes the message. Coded issues are encoded into the message (`encodeValidationIssues`, `L:src/main/ipc-handlers.ts:376-391`).
- Either way, the renderer sees a thrown error with a code. The envelope is fully explicit on HTTP and normalized at the edge on IPC.

### 11. Other notable points

- **Audit and access logs** are written in `secure()` for both transports, attributed to the context principal, with an audit coverage registry test.
- **Concurrency policy** is documented in `L:.planning/docs/architecture/web-multi-user-write-policy.md`. It covers row locks, same-field `CONFLICT` with `base`/`baseAbsent`, an `IdempotencyGuard` keyed per principal, advisory locks for imports and merges, and per-class `statement_timeout`.
- **Database:** a `DatabaseSession` abstraction with SQLite and PostgreSQL implementations and a `DatabaseCapabilities` descriptor (`L:src/main/database/session.ts`, `session-factory.ts`). Desktop can also use a PostgreSQL profile. Web is PostgreSQL plus S3 object storage only.
- **Router:** hash history (`createWebHashHistory`, `L:src/renderer/main.ts:101`), so the same URL scheme works in Electron and on the web. A route-chunk load failure triggers a protected session check (`isRouteImportFailure`, `L:src/web/client/api.ts:45-51`).
- **Large results:** responses are JSON-sliced and streamed with backpressure, and request body bytes are counted (`L:src/web/server/dispatcher.ts:89-102,207-332`).
- **Logging:** renderer diagnostics are forwarded over IPC (`diagnostics:forwardRendererEvent`). That operation is denied on the web, which uses Fastify/pino with a request ID.

---

## Part 2: VarLens today (brief)

- **Transport.**
  - Typed `WindowAPI` (`V:src/shared/types/api.ts`), assembled from domain contracts such as `V:src/shared/ipc/domains/cases.ts:4-13`, which returns `Promise<IpcResult<T>>`.
  - The preload binds each domain separately (`V:src/preload/domains/cases.ts:4-13`).
  - The web client is a **permissive `Proxy`** that turns any `window.api.<d>.<m>()` into `POST /api/<d>/<m>` (`V:src/web/client/api.ts:1-20,97-121, ~355-380`). It has special cases for SSE-bridged `on*` subscribers (import progress, batch-import, variants:annotationChanged, cohort:summaryRebuilt) and for `shell.openExternal`.
  - Runtime detection uses `window.__VARLENS_WEB__` (`V:src/renderer/src/utils/runtime-mode.ts`).
- **Service layer.**
  - The shared seam is `StorageSession` (`V:src/main/storage/session.ts:7-25`), with read, write and import executors. `PostgresStorageSession` and the SQLite session implement it.
  - The **handler layer is not shared**:
    - IPC side: `V:src/main/ipc/domains/*.ts` delegate to `V:src/main/ipc/handlers/*.ts`, which do zod validation and `wrapHandler` (for example `handlers/cases.ts:77-87`).
    - Web side: `V:src/web/server/dispatcher.ts:245-421` resolves (1) per-domain **overrides** from `V:src/web/server/routes/*.ts`, then (2) read-task autoroute, then (3) write-task autoroute against `V:src/web/server/task-types.ts`.
    - The overrides re-implement validation, for example `routes/cases.ts:15-22` re-parses `CaseIdSchema` and returns an ad-hoc `{error:'invalid-case-id'}`. They also publish SSE events by hand.
- **Contract.**
  - VarLens has **zod** schemas (`V:src/shared/types/ipc-schemas.ts`, `V:src/shared/api/schemas/*.ts`), and `fastify-type-provider-zod` produces OpenAPI (`V:src/web/server/routes/openapi*.ts`). Limin has none of this.
  - The generic dispatcher route is `hide:true` in OpenAPI.
- **Capabilities.**
  - `database:capabilities` returns `StorageCapabilities` (backend features), and the web override switches export off (`V:src/web/server/routes/database.ts:5-23`).
  - The renderer reads it through `V:src/renderer/src/utils/backend-capabilities.ts` (`CapabilityPath`).
  - Runtime-only features are **client-side flags** (`V:src/renderer/src/utils/runtime-features.ts`, for example `isProteinViewerAvailable = !isWebRuntime()`).
  - There is no role-aware, per-session capability list.
- **Error model.**
  - `IpcResult<T> = T | SerializableError`, recognized by a **structural sniff** for `code`, `message` and `userMessage` (`V:src/shared/types/errors.ts:21-44`). There is no discriminant.
  - The web dispatcher returns the raw result or a `SerializableError` with a status. Some overrides return non-`SerializableError` shapes.
- **Authorization and audit.**
  - Roles are `admin` and `user` (`V:src/web/server/platform-identity.ts:105`), with an ad-hoc `requireAdmin` (`V:src/web/server/routes/guards.ts`) and `PRE_ROTATION_ALLOWED` (`dispatcher.ts:78`).
  - Web reads and writes are audited **inside the web dispatcher only** (`V:src/web/server/audit.ts`, dispatcher `:330-410`).
  - There is no request-context/`AsyncLocalStorage` actor anywhere in `src/`.
- **Events.** `WebEventHub` is an in-memory per-user pub/sub over SSE (`V:src/web/server/events.ts:10-62`), versus `ipcRenderer.on` on desktop. There is no shared event contract beyond a five-line `web-event-types.ts`.
- **Files.**
  - Upload staging exists (`V:src/web/server/routes/upload-staging.ts`, `VARLENS_WEB_UPLOAD_DIR` and TTL in `V:.planning/web/context/runtime-contract.md:31-33`).
  - Browser downloads and export are still backlog (`V:.planning/web/backlog/web-browser-upload-and-downloads.md`).
- **Parity tests.**
  - `V:tests/web-gate/handler-seam.test.ts:204-...` works at **domain-file** level: shared ↔ preload ↔ main, an audited override-module list, no direct PG access in overrides, and `PENDING_SHARED_LOGIC_EXTRACTION` must only shrink.
  - Behavioral parity: `V:tests/web-gate/parity/ipc-fixture-parity.test.ts` plus the `parity/ipc/*.ts` scenarios run Electron and web side by side against PostgreSQL.
  - All web gates are **opt-in** (`V:tests/web-gate/README.md`: "do not run during default `make ci`"; `Makefile` targets `web-gate-*` and `VARLENS_WEB=1`).

---

## Part 3: Comparison table

| Pattern | Limin (file paths) | VarLens today (file paths) | Adopt? | Rationale |
|---|---|---|---|---|
| One typed client interface, two implementations | `L:src/shared/api-type.ts` (`LiminApi`); `L:src/main/preload.ts:21-151`; `L:src/web/client/api.ts:163-339` | `V:src/shared/types/api.ts` + `V:src/shared/ipc/domains/*`; `V:src/preload/domains/*`; `V:src/web/client/api.ts` (Proxy) | **adapt** | VarLens already has the typed interface. Replace the permissive Proxy with an explicit object typed `WindowAPI`, built from per-domain web factories that mirror `src/preload/domains/*`, so tsc enforces web coverage. |
| Transport chosen by entry point, `platform` marker | `L:src/web/bootstrap.ts:19-31`; `use-platform.ts` | `V:src/web/bootstrap.ts`, `install-api.ts`, `__VARLENS_WEB__` | **already-have** | Same model. |
| Store-only `window.api` access (migration seam) | `L:AGENTS.md` guardrail; `L:src/renderer/stores/*` | Mixed; composables and components call `window.api` | **adapt** | Route web-sensitive calls through stores and composables. Add a lint or test that bans `window.api` in `.vue` files. |
| Single transport-neutral handler object, built once and bound twice | `L:src/main/api/limin-api-handlers.ts:82-89`; `L:src/main/ipc-handlers.ts:333-414`; `L:src/web/server.ts:329-337` | Shared only at `StorageSession` (`V:src/main/storage/session.ts`); handlers duplicated (`V:src/main/ipc/handlers/*` vs `V:src/web/server/routes/*`) | **adopt** | This is the biggest gap. Today validation, events and audit live in two places. Extract `createVarlensApiHandlers(deps)` per domain, with no Electron imports. Bind it from `src/main/ipc/domains/*` and mount it under the web dispatcher. This retires most overrides and the `PENDING_SHARED_LOGIC_EXTRACTION` list. |
| Narrow per-operation platform adapters | `L:src/main/api/limin-api-handlers.ts:58-76`; `L:src/main/api/electron-adapters.ts:61`; `L:src/web/server/web-adapters.ts:54-97` | Dialogs, `showItemInFolder` and export paths are inlined in IPC handlers | **adopt** | Isolates the only real desktop/web difference (dialogs, shell, file paths) and keeps the shared handlers pure. |
| `secure()` wrapper: RBAC + access log + audit + timeouts in one place | `L:src/main/api/limin-api-handlers.ts:213-...`; `L:src/main/security/api-security-map.ts` | Audit only in the web dispatcher (`V:src/web/server/audit.ts`); `requireAdmin` ad hoc; no desktop authz | **adopt** | One declarative `domain:method → {access, target, auditCategory}` map gives the same audit trail on desktop and web. This matters for a clinical tool. |
| Request context via `AsyncLocalStorage` (actor, transport, request ID) | `L:src/main/security/request-context-storage.ts:7-40`; `request-context.ts:6-69` | None. The web reads `request.session.user` in overrides; desktop has no actor | **adopt** | Services get the actor without signature churn, and clients cannot spoof `created_by`. Desktop uses a synthetic local principal. |
| Generic action dispatch instead of per-feature channels | `L:src/main/services/action-registry.ts`; `entity:action`; `L:.planning/docs/architecture/feature-system.md` | About 29 IPC domains, each with its own channels | **not-applicable** (partially) | VarLens's domain-module pattern is deliberate and typed. Keep it, but generate the web binding from the same contract rather than hand-writing overrides. |
| Contract schemas / OpenAPI | None (TS interface + hand validators) | zod `ipc-schemas` + `src/shared/api/schemas/*` + OpenAPI (`V:src/web/server/routes/openapi*.ts`) | **already-have** (VarLens ahead) | Keep zod as the single validator, and call it inside the shared handler so both transports validate identically. |
| Fail-closed web capability policy plus startup inventory | `L:src/web/server/capability-policy.ts:166-286`; `L:src/web/server.ts:339-350` | `V:src/web/server/task-types.ts` allowlist + overrides; unknown method → 404; no explicit desktop-only list | **adopt** | Every `domain:method` must be classified as web-allowed, web-denied (desktop-only) or web-only, and the server refuses to boot otherwise. This turns "accepted divergence" in `V:tests/web-gate/README.md` into an explicit, reviewable list. |
| Per-session, role-aware capability list from the server | `L:src/web/server/session-capabilities.ts:43-88`; `L:src/renderer/stores/transport-capability-store.ts` | `database:capabilities` (backend features only, `V:src/web/server/routes/database.ts`); client flags `V:src/renderer/src/utils/runtime-features.ts` | **adapt** | Extend `database:capabilities` (or add `session:capabilities`) to return `{operations, routes, readOnly, reason}`, and feed it into one Pinia `transportCapabilityStore`. This removes scattered `isWebRuntime()` checks. |
| Client-side fail-closed guard before RPC | `L:src/web/client/api.ts:171-196` | The Proxy forwards anything | **adopt** | No pointless 404s or 501s in the console, and a typed `UNSUPPORTED` error that the UI can handle. |
| Test: the web client binds every handler operation | `L:tests/web-gate/web-client-api.test.ts:42-55` | `V:tests/web-gate/handler-seam.test.ts` (domain-file level only) | **adopt** | Cheap, per-method guard. Run it in default `make test`, not only behind the opt-in gate. |
| Same-handler, both-transports, both-backends security smoke | `L:src/main/security/__tests__/transport-backend-security-smoke.test.ts` | `V:tests/web-gate/parity/*` (behavioral, opt-in, needs Electron + PG) | **adapt** | Add a fast in-process test that calls one handler set through a mocked `ipcMain` and through `fastify.inject`, then compares results and audit rows. Keep the heavy Electron parity suite for nightly or opt-in runs. |
| Role × capability matrix test | `L:tests/web-gate/role-matrix.test.ts` | Not present (two roles) | **adapt** | Becomes worthwhile once there are more than two roles or a read-only web profile. |
| Audit coverage registry (every write is audited or exempt with a reason) | `L:src/main/services/audit/audit-coverage-registry.ts` + `audit-coverage.test.ts` | `V:tests/web-gate/audit-shape.test.ts`, `dispatcher-audit-gating.test.ts` (web only) | **adopt** | Gives a provable audit trail across both transports. |
| Discriminated `{ok}` result envelope + closed error codes + HTTP mapping | `L:src/shared/api/api-result.ts:16-165` | `IpcResult<T> = T \| SerializableError` structural sniff (`V:src/shared/types/errors.ts:21-44`); ad-hoc override error shapes | **adapt** | Keep `SerializableError`, but put it on the wire as `{ok:false,error}`. Add `UNSUPPORTED`/`BUSY`/`FORBIDDEN`/`CONFLICT` codes and an `httpStatusFor(code)`. Have `unwrapIpcResult` accept both shapes during migration. This removes false positives from the structural sniff. |
| Opaque-token file sources (`localPath` / `bytes` / `stagedUpload`) | `L:src/shared/import-file-source.ts:1-8`; `L:src/web/client/api.ts:86-150`; `L:src/web/client/file-upload.ts`; `L:src/main/preload.ts:153-157` | Upload staging exists (`V:src/web/server/routes/upload-staging.ts`); ref passed to import | **adapt** | Unify desktop file paths behind the same token type (register path → token), so import handlers have one signature for both transports. |
| Browser downloads via the same secured handler + request-scoped sink | `L:src/web/server/web-adapters.ts:22-82`; `L:src/web/server/view-export-routes.ts`; `L:src/web/client/view-export.ts` | Backlog (`V:.planning/web/backlog/web-browser-upload-and-downloads.md`); web export disabled | **adopt** | A direct template for VarLens's pending variant and cohort export downloads: run the shared export handler, stream into a `Content-Disposition` response, then Blob + `<a download>`. |
| File-route hardening (`Sec-Fetch-Dest`, RFC 5987 names) | `L:src/web/server/file-routes.ts:60-93` | n/a yet | **adopt** (with downloads) | Low cost and prevents previews from being used as a page. |
| Cookie session + Fetch-Metadata CSRF | `L:src/web/server/auth.ts:103-116,224-233` | `V:src/web/server/auth.ts:116-245` (origin + sec-fetch-site, `__Host-`) | **already-have** | Equivalent. |
| Jobs: polling with server-dictated `pollAfterMs` vs push | `L:src/shared/db-job-types.ts`; `L:src/renderer/stores/db-job-store.ts` | IPC events + SSE hub (`V:src/web/server/events.ts`); `jobs:` read API (`V:src/shared/ipc/domains/jobs.ts`) | **adapt** | Make `jobs:list/get/progress` (with `pollAfterMs`) the canonical, transport-neutral progress path, and keep SSE and IPC events only as "poll now" hints. Then the web in-memory hub is not a correctness dependency. |
| SSE closes on session revocation | `L:src/web/server/events.ts:25-34,97-121` | No revalidation in `V:src/web/server/events.ts` | **adopt** | Small security fix: a revoked session should not keep receiving events. |
| Per-viewer prefs in `localStorage`, install/deployment settings server-side | `L:src/renderer/theme-preference.ts`; `L:src/main/services/app-shell-settings-service.ts` | `V:src/renderer/src/stores/settingsStore.ts`, `useColumnPreferences.ts` (`localStorage`) | **already-have** | Same split. Consider a per-user DB-backed preference table later if multi-device web use matters. |
| Streamed JSON responses with backpressure for big results | `L:src/web/server/dispatcher.ts:207-332`; `json-slices.ts` | `V:src/web/server/compression.ts` | **adapt** | Useful for large variant pages and cohort queries on PostgreSQL. |
| Hash router shared by both shells | `L:src/renderer/main.ts:101` | Vue Router (same renderer) | **already-have** | No change needed. |
| Web gates part of the default pre-push `make ci` | `L:AGENTS.md` (pre-push runs `make ci` incl. web gate) | Opt-in (`VARLENS_WEB=1`, `V:tests/web-gate/README.md`) | **adapt** | Move the cheap static gates (client binding, capability inventory, electron-leak) into default `make test`. Keep the heavy PG and Electron parity runs opt-in. |

## Top 8 patterns VarLens should adopt

1. **A transport-neutral handler factory, built once and bound twice.**
   - `L:src/main/api/limin-api-handlers.ts:82-89`, `L:src/main/ipc-handlers.ts:333-414`, `L:src/web/server.ts:329-337`, `L:src/web/server/dispatcher.ts:103-199`.
   - Build per-domain handlers on `StorageSession` with zod validation inside. IPC domains and the web dispatcher become thin bindings, which retires `src/web/server/routes/*` overrides.
2. **Narrow platform adapters for dialogs, shell and file paths.**
   - `L:src/main/api/limin-api-handlers.ts:58-76`, `L:src/main/api/electron-adapters.ts:61`, `L:src/web/server/web-adapters.ts:54-97`.
3. **A declarative security/audit map plus a `secure()` wrapper with an `AsyncLocalStorage` request context.**
   - `L:src/main/security/api-security-map.ts`, `limin-api-handlers.ts:213+`, `L:src/main/security/request-context-storage.ts:7-40`, `L:src/main/security/request-context.ts`, `L:src/main/security/electron-principal-resolver.ts`.
   - Gives the same RBAC, audit and actor on desktop and web.
4. **A fail-closed web capability policy with a startup inventory**, where every `domain:method` is explicitly web-allowed or desktop-only.
   - `L:src/web/server/capability-policy.ts:51-99,166-286`, `L:src/web/server.ts:339-350`, `L:src/shared/web-capabilities.ts`.
5. **A server-issued, role-aware session capability list consumed by one renderer store.**
   - `L:src/web/server/session-capabilities.ts:43-88`, `L:src/renderer/stores/transport-capability-store.ts:10-80`, `L:src/web/client/api.ts:171-196`.
   - Replaces `runtime-features.ts` flags and permissive-Proxy 404s.
6. **An explicit typed web client plus a test that it binds every handler operation.**
   - `L:src/web/client/api.ts:163-339`, `L:tests/web-gate/web-client-api.test.ts:42-55`.
   - Add a fast in-process both-transports smoke modelled on `L:src/main/security/__tests__/transport-backend-security-smoke.test.ts`.
7. **A discriminated result envelope with a closed set of error codes and HTTP status mapping.**
   - `L:src/shared/api/api-result.ts:16-165`, `L:src/web/client/session-coordinator.ts:118-153`, `L:src/main/ipc-handlers.ts:376-391`.
   - Replaces the structural `T | SerializableError` sniff and the ad-hoc override error bodies.
8. **Token-based file I/O and download routes that run the same secured handler.**
   - `L:src/shared/import-file-source.ts`, `L:src/web/client/file-upload.ts:42-75`, `L:src/web/client/api.ts:86-150`, `L:src/web/server/web-adapters.ts:22-82`, `L:src/web/server/view-export-routes.ts`, `L:src/web/server/file-routes.ts:60-193`, `L:src/web/client/view-export.ts`, `L:src/web/client/file-download.ts`.
   - Directly unblocks `V:.planning/web/backlog/web-browser-upload-and-downloads.md`.

Honourable mentions:
- an audit coverage registry (`L:src/main/services/audit/audit-coverage-registry.ts`);
- SSE that closes on revocation (`L:src/web/server/events.ts`);
- `pollAfterMs` job polling (`L:src/shared/db-job-types.ts`, `L:src/renderer/stores/db-job-store.ts`);
- the documented multi-user write policy (`L:.planning/docs/architecture/web-multi-user-write-policy.md`).

## Where VarLens is already ahead or should not copy

- VarLens has **zod schemas and OpenAPI generation**. Limin has hand-written validators and no API documentation. Keep zod, and move it into the shared handler.
- VarLens's typed **domain-module IPC pattern** is a better fit than Limin's single generic `entity:action` channel for a fixed clinical domain. Do not collapse to generic dispatch.
- VarLens pushes **live events** (import progress, annotation changes). Limin has none. Keep them as hints on top of a pollable jobs API.
