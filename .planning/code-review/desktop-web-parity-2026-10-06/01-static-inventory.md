# VarLens desktop vs web: static `window.api` parity inventory

Generated 2026-10-06 from worktree agent-a441a5be6bf38012d @ 8a662b89 by static analysis only (nothing was executed). Machine-readable twin: `static-inventory.json`.

## Summary

| Classification | Count |
|---|---|
| PARITY | 132 |
| DEGRADED | 9 |
| BROKEN | 3 |
| MISSING | 33 |
| LEGITIMATELY-DESKTOP-ONLY | 40 |
| **Total `window.api` methods / channels** | **217** |

Definitions: **PARITY** = reachable in web with equivalent behavior (transport substitutions like upload refs or SSE count). **DEGRADED** = works but with reduced or different behavior. **BROKEN** = wired, or called by the UI, but fails or is wrong for real calls. **MISSING** = desktop feature with a reasonable web equivalent that is not implemented (404, production 501, or no-op). **LEGITIMATELY-DESKTOP-ONLY** = the concept does not apply in web; the UX decision it needs is listed.

### Most user-impactful non-PARITY channels

| # | Method | Class | Why |
|---|---|---|---|
| 1 | `export.variants` | MISSING | 501 unsupported-web-capability unless parity fixtures enabled; database:capabilities overlay sets export.variants=false so useFilterExport.ts:9 shows "not available". Even with fixtures it writes CSV to server tmpdir and returns a server filePath (no browser download) |
| 2 | `cohort.getVariants` | DEGRADED | shared getCohortVariantsViaSession, but active-panel filters resolve intervals via getGeneReferenceDb() (PostgresCohortRepository.ts:683) which the web build aliases to a throwing stub (src/web/stubs/gene-reference-loader-stub.ts, vite.web.config.ts:32) -> cohort query with an active gene panel errors (verify at runtime) |
| 3 | `vep.fetch` | MISSING | 501 in production (fixture-gated); useVepEnrichment.ts:156 is NOT gated -> "VEP fetch failed" in variant details |
| 4 | `hpo.search` | MISSING | 501 in production (fixture-gated); HpoTermSelector.vue:111 (CaseMetadataCard) ungated -> users cannot add HPO terms to cases in web |
| 5 | `export.cohort` | MISSING | same as export.variants; CohortTable.vue:225 export disabled |
| 6 | `myvariant.fetch` | MISSING | 404 not wired; useVepEnrichment.ts:157 ungated -> MyVariant section errors |
| 7 | `spliceai.fetch` | MISSING | 404 not wired; useVepEnrichment.ts:158 ungated -> SpliceAI section errors |
| 8 | `panels.validateSymbols` | BROKEN | 404 not wired, NOT gated: PanelEditorDialog.vue:306 / useGeneValidation.ts:123 gene-symbol validation fails in web, so panels cannot be built from symbol lists |
| 9 | `cases.deleteBatch` | MISSING | 404 not wired; Postgres capability cases.deleteMany=false gates CaseList.vue:537 |
| 10 | `import.startMultiFile` | DEGRADED | route works (shared startMultiFileImport) but the multi-file "Import VCF Files" entry point is hidden in web (AppSidebar.vue:24, AppToolbar.vue:122); SQLite-session fallback throws |
| 11 | `import.cancel` | DEGRADED | calls process-global cancelImport(): cancels whatever import is running for ANY user; no per-user/per-run scoping |
| 12 | `cohort.runAssociation` | MISSING | 501 always; UI NOT gated (useAssociation.ts:30, GeneBurdenView) -> run button errors |
| 13 | `audit.getByEntity` | DEGRADED | admin-only override (routes/audit-log.ts:17): non-admin web users get 403 in ActivityLogPanel.vue:70; desktop ungated (deliberate: trail includes employee activity) |
| 14 | `panels.autocomplete` | BROKEN | 404 not wired, NOT gated (useGeneValidation.ts:159) |
| 15 | `panels.searchPanelApp` | MISSING | 404 not wired, NOT gated (PanelAppImportDialog.vue:230) |
| 16 | `panels.importPanelApp` | MISSING | 404 not wired, NOT gated (PanelAppImportDialog.vue:253) |
| 17 | `protein.getMapping` | MISSING | 501 in production (fixture-gated); renderer gates the protein viewer off in web (runtime-features.ts:17, VariantDetailsPanel.vue:194) |
| 18 | `cases.deleteAll` | MISSING | 404 not wired; Postgres capability cases.deleteAll=false so App.vue:234 shows "not available" warning |
| 19 | `import.vcfMultiPreview` | DEGRADED | shared getVcfMultiPreview but siblingBedFiles forced to [] (no sibling BED auto-discovery for uploads) |
| 20 | `system.setWorkerThreads` | DEGRADED | silent client no-op, but ApplicationPreferences.vue:135 still shows the worker-thread control in web |

## Transport architecture

**Desktop:** renderer `window.api.<d>.<m>()` → contextBridge (`src/preload/index.ts:20`) → `src/preload/window-api/create-window-api.ts:440` assembles the `core-api.ts`/`app-api.ts` wrappers → `src/preload/domains/<d>.ts` calls `ipcRenderer.invoke('<channel>')` → `ipcMain.handle` in `src/main/ipc/handlers/<d>.ts` (registered from `src/main/ipc/domains/<d>.ts`) → `wrapHandler` + Zod validation → Postgres sessions use `session.getRead/WriteExecutor().execute({type, params})` and SQLite sessions use the legacy DatabaseService path → `IpcResult`. Push events use `webContents.send` / `safeEmit` → `ipcRenderer.on` (`src/preload/window-api/events.ts:5`).

**Web:** `src/web/bootstrap.ts` imports `src/web/client/install-api.ts` (sets `window.__VARLENS_WEB__`, line 9, and `window.api = createApi()`) before the renderer. `createApi()` (`src/web/client/api.ts:559`) is a Proxy: `DOMAIN_OVERRIDES` (`api.ts:546`) handle shell, system, updater, and perf entirely on the client, plus pickers/uploads, SSE subscriptions and `export.revealInFolder`. Every other property becomes `httpInvoke` → `POST {BASE}/api/<windowKey>/<method>` with body `{args}` (`api.ts:101`), and any `on*` without an override is a silent no-op (`api.ts:361`). On the server, the auth preHandler (`src/web/server/auth.ts:225`) runs first, then the single Fastify route `/api/:domain/:method` (`src/web/server/dispatcher.ts:294`), which applies the pre-rotation gate (`:333`) and maps the camelCase key to kebab-case (`task-types.ts:153`). It tries three layers in order: (1) per-method override from `src/web/server/routes/*.ts` (`dispatcher.ts:237`), (2) `READ_TASK_TYPES` autoroute → read executor with **raw positional args** (`task-types.ts:13`, `dispatcher.ts:372`), (3) `WRITE_TASK_TYPES` autoroute + write audit (`task-types.ts:69`, `dispatcher.ts:392`). Anything else returns **404 `unknown method`** (`dispatcher.ts:412`). Errors come back as JSON `SerializableError` with a 4xx/5xx status, and the client returns them as IPC error envelopes. Uploads use `POST /api/import/upload` (`routes/upload-staging.ts:79`) and push events use SSE `GET /api/events` (`events.ts:40`).

**Key consequence:** Web dispatch key = toTaskDomain(<window.api key>) + ":" + <preload METHOD name>, not the desktop IPC channel. Channels whose desktop name differs from the method (cohort:variants vs cohort:getVariants, panels:active-for-case vs panels:activeForCase, analysisGroups:* vs analysis-groups:*, variants:filterOptions vs getFilterOptions, protein:mapping vs getMapping, gnomad:variants vs getVariants) are matched by method name only.

Web storage is always the Postgres `StorageSession`. An autorouted call therefore runs the same executor task as the desktop handler's Postgres branch, but skips the desktop Zod validation, default filling and any in-process cache invalidation (for example `clearPanelIntervalCache`).

## Per-domain channel tables

Columns: preload method · desktop IPC channel · desktop handler · web mechanism (location) · web logic reuse · class · reason / UX decision.

### `cases`  (PARITY 4, MISSING 2)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `cases.list` | `cases:list` | `src/main/ipc/handlers/cases.ts:77` | route-override (`src/web/server/routes/cases.ts:8`) | shared: session.listCases (desktop via cases-logic.listCases) | PARITY | override calls session.listCases(); desktop cases-logic.listCases wraps the same call |
| `cases.query` | `cases:query` | `src/main/ipc/handlers/cases.ts:85` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:14`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | read autoroute; renderer (CaseList.vue:309) sends complete params so missing Zod defaults do not matter |
| `cases.delete` | `cases:delete` | `src/main/ipc/handlers/cases.ts:96` | route-override (`src/web/server/routes/cases.ts:14`) | thin re-implementation over executor task cases:delete | PARITY | override executes cases:delete and publishes cohort:summaryRebuilt; desktop uses deleteSingleCaseForCurrentSession + emits orphan cases:deleted |
| `cases.deleteAll` | `cases:deleteAll` | `src/main/ipc/handlers/cases.ts:109` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404 not wired; Postgres capability cases.deleteAll=false so App.vue:234 shows "not available" warning **UX:** admin-only server-side bulk delete job, or keep capability-gated |
| `cases.deleteBatch` | `cases:deleteBatch` | `src/main/ipc/handlers/cases.ts:116` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404 not wired; Postgres capability cases.deleteMany=false gates CaseList.vue:537 **UX:** server-side batch delete (loop cases:delete in one transaction/job) |
| `cases.availableBuilds` | `cases:availableBuilds` | `src/main/ipc/handlers/cases.ts:81` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:15`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | read autoroute |

### `variants`  (PARITY 9)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `variants.query` | `variants:query` | `src/main/ipc/handlers/variants.ts:46` | route-override (`src/web/server/routes/variants.ts:48`) | thin re-implementation over executor task (desktop: variants-logic.queryVariants) | PARITY | override validates with the same shared/api/schemas and executes variants:query |
| `variants.getFilterOptions` | `variants:filterOptions` | `src/main/ipc/handlers/variants.ts:144` | route-override (`src/web/server/routes/variants.ts:107`) | shared logic: getFilterOptions | PARITY | override calls shared variants-logic.getFilterOptions |
| `variants.search` | `variants:search` | `src/main/ipc/handlers/variants.ts:164` | route-override (`src/web/server/routes/variants.ts:16`) | shared logic: searchVariants | PARITY | override calls shared variants-logic.searchVariants; no renderer callers (legacySearch=false on Postgres) |
| `variants.geneSymbols` | `variants:geneSymbols` | `src/main/ipc/handlers/variants.ts:216` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:29`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | read autoroute; renderer passes explicit limit 50 (desktop preload defaults limit, web does not) |
| `variants.typeCounts` | `variants:typeCounts` | `src/main/ipc/handlers/variants.ts:264` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:27`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | read autoroute |
| `variants.columnMeta` | `variants:columnMeta` | `src/main/ipc/handlers/variants.ts:291` | route-override (`src/web/server/routes/variants.ts:28`) | thin adapter over the same executor task | PARITY | override validates payload, executes variants:columnMeta |
| `variants.typesPresent` | `variants:typesPresent` | `src/main/ipc/handlers/variants.ts:319` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:28`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | read autoroute; payload {caseId}\|{caseIds} matches executor scope |
| `variants.shortlist` | `variants:shortlist` | `src/main/ipc/handlers/shortlist.ts:55` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:33`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | read autoroute |
| `variants.onAnnotationChanged` | `variants:annotationChanged` | `src/main/ipc/handlers/annotations.ts:36` | sse (`src/web/client/api.ts:522`) | web transport (SSE) for the same AnnotationChangeEvent | PARITY | SSE 'variants:annotationChanged' published by annotations:upsertPerCase override (routes/annotations.ts:65); per-user, single-process hub |

### `import`  (PARITY 7, DEGRADED 3, LEGITIMATELY-DESKTOP-ONLY 1)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `import.selectFile` | `import:selectFile` | `src/main/ipc/handlers/import.ts:133` | client-side-impl+upload (`src/web/client/api.ts:432`) | web equivalent (upload staging) | PARITY | browser <input type=file> + XHR upload to POST /api/import/upload returns an upload ref used in place of a path |
| `import.selectFiles` | `import:selectFiles` | `src/main/ipc/handlers/import.ts:334` | client-side-impl+upload (`src/web/client/api.ts:441`) | web equivalent (upload staging) | PARITY | browser multi-file picker + upload refs |
| `import.selectBedFile` | `import:selectBedFile` | `src/main/ipc/handlers/import.ts:360` | client-side-impl+upload (`src/web/client/api.ts:448`) | web equivalent (upload staging) | PARITY | browser picker + upload ref; region-files:importBed and import filters resolve refs |
| `import.enrollDroppedFiles` | `import:enrollDroppedFiles` | `src/main/ipc/handlers/import.ts:314` | client-side-impl+upload (`src/web/client/api.ts:454`) | web equivalent (upload staging) | PARITY | dropped File objects uploaded; refs returned (desktop: webUtils.getPathForFile + enrollment token) |
| `import.start` | `import:start` | `src/main/ipc/handlers/import.ts:163` | route-override (`src/web/server/routes/import.ts:111`) | shared logic: startImport | PARITY | override resolves upload ref then calls shared import-logic.startImport with SSE progress; server-local paths always 403 (server-path-import.ts:1) |
| `import.startMultiFile` | `import:startMultiFile` | `src/main/ipc/handlers/import.ts:192` | route-override (`src/web/server/routes/import.ts:158`) | shared logic: startMultiFileImport | DEGRADED | route works (shared startMultiFileImport) but the multi-file "Import VCF Files" entry point is hidden in web (AppSidebar.vue:24, AppToolbar.vue:122); SQLite-session fallback throws **UX:** un-hide multi-file import once upload of SNV/SV/CNV/STR bundles is verified |
| `import.vcfPreview` | `import:vcfPreview` | `src/main/ipc/handlers/import.ts:260` | route-override (`src/web/server/routes/import.ts:50`) | shared logic: getVcfPreview | PARITY | override calls shared getVcfPreview on staged upload |
| `import.vcfMultiPreview` | `import:vcfMultiPreview` | `src/main/ipc/handlers/import.ts:277` | route-override (`src/web/server/routes/import.ts:72`) | shared logic: getVcfMultiPreview | DEGRADED | shared getVcfMultiPreview but siblingBedFiles forced to [] (no sibling BED auto-discovery for uploads) **UX:** let user upload BED alongside the VCF bundle |
| `import.onProgress` | `import:progress` | `src/main/ipc/handlers/import.ts:124` | sse (`src/web/client/api.ts:430`) | web transport (SSE) | PARITY | SSE 'import:progress' |
| `import.cancel` | `import:cancel` | `src/main/ipc/handlers/import.ts:254` | route-override (`src/web/server/routes/import.ts:264`) | shared logic: cancelImport | DEGRADED | calls process-global cancelImport(): cancels whatever import is running for ANY user; no per-user/per-run scoping **UX:** scope cancellation to the caller run/job id |
| `import.(internal) registerDroppedFileEnrollmentToken` | `import:registerDroppedFileEnrollmentToken` | `src/main/ipc/handlers/import.ts:302` | not-applicable | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | preload-internal path-authority handshake; web uploads File objects instead **UX:** n/a |

### `system`  (LEGITIMATELY-DESKTOP-ONLY 5, DEGRADED 1)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `system.getVersion` | `system:version` | `src/main/ipc/handlers/system.ts:57` | client-side-stub (`src/web/client/api.ts:404`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client stub returns build __APP_VERSION__ and electron:"web" **UX:** show web build version / server git SHA |
| `system.getUserDataPath` | `system:userDataPath` | `src/main/ipc/handlers/system.ts:63` | client-side-stub (`src/web/client/api.ts:405`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client stub returns 'web'; no renderer callers **UX:** none needed |
| `system.getCpuCount` | `system:getCpuCount` | `src/main/ipc/handlers/system.ts:69` | client-side-stub (`src/web/client/api.ts:406`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client stub returns browser navigator.hardwareConcurrency (client CPU, irrelevant to server) **UX:** hide worker-thread preference in web; server concurrency is operator config |
| `system.setWorkerThreads` | `system:setWorkerThreads` | `src/main/ipc/handlers/system.ts:75` | client-side-stub (`src/web/client/api.ts:407`) | client-side stub | DEGRADED | silent client no-op, but ApplicationPreferences.vue:135 still shows the worker-thread control in web **UX:** hide the control in web (isWebRuntime) or make it an admin server setting |
| `system.getWorkerThreads` | `system:getWorkerThreads` | `src/main/ipc/handlers/system.ts:88` | client-side-stub (`src/web/client/api.ts:408`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client stub returns 0; no renderer callers **UX:** none needed |
| `system.getLogFilePath` | `system:logFilePath` | `src/main/ipc/handlers/system.ts:94` | client-side-stub (`src/web/client/api.ts:409`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client stub returns ''; no renderer callers **UX:** server logs belong to operator log pipeline |

### `export`  (MISSING 2, LEGITIMATELY-DESKTOP-ONLY 1)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `export.variants` | `export:variants` | `src/main/ipc/handlers/export.ts:66` | fixture-gated (`src/web/server/routes/export.ts:19`) | shared exportPostgresVariants (fixture path only) | MISSING | 501 unsupported-web-capability unless parity fixtures enabled; database:capabilities overlay sets export.variants=false so useFilterExport.ts:9 shows "not available". Even with fixtures it writes CSV to server tmpdir and returns a server filePath (no browser download) **UX:** streaming HTTP download (Content-Disposition) reusing exportPostgresVariants into the response stream |
| `export.cohort` | `export:cohort` | `src/main/ipc/handlers/export.ts:170` | fixture-gated (`src/web/server/routes/export.ts:41`) | shared exportPostgresCohort (fixture path only) | MISSING | same as export.variants; CohortTable.vue:225 export disabled **UX:** streaming HTTP download reusing exportPostgresCohort |
| `export.revealInFolder` | `export:revealInFolder` | `src/main/ipc/handlers/export.ts:47` | client-side-stub (`src/web/client/api.ts:394`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client stub returns {success:false} **UX:** replace "show in folder" with the browser download itself |

### `shell`  (PARITY 1, DEGRADED 1)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `shell.openExternal` | `shell:openExternal` | `src/main/ipc/handlers/shell.ts:38` | client-side-impl (`src/web/client/api.ts:378`) | client-side re-implementation of URL validation | PARITY | client window.open after https + static ALLOWED_DOMAINS check |
| `shell.updateDomains` | `shell:updateUserDomains` | `src/main/ipc/handlers/shell.ts:23` | client-side-stub (`src/web/client/api.ts:385`) | client-side stub | DEGRADED | client no-op: user-added external-link domains (externalLinksStore.ts:289) are never honoured by web openExternal **UX:** keep user allowlist client-side and include it in isUrlSafeForExternal |

### `database`  (LEGITIMATELY-DESKTOP-ONLY 18, PARITY 3)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `database.selectFile` | `database:selectFile` | `src/main/ipc/handlers/database.ts:251` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; native file dialog for .db files; DatabasePicker shows a fixed server workspace in web (DatabasePicker.vue:20) **UX:** web has one server-configured Postgres workspace; no file picker |
| `database.selectSaveLocation` | `database:selectSaveLocation` | `src/main/ipc/handlers/database.ts:273` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; native save dialog **UX:** n/a (server workspace) |
| `database.open` | `database:open` | `src/main/ipc/handlers/database.ts:303` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; open local SQLite file; UI gated by DatabasePicker isWebMode **UX:** n/a (server workspace) |
| `database.create` | `database:create` | `src/main/ipc/handlers/database.ts:320` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; create local SQLite file. DESKTOP DEFECT: core-api.ts:316 wrapper drops the 3rd setupPassphrase arg **UX:** n/a (server workspace) |
| `database.rekey` | `database:rekey` | `src/main/ipc/handlers/database.ts:340` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; SQLCipher rekey **UX:** server-side at-rest encryption is operator responsibility (disk/PG TDE) |
| `database.info` | `database:info` | `src/main/ipc/handlers/database.ts:413` | route-override (`src/web/server/routes/database.ts:31`) | web-only identity adapter | PARITY | override returns synthetic {path:"web:postgres", name:"VarLens Web", encrypted:false} |
| `database.capabilities` | `database:capabilities` | `src/main/ipc/handlers/database.ts:422` | route-override (`src/web/server/routes/database.ts:19`) | session.capabilities + web overlay | PARITY | override returns POSTGRES_CAPABILITIES with export.* forced false unless parity fixtures |
| `database.postgresDiagnostics` | `database:postgresDiagnostics` | `src/main/ipc/handlers/database.ts:431` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; desktop client-side diagnostics of a hosted PG connection; no renderer caller **UX:** expose web-only database:health (exists, routes/database.ts:25) on an admin page |
| `database.postgresProfilesList` | `database:postgresProfilesList` | `src/main/ipc/handlers/database.ts:440` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; desktop connection profiles; DatabasePicker skips fetch in web (DatabasePicker.vue:327,444) **UX:** server owns the connection (VARLENS_PG_URL) |
| `database.postgresProfileSave` | `database:postgresProfileSave` | `src/main/ipc/handlers/database.ts:450` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; desktop connection profiles **UX:** n/a |
| `database.postgresProfileRemove` | `database:postgresProfileRemove` | `src/main/ipc/handlers/database.ts:465` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; desktop connection profiles **UX:** n/a |
| `database.postgresProfileTest` | `database:postgresProfileTest` | `src/main/ipc/handlers/database.ts:480` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; desktop connection profiles **UX:** n/a |
| `database.postgresProfileOpen` | `database:postgresProfileOpen` | `src/main/ipc/handlers/database.ts:500` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; desktop connection profiles **UX:** n/a |
| `database.recentList` | `database:recentList` | `src/main/ipc/handlers/database.ts:519` | route-override (`src/web/server/routes/database.ts:50`) | web stub | LEGITIMATELY-DESKTOP-ONLY | override returns [] **UX:** n/a |
| `database.getOverview` | `database:overview` | `src/main/ipc/handlers/database.ts:528` | route-override (`src/web/server/routes/database.ts:41`) | thin adapter over the same executor task | PARITY | override executes database:overview read task |
| `database.removeRecent` | `database:removeRecent` | `src/main/ipc/handlers/database.ts:541` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; recent-files list; gated by DatabasePicker **UX:** n/a |
| `database.deleteFile` | `database:deleteFile` | `src/main/ipc/handlers/database.ts:561` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; delete local .db file; gated **UX:** n/a |
| `database.showInFolder` | `database:showInFolder` | `src/main/ipc/handlers/database.ts:575` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; OS file manager; gated **UX:** n/a |
| `database.migrateToEncrypted` | `database:migrateToEncrypted` | `src/main/ipc/handlers/database.ts:374` | n/a-not-exposed | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | web: n/a (SQLite encryption). DESKTOP DEFECT: not forwarded by core-api.ts database wrapper -> window.api.database.migrateToEncrypted is undefined (databaseStore.ts:202) **UX:** server-side at-rest encryption is operator responsibility |
| `database.deletePlaintextBackup` | `database:deletePlaintextBackup` | `src/main/ipc/handlers/database.ts:396` | n/a-not-exposed | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | web: n/a. DESKTOP DEFECT: not forwarded by core-api.ts wrapper (databaseStore.ts:216) **UX:** n/a |
| `database.setRecoveryPassphrase` | `database:setRecoveryPassphrase` | `src/main/ipc/handlers/database.ts:356` | n/a-not-exposed | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | web: n/a. DESKTOP DEFECT: not forwarded by core-api.ts wrapper (databaseStore.ts:227) **UX:** n/a |

### `batchImport`  (PARITY 10, DEGRADED 1)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `batchImport.selectFiles` | `batch-import:selectFiles` | `src/main/ipc/handlers/batch-import.ts:52` | client-side-impl+upload (`src/web/client/api.ts:443`) | web equivalent (upload staging) | PARITY | browser multi-file picker + upload refs |
| `batchImport.selectFolder` | `batch-import:selectFolder` | `src/main/ipc/handlers/batch-import.ts:82` | client-side-impl+upload (`src/web/client/api.ts:489`) | web equivalent (upload staging) | PARITY | browser <input webkitdirectory> + uploads every file |
| `batchImport.checkDuplicates` | `batch-import:checkDuplicates` | `src/main/ipc/handlers/batch-import.ts:133` | route-override (`src/web/server/routes/batch-import.ts:68`) | REIMPLEMENTATION (drift risk) | PARITY | override re-implements duplicate check with extractCaseName + session.listCases (desktop: batch-import-logic.checkDuplicateFiles) |
| `batchImport.start` | `batch-import:start` | `src/main/ipc/handlers/batch-import.ts:157` | route-override (`src/web/server/routes/batch-import.ts:103`) | REIMPLEMENTATION (drift risk): startWebBatchImport vs startBatchImport | PARITY | override re-implements orchestration as startWebBatchImport on jobRunner (desktop: batch-import-logic.startBatchImport); HTTP request held open for the whole batch |
| `batchImport.cancel` | `batch-import:cancel` | `src/main/ipc/handlers/batch-import.ts:196` | route-override (`src/web/server/routes/batch-import.ts:152`) | shared logic: cancelImport | DEGRADED | cancels ALL running import_batch jobs process-wide plus global cancelImport() (cross-user) **UX:** scope cancel to caller runId |
| `batchImport.selectZip` | `batch-import:selectZip` | `src/main/ipc/handlers/batch-import.ts:202` | client-side-impl+upload (`src/web/client/api.ts:493`) | web equivalent (upload staging) | PARITY | upload .zip then server testZipPassword probe to derive isEncrypted |
| `batchImport.testZipPassword` | `batch-import:testZipPassword` | `src/main/ipc/handlers/batch-import.ts:238` | route-override (`src/web/server/routes/batch-import.ts:198`) | shared logic: testZipPassword | PARITY | shared batch-import-logic.testZipPassword on staged upload |
| `batchImport.extractZip` | `batch-import:extractZip` | `src/main/ipc/handlers/batch-import.ts:257` | route-override (`src/web/server/routes/batch-import.ts:160`) | shared logic: extractZip | PARITY | shared extractZip on staged upload (stageExistingFileUpload for members) |
| `batchImport.cleanupZipTemp` | `batch-import:cleanupZipTemp` | `src/main/ipc/handlers/batch-import.ts:281` | route-override (`src/web/server/routes/batch-import.ts:229`) | shared batch-import-logic.cleanupZipTemp | PARITY | shared cleanupZipTemp |
| `batchImport.onProgress` | `batch-import:progress` | `src/main/ipc/handlers/batch-import.ts:45` | sse (`src/web/client/api.ts:472`) | web transport (SSE) | PARITY | SSE 'batch-import:progress' |
| `batchImport.onComplete` | `batch-import:complete` | `src/main/ipc/handlers/batch-import.ts:46` | sse (`src/web/client/api.ts:476`) | web transport (SSE) | PARITY | SSE 'batch-import:complete' |

### `cohort`  (DEGRADED 1, PARITY 6, MISSING 3, LEGITIMATELY-DESKTOP-ONLY 1)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `cohort.getVariants` | `cohort:variants` | `src/main/ipc/handlers/cohort.ts:65` | route-override (`src/web/server/routes/cohort.ts:18`) | shared logic: getCohortVariantsViaSession | DEGRADED | shared getCohortVariantsViaSession, but active-panel filters resolve intervals via getGeneReferenceDb() (PostgresCohortRepository.ts:683) which the web build aliases to a throwing stub (src/web/stubs/gene-reference-loader-stub.ts, vite.web.config.ts:32) -> cohort query with an active gene panel errors (verify at runtime) **UX:** ship gene_reference.db in the web image and route the loader to web-gene-reference.ts |
| `cohort.getColumnMeta` | `cohort:columnMeta` | `src/main/ipc/handlers/cohort.ts:78` | route-override (`src/web/server/routes/cohort.ts:31`) | shared logic: getCohortColumnMetaViaSession | PARITY | shared getCohortColumnMetaViaSession |
| `cohort.getSummary` | `cohort:summary` | `src/main/ipc/handlers/cohort.ts:84` | route-override (`src/web/server/routes/cohort.ts:37`) | shared logic: getCohortSummaryViaSession | PARITY | shared getCohortSummaryViaSession |
| `cohort.getCarriers` | `cohort:carriers` | `src/main/ipc/handlers/cohort.ts:90` | route-override (`src/web/server/routes/cohort.ts:67`) | shared logic: getCohortCarriersViaSession | PARITY | shared getCohortCarriersViaSession |
| `cohort.getGeneBurden` | `cohort:geneBurden` | `src/main/ipc/handlers/cohort.ts:114` | route-override (`src/web/server/routes/cohort.ts:86`) | shared logic: getCohortGeneBurdenViaSession | PARITY | shared getCohortGeneBurdenViaSession |
| `cohort.runAssociation` | `cohort:geneBurdenCompare` | `src/main/ipc/handlers/cohort.ts:120` | 501-unsupportedWebCapability (`src/web/server/routes/cohort.ts:55`) | none (not implemented) | MISSING | 501 always; UI NOT gated (useAssociation.ts:30, GeneBurdenView) -> run button errors **UX:** server job (jobRunner) + SSE progress, or hide run action in web (backlog/web-cohort-association-support.md) |
| `cohort.cancelAssociation` | `cohort:geneBurdenCancel` | `src/main/ipc/handlers/cohort.ts:134` | 501-unsupportedWebCapability (`src/web/server/routes/cohort.ts:61`) | none (not implemented) | MISSING | 501 always **UX:** part of association job design |
| `cohort.onAssociationProgress` | `cohort:geneBurdenProgress` | `src/main/ipc/handlers/cohort.ts:129` | client-noop-subscription (`src/web/client/api.ts:361`) | none (not implemented) | MISSING | client no-op subscription; never fires **UX:** SSE event cohort:geneBurdenProgress |
| `cohort.getSummaryStatus` | `cohort:summaryStatus` | `src/main/ipc/handlers/cohort.ts:139` | route-override (`src/web/server/routes/cohort.ts:43`) | shared logic: getCohortSummaryStatusViaSession | PARITY | shared getCohortSummaryStatusViaSession |
| `cohort.rebuildSummary` | `cohort:rebuildSummary` | `src/main/ipc/handlers/cohort.ts:146` | 501-unsupportedWebCapability (`src/web/server/routes/cohort.ts:49`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 501 always; Postgres capability cohort.rebuild=false (summary computed live); no renderer caller **UX:** keep hidden; Postgres summary does not need manual rebuild |
| `cohort.onSummaryRebuilt` | `cohort:summaryRebuilt` | `src/main/ipc/handlers/batch-import.ts:47` | sse (`src/web/client/api.ts:538`) | web transport (SSE) | PARITY | SSE 'cohort:summaryRebuilt' published by cases/import/batch-import overrides |

### `annotations`  (PARITY 7, BROKEN 1)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `annotations.getGlobal` | `annotations:getGlobal` | `src/main/ipc/handlers/annotations.ts:56` | route-override (`src/web/server/routes/annotations.ts:16`) | thin adapter over executor task | PARITY | override packs (chr,pos,ref,alt) into coords and executes annotations:getGlobal |
| `annotations.upsertGlobal` | `annotations:upsertGlobal` | `src/main/ipc/handlers/annotations.ts:84` | route-override (`src/web/server/routes/annotations.ts:31`) | shared logic: upsertGlobalAnnotationViaSession | PARITY | shared annotations-logic.upsertGlobalAnnotationViaSession |
| `annotations.deleteGlobal` | `annotations:deleteGlobal` | `src/main/ipc/handlers/annotations.ts:119` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:90`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | BROKEN | write autoroute passes raw args (chr,pos,ref,alt) but executor expects [coords: VariantCoords] (write-executor.ts:60) -> wrong params; latent (no renderer caller; UI deletes via upsertGlobal(null)) **UX:** add override packing coords like annotations:getGlobal |
| `annotations.getPerCase` | `annotations:getPerCase` | `src/main/ipc/handlers/annotations.ts:149` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:47`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | read autoroute (params align); no direct renderer caller |
| `annotations.upsertPerCase` | `annotations:upsertPerCase` | `src/main/ipc/handlers/annotations.ts:176` | route-override (`src/web/server/routes/annotations.ts:48`) | shared logic: upsertPerCaseAnnotationWithEvent | PARITY | shared upsertPerCaseAnnotationWithEvent + SSE annotationChanged |
| `annotations.deletePerCase` | `annotations:deletePerCase` | `src/main/ipc/handlers/annotations.ts:216` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:92`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | write autoroute (params align); no direct renderer caller |
| `annotations.getForVariant` | `annotations:getForVariant` | `src/main/ipc/handlers/annotations.ts:247` | route-override (`src/web/server/routes/annotations.ts:72`) | thin adapter over executor task | PARITY | override packs coords; executes annotations:getForVariant |
| `annotations.batchGet` | `annotations:batchGet` | `src/main/ipc/handlers/annotations.ts:299` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:49`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | read autoroute (params align) |

### `vep`  (MISSING 4)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `vep.fetch` | `vep:fetch` | `src/main/ipc/handlers/vep.ts:35` | fixture-gated (`src/web/server/routes/vep.ts:8`) | fixture builder only | MISSING | 501 in production (fixture-gated); useVepEnrichment.ts:156 is NOT gated -> "VEP fetch failed" in variant details **UX:** server-side Ensembl VEP proxy with shared cache (data-governance decision: coordinates leave the server) or explicit "not available in web" panel |
| `vep.cancel` | `vep:cancel` | `src/main/ipc/handlers/vep.ts:89` | fixture-gated (`src/web/server/routes/vep.ts:34`) | none (not implemented) | MISSING | 501 in production (fixture-gated); no renderer caller **UX:** part of server-side VEP proxy |
| `vep.clearCache` | `vep:clearCache` | `src/main/ipc/handlers/vep.ts:102` | fixture-gated (`src/web/server/routes/vep.ts:27`) | none (not implemented) | MISSING | 501 in production; no renderer caller **UX:** admin cache management |
| `vep.getCacheStats` | `vep:getCacheStats` | `src/main/ipc/handlers/vep.ts:115` | fixture-gated (`src/web/server/routes/vep.ts:20`) | none (not implemented) | MISSING | 501 in production; no renderer caller **UX:** admin cache management |

### `hpo`  (MISSING 2)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `hpo.search` | `hpo:search` | `src/main/ipc/handlers/hpo.ts:41` | fixture-gated (`src/web/server/routes/hpo.ts:8`) | fixture builder only | MISSING | 501 in production (fixture-gated); HpoTermSelector.vue:111 (CaseMetadataCard) ungated -> users cannot add HPO terms to cases in web **UX:** search the bundled HPO ontology (useHpoBundled.ts already exists client-side) or a server-side ontology index |
| `hpo.clearCache` | `hpo:clearCache` | `src/main/ipc/handlers/hpo.ts:81` | fixture-gated (`src/web/server/routes/hpo.ts:23`) | none (not implemented) | MISSING | 501 in production; no renderer caller **UX:** n/a if bundled ontology used |

### `myvariant`  (MISSING 2)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `myvariant.fetch` | `myvariant:fetch` | `src/main/ipc/handlers/myvariant.ts:32` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404 not wired; useVepEnrichment.ts:157 ungated -> MyVariant section errors **UX:** server-side MyVariant.info proxy + cache |
| `myvariant.clearCache` | `myvariant:clearCache` | `src/main/ipc/handlers/myvariant.ts:98` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404; no renderer caller **UX:** admin cache management |

### `spliceai`  (MISSING 2)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `spliceai.fetch` | `spliceai:fetch` | `src/main/ipc/handlers/spliceai.ts:32` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404 not wired; useVepEnrichment.ts:158 ungated -> SpliceAI section errors **UX:** server-side SpliceAI lookup proxy + cache |
| `spliceai.clearCache` | `spliceai:clearCache` | `src/main/ipc/handlers/spliceai.ts:104` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404; no renderer caller **UX:** admin cache management |

### `logs`  (LEGITIMATELY-DESKTOP-ONLY 1)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `logs.onMessage` | `logs:message` | `src/main/services/MainLogger.ts:93` | client-noop-subscription (`src/web/client/api.ts:361`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | client no-op subscription; main-process logs never reach the in-app log viewer (LogService.ts:41) **UX:** show client-side logs only; server logs via operator log pipeline (or admin-only SSE log stream) |

### `updater`  (LEGITIMATELY-DESKTOP-ONLY 5)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `updater.checkForUpdate` | `updater:check` | `src/main/ipc/handlers/updater.ts:15` | client-side-stub (`src/web/client/api.ts:415`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client no-op **UX:** hide updater UI in web; server version is managed by deployment |
| `updater.downloadUpdate` | `updater:download` | `src/main/ipc/handlers/updater.ts:21` | client-side-stub (`src/web/client/api.ts:416`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client no-op **UX:** hide updater UI in web |
| `updater.installUpdate` | `updater:install` | `src/main/ipc/handlers/updater.ts:27` | client-side-stub (`src/web/client/api.ts:417`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client no-op **UX:** hide updater UI in web |
| `updater.getStatus` | `updater:status` | `src/main/ipc/handlers/updater.ts:33` | client-side-stub (`src/web/client/api.ts:418`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client stub {state:'idle'} -> footer shows no update **UX:** hide updater UI in web |
| `updater.onStatusChange` | `updater:status` | `src/main/services/AutoUpdater.ts:17` | client-side-stub (`src/web/client/api.ts:419`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client no-op subscription **UX:** hide updater UI in web |

### `perf`  (LEGITIMATELY-DESKTOP-ONLY 4)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `perf.reportInteractive` | `perf:interactive` | `src/main/index.ts:272` | client-side-stub (`src/web/client/api.ts:371`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client no-op (Electron startup-perf milestone) **UX:** n/a (desktop E2E perf harness) |
| `perf.getSnapshot` | `perf:mainSnapshot` | `src/main/ipc/handlers/system.ts:100` | client-rpc-to-unknown (`src/web/client/api.ts:372`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | would POST /api/perf/getSnapshot -> 404, but perf.isEnabled() is false in web so never called **UX:** n/a |
| `perf.resetSnapshot` | `None` | `None` | client-rpc-to-unknown (`src/web/client/api.ts:373`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | would POST /api/perf/resetSnapshot -> 404; never called in web **UX:** n/a |
| `perf.isEnabled` | `None` | `None` | client-side-stub (`src/web/client/api.ts:374`) | client-side stub | LEGITIMATELY-DESKTOP-ONLY | client stub false **UX:** n/a |

### `caseMetadata`  (PARITY 23)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `caseMetadata.get` | `case-metadata:get` | `src/main/ipc/handlers/case-metadata.ts:121` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:16`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetadata.upsert` | `case-metadata:upsert` | `src/main/ipc/handlers/case-metadata.ts:135` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:71`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.getFullMetadata` | `case-metadata:getFullMetadata` | `src/main/ipc/handlers/case-metadata.ts:500` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:26`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetadata.listCohorts` | `case-metadata:listCohorts` | `src/main/ipc/handlers/case-metadata.ts:163` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:17`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetadata.createCohort` | `case-metadata:createCohort` | `src/main/ipc/handlers/case-metadata.ts:169` | route-override (`src/web/server/routes/case-metadata.ts:6`) | thin adapter over the same executor task | PARITY | route override validates args and executes the matching executor task |
| `caseMetadata.updateCohort` | `case-metadata:updateCohort` | `src/main/ipc/handlers/case-metadata.ts:186` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:73`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.deleteCohort` | `case-metadata:deleteCohort` | `src/main/ipc/handlers/case-metadata.ts:213` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:74`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.getCohortByName` | `case-metadata:getCohortByName` | `src/main/ipc/handlers/case-metadata.ts:228` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:18`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetadata.getCaseCohorts` | `case-metadata:getCaseCohorts` | `src/main/ipc/handlers/case-metadata.ts:246` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:19`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetadata.assignCohort` | `case-metadata:assignCohort` | `src/main/ipc/handlers/case-metadata.ts:260` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:75`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.removeCohort` | `case-metadata:removeCohort` | `src/main/ipc/handlers/case-metadata.ts:278` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:76`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.setCohorts` | `case-metadata:setCohorts` | `src/main/ipc/handlers/case-metadata.ts:296` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:77`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.getHpoTerms` | `case-metadata:getHpoTerms` | `src/main/ipc/handlers/case-metadata.ts:318` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:20`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetadata.assignHpoTerm` | `case-metadata:assignHpoTerm` | `src/main/ipc/handlers/case-metadata.ts:332` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:78`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.removeHpoTerm` | `case-metadata:removeHpoTerm` | `src/main/ipc/handlers/case-metadata.ts:355` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:79`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.getDataInfo` | `case-metadata:getDataInfo` | `src/main/ipc/handlers/case-metadata.ts:374` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:21`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetadata.upsertDataInfo` | `case-metadata:upsertDataInfo` | `src/main/ipc/handlers/case-metadata.ts:388` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:80`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.listExternalIds` | `case-metadata:listExternalIds` | `src/main/ipc/handlers/case-metadata.ts:419` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:22`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetadata.upsertExternalId` | `case-metadata:upsertExternalId` | `src/main/ipc/handlers/case-metadata.ts:433` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:81`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.deleteExternalId` | `case-metadata:deleteExternalId` | `src/main/ipc/handlers/case-metadata.ts:456` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:82`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetadata.distinctHpoTerms` | `case-metadata:distinctHpoTerms` | `src/main/ipc/handlers/case-metadata.ts:478` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:23`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetadata.distinctPlatforms` | `case-metadata:distinctPlatforms` | `src/main/ipc/handlers/case-metadata.ts:484` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:24`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetadata.distinctExternalIdTypes` | `case-metadata:distinctExternalIdTypes` | `src/main/ipc/handlers/case-metadata.ts:490` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:25`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |

### `caseComments`  (PARITY 4)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `caseComments.list` | `case-comments:list` | `src/main/ipc/handlers/case-comments.ts:22` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:50`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseComments.create` | `case-comments:create` | `src/main/ipc/handlers/case-comments.ts:44` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:93`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseComments.update` | `case-comments:update` | `src/main/ipc/handlers/case-comments.ts:74` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:94`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseComments.delete` | `case-comments:delete` | `src/main/ipc/handlers/case-comments.ts:97` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:95`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |

### `caseMetrics`  (PARITY 5)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `caseMetrics.listDefinitions` | `case-metrics:listDefinitions` | `src/main/ipc/handlers/case-metrics.ts:22` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:51`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetrics.createDefinition` | `case-metrics:createDefinition` | `src/main/ipc/handlers/case-metrics.ts:34` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:96`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetrics.listForCase` | `case-metrics:listForCase` | `src/main/ipc/handlers/case-metrics.ts:75` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:52`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `caseMetrics.upsert` | `case-metrics:upsert` | `src/main/ipc/handlers/case-metrics.ts:97` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:97`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `caseMetrics.delete` | `case-metrics:delete` | `src/main/ipc/handlers/case-metrics.ts:127` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:98`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |

### `transcripts`  (PARITY 3)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `transcripts.list` | `transcripts:list` | `src/main/ipc/handlers/transcripts.ts:25` | route-override (`src/web/server/routes/transcripts.ts:11`) | thin adapter over the same executor task | PARITY | route override validates args and executes the matching executor task |
| `transcripts.switch` | `transcripts:switch` | `src/main/ipc/handlers/transcripts.ts:57` | route-override (`src/web/server/routes/transcripts.ts:26`) | thin adapter over the same executor task | PARITY | route override validates args and executes the matching executor task |
| `transcripts.insertAndSwitch` | `transcripts:insertAndSwitch` | `src/main/ipc/handlers/transcripts.ts:99` | route-override (`src/web/server/routes/transcripts.ts:42`) | thin adapter over the same executor task | PARITY | route override validates args and executes the matching executor task |

### `tags`  (PARITY 9)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `tags.list` | `tags:list` | `src/main/ipc/handlers/tags.ts:49` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:43`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `tags.create` | `tags:create` | `src/main/ipc/handlers/tags.ts:59` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:83`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `tags.update` | `tags:update` | `src/main/ipc/handlers/tags.ts:77` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:84`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `tags.delete` | `tags:delete` | `src/main/ipc/handlers/tags.ts:100` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:85`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `tags.getUsageCount` | `tags:getUsageCount` | `src/main/ipc/handlers/tags.ts:119` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:44`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `tags.getVariantTags` | `tags:getVariantTags` | `src/main/ipc/handlers/tags.ts:140` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:45`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `tags.assignVariantTag` | `tags:assignVariantTag` | `src/main/ipc/handlers/tags.ts:158` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:86`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `tags.removeVariantTag` | `tags:removeVariantTag` | `src/main/ipc/handlers/tags.ts:197` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:87`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `tags.setVariantTags` | `tags:setVariantTags` | `src/main/ipc/handlers/tags.ts:236` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:88`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |

### `audit`  (DEGRADED 2)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `audit.getByEntity` | `audit:getByEntity` | `src/main/ipc/handlers/audit-log.ts:65` | route-override (`src/web/server/routes/audit-log.ts:23`) | n/a | DEGRADED | admin-only override (routes/audit-log.ts:17): non-admin web users get 403 in ActivityLogPanel.vue:70; desktop ungated (deliberate: trail includes employee activity) **UX:** role-aware: hide activity panel or show clinical-change subset to non-admins |
| `audit.query` | `audit:query` | `src/main/ipc/handlers/audit-log.ts:92` | route-override (`src/web/server/routes/audit-log.ts:24`) | n/a | DEGRADED | admin-only override; no renderer caller **UX:** admin audit page |

### `geneLists`  (PARITY 5)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `geneLists.list` | `gene-lists:list` | `src/main/ipc/handlers/gene-lists.ts:27` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:57`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `geneLists.create` | `gene-lists:create` | `src/main/ipc/handlers/gene-lists.ts:42` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:106`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `geneLists.delete` | `gene-lists:delete` | `src/main/ipc/handlers/gene-lists.ts:65` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:107`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `geneLists.getGenes` | `gene-lists:getGenes` | `src/main/ipc/handlers/gene-lists.ts:86` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:58`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `geneLists.setGenes` | `gene-lists:setGenes` | `src/main/ipc/handlers/gene-lists.ts:113` | route-override (`src/web/server/routes/gene-lists.ts:6`) | thin adapter over executor tasks | PARITY | override executes setGenes then returns getGenes |

### `regionFiles`  (PARITY 4)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `regionFiles.list` | `region-files:list` | `src/main/ipc/handlers/gene-lists.ts:145` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:59`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `regionFiles.create` | `region-files:create` | `src/main/ipc/handlers/gene-lists.ts:160` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:109`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `regionFiles.delete` | `region-files:delete` | `src/main/ipc/handlers/gene-lists.ts:186` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:110`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `regionFiles.importBed` | `region-files:importBed` | `src/main/ipc/handlers/gene-lists.ts:207` | route-override (`src/web/server/routes/region-files.ts:10`) | thin adapter over executor task | PARITY | override resolves upload ref then executes region-files:importBed (rejectMalformedRows:true) |

### `panels`  (PARITY 11, BROKEN 2, MISSING 4)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `panels.list` | `panels:list` | `src/main/ipc/handlers/panels.ts:65` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:53`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `panels.get` | `panels:get` | `src/main/ipc/handlers/panels.ts:75` | route-override (`src/web/server/routes/panels.ts:7`) | shared logic: getPanelWithGenes | PARITY | shared panels-logic.getPanelWithGenes |
| `panels.create` | `panels:create` | `src/main/ipc/handlers/panels.ts:86` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:99`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `panels.update` | `panels:update` | `src/main/ipc/handlers/panels.ts:105` | route-override (`src/web/server/routes/panels.ts:19`) | thin adapter over executor task | PARITY | override maps renderer object to executor shape |
| `panels.delete` | `panels:delete` | `src/main/ipc/handlers/panels.ts:132` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:101`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `panels.duplicate` | `panels:duplicate` | `src/main/ipc/handlers/panels.ts:151` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:102`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `panels.setGenes` | `panels:setGenes` | `src/main/ipc/handlers/panels.ts:173` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:103`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `panels.getGenes` | `panels:getGenes` | `src/main/ipc/handlers/panels.ts:193` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:55`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `panels.activate` | `panels:activate` | `src/main/ipc/handlers/panels.ts:214` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:104`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | write autoroute; no renderer caller |
| `panels.deactivate` | `panels:deactivate` | `src/main/ipc/handlers/panels.ts:237` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:105`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | write autoroute; no renderer caller |
| `panels.activeForCase` | `panels:active-for-case` | `src/main/ipc/handlers/panels.ts:255` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:56`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | read autoroute; no renderer caller (desktop channel is panels:active-for-case) |
| `panels.validateSymbols` | `panels:validate-symbols` | `src/main/ipc/handlers/panels.ts:279` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | BROKEN | 404 not wired, NOT gated: PanelEditorDialog.vue:306 / useGeneValidation.ts:123 gene-symbol validation fails in web, so panels cannot be built from symbol lists **UX:** serve validateSymbols from the web gene reference DB (web-gene-reference.ts already opens resources/gene_reference.db) |
| `panels.autocomplete` | `panels:autocomplete` | `src/main/ipc/handlers/panels.ts:294` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | BROKEN | 404 not wired, NOT gated (useGeneValidation.ts:159) **UX:** serve from web gene reference DB |
| `panels.searchPanelApp` | `panels:search-panelapp` | `src/main/ipc/handlers/panels.ts:310` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404 not wired, NOT gated (PanelAppImportDialog.vue:230) **UX:** server-side PanelApp proxy |
| `panels.importPanelApp` | `panels:import-panelapp` | `src/main/ipc/handlers/panels.ts:325` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404 not wired, NOT gated (PanelAppImportDialog.vue:253) **UX:** server-side PanelApp proxy + importPanelAppForSession (exists for Postgres sessions) |
| `panels.generateStringDb` | `panels:generate-stringdb` | `src/main/ipc/handlers/panels.ts:345` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404 not wired, NOT gated (StringDbGenerateDialog.vue:182) **UX:** server-side STRING proxy + generateStringDbForSession |
| `panels.exportBed` | `panels:export-bed` | `src/main/ipc/handlers/panels.ts:369` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404 not wired, NOT gated (PanelManagerDialog.vue:431) **UX:** browser download of BED computed server-side from gene reference DB |

### `geneRef`  (MISSING 2, LEGITIMATELY-DESKTOP-ONLY 2)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `geneRef.info` | `gene-ref:info` | `src/main/ipc/handlers/gene-ref.ts:14` | fixture-gated (`src/web/server/routes/gene-ref.ts:8`) | shared? no: web-only web-gene-reference.ts (node:sqlite) | MISSING | 501 in production although web-gene-reference.ts can serve real data; only enabled with parity fixtures. PanelManagerDialog.vue:308 calls it ungated **UX:** drop the fixture gate and serve getWebGeneReferenceDb().getInfo() |
| `geneRef.assemblies` | `gene-ref:assemblies` | `src/main/ipc/handlers/gene-ref.ts:21` | fixture-gated (`src/web/server/routes/gene-ref.ts:15`) | web-only web-gene-reference.ts | MISSING | 501 in production (same as info); no renderer caller **UX:** serve getWebGeneReferenceDb().getAssemblies() |
| `geneRef.checkUpdates` | `gene-ref:check-updates` | `src/main/ipc/handlers/gene-ref.ts:32` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; desktop downloads gene reference updates into userData **UX:** operator updates gene_reference.db in the image |
| `geneRef.update` | `gene-ref:update` | `src/main/ipc/handlers/gene-ref.ts:57` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; PanelManagerDialog.vue:404 update button not gated in web **UX:** hide update button in web; image rebuild updates reference |

### `auth`  (PARITY 8, MISSING 1)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `auth.login` | `auth:login` | `src/main/ipc/handlers/auth.ts:30` | route-override (`src/web/server/routes/auth.ts:29`) | separate web auth service (by design) | PARITY | web reimplementation on PostgresWebAuthService + session cookie (by design: different auth boundary) |
| `auth.logout` | `auth:logout` | `src/main/ipc/handlers/auth.ts:41` | route-override (`src/web/server/routes/auth.ts:82`) | separate web auth service (by design) | PARITY | session cookie delete + audit |
| `auth.currentUser` | `auth:currentUser` | `src/main/ipc/handlers/auth.ts:47` | route-override (`src/web/server/routes/auth.ts:97`) | separate web auth service (by design) | PARITY | returns session user |
| `auth.isAccountsEnabled` | `auth:isAccountsEnabled` | `src/main/ipc/handlers/auth.ts:53` | route-override (`src/web/server/routes/auth.ts:102`) | separate web auth service (by design) | PARITY | public override; true under platform identity |
| `auth.createUser` | `auth:createUser` | `src/main/ipc/handlers/auth.ts:59` | route-override(501-path) (`src/web/server/routes/auth.ts:198`) | separate web auth service | MISSING | always 501 'multi-user-disabled' (single-tenant release) after admin+schema checks; platform-identity mode denies **UX:** decide multi-user story (platform identity / OIDC provisioning) |
| `auth.listUsers` | `auth:listUsers` | `src/main/ipc/handlers/auth.ts:78` | route-override (`src/web/server/routes/auth.ts:218`) | separate web auth service | PARITY | admin-gated |
| `auth.deactivateUser` | `auth:deactivateUser` | `src/main/ipc/handlers/auth.ts:84` | route-override (`src/web/server/routes/auth.ts:225`) | separate web auth service | PARITY | admin-gated; denied in platform-identity mode |
| `auth.resetPassword` | `auth:resetPassword` | `src/main/ipc/handlers/auth.ts:95` | route-override (`src/web/server/routes/auth.ts:255`) | separate web auth service | PARITY | admin-gated; denied in platform-identity mode |
| `auth.changePassword` | `auth:changePassword` | `src/main/ipc/handlers/auth.ts:117` | route-override (`src/web/server/routes/auth.ts:109`) | separate web auth service | PARITY | session-based; denied in platform-identity mode; reachable pre-rotation |

### `analysisGroups`  (PARITY 8)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `analysisGroups.list` | `analysisGroups:list` | `src/main/ipc/handlers/analysis-groups.ts:29` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:61`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `analysisGroups.get` | `analysisGroups:get` | `src/main/ipc/handlers/analysis-groups.ts:42` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:62`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `analysisGroups.create` | `analysisGroups:create` | `src/main/ipc/handlers/analysis-groups.ts:65` | route-override (`src/web/server/routes/analysis-groups.ts:9`) | thin adapter over executor task | PARITY | override validates and executes analysis-groups:create; no renderer caller |
| `analysisGroups.update` | `analysisGroups:update` | `src/main/ipc/handlers/analysis-groups.ts:93` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:117`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `analysisGroups.delete` | `analysisGroups:delete` | `src/main/ipc/handlers/analysis-groups.ts:125` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:118`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `analysisGroups.addMember` | `analysisGroups:addMember` | `src/main/ipc/handlers/analysis-groups.ts:150` | route-override (`src/web/server/routes/analysis-groups.ts:29`) | thin adapter over executor task | PARITY | override validates and executes addMember; no renderer caller |
| `analysisGroups.removeMember` | `analysisGroups:removeMember` | `src/main/ipc/handlers/analysis-groups.ts:186` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:120`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `analysisGroups.getForCase` | `analysisGroups:getForCase` | `src/main/ipc/handlers/analysis-groups.ts:213` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:63`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |

### `protein`  (MISSING 4)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `protein.getMapping` | `protein:mapping` | `src/main/ipc/handlers/protein.ts:72` | fixture-gated (`src/web/server/routes/protein.ts:17`) | fixture builder only | MISSING | 501 in production (fixture-gated); renderer gates the protein viewer off in web (runtime-features.ts:17, VariantDetailsPanel.vue:194) **UX:** server-side UniProt proxy + cache |
| `protein.getDomains` | `protein:domains` | `src/main/ipc/handlers/protein.ts:109` | fixture-gated (`src/web/server/routes/protein.ts:31`) | fixture builder only | MISSING | 501 in production; UI gated **UX:** server-side InterPro proxy + cache |
| `protein.getStructure` | `protein:structure` | `src/main/ipc/handlers/protein.ts:127` | fixture-gated (`src/web/server/routes/protein.ts:49`) | fixture builder only | MISSING | 501 in production; UI gated **UX:** server-side AlphaFold proxy (or direct browser fetch of public CIF URLs) |
| `protein.getGeneStructure` | `protein:gene-structure` | `src/main/ipc/handlers/protein.ts:145` | fixture-gated (`src/web/server/routes/protein.ts:67`) | fixture builder only | MISSING | 501 in production; UI gated **UX:** server-side Ensembl proxy |

### `gnomad`  (MISSING 2)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `gnomad.getVariants` | `gnomad:variants` | `src/main/ipc/handlers/gnomad.ts:38` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404 not wired; only reachable from the protein viewer which is gated off in web (LollipopPlotPanel.vue:186) **UX:** server-side gnomAD GraphQL proxy + cache |
| `gnomad.getClinVarVariants` | `gnomad:clinvar` | `src/main/ipc/handlers/gnomad.ts:81` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404 not wired; gated with protein viewer (ProteinVisualizationModal.vue:227) **UX:** server-side gnomAD ClinVar proxy |

### `presets`  (PARITY 5)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `presets.list` | `presets:list` | `src/main/ipc/handlers/filter-presets.ts:21` | generic-bridge(read-task autoroute) (`src/web/server/task-types.ts:60`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(read-task autoroute): positional args match executor params |
| `presets.create` | `presets:create` | `src/main/ipc/handlers/filter-presets.ts:31` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:112`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `presets.update` | `presets:update` | `src/main/ipc/handlers/filter-presets.ts:48` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:113`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `presets.delete` | `presets:delete` | `src/main/ipc/handlers/filter-presets.ts:74` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:114`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |
| `presets.reorder` | `presets:reorder` | `src/main/ipc/handlers/filter-presets.ts:93` | generic-bridge(write-task autoroute) (`src/web/server/task-types.ts:115`) | same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults | PARITY | generic-bridge(write-task autoroute): positional args match executor params |

### `debug`  (LEGITIMATELY-DESKTOP-ONLY 2)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `debug.queryCountersGet` | `debug:queryCounters:get` | `src/main/ipc/domains/debug.ts:11` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; desktop-only Postgres query counters for perf gates; no renderer caller **UX:** web uses /metrics |
| `debug.queryCountersReset` | `debug:queryCounters:reset` | `src/main/ipc/domains/debug.ts:18` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | LEGITIMATELY-DESKTOP-ONLY | 404; no renderer caller **UX:** web uses /metrics |

### `jobs`  (MISSING 3)

| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |
|---|---|---|---|---|---|---|
| `jobs.list` | `jobs:list` | `src/main/ipc/domains/jobs.ts:21` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404; web batch import uses jobRunner but no jobs endpoint; no renderer caller yet **UX:** expose per-user job list over HTTP + SSE when a jobs UI lands |
| `jobs.get` | `jobs:get` | `src/main/ipc/domains/jobs.ts:34` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404; no renderer caller **UX:** same |
| `jobs.progress` | `jobs:progress` | `src/main/ipc/domains/jobs.ts:47` | 404-not-wired (`src/web/server/dispatcher.ts:412`) | none (not implemented) | MISSING | 404; no renderer caller **UX:** same |

## StorageCapabilities

Type: `src/shared/types/storage-capabilities.ts:3`. SQLite: `src/main/storage/sqlite/SqliteStorageSession.ts:18 (SQLITE_CAPABILITIES; every flag true except workspace.hostedConnectionLifecycle=false)`. Postgres: `src/main/storage/postgres/PostgresStorageSession.ts:49 (POSTGRES_CAPABILITIES)`. Web overlay: `src/web/server/routes/database.ts:5 webCapabilities(): export.{variants,cohort,streaming}=false unless webParityFixturesEnabled()`.

| Flag | SQLite (desktop) | Postgres (desktop) | Web (served) |
|---|---|---|---|
| `workspace.localFileLifecycle` | True | False | False |
| `workspace.hostedConnectionLifecycle` | False | True | True |
| `workspace.encryptionAtRest` | True | False | False |
| `cases.deleteMany` | True | False | False |
| `cases.deleteAll` | True | False | False |
| `variants.legacySearch` | True | False | False |
| `cohort.rebuild` | True | False | False |
| `export.variants` | True | True | False |
| `export.cohort` | True | True | False |
| `export.streaming` | True | True | False |

All other flags: true for both backends (workspace.migrations, workspace.healthDiagnostics, cases.list/query/deleteOne/overview, imports.*, variants.* except legacySearch, workflow.*, cohort.* except rebuild).

Gate semantics: src/renderer/src/utils/backend-capabilities.ts: CapabilityPath union (line 5) covers 24 paths; currentCanUseFeature (line 98) FAILS OPEN (returns true) while capabilities are null; getCurrentUnsupportedReason (line 79) returns null on load error (also fail-open).

Flags declared but never read by the renderer: `workspace.*`, `cases.list`, `cases.query`, `imports.*`, `variants.searchQuery`, `variants.legacySearch`, `variants.typeCounts`, `variants.typesPresent`, `variants.geneSymbols`, `workflow.caseComments`, `workflow.caseMetrics`, `workflow.geneLists`, `workflow.regionFiles`, `workflow.analysisGroups`, `workflow.auditLog`, `cohort.rebuild`, `cohort.carriers`, `cohort.geneBurden`, `export.streaming`.

### Renderer capability consumers

| Capability path | Site | Effect |
|---|---|---|
| `cases.deleteAll` | `src/renderer/src/App.vue:234` | blocks Delete-all-cases action with a warning (false on Postgres/web) |
| `cases.overview` | `src/renderer/src/components/DatabaseOverviewDialog.vue:61` | overview dialog unsupported message (true everywhere) |
| `cases.deleteOne` | `src/renderer/src/components/CaseList.vue:449` | single case delete guard (true everywhere) |
| `cases.deleteMany` | `src/renderer/src/components/CaseList.vue:537` | blocks batch delete (false on Postgres/web) |
| `variants.(tag|comment|acmg|annotation|panel|inheritance|analysisGroup|phasing)Filters, variants.columnMeta` | `src/renderer/src/components/FilterToolbar.vue:235-262` | strips unsupported filter keys before querying (all true on both backends today) |
| `variants.acmgFilters` | `src/renderer/src/components/FilterToolbar.vue:489` | hides ACMG filter control |
| `(any CapabilityPath)` | `src/renderer/src/components/FilterToolbar.vue:222` | warns/logs reason when a filter is unsupported |
| `workflow.filterPresets` | `src/renderer/src/components/FilterToolbar.vue:695; src/renderer/src/components/cohort/CohortFilterBar.vue:607` | blocks preset save/load |
| `(any CapabilityPath)` | `src/renderer/src/components/cohort/CohortFilterBar.vue:174` | cohort filter unsupported warnings |
| `cohort.query / export.cohort / cohort.summary / cohort.columnMeta` | `src/renderer/src/components/CohortTable.vue:221,225,229,239` | cohort table load, cohort CSV export (disabled in web), summary, column meta |
| `variants.columnMeta` | `src/renderer/src/composables/useVariantColumnMeta.ts:106` | skips column-meta fetch |
| `variants.filterOptions / workflow.tags` | `src/renderer/src/composables/useFilterOptionsCache.ts:22,85,127,136` | skips filter-options/tag loading |
| `export.variants` | `src/renderer/src/composables/useFilterExport.ts:9` | variant CSV export disabled with message (web) |

## Renderer runtime gates (web vs desktop branching)

| Site | Check | Effect |
|---|---|---|
| `src/renderer/src/utils/runtime-mode.ts:1` | isWebRuntime() = window.__VARLENS_WEB__ === true (set by src/web/client/install-api.ts:9) | single source of runtime branching |
| `src/renderer/src/utils/runtime-features.ts:17` | isProteinViewerAvailable() = !isWebRuntime() | protein:* and gnomad:* unreachable in web |
| `src/renderer/src/components/VariantDetailsPanel.vue:282,194,201` | proteinViewerAvailable | hides protein/lollipop modal; renders an unavailable note instead |
| `src/renderer/src/components/VariantDetailsPanel.vue:290` | isWebRuntime() | emits 'variant-updated' after tag changes (web-only refresh) |
| `src/renderer/src/components/DatabasePicker.vue:20,301` | isWebMode | web shows single static workspace item; hides recent DBs, open/create/delete/show-in-folder, encryption actions |
| `src/renderer/src/components/DatabasePicker.vue:327,444` | !isWebMode | skips postgresProfilesList fetch in web |
| `src/renderer/src/components/AppSidebar.vue:24` | !isWebMode | hides 'Import VCF Files' (multi-file SNV/SV/CNV/STR) menu item in web |
| `src/renderer/src/components/AppToolbar.vue:122` | !isWebMode | hides 'Import VCF Files' multi-file import in web |
| `src/renderer/src/components/CaseMetadataModal.vue:28,94,162` | isWebMode | web uses button tabs + v-if panes instead of v-tabs-window (same four panes; layout-only) |
| `src/renderer/src/components/VariantTable.vue:489,648` | isWebRuntime() | web subscribes to variants.onAnnotationChanged and reloads when annotation-backed filters are active |
| `src/renderer/src/components/CohortTable.vue:557` | isWebRuntime() | web reloads cohort on annotation change with annotation-backed filters |
| `src/renderer/src/components/import/ImportWizard.vue:332,367,783,787,858` | isWebRuntime() | browser-upload progress events (WEB_UPLOAD_EVENT), upload cancel, SSE import progress wiring |
| `src/renderer/src/App.vue:282` | isWebRuntime() | invalidates variant column meta cache on case delete |
| `src/renderer/src/App.vue:319` | !isWebRuntime() return | handleDialogBatchImportComplete only acts in web |
| `src/renderer/src/App.vue:324` | !isWebRuntime() return | handleMetadataChanged refresh only in web |
| `src/renderer/src/composables/useShellLifecycle.ts:55,63` | isWebRuntime() | invalidates column-meta cache after import/batch import in web |
| `src/renderer/src/components/KeyboardShortcutsDialog.vue:38; src/renderer/src/components/SlimFilterToolbar.vue:219` | navigator.platform Mac | cosmetic modifier-key labels only |
| `src/renderer/src/components/HpoTermSelector.vue:96` | typeof api.hpo.search === 'function' | feature-detect is always true under the web Proxy (Proxy returns a function for every property) -> no web gating |
| `src/renderer/src/composables/useCohortData.ts:191,234` | typeof cohortApi.onSummaryRebuilt/getSummaryStatus === 'function' | feature-detects are always true under the web Proxy |

**Ungated web failures.** These non-PARITY methods are called from renderer code with no web gate, so the user sees an error or a silent no-op:

- window.api.hpo.search  (HpoTermSelector.vue:111 via CaseMetadataCard: 501 -> cannot add HPO terms)
- window.api.vep.fetch / myvariant.fetch / spliceai.fetch  (useVepEnrichment.ts:156-158: 501/404 -> enrichment sections error)
- window.api.panels.validateSymbols / autocomplete  (useGeneValidation.ts:123,159; PanelEditorDialog.vue:306: 404)
- window.api.panels.searchPanelApp / importPanelApp  (PanelAppImportDialog.vue:230,253: 404)
- window.api.panels.generateStringDb  (StringDbGenerateDialog.vue:182: 404)
- window.api.panels.exportBed  (PanelManagerDialog.vue:431: 404)
- window.api.geneRef.info / geneRef.update  (PanelManagerDialog.vue:308,404: 501/404)
- window.api.cohort.runAssociation / cancelAssociation / onAssociationProgress  (useAssociation.ts:30,35,47: 501 / silent)
- window.api.cohort.getVariants with active gene panels  (gene-reference stub throws; verify at runtime)
- window.api.audit.getByEntity  (ActivityLogPanel.vue:70: 403 for non-admin web users)
- window.api.auth.createUser  (UserManagement.vue:54: 501 multi-user-disabled)
- window.api.system.setWorkerThreads  (ApplicationPreferences.vue:135: silent no-op)
- window.api.shell.updateDomains  (externalLinksStore.ts:289: silent no-op; user domains blocked by openExternal)
- window.api.import.cancel / batchImport.cancel  (cross-user global cancel)

Gaps hidden by capability flags (the user sees a "not available" message): cases.deleteAll (App.vue:234), cases.deleteBatch (CaseList.vue:537), export.variants (useFilterExport.ts:9), export.cohort (CohortTable.vue:225). Gaps hidden by runtime gates: protein/gnomad viewer, database file lifecycle, multi-file VCF import entry.

## Event / push channels

| Channel | Desktop emitter | Preload subscriber | Web | Status |
|---|---|---|---|---|
| `import:progress` | src/main/ipc/handlers/import.ts:124 (safeEmit) | src/preload/window-api/core-api.ts:288 import.onProgress | SSE event via WebEventHub; published src/web/server/routes/import.ts:145,245; client src/web/client/api.ts:430 | PARITY |
| `batch-import:progress` | src/main/ipc/handlers/batch-import.ts:45 | core-api.ts:345 batchImport.onProgress | SSE; published routes/batch-import.ts:382; client api.ts:472 | PARITY |
| `batch-import:complete` | src/main/ipc/handlers/batch-import.ts:46 | core-api.ts:346 batchImport.onComplete | SSE; published routes/batch-import.ts:421; client api.ts:476 | PARITY |
| `cohort:summaryRebuilt` | handlers/cohort.ts:35,36,42; handlers/batch-import.ts:47; handlers/cases.ts:25 | core-api.ts:361 cohort.onSummaryRebuilt | SSE; published routes/cases.ts:28-29, routes/import.ts:134,152,231,258, routes/batch-import.ts:337,420; client api.ts:538 | PARITY |
| `variants:annotationChanged` | handlers/annotations.ts:36 (broadcast from upsertPerCase, :207) | core-api.ts:275 variants.onAnnotationChanged | SSE; published routes/annotations.ts:65 only to the acting user; client api.ts:522 | PARITY |
| `cohort:geneBurdenProgress` | handlers/cohort.ts:129 | core-api.ts:358 cohort.onAssociationProgress | none: client on* fallback returns no-op unsubscribe (api.ts:361); association itself is 501 | MISSING |
| `logs:message` | src/main/services/MainLogger.ts:93 | core-api.ts:401 logs.onMessage | none: no-op subscription | LEGITIMATELY-DESKTOP-ONLY |
| `updater:status` | src/main/services/AutoUpdater.ts:17 | core-api.ts:409 updater.onStatusChange | client stub no-op (api.ts:419) | LEGITIMATELY-DESKTOP-ONLY |
| `perf:interactive (renderer->main send)` | listener src/main/index.ts:272 (ipcMain.once) | core-api.ts:413 perf.reportInteractive | client no-op (api.ts:371) | LEGITIMATELY-DESKTOP-ONLY |
| `cases:deleted` | src/main/ipc/handlers/cases.ts:24 | NONE (orphan emit, no preload subscriber) | n/a | ORPHAN |
| `export:progress` | src/main/ipc/handlers/export.ts:132,227 | NONE (orphan emit) | n/a (export unsupported) | ORPHAN |

SSE transport notes:

- Single endpoint GET /api/events (src/web/server/events.ts:40), text/event-stream, hijacked reply; auth = session user (401 otherwise).
- WebEventHub (events.ts:9) is an in-memory Map<userId, listeners>: events reach only the acting user, and only on the same Node process (no cross-instance fan-out; horizontal scaling would silently drop events).
- No heartbeat/keep-alive comments after the initial ": connected" (events.ts:54): idle-timeout proxies can drop the stream; EventSource auto-reconnects but events emitted during the gap are lost (no Last-Event-ID replay).
- Client shares one EventSource across subscribers and closes it when the last subscriber unsubscribes (src/web/client/api.ts:322-352).
- Any window.api.<domain>.on* without an explicit client override resolves to a no-op unsubscribe (api.ts:361), so missing event bridges fail silently.
- Browser upload progress is a separate client-only CustomEvent channel (varlens:web-upload, api.ts:28) driven by XHR upload.onprogress.

## Dead, hidden, or alias web routes

- database:health (routes/database.ts:25) - no window.api method
- import:selectFile/selectFiles/selectBedFile and batch-import:selectFiles/selectFolder/selectZip server overrides (return null/[]) are shadowed by client overrides and unreachable from the SPA
- Alias autoroutes reachable only by direct HTTP: `variants:filterOptions`, `cohort:query`, `cohort:summary`, `cohort:columnMeta`, `cohort:carriers`, `cohort:geneBurden`, `database:overview`. These READ_TASK_TYPES are reachable as POST /api/<domain>/<method> but the SPA uses the preload method names (getFilterOptions, getVariants, ...). They bypass the per-route Zod validation the matching overrides apply (e.g. CohortSearchParamsSchema).

## Desktop defects found incidentally

- src/preload/window-api/core-api.ts:312-331: database wrapper omits migrateToEncrypted, deletePlaintextBackup, setRecoveryPassphrase (present in preload/domains/database.ts:13-17, contract, and main handlers) -> databaseStore.ts:202/216/227 call undefined on desktop (TypeError). Masked by `as WindowAPI['database']` cast.
- src/preload/window-api/core-api.ts:316: create: (path, password) => databaseDomain.create(path, password) drops setupPassphrase -> first-run passphrase setup re-call from databaseStore.ts:144 never reaches main.
- Orphan desktop emits with no preload subscriber: cases:deleted (handlers/cases.ts:24), export:progress (handlers/export.ts:132,227).

## Existing parity tests and their blind spots

| Test | Runs in | Enforces | Blind spots |
|---|---|---|---|
| `tests/shared/types/preload-contract.test.ts` | default make test | WindowAPI top-level keys == preload keys == mockApi keys; selected domain modules use shared contracts; IpcResult source-string checks; caseMetadata not laundered via cast | does not check per-method forwarding inside the core-api/app-api wrappers: database wrapper is cast `as WindowAPI['database']` (core-api.ts:331) and silently omits migrateToEncrypted/deletePlaintextBackup/setRecoveryPassphrase and drops create()'s setupPassphrase; says nothing about web. |
| `tests/web-gate/handler-seam.test.ts` | make web-gate-static (opt-in; NOT default CI) | every shared domain has preload + main module; route override modules are all imported by dispatcher; routes never touch Postgres directly; override keys are pass-through/shared-logic/unsupported (ts-morph verdict) except audited exception files | treats unsupportedWebCapability as an acceptable verdict; never enumerates contract methods, so 404 (not-wired) methods and fixture-gated 501s pass; flat handlers (shell/system/updater/shortlist) excluded; does not verify autoroute arg-shape compatibility (annotations.deleteGlobal). |
| `tests/web-gate/web-client-api.test.ts` | web-gate-static | client Proxy RPC/error envelope, SSE bridging for the 5 bridged events, picker/upload behaviour | does not assert that every WindowAPI method is reachable; on* no-op fallback untested for unbridged events |
| `tests/web-gate/dispatcher-adapters-{core,read-seams,auth-import,assets-annotations-export}.test.ts` | web-gate-static | per-override unit behaviour with mocked session; unknown method -> 404; metrics | LOCKS IN the gaps: asserts 501 unsupported-web-capability for cohort association/rebuild, export, reference APIs (read-seams.test.ts:197-231, assets-annotations-export.test.ts:419-436); no coverage of not-wired methods |
| `scripts/ipc-parity/validate-fixtures.ts (make web-ipc-fixtures)` | prerequisite of web-gate-static | tests/fixtures/ipc-parity/manifest.json covers the same 23 IPC areas and its fixture files validate | area-level list is hard-coded; no method-level completeness |
| `tests/web-gate/parity/ipc-fixture-parity.test.ts + parity/ipc/*.ts` | make web-gate-parity / web-parity-e2e (opt-in; needs VARLENS_PG_URL + Electron build) | desktop-vs-web hash equality for ~76 method calls across 23 areas (REQUIRED_IPC_AREAS, scenarios.ts:27); runs web with VARLENS_WEB_PARITY_FIXTURES=1 | runs with parity fixtures ON, so fixture-gated 501s (vep/hpo/protein/geneRef/export) look like parity although production returns 501; no scenarios for gnomad/myvariant/spliceai/jobs/debug/shell/system/updater/logs or panels.validateSymbols/autocomplete/PanelApp/STRING/exportBed, cases.deleteAll/deleteBatch, cohort association; LIKELY STALE: seeds via import.start with absolute server paths (ipc-fixture-parity.test.ts:178) but serverPathImportDisabled() is hard-coded true since 37167a54 (2026-06-13) while the harness was last touched 2026-05-26 -> web seed should 403 (verify by running). |
| `tests/web-gate/parity/data-manifest-parity.test.ts, import-and-filter.test.ts` | opt-in parity | import/filter output parity on manifest data | same server-path import seeding (data-manifest-parity-support.ts:244,298; import-and-filter.test.ts:261) -> likely broken by the server-path disable |
| `tests/web-gate/integration/*` | make web-gate-postgres / web-ci (opt-in) | server lifecycle, auth gates, must-change-password, metrics, openapi, migrations | no channel coverage |

**Does any test fail when a desktop channel has no web implementation?** NO. No test fails when a desktop channel has no web implementation. handler-seam checks module triples and override-key style; dispatcher tests assert 404/501 behaviour; the parity suite only covers listed scenarios (and with fixtures on). A completeness gate would need to enumerate every *DomainContract method + flat API and require each to be either routed (override/autoroute/client override) or explicitly allowlisted as desktop-only.

## Existing planning intent (for reconciliation)

- `.planning/web/context/decisions/adr/0002-parallel-maintainability.md`: one `<domain>-logic.ts` per domain shared by both transports. It is violated by the batch-import (`startWebBatchImport`) and checkDuplicates reimplementations, and the per-route adapters for variants.query, transcripts, and annotations getGlobal/getForVariant duplicate validation instead of sharing it.
- `.planning/web/backlog/web-browser-upload-and-downloads.md`: the **upload half is now implemented** (`routes/upload-staging.ts`, client pickers), so the doc is stale there. The **download half is still open**: export is 501 or capability-disabled.
- `.planning/web/backlog/web-cohort-association-support.md`: asks to choose between implementing association or gating it in the UI. Neither has been done, so the run action is ungated and returns 501.
- `tests/web-gate/README.md` and `handler-seam.test.ts` ROUTE_OVERRIDE_LOGIC_EXCEPTIONS: say web "intentionally disables external reference fetches" (gene-ref, hpo, protein, vep). That leaves HPO term entry, VEP/MyVariant/SpliceAI enrichment, and panel gene validation unusable in web without a recorded UX decision.
- `.planning/web/backlog/phase3-execution-plan.md` planned hand-written `src/web/api-shim/<domain>.ts` files implementing each `*DomainContract`, so the compiler would catch missing methods. What shipped is a permissive Proxy (`api.ts:5-19`), which removes that compile-time completeness check.
