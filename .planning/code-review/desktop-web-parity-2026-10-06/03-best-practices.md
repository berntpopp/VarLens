# Desktop <-> Web Parity: External Best Practices (research notes)

Prepared 2026-10-06 for the VarLens desktop/web parity spec. Context: Electron 43 + Vue 3.5 desktop
(SQLite, `window.api` over typed IPC with `IpcResult<T>`), plus a web mode (Fastify 5 + Postgres)
where the browser implements the same `window.api` contract over HTTP.

Source dating: where a page carries a date it is given; otherwise "accessed 2026-10-06". Library
statements were checked against current docs (oRPC, Fastify, Graphile Worker, pg-boss via
context7/DeepWiki, MDN, OWASP, Electron docs). Treat "skills.sh / skillsmp" and aggregator pages as
weak evidence; they are listed only where they corroborate a primary source.

---

## 1. Dual-target architecture: one contract, many transports

### What the reference projects do

| Project | Pattern | Source |
|---|---|---|
| VS Code (desktop / vscode.dev / VS Code Server) | Services are defined behind interfaces and reached through "channels" (`IChannel` / `ProxyChannel`); the same service can be local (Electron main), remote (server over socket) or in-browser. Refactor for browser mode began 2019. | https://code.visualstudio.com/docs/remote/vscode-server ; https://pyshine.com/Visual-Studio-Code-Architecture-Source-Tour/ (accessed 2026-10-06) |
| Joplin | Monorepo: `lib` holds the platform-agnostic core (models, sync, search, E2EE); `app-desktop` (Electron), `app-mobile`, `app-cli`, `server` are thin shells over it. | https://best-of-web.builder.io/compare/laurent22%3Ejoplin/logseq%3Elogseq |
| AFFiNE | Platform apps (`@affine/web`, `@affine/electron`) over shared `@affine/core`; storage behind `@affine/nbstore` with local (IndexedDB/SQLite) and cloud implementations. | https://deepwiki.com/toeverything/AFFiNE/2-frontend-architecture ; https://docs.affine.pro/develop-wip/frontend/electron |

Common thread: **ports & adapters**. Business logic lives in a transport-agnostic service layer; the
renderer depends on a port (here `window.api`); each target supplies an adapter (IPC adapter on
desktop, HTTP adapter in browser). Storage is a second port (SQLite vs Postgres).

### Libraries where one router serves both IPC and HTTP

| Library | IPC transport | HTTP transport | Notes |
|---|---|---|---|
| **oRPC** (v1, 2025) | `@orpc/server/message-port` `RPCHandler` in main; `@orpc/client/message-port` `RPCLink` in renderer; preload just forwards a `MessagePort` via `ipcRenderer.postMessage` | `@orpc/server/node`, `/fetch`, plus OpenAPI handler; SSE/streaming typed | Strongest fit: contract-first (`@orpc/contract`), zod/valibot, OpenAPI generation, typed errors, streaming, Pinia Colada / TanStack Vue integration. https://orpc.dev/docs/adapters/electron ; https://orpc.dev/docs/adapters/message-port ; https://zuplo.com/blog/2025/04/22/typesafe-apis-made-simple-with-orpc |
| **tRPC** + `electron-trpc` / `trpc-electron` | `ipcLink` + `createIPCHandler` | standard tRPC HTTP adapters (incl. Fastify) | Works, but `electron-trpc` lagged tRPC v11 (rewrite pending; fork `trpc-electron` by mat-sz added v11). Maintenance risk. https://github.com/jsonnull/electron-trpc/pull/194 ; https://trpc.io/blog/announcing-trpc-11 |
| **ts-rest** | none built-in (you would write an IPC adapter over the contract) | `@ts-rest/fastify`, OpenAPI generation | REST-shaped contract; good if the HTTP surface must look RESTful. https://www.pkgpulse.com/guides/trpc-v11-vs-ts-rest-2026 |
| **Hono RPC** | Community pattern: run Hono `app.fetch` in main and pipe IPC requests through it (hono-electron-ipc) | native | Clever, but adds HTTP semantics inside IPC; community-only. https://hono.dev/guides/rpc |

**Assessment for VarLens:** VarLens already has the essential pattern hand-rolled (shared
`src/shared/ipc/domains/<name>.ts` contracts + preload binding + main handler + HTTP mirror). Adopting
oRPC wholesale would be a large migration; the cheaper win is to make the existing contract the
single source of truth that *generates or type-checks* both adapters (see section 2). oRPC is the
reference design to borrow from (contract object -> handlers -> per-transport handler), and the
best candidate if a future migration is chosen.

---

## 2. Contract testing both transports

### Compile-time exhaustiveness

- Define the channel set once as a const map (`as const`) and derive `type Channel = keyof typeof contract`.
- Each adapter registers via an object typed `satisfies { [K in Channel]: Handler<K> }`
  (or `Record<Channel, ...>`). A missing channel is a **typecheck error**; an extra key is also an
  error with `satisfies` (excess property check), while literal types are preserved.
  https://dannyguo.com/blog/how-to-enforce-exhaustive-typescript-enum-mappings-using-records ;
  https://blog.logrocket.com/level-up-typescript-record-types
- For channels intentionally desktop-only, encode it in the contract
  (`availability: 'both' | 'desktop' | 'web'`) and use a mapped type that requires an
  implementation for `'both' | 'web'` keys in the HTTP adapter and forbids `'desktop'` keys there.
  This turns "web gap" from a runtime surprise into a reviewed contract decision.

### One behavioral suite, two adapters

- Write the contract test suite once as a factory `describeContract(makeClient)` and instantiate it
  per adapter: in-process service, IPC adapter (Electron/`_electron` or a fake `ipcMain`), HTTP
  adapter (Fastify `inject()` - no socket needed - against Postgres). This is the standard
  "abstract test / shared examples" pattern; it is what consumer-driven contract tools approximate
  across repos.
- **Pact is not the right tool here.** Pact's value is decoupling release cycles between teams that
  own consumer and provider; PactFlow itself advises weighing release-cycle pressure before adopting
  it. In a single repo with shared TS types the in-repo shared suite gives stronger guarantees for
  less cost. https://pactflow.io/blog/why-pact-implementations-fail-and-what-you-can-do-to-avoid-it-blog/ ;
  https://pactflow.io/difference-between-consumer-driven-contract-testing-and-bi-directional-contract-testing/
- Assert the **envelope** too: both transports must produce identical `IpcResult` /
  `SerializableError` shapes (error codes, not messages), identical pagination/sort semantics and
  identical serialization of dates/BigInt/null.

### Runtime validation + OpenAPI from zod

- `fastify-type-provider-zod` (v5+ supports Zod 4; v7 current) validates request/response with zod
  and feeds `@fastify/swagger` via `jsonSchemaTransform` / `jsonSchemaTransformObject`; register
  shared schemas in `z.globalRegistry` to get `$ref`s.
  https://cdn.jsdelivr.net/npm/fastify-type-provider-zod@7.0.0/README.md ;
  https://fastify.dev/docs/latest/Reference/Type-Providers.md
- Alternatives: `fastify-zod-openapi` / `zod-openapi`. https://npmjs.com/package/fastify-zod-openapi
- Validate on the IPC side with the *same* zod schemas (Electron recommends validating all IPC
  input; see section 7). A generated OpenAPI doc can be snapshotted in CI so contract drift shows up
  as a diff.

---

## 3. Large exports (download) and uploads

### Downloads - ranked

1. **Server-streamed response with `Content-Disposition: attachment`** - works in every browser,
   memory-flat on the client, browser's own download manager shows progress. Fastify: `reply.send(stream)`;
   streams are treated as pre-serialized (no response validation), set headers yourself; over HTTP/2
   split very large chunks. https://fastify.dev/docs/latest/Reference/Reply/ ;
   FileSaver/StreamSaver authors themselves say: if the file comes from a server, use headers, not AJAX.
   https://cdn.jsdelivr.net/npm/file-saver@2.0.0/README.md ; https://blog.openreplay.com/create-downloadable-file-browser/
   - Trigger via a plain navigation/`<a href download>` (not `fetch` + Blob), so auth must ride on a
     cookie or a **short-lived signed URL** (HMAC over job id, user id, expiry), since navigation
     cannot add an `Authorization` header. https://upstash.com/docs/blob/recipes/exports
2. **Background export job + signed URL** for slow/huge exports (cohort-wide VCF/XLSX): `POST /exports`
   -> `202 Accepted` + job id; progress via SSE/polling; on completion mint a signed URL with a few
   minutes TTL; artifact stored on disk/object store with retention cleanup.
3. **`showSaveFilePicker` + `FileSystemWritableFileStream`** - true streaming to disk, but
   **Chromium-only, experimental, secure-context + transient user activation required**. Use only as
   a progressive enhancement for client-generated files. https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker
4. **StreamSaver.js** (service-worker fakes a server response) - cross-browser fallback for
   client-generated streams; author calls it a last resort; adds SW complexity. https://npmjs.com/package/streamsaver
5. **`fetch` -> Blob -> object URL** - only for small files. Chrome keeps blobs in memory up to ~2 GB
   (x64 desktop) then spills to disk; Android/ChromeOS limits are far lower. Never for multi-GB.
   https://chromium.googlesource.com/chromium/src/+show/HEAD/storage/browser/blob/README.md

Desktop parity note: Electron uses native `dialog.showSaveDialog` + main-process write; the contract
should model export as "produce artifact" (job/handle) and let each adapter decide delivery
(desktop: write to chosen path; web: attachment stream / signed URL).

### Uploads (multi-GB VCF)

- **`@fastify/multipart` streaming**: parses incrementally, pipe straight to disk/import pipeline
  with `pipeline()`. Default `limits.fileSize` is **1 MiB** - must be raised explicitly; hitting a
  limit **truncates** the stream rather than throwing (check `file.truncated` / limit events); an
  unconsumed file stream hangs the request. https://cdn.jsdelivr.net/npm/@fastify/multipart@10.1.0/README.md
- **tus (resumable)**: `@tus/server` v2 (2025-03-25: ESM-only, Node >= 20.19, runs inside Fastify or
  any Node server; disk/S3/GCS stores) + `@uppy/tus` / `tus-js-client` in the browser. Recommended
  for multi-GB VCF over hospital networks, where a dropped connection at 80 % should not restart.
  https://tus.io/blog/2025/03/25/tus-node-server-v200 ; https://uppy.io/docs/tus/
- Pattern: upload -> temp object -> enqueue import job (section 5) -> job reads from stored file.
  Desktop path is unchanged (main process reads a local path), so the contract should take an
  "import source" abstraction (local path on desktop, upload id on web), not a raw path.

---

## 4. Capability negotiation vs feature flags

- **Server-advertised capabilities** is the established pattern for clients that talk to servers
  of differing abilities: LSP and MCP both exchange a capabilities object at `initialize`, and both
  sides must only use negotiated features. https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle ;
  https://modelcontextprotocol.io/specification/latest/basic/lifecycle
- **Recommendation:** a single `system:capabilities` channel (implemented by both adapters) returning
  e.g. `{ runtime: 'desktop'|'web', features: { localFileDialogs, encryptedDbKey, autoUpdate,
  nativeExportToPath, resumableUpload, multiUser, ... }, limits: { maxUploadBytes, ... },
  contractVersion }`. The renderer gates UI on capabilities, **never** on `if (isElectron)`. This
  keeps "desktop-only by nature" features (auto-updater, DB-file switching, SQLCipher key entry,
  `shell.openPath`) explicit and testable.
- **Build-time flags** (Vite `define`) only for tree-shaking code that must not ship in a target
  (e.g., Electron-only modules out of the web bundle).
- **Runtime feature flags (OpenFeature)** solve a different problem - progressive rollout / per-tenant
  toggles in the web deployment. Vendor-neutral, has Node server and Web SDKs with providers
  (flagd, PostHog, etc.). Adopt only if VarLens web gets multi-tenant rollout needs; do not use flags
  to express platform capability. https://openfeature.dev/docs/reference/technologies/server/javascript ;
  https://openfeature.dev/docs/reference/sdks/client/web/
- HATEOAS-style per-resource affordances (e.g., `canDelete`) are useful for **authorization**-dependent
  UI in multi-user web; they complement, not replace, the global capabilities endpoint.

---

## 5. Background jobs and progress in web mode

### Transport for progress

- **SSE is the default for server->client job progress** (one-way, auto-reconnect, `Last-Event-ID`
  replay, plain HTTP, works through proxies, HTTP/2 multiplexed). WebSocket only if bidirectional
  low-latency messaging is needed. https://dev.to/pavelespitia/streaming-long-ai-jobs-to-the-browser-sse-patterns-from-building-an-audit-tool-2lc8 ;
  https://rednafi.com/python/server-sent-events/
- Caveats: native `EventSource` is GET-only and **cannot set custom headers** - use cookie auth
  (`withCredentials`) or `fetch`-based SSE (`@microsoft/fetch-event-source`-style). Over HTTP/1.1
  browsers cap ~6 connections per origin, so multiplex all jobs on **one** SSE stream per tab or
  serve over HTTP/2. https://developer.mozilla.org/en-US/docs/Web/API/EventSource/withCredentials ;
  https://github.com/mpetazzoni/sse.js
- Fastify: official `@fastify/sse` (route option `{ sse: true }`, async iterators, `Last-Event-ID`
  replay, heartbeat, backpressure). Early version line (0.x) - pin and test.
  https://cdn.jsdelivr.net/npm/@fastify/sse@0.4.0/README.md
- **Polling fallback** (`GET /jobs/:id` every 1-2 s) must always work - it is also what the SSE
  stream should reconstruct state from after reconnect. Progress should carry semantic steps
  ("parsing chunk 12/40", rows imported) not just percent.

### Durable job table in Postgres

- **pg-boss**: queue on Postgres (`SKIP LOCKED`), states `created/retry/active/completed/cancelled/failed`,
  `cancel()`/`resume()`, `getJobById()` for status, singleton/`singletonKey` policies (one active
  import per case), retention. https://deepwiki.com/timgit/pg-boss/5-job-lifecycle ;
  https://github.com/timgit/pg-boss
- **Graphile Worker**: LISTEN/NOTIFY, 2-3 ms pickup, `helpers.abortSignal` (since v0.16, 2023-12-11)
  for cooperative cancellation/shutdown, `job_key` for dedupe/replace, jobs addable from SQL.
  https://github.com/graphile/worker/blob/main/website/docs/tasks.md ;
  https://github.com/graphile/worker/blob/main/website/news/2023-12-11-016-release.mdx
- Neither stores rich progress; keep an **app-owned `jobs` table** (id, owner_user_id, kind, state,
  progress jsonb, error, artifact_ref, created/updated) as the source of truth the UI reads, and use
  the queue only for dispatch. Progress writes should be throttled (e.g., <= 1/s) and broadcast via
  `NOTIFY` -> SSE.
- **Cancellation**: request sets `cancel_requested`, worker checks it between batches / observes an
  `AbortSignal`, then rolls back or marks partial import. Same `AbortSignal` model exists on
  desktop (worker_threads), so the contract can expose `jobs:cancel` for both targets.

---

## 6. Per-user vs per-install settings

No single canonical source; consensus from multi-user SaaS practice and VS Code's own model
(User / Workspace / Remote / Machine scopes, where some settings are explicitly `machine`-scoped
and never synced): https://code.visualstudio.com/docs/configure/settings

Recommendations:
- Classify every setting by **scope** in the contract: `user` (UI prefs, column layouts, filter
  presets), `deployment/instance` (admin-controlled: external API keys, max upload size, retention),
  `device` (window size, local paths, DB file location, update channel - desktop-only).
- Desktop: all three collapse to one local store, but keep the scope tag so the web adapter knows
  where to persist. Web: `user` -> `user_settings` table keyed by user id; `instance` -> admin-only
  table/env; `device` -> `localStorage` or not offered (capability-gated).
- Shared data (filter presets, gene lists) needs explicit ownership + visibility (`private` /
  `shared`) in web; desktop defaults to owner = local user.
- Never let a per-user write mutate instance settings through the same channel (that is a BFLA hole,
  see section 7).

---

## 7. Security of IPC-shaped RPC over HTTP

- **Electron side** (keep): validate the sender (`event.senderFrame` URL allowlist) on every
  handler; expose narrow functions via `contextBridge`, never raw `ipcRenderer`; validate all IPC
  inputs. https://www.electronjs.org/docs/latest/tutorial/security
- **HTTP side** - IPC habits that become vulnerabilities:
  - *Implicit trust*: IPC handlers assume one trusted local user. Over HTTP every channel needs
    **authentication + per-channel authorization (function level) + per-object authorization**
    (case/variant ownership). OWASP API Top 10 2023: API1 BOLA, API5 BFLA.
    https://owasp.org/API-Security/editions/2023/en/0x11-t10/ ; https://blog.barracuda.com/2023/06/19/owasp-top-10-api-broken-funtion-level-authorization
  - *Desktop-only channels must not exist* on the web router (DB file open/switch, encryption key,
    `shell.openExternal/openPath`, updater, arbitrary filesystem paths). Enforce by construction:
    the HTTP router is built from an allowlist derived from contract `availability`, and a test
    asserts that no desktop-only channel is routable (404, not 403).
  - *Path inputs*: any channel taking a filesystem path is an SSRF/LFI vector on a server - replace
    with upload ids / server-side artifact ids.
  - **CSRF** (cookie sessions): OWASP 2025+ guidance ranks **Fetch Metadata (`Sec-Fetch-Site`)**
    checks first, with fallback; plus require JSON content-type (rejects simple-request content types),
    a custom header (forces CORS preflight), `SameSite=Lax/Strict` cookies, Origin verification, or
    signed double-submit tokens. If using `@fastify/csrf-protection`, use >= 6.3 with `hmacKey` and
    `userInfo` (CVE-2023-27495). Make all state-changing channels non-GET.
    https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html ;
    https://nvd.nist.gov/vuln/detail/CVE-2023-27495
  - *Input validation & response shaping*: validate with the same zod schemas as IPC; use response
    schemas (fastify serializer) so internal fields never leak; map errors to stable codes and
    strip stack traces/SQL in `SerializableError` for web.
  - *Resource limits*: rate limiting, body/upload size limits (multipart default 1 MiB, truncation
    semantics), query `limit` caps, timeouts - local IPC never needed these.
  - Signed download URLs: short TTL, bound to user + artifact, single purpose.

---

## Concrete recommendations for the VarLens parity spec

1. Keep `src/shared/ipc/domains/*` as the single contract; add per-channel metadata
   (`availability`, `scope`, `mutates`, `authz`) and derive both adapters' registration types from it.
2. Enforce exhaustiveness at typecheck: both registries `satisfies` a mapped type over the contract.
3. One shared behavioral contract suite run against in-process service, IPC adapter, and Fastify
   `inject()` adapter; Pact is unnecessary in-repo.
4. Zod schemas shared by IPC validation and `fastify-type-provider-zod`; snapshot generated OpenAPI in CI.
5. `system:capabilities` endpoint; renderer gates on capabilities, never on runtime sniffing.
6. Exports: model as artifact/job; web delivers via streamed `Content-Disposition: attachment` with
   signed short-lived URL; `showSaveFilePicker` only as Chromium progressive enhancement; no Blob for
   large files.
7. Uploads: tus (`@tus/server` v2 + Uppy) for multi-GB VCF, or `@fastify/multipart` streaming with
   explicit limits and truncation checks; contract takes an import-source abstraction.
8. Jobs: app-owned `jobs` table + pg-boss or Graphile Worker for dispatch; SSE (one stream per tab)
   with polling fallback; cooperative cancellation via `AbortSignal` on both targets.
9. Settings: tag scope user/instance/device; persist accordingly; device-scope desktop-only.
10. Security: router built from allowlist (desktop-only channels unroutable), BOLA/BFLA checks per
    channel, Fetch-Metadata + JSON-only + SameSite CSRF defenses, rate/size limits, sanitized errors.
11. Revisit oRPC (contract-first, message-port + HTTP + OpenAPI + SSE) as a migration target only if
    hand-maintained adapters keep drifting.
