#!/usr/bin/env python3
"""Merge raw.json with manual classification -> static-inventory.json + static-inventory.md"""
import json, sys, collections, datetime

HERE = sys.argv[1]
raw = json.load(open(f'{HERE}/raw.json'))
recs = raw['records']

P, D, B, M, L = 'PARITY', 'DEGRADED', 'BROKEN', 'MISSING', 'LEGITIMATELY-DESKTOP-ONLY'
EXEC_SHARED = 'same StorageSession executor task the desktop handler uses on its Postgres branch (desktop SQLite branch uses legacy DatabaseService); web skips desktop Zod validation/defaults'

# key -> (classification, reason, ux_decision_or_None, shared_logic_override_or_None, impact 0-5)
C = {
 # cases
 'cases.list': (P, 'override calls session.listCases(); desktop cases-logic.listCases wraps the same call', None, 'shared: session.listCases (desktop via cases-logic.listCases)', 5),
 'cases.query': (P, 'read autoroute; renderer (CaseList.vue:309) sends complete params so missing Zod defaults do not matter', None, None, 5),
 'cases.delete': (P, 'override executes cases:delete and publishes cohort:summaryRebuilt; desktop uses deleteSingleCaseForCurrentSession + emits orphan cases:deleted', None, 'thin re-implementation over executor task cases:delete', 4),
 'cases.deleteAll': (M, '404 not wired; Postgres capability cases.deleteAll=false so App.vue:234 shows "not available" warning', 'admin-only server-side bulk delete job, or keep capability-gated', None, 2),
 'cases.deleteBatch': (M, '404 not wired; Postgres capability cases.deleteMany=false gates CaseList.vue:537', 'server-side batch delete (loop cases:delete in one transaction/job)', None, 3),
 'cases.availableBuilds': (P, 'read autoroute', None, None, 3),
 # variants
 'variants.query': (P, 'override validates with the same shared/api/schemas and executes variants:query', None, 'thin re-implementation over executor task (desktop: variants-logic.queryVariants)', 5),
 'variants.getFilterOptions': (P, 'override calls shared variants-logic.getFilterOptions', None, None, 5),
 'variants.search': (P, 'override calls shared variants-logic.searchVariants; no renderer callers (legacySearch=false on Postgres)', None, None, 0),
 'variants.geneSymbols': (P, 'read autoroute; renderer passes explicit limit 50 (desktop preload defaults limit, web does not)', None, None, 3),
 'variants.typeCounts': (P, 'read autoroute', None, None, 4),
 'variants.columnMeta': (P, 'override validates payload, executes variants:columnMeta', None, None, 4),
 'variants.typesPresent': (P, 'read autoroute; payload {caseId}|{caseIds} matches executor scope', None, None, 3),
 'variants.shortlist': (P, 'read autoroute', None, None, 4),
 'variants.onAnnotationChanged': (P, "SSE 'variants:annotationChanged' published by annotations:upsertPerCase override (routes/annotations.ts:65); per-user, single-process hub", None, 'web transport (SSE) for the same AnnotationChangeEvent', 3),
 # import
 'import.selectFile': (P, 'browser <input type=file> + XHR upload to POST /api/import/upload returns an upload ref used in place of a path', None, 'web equivalent (upload staging)', 5),
 'import.selectFiles': (P, 'browser multi-file picker + upload refs', None, 'web equivalent (upload staging)', 4),
 'import.selectBedFile': (P, 'browser picker + upload ref; region-files:importBed and import filters resolve refs', None, 'web equivalent (upload staging)', 3),
 'import.enrollDroppedFiles': (P, 'dropped File objects uploaded; refs returned (desktop: webUtils.getPathForFile + enrollment token)', None, 'web equivalent (upload staging)', 3),
 'import.start': (P, 'override resolves upload ref then calls shared import-logic.startImport with SSE progress; server-local paths always 403 (server-path-import.ts:1)', None, None, 5),
 'import.startMultiFile': (D, 'route works (shared startMultiFileImport) but the multi-file "Import VCF Files" entry point is hidden in web (AppSidebar.vue:24, AppToolbar.vue:122); SQLite-session fallback throws', 'un-hide multi-file import once upload of SNV/SV/CNV/STR bundles is verified', None, 3),
 'import.vcfPreview': (P, 'override calls shared getVcfPreview on staged upload', None, None, 4),
 'import.vcfMultiPreview': (D, 'shared getVcfMultiPreview but siblingBedFiles forced to [] (no sibling BED auto-discovery for uploads)', 'let user upload BED alongside the VCF bundle', None, 2),
 'import.onProgress': (P, "SSE 'import:progress'", None, 'web transport (SSE)', 4),
 'import.cancel': (D, 'calls process-global cancelImport(): cancels whatever import is running for ANY user; no per-user/per-run scoping', 'scope cancellation to the caller run/job id', None, 3),
 # system (flat)
 'system.getVersion': (L, 'client stub returns build __APP_VERSION__ and electron:"web"', 'show web build version / server git SHA', 'client-side stub', 1),
 'system.getUserDataPath': (L, "client stub returns 'web'; no renderer callers", 'none needed', 'client-side stub', 0),
 'system.getCpuCount': (L, 'client stub returns browser navigator.hardwareConcurrency (client CPU, irrelevant to server)', 'hide worker-thread preference in web; server concurrency is operator config', 'client-side stub', 1),
 'system.setWorkerThreads': (D, 'silent client no-op, but ApplicationPreferences.vue:135 still shows the worker-thread control in web', 'hide the control in web (isWebRuntime) or make it an admin server setting', 'client-side stub', 2),
 'system.getWorkerThreads': (L, 'client stub returns 0; no renderer callers', 'none needed', 'client-side stub', 0),
 'system.getLogFilePath': (L, "client stub returns ''; no renderer callers", 'server logs belong to operator log pipeline', 'client-side stub', 0),
 # export
 'export.variants': (M, '501 unsupported-web-capability unless parity fixtures enabled; database:capabilities overlay sets export.variants=false so useFilterExport.ts:9 shows "not available". Even with fixtures it writes CSV to server tmpdir and returns a server filePath (no browser download)', 'streaming HTTP download (Content-Disposition) reusing exportPostgresVariants into the response stream', 'shared exportPostgresVariants (fixture path only)', 5),
 'export.cohort': (M, 'same as export.variants; CohortTable.vue:225 export disabled', 'streaming HTTP download reusing exportPostgresCohort', 'shared exportPostgresCohort (fixture path only)', 4),
 'export.revealInFolder': (L, 'client stub returns {success:false}', 'replace "show in folder" with the browser download itself', 'client-side stub', 1),
 # shell
 'shell.openExternal': (P, 'client window.open after https + static ALLOWED_DOMAINS check', None, 'client-side re-implementation of URL validation', 4),
 'shell.updateDomains': (D, 'client no-op: user-added external-link domains (externalLinksStore.ts:289) are never honoured by web openExternal', 'keep user allowlist client-side and include it in isUrlSafeForExternal', 'client-side stub', 2),
 # database
 'database.selectFile': (L, '404; native file dialog for .db files; DatabasePicker shows a fixed server workspace in web (DatabasePicker.vue:20)', 'web has one server-configured Postgres workspace; no file picker', None, 0),
 'database.selectSaveLocation': (L, '404; native save dialog', 'n/a (server workspace)', None, 0),
 'database.open': (L, '404; open local SQLite file; UI gated by DatabasePicker isWebMode', 'n/a (server workspace)', None, 0),
 'database.create': (L, '404; create local SQLite file. DESKTOP DEFECT: core-api.ts:316 wrapper drops the 3rd setupPassphrase arg', 'n/a (server workspace)', None, 0),
 'database.rekey': (L, '404; SQLCipher rekey', 'server-side at-rest encryption is operator responsibility (disk/PG TDE)', None, 0),
 'database.migrateToEncrypted': (L, 'web: n/a (SQLite encryption). DESKTOP DEFECT: not forwarded by core-api.ts database wrapper -> window.api.database.migrateToEncrypted is undefined (databaseStore.ts:202)', 'server-side at-rest encryption is operator responsibility', None, 0),
 'database.deletePlaintextBackup': (L, 'web: n/a. DESKTOP DEFECT: not forwarded by core-api.ts wrapper (databaseStore.ts:216)', 'n/a', None, 0),
 'database.setRecoveryPassphrase': (L, 'web: n/a. DESKTOP DEFECT: not forwarded by core-api.ts wrapper (databaseStore.ts:227)', 'n/a', None, 0),
 'database.info': (P, 'override returns synthetic {path:"web:postgres", name:"VarLens Web", encrypted:false}', None, 'web-only identity adapter', 2),
 'database.capabilities': (P, 'override returns POSTGRES_CAPABILITIES with export.* forced false unless parity fixtures', None, 'session.capabilities + web overlay', 5),
 'database.postgresDiagnostics': (L, '404; desktop client-side diagnostics of a hosted PG connection; no renderer caller', 'expose web-only database:health (exists, routes/database.ts:25) on an admin page', None, 0),
 'database.postgresProfilesList': (L, '404; desktop connection profiles; DatabasePicker skips fetch in web (DatabasePicker.vue:327,444)', 'server owns the connection (VARLENS_PG_URL)', None, 0),
 'database.postgresProfileSave': (L, '404; desktop connection profiles', 'n/a', None, 0),
 'database.postgresProfileRemove': (L, '404; desktop connection profiles', 'n/a', None, 0),
 'database.postgresProfileTest': (L, '404; desktop connection profiles', 'n/a', None, 0),
 'database.postgresProfileOpen': (L, '404; desktop connection profiles', 'n/a', None, 0),
 'database.recentList': (L, 'override returns []', 'n/a', 'web stub', 0),
 'database.getOverview': (P, 'override executes database:overview read task', None, None, 3),
 'database.removeRecent': (L, '404; recent-files list; gated by DatabasePicker', 'n/a', None, 0),
 'database.deleteFile': (L, '404; delete local .db file; gated', 'n/a', None, 0),
 'database.showInFolder': (L, '404; OS file manager; gated', 'n/a', None, 0),
 # batch import
 'batchImport.selectFiles': (P, 'browser multi-file picker + upload refs', None, 'web equivalent (upload staging)', 3),
 'batchImport.selectFolder': (P, 'browser <input webkitdirectory> + uploads every file', None, 'web equivalent (upload staging)', 2),
 'batchImport.selectZip': (P, 'upload .zip then server testZipPassword probe to derive isEncrypted', None, 'web equivalent (upload staging)', 2),
 'batchImport.checkDuplicates': (P, 'override re-implements duplicate check with extractCaseName + session.listCases (desktop: batch-import-logic.checkDuplicateFiles)', None, 'REIMPLEMENTATION (drift risk)', 3),
 'batchImport.start': (P, 'override re-implements orchestration as startWebBatchImport on jobRunner (desktop: batch-import-logic.startBatchImport); HTTP request held open for the whole batch', None, 'REIMPLEMENTATION (drift risk): startWebBatchImport vs startBatchImport', 4),
 'batchImport.cancel': (D, 'cancels ALL running import_batch jobs process-wide plus global cancelImport() (cross-user)', 'scope cancel to caller runId', None, 2),
 'batchImport.testZipPassword': (P, 'shared batch-import-logic.testZipPassword on staged upload', None, None, 2),
 'batchImport.extractZip': (P, 'shared extractZip on staged upload (stageExistingFileUpload for members)', None, None, 2),
 'batchImport.cleanupZipTemp': (P, 'shared cleanupZipTemp', None, 'shared batch-import-logic.cleanupZipTemp', 1),
 'batchImport.onProgress': (P, "SSE 'batch-import:progress'", None, 'web transport (SSE)', 3),
 'batchImport.onComplete': (P, "SSE 'batch-import:complete'", None, 'web transport (SSE)', 3),
 # cohort
 'cohort.getVariants': (D, 'shared getCohortVariantsViaSession, but active-panel filters resolve intervals via getGeneReferenceDb() (PostgresCohortRepository.ts:683) which the web build aliases to a throwing stub (src/web/stubs/gene-reference-loader-stub.ts, vite.web.config.ts:32) -> cohort query with an active gene panel errors (verify at runtime)', 'ship gene_reference.db in the web image and route the loader to web-gene-reference.ts', None, 5),
 'cohort.getColumnMeta': (P, 'shared getCohortColumnMetaViaSession', None, None, 3),
 'cohort.getSummary': (P, 'shared getCohortSummaryViaSession', None, None, 4),
 'cohort.getCarriers': (P, 'shared getCohortCarriersViaSession', None, None, 3),
 'cohort.getGeneBurden': (P, 'shared getCohortGeneBurdenViaSession', None, None, 3),
 'cohort.runAssociation': (M, '501 always; UI NOT gated (useAssociation.ts:30, GeneBurdenView) -> run button errors', 'server job (jobRunner) + SSE progress, or hide run action in web (backlog/web-cohort-association-support.md)', None, 3),
 'cohort.cancelAssociation': (M, '501 always', 'part of association job design', None, 1),
 'cohort.onAssociationProgress': (M, 'client no-op subscription; never fires', 'SSE event cohort:geneBurdenProgress', None, 1),
 'cohort.getSummaryStatus': (P, 'shared getCohortSummaryStatusViaSession', None, None, 2),
 'cohort.rebuildSummary': (L, '501 always; Postgres capability cohort.rebuild=false (summary computed live); no renderer caller', 'keep hidden; Postgres summary does not need manual rebuild', None, 0),
 'cohort.onSummaryRebuilt': (P, "SSE 'cohort:summaryRebuilt' published by cases/import/batch-import overrides", None, 'web transport (SSE)', 2),
 # annotations
 'annotations.getGlobal': (P, 'override packs (chr,pos,ref,alt) into coords and executes annotations:getGlobal', None, 'thin adapter over executor task', 4),
 'annotations.upsertGlobal': (P, 'shared annotations-logic.upsertGlobalAnnotationViaSession', None, None, 5),
 'annotations.deleteGlobal': (B, 'write autoroute passes raw args (chr,pos,ref,alt) but executor expects [coords: VariantCoords] (write-executor.ts:60) -> wrong params; latent (no renderer caller; UI deletes via upsertGlobal(null))', 'add override packing coords like annotations:getGlobal', None, 1),
 'annotations.getPerCase': (P, 'read autoroute (params align); no direct renderer caller', None, None, 1),
 'annotations.upsertPerCase': (P, 'shared upsertPerCaseAnnotationWithEvent + SSE annotationChanged', None, None, 5),
 'annotations.deletePerCase': (P, 'write autoroute (params align); no direct renderer caller', None, None, 1),
 'annotations.getForVariant': (P, 'override packs coords; executes annotations:getForVariant', None, 'thin adapter over executor task', 4),
 'annotations.batchGet': (P, 'read autoroute (params align)', None, None, 4),
 # enrichment
 'vep.fetch': (M, '501 in production (fixture-gated); useVepEnrichment.ts:156 is NOT gated -> "VEP fetch failed" in variant details', 'server-side Ensembl VEP proxy with shared cache (data-governance decision: coordinates leave the server) or explicit "not available in web" panel', 'fixture builder only', 5),
 'vep.cancel': (M, '501 in production (fixture-gated); no renderer caller', 'part of server-side VEP proxy', None, 0),
 'vep.clearCache': (M, '501 in production; no renderer caller', 'admin cache management', None, 0),
 'vep.getCacheStats': (M, '501 in production; no renderer caller', 'admin cache management', None, 0),
 'hpo.search': (M, '501 in production (fixture-gated); HpoTermSelector.vue:111 (CaseMetadataCard) ungated -> users cannot add HPO terms to cases in web', 'search the bundled HPO ontology (useHpoBundled.ts already exists client-side) or a server-side ontology index', 'fixture builder only', 5),
 'hpo.clearCache': (M, '501 in production; no renderer caller', 'n/a if bundled ontology used', None, 0),
 'myvariant.fetch': (M, '404 not wired; useVepEnrichment.ts:157 ungated -> MyVariant section errors', 'server-side MyVariant.info proxy + cache', None, 4),
 'myvariant.clearCache': (M, '404; no renderer caller', 'admin cache management', None, 0),
 'spliceai.fetch': (M, '404 not wired; useVepEnrichment.ts:158 ungated -> SpliceAI section errors', 'server-side SpliceAI lookup proxy + cache', None, 4),
 'spliceai.clearCache': (M, '404; no renderer caller', 'admin cache management', None, 0),
 # logs / updater / perf
 'logs.onMessage': (L, 'client no-op subscription; main-process logs never reach the in-app log viewer (LogService.ts:41)', 'show client-side logs only; server logs via operator log pipeline (or admin-only SSE log stream)', None, 1),
 'updater.checkForUpdate': (L, 'client no-op', 'hide updater UI in web; server version is managed by deployment', 'client-side stub', 0),
 'updater.downloadUpdate': (L, 'client no-op', 'hide updater UI in web', 'client-side stub', 0),
 'updater.installUpdate': (L, 'client no-op', 'hide updater UI in web', 'client-side stub', 0),
 'updater.getStatus': (L, "client stub {state:'idle'} -> footer shows no update", 'hide updater UI in web', 'client-side stub', 0),
 'updater.onStatusChange': (L, 'client no-op subscription', 'hide updater UI in web', 'client-side stub', 0),
 'perf.reportInteractive': (L, 'client no-op (Electron startup-perf milestone)', 'n/a (desktop E2E perf harness)', 'client-side stub', 0),
 'perf.getSnapshot': (L, 'would POST /api/perf/getSnapshot -> 404, but perf.isEnabled() is false in web so never called', 'n/a', None, 0),
 'perf.resetSnapshot': (L, 'would POST /api/perf/resetSnapshot -> 404; never called in web', 'n/a', None, 0),
 'perf.isEnabled': (L, 'client stub false', 'n/a', 'client-side stub', 0),
 # audit
 'audit.getByEntity': (D, 'admin-only override (routes/audit-log.ts:17): non-admin web users get 403 in ActivityLogPanel.vue:70; desktop ungated (deliberate: trail includes employee activity)', 'role-aware: hide activity panel or show clinical-change subset to non-admins', None, 3),
 'audit.query': (D, 'admin-only override; no renderer caller', 'admin audit page', None, 1),
 # gene lists / region files
 'geneLists.setGenes': (P, 'override executes setGenes then returns getGenes', None, 'thin adapter over executor tasks', 2),
 'regionFiles.importBed': (P, 'override resolves upload ref then executes region-files:importBed (rejectMalformedRows:true)', None, 'thin adapter over executor task', 2),
 # panels
 'panels.get': (P, 'shared panels-logic.getPanelWithGenes', None, None, 3),
 'panels.update': (P, 'override maps renderer object to executor shape', None, 'thin adapter over executor task', 2),
 'panels.activate': (P, 'write autoroute; no renderer caller', None, None, 0),
 'panels.deactivate': (P, 'write autoroute; no renderer caller', None, None, 0),
 'panels.activeForCase': (P, 'read autoroute; no renderer caller (desktop channel is panels:active-for-case)', None, None, 0),
 'panels.validateSymbols': (B, '404 not wired, NOT gated: PanelEditorDialog.vue:306 / useGeneValidation.ts:123 gene-symbol validation fails in web, so panels cannot be built from symbol lists', 'serve validateSymbols from the web gene reference DB (web-gene-reference.ts already opens resources/gene_reference.db)', None, 4),
 'panels.autocomplete': (B, '404 not wired, NOT gated (useGeneValidation.ts:159)', 'serve from web gene reference DB', None, 3),
 'panels.searchPanelApp': (M, '404 not wired, NOT gated (PanelAppImportDialog.vue:230)', 'server-side PanelApp proxy', None, 3),
 'panels.importPanelApp': (M, '404 not wired, NOT gated (PanelAppImportDialog.vue:253)', 'server-side PanelApp proxy + importPanelAppForSession (exists for Postgres sessions)', None, 3),
 'panels.generateStringDb': (M, '404 not wired, NOT gated (StringDbGenerateDialog.vue:182)', 'server-side STRING proxy + generateStringDbForSession', None, 2),
 'panels.exportBed': (M, '404 not wired, NOT gated (PanelManagerDialog.vue:431)', 'browser download of BED computed server-side from gene reference DB', None, 2),
 # gene ref
 'geneRef.info': (M, '501 in production although web-gene-reference.ts can serve real data; only enabled with parity fixtures. PanelManagerDialog.vue:308 calls it ungated', 'drop the fixture gate and serve getWebGeneReferenceDb().getInfo()', 'shared? no: web-only web-gene-reference.ts (node:sqlite)', 2),
 'geneRef.assemblies': (M, '501 in production (same as info); no renderer caller', 'serve getWebGeneReferenceDb().getAssemblies()', 'web-only web-gene-reference.ts', 1),
 'geneRef.checkUpdates': (L, '404; desktop downloads gene reference updates into userData', 'operator updates gene_reference.db in the image', None, 0),
 'geneRef.update': (L, '404; PanelManagerDialog.vue:404 update button not gated in web', 'hide update button in web; image rebuild updates reference', None, 1),
 # auth
 'auth.login': (P, 'web reimplementation on PostgresWebAuthService + session cookie (by design: different auth boundary)', None, 'separate web auth service (by design)', 5),
 'auth.logout': (P, 'session cookie delete + audit', None, 'separate web auth service (by design)', 3),
 'auth.currentUser': (P, 'returns session user', None, 'separate web auth service (by design)', 4),
 'auth.isAccountsEnabled': (P, 'public override; true under platform identity', None, 'separate web auth service (by design)', 3),
 'auth.createUser': (M, "always 501 'multi-user-disabled' (single-tenant release) after admin+schema checks; platform-identity mode denies", 'decide multi-user story (platform identity / OIDC provisioning)', 'separate web auth service', 2),
 'auth.listUsers': (P, 'admin-gated', None, 'separate web auth service', 2),
 'auth.deactivateUser': (P, 'admin-gated; denied in platform-identity mode', None, 'separate web auth service', 1),
 'auth.resetPassword': (P, 'admin-gated; denied in platform-identity mode', None, 'separate web auth service', 1),
 'auth.changePassword': (P, 'session-based; denied in platform-identity mode; reachable pre-rotation', None, 'separate web auth service', 3),
 # analysis groups
 'analysisGroups.create': (P, 'override validates and executes analysis-groups:create; no renderer caller', None, 'thin adapter over executor task', 0),
 'analysisGroups.addMember': (P, 'override validates and executes addMember; no renderer caller', None, 'thin adapter over executor task', 0),
 # protein / gnomad
 'protein.getMapping': (M, '501 in production (fixture-gated); renderer gates the protein viewer off in web (runtime-features.ts:17, VariantDetailsPanel.vue:194)', 'server-side UniProt proxy + cache', 'fixture builder only', 3),
 'protein.getDomains': (M, '501 in production; UI gated', 'server-side InterPro proxy + cache', 'fixture builder only', 2),
 'protein.getStructure': (M, '501 in production; UI gated', 'server-side AlphaFold proxy (or direct browser fetch of public CIF URLs)', 'fixture builder only', 2),
 'protein.getGeneStructure': (M, '501 in production; UI gated', 'server-side Ensembl proxy', 'fixture builder only', 2),
 'gnomad.getVariants': (M, '404 not wired; only reachable from the protein viewer which is gated off in web (LollipopPlotPanel.vue:186)', 'server-side gnomAD GraphQL proxy + cache', None, 2),
 'gnomad.getClinVarVariants': (M, '404 not wired; gated with protein viewer (ProteinVisualizationModal.vue:227)', 'server-side gnomAD ClinVar proxy', None, 2),
 # debug / jobs
 'debug.queryCountersGet': (L, '404; desktop-only Postgres query counters for perf gates; no renderer caller', 'web uses /metrics', None, 0),
 'debug.queryCountersReset': (L, '404; no renderer caller', 'web uses /metrics', None, 0),
 'jobs.list': (M, '404; web batch import uses jobRunner but no jobs endpoint; no renderer caller yet', 'expose per-user job list over HTTP + SSE when a jobs UI lands', None, 1),
 'jobs.get': (M, '404; no renderer caller', 'same', None, 0),
 'jobs.progress': (M, '404; no renderer caller', 'same', None, 0),
 'import.(internal) registerDroppedFileEnrollmentToken': (L, 'preload-internal path-authority handshake; web uploads File objects instead', 'n/a', None, 0),
}

# default for unlisted generic-bridge entries
out = []
for r in recs:
    k = f"{r['windowKey']}.{r['method']}"
    w = r.get('web', {})
    mech = w.get('mechanism')
    if k in C:
        cls, reason, ux, shared, impact = C[k]
    elif mech and mech.startswith('generic-bridge'):
        cls, reason, ux, shared, impact = P, f"{mech}: positional args match executor params", None, None, 2
        # bump impact for commonly used
        if r.get('rendererCallSites') or r.get('rendererProbableAliasedCallSites'):
            impact = 3
    elif mech == 'route-override':
        cls, reason, ux, shared, impact = P, 'route override validates args and executes the matching executor task', None, None, 3
        print('DEFAULTED', k)
    else:
        raise SystemExit(f'UNCLASSIFIED {k} {mech}')
    if shared is None:
        if mech and mech.startswith('generic-bridge'):
            shared = EXEC_SHARED
        elif w.get('calls'):
            shared = 'shared logic: ' + ', '.join(c for c in w['calls'] if not c.startswith('build'))
        elif w.get('usesExecutor'):
            shared = 'thin adapter over the same executor task'
        else:
            shared = 'none (not implemented)' if cls in (M, L, B) else 'n/a'
    rec = {
        'channel': r.get('channel'),
        'domain': r['windowKey'],
        'preloadMethod': f"window.api.{r['windowKey']}.{r['method']}",
        'kind': r['kind'],
        'preloadWrapper': r.get('preloadWrapper'),
        'preloadBinding': r.get('preloadBinding'),
        'desktopHandler': r.get('desktopHandler'),
        'desktopEmitters': r.get('desktopEmitters'),
        'webServerKey': r.get('webServerKey'),
        'webMechanism': mech,
        'webLocation': w.get('loc'),
        'webNote': w.get('note'),
        'webSharedLogic': shared,
        'classification': cls,
        'reason': reason,
        'webUxDecisionNeeded': ux,
        'userImpact0to5': impact,
        'rendererCallSites': (r.get('rendererCallSites') or []) + (r.get('rendererProbableAliasedCallSites') or []),
        'notExposedOnDesktopWindowApi': bool(r.get('notExposedOnWindowApi')),
    }
    out.append(rec)

counts = collections.Counter(o['classification'] for o in out)

storage = {
 'typeDefinition': 'src/shared/types/storage-capabilities.ts:3',
 'sqlite': 'src/main/storage/sqlite/SqliteStorageSession.ts:18 (SQLITE_CAPABILITIES; every flag true except workspace.hostedConnectionLifecycle=false)',
 'postgres': 'src/main/storage/postgres/PostgresStorageSession.ts:49 (POSTGRES_CAPABILITIES)',
 'webOverlay': 'src/web/server/routes/database.ts:5 webCapabilities(): export.{variants,cohort,streaming}=false unless webParityFixturesEnabled()',
 'flagsThatDiffer': {
   'workspace.localFileLifecycle': {'sqlite': True, 'postgres': False, 'web': False},
   'workspace.hostedConnectionLifecycle': {'sqlite': False, 'postgres': True, 'web': True},
   'workspace.encryptionAtRest': {'sqlite': True, 'postgres': False, 'web': False},
   'cases.deleteMany': {'sqlite': True, 'postgres': False, 'web': False},
   'cases.deleteAll': {'sqlite': True, 'postgres': False, 'web': False},
   'variants.legacySearch': {'sqlite': True, 'postgres': False, 'web': False},
   'cohort.rebuild': {'sqlite': True, 'postgres': False, 'web': False},
   'export.variants': {'sqlite': True, 'postgres': True, 'web': False},
   'export.cohort': {'sqlite': True, 'postgres': True, 'web': False},
   'export.streaming': {'sqlite': True, 'postgres': True, 'web': False},
 },
 'allOtherFlags': 'true for both backends (workspace.migrations, workspace.healthDiagnostics, cases.list/query/deleteOne/overview, imports.*, variants.* except legacySearch, workflow.*, cohort.* except rebuild)',
 'flagsNeverReadByRenderer': ['workspace.*', 'cases.list', 'cases.query', 'imports.*', 'variants.searchQuery', 'variants.legacySearch', 'variants.typeCounts', 'variants.typesPresent', 'variants.geneSymbols', 'workflow.caseComments', 'workflow.caseMetrics', 'workflow.geneLists', 'workflow.regionFiles', 'workflow.analysisGroups', 'workflow.auditLog', 'cohort.rebuild', 'cohort.carriers', 'cohort.geneBurden', 'export.streaming'],
 'rendererGateSemantics': 'src/renderer/src/utils/backend-capabilities.ts: CapabilityPath union (line 5) covers 24 paths; currentCanUseFeature (line 98) FAILS OPEN (returns true) while capabilities are null; getCurrentUnsupportedReason (line 79) returns null on load error (also fail-open)',
 'rendererConsumers': [
   {'path': 'cases.deleteAll', 'site': 'src/renderer/src/App.vue:234', 'effect': 'blocks Delete-all-cases action with a warning (false on Postgres/web)'},
   {'path': 'cases.overview', 'site': 'src/renderer/src/components/DatabaseOverviewDialog.vue:61', 'effect': 'overview dialog unsupported message (true everywhere)'},
   {'path': 'cases.deleteOne', 'site': 'src/renderer/src/components/CaseList.vue:449', 'effect': 'single case delete guard (true everywhere)'},
   {'path': 'cases.deleteMany', 'site': 'src/renderer/src/components/CaseList.vue:537', 'effect': 'blocks batch delete (false on Postgres/web)'},
   {'path': 'variants.(tag|comment|acmg|annotation|panel|inheritance|analysisGroup|phasing)Filters, variants.columnMeta', 'site': 'src/renderer/src/components/FilterToolbar.vue:235-262', 'effect': 'strips unsupported filter keys before querying (all true on both backends today)'},
   {'path': 'variants.acmgFilters', 'site': 'src/renderer/src/components/FilterToolbar.vue:489', 'effect': 'hides ACMG filter control'},
   {'path': '(any CapabilityPath)', 'site': 'src/renderer/src/components/FilterToolbar.vue:222', 'effect': 'warns/logs reason when a filter is unsupported'},
   {'path': 'workflow.filterPresets', 'site': 'src/renderer/src/components/FilterToolbar.vue:695; src/renderer/src/components/cohort/CohortFilterBar.vue:607', 'effect': 'blocks preset save/load'},
   {'path': '(any CapabilityPath)', 'site': 'src/renderer/src/components/cohort/CohortFilterBar.vue:174', 'effect': 'cohort filter unsupported warnings'},
   {'path': 'cohort.query / export.cohort / cohort.summary / cohort.columnMeta', 'site': 'src/renderer/src/components/CohortTable.vue:221,225,229,239', 'effect': 'cohort table load, cohort CSV export (disabled in web), summary, column meta'},
   {'path': 'variants.columnMeta', 'site': 'src/renderer/src/composables/useVariantColumnMeta.ts:106', 'effect': 'skips column-meta fetch'},
   {'path': 'variants.filterOptions / workflow.tags', 'site': 'src/renderer/src/composables/useFilterOptionsCache.ts:22,85,127,136', 'effect': 'skips filter-options/tag loading'},
   {'path': 'export.variants', 'site': 'src/renderer/src/composables/useFilterExport.ts:9', 'effect': 'variant CSV export disabled with message (web)'},
 ],
 'mockCapabilities': 'src/renderer/src/mocks/mockApi.ts:18 MOCK_SQLITE_CAPABILITIES',
}

renderer_gates = [
 {'site': 'src/renderer/src/utils/runtime-mode.ts:1', 'check': 'isWebRuntime() = window.__VARLENS_WEB__ === true (set by src/web/client/install-api.ts:9)', 'effect': 'single source of runtime branching'},
 {'site': 'src/renderer/src/utils/runtime-features.ts:17', 'check': 'isProteinViewerAvailable() = !isWebRuntime()', 'effect': 'protein:* and gnomad:* unreachable in web'},
 {'site': 'src/renderer/src/components/VariantDetailsPanel.vue:282,194,201', 'check': 'proteinViewerAvailable', 'effect': 'hides protein/lollipop modal; renders an unavailable note instead'},
 {'site': 'src/renderer/src/components/VariantDetailsPanel.vue:290', 'check': 'isWebRuntime()', 'effect': "emits 'variant-updated' after tag changes (web-only refresh)"},
 {'site': 'src/renderer/src/components/DatabasePicker.vue:20,301', 'check': 'isWebMode', 'effect': 'web shows single static workspace item; hides recent DBs, open/create/delete/show-in-folder, encryption actions'},
 {'site': 'src/renderer/src/components/DatabasePicker.vue:327,444', 'check': '!isWebMode', 'effect': 'skips postgresProfilesList fetch in web'},
 {'site': 'src/renderer/src/components/AppSidebar.vue:24', 'check': '!isWebMode', 'effect': "hides 'Import VCF Files' (multi-file SNV/SV/CNV/STR) menu item in web"},
 {'site': 'src/renderer/src/components/AppToolbar.vue:122', 'check': '!isWebMode', 'effect': "hides 'Import VCF Files' multi-file import in web"},
 {'site': 'src/renderer/src/components/CaseMetadataModal.vue:28,94,162', 'check': 'isWebMode', 'effect': 'web uses button tabs + v-if panes instead of v-tabs-window (same four panes; layout-only)'},
 {'site': 'src/renderer/src/components/VariantTable.vue:489,648', 'check': 'isWebRuntime()', 'effect': 'web subscribes to variants.onAnnotationChanged and reloads when annotation-backed filters are active'},
 {'site': 'src/renderer/src/components/CohortTable.vue:557', 'check': 'isWebRuntime()', 'effect': 'web reloads cohort on annotation change with annotation-backed filters'},
 {'site': 'src/renderer/src/components/import/ImportWizard.vue:332,367,783,787,858', 'check': 'isWebRuntime()', 'effect': 'browser-upload progress events (WEB_UPLOAD_EVENT), upload cancel, SSE import progress wiring'},
 {'site': 'src/renderer/src/App.vue:282', 'check': 'isWebRuntime()', 'effect': 'invalidates variant column meta cache on case delete'},
 {'site': 'src/renderer/src/App.vue:319', 'check': '!isWebRuntime() return', 'effect': 'handleDialogBatchImportComplete only acts in web'},
 {'site': 'src/renderer/src/App.vue:324', 'check': '!isWebRuntime() return', 'effect': 'handleMetadataChanged refresh only in web'},
 {'site': 'src/renderer/src/composables/useShellLifecycle.ts:55,63', 'check': 'isWebRuntime()', 'effect': 'invalidates column-meta cache after import/batch import in web'},
 {'site': 'src/renderer/src/components/KeyboardShortcutsDialog.vue:38; src/renderer/src/components/SlimFilterToolbar.vue:219', 'check': 'navigator.platform Mac', 'effect': 'cosmetic modifier-key labels only'},
 {'site': 'src/renderer/src/components/HpoTermSelector.vue:96', 'check': "typeof api.hpo.search === 'function'", 'effect': 'feature-detect is always true under the web Proxy (Proxy returns a function for every property) -> no web gating'},
 {'site': 'src/renderer/src/composables/useCohortData.ts:191,234', 'check': "typeof cohortApi.onSummaryRebuilt/getSummaryStatus === 'function'", 'effect': 'feature-detects are always true under the web Proxy'},
]
ungated_web_failures = [
 'window.api.hpo.search  (HpoTermSelector.vue:111 via CaseMetadataCard: 501 -> cannot add HPO terms)',
 'window.api.vep.fetch / myvariant.fetch / spliceai.fetch  (useVepEnrichment.ts:156-158: 501/404 -> enrichment sections error)',
 'window.api.panels.validateSymbols / autocomplete  (useGeneValidation.ts:123,159; PanelEditorDialog.vue:306: 404)',
 'window.api.panels.searchPanelApp / importPanelApp  (PanelAppImportDialog.vue:230,253: 404)',
 'window.api.panels.generateStringDb  (StringDbGenerateDialog.vue:182: 404)',
 'window.api.panels.exportBed  (PanelManagerDialog.vue:431: 404)',
 'window.api.geneRef.info / geneRef.update  (PanelManagerDialog.vue:308,404: 501/404)',
 'window.api.cohort.runAssociation / cancelAssociation / onAssociationProgress  (useAssociation.ts:30,35,47: 501 / silent)',
 'window.api.cohort.getVariants with active gene panels  (gene-reference stub throws; verify at runtime)',
 'window.api.audit.getByEntity  (ActivityLogPanel.vue:70: 403 for non-admin web users)',
 'window.api.auth.createUser  (UserManagement.vue:54: 501 multi-user-disabled)',
 'window.api.system.setWorkerThreads  (ApplicationPreferences.vue:135: silent no-op)',
 'window.api.shell.updateDomains  (externalLinksStore.ts:289: silent no-op; user domains blocked by openExternal)',
 'window.api.import.cancel / batchImport.cancel  (cross-user global cancel)',
]
ungated_capability_gated = ['cases.deleteAll (App.vue:234)', 'cases.deleteBatch (CaseList.vue:537)', 'export.variants (useFilterExport.ts:9)', 'export.cohort (CohortTable.vue:225)']

events = [
 {'channel': 'import:progress', 'desktopEmitter': 'src/main/ipc/handlers/import.ts:124 (safeEmit)', 'preloadSubscriber': 'src/preload/window-api/core-api.ts:288 import.onProgress', 'web': "SSE event via WebEventHub; published src/web/server/routes/import.ts:145,245; client src/web/client/api.ts:430", 'status': P},
 {'channel': 'batch-import:progress', 'desktopEmitter': 'src/main/ipc/handlers/batch-import.ts:45', 'preloadSubscriber': 'core-api.ts:345 batchImport.onProgress', 'web': 'SSE; published routes/batch-import.ts:382; client api.ts:472', 'status': P},
 {'channel': 'batch-import:complete', 'desktopEmitter': 'src/main/ipc/handlers/batch-import.ts:46', 'preloadSubscriber': 'core-api.ts:346 batchImport.onComplete', 'web': 'SSE; published routes/batch-import.ts:421; client api.ts:476', 'status': P},
 {'channel': 'cohort:summaryRebuilt', 'desktopEmitter': 'handlers/cohort.ts:35,36,42; handlers/batch-import.ts:47; handlers/cases.ts:25', 'preloadSubscriber': 'core-api.ts:361 cohort.onSummaryRebuilt', 'web': 'SSE; published routes/cases.ts:28-29, routes/import.ts:134,152,231,258, routes/batch-import.ts:337,420; client api.ts:538', 'status': P},
 {'channel': 'variants:annotationChanged', 'desktopEmitter': 'handlers/annotations.ts:36 (broadcast from upsertPerCase, :207)', 'preloadSubscriber': 'core-api.ts:275 variants.onAnnotationChanged', 'web': 'SSE; published routes/annotations.ts:65 only to the acting user; client api.ts:522', 'status': P},
 {'channel': 'cohort:geneBurdenProgress', 'desktopEmitter': 'handlers/cohort.ts:129', 'preloadSubscriber': 'core-api.ts:358 cohort.onAssociationProgress', 'web': 'none: client on* fallback returns no-op unsubscribe (api.ts:361); association itself is 501', 'status': M},
 {'channel': 'logs:message', 'desktopEmitter': 'src/main/services/MainLogger.ts:93', 'preloadSubscriber': 'core-api.ts:401 logs.onMessage', 'web': 'none: no-op subscription', 'status': L},
 {'channel': 'updater:status', 'desktopEmitter': 'src/main/services/AutoUpdater.ts:17', 'preloadSubscriber': 'core-api.ts:409 updater.onStatusChange', 'web': 'client stub no-op (api.ts:419)', 'status': L},
 {'channel': 'perf:interactive (renderer->main send)', 'desktopEmitter': 'listener src/main/index.ts:272 (ipcMain.once)', 'preloadSubscriber': 'core-api.ts:413 perf.reportInteractive', 'web': 'client no-op (api.ts:371)', 'status': L},
 {'channel': 'cases:deleted', 'desktopEmitter': 'src/main/ipc/handlers/cases.ts:24', 'preloadSubscriber': 'NONE (orphan emit, no preload subscriber)', 'web': 'n/a', 'status': 'ORPHAN'},
 {'channel': 'export:progress', 'desktopEmitter': 'src/main/ipc/handlers/export.ts:132,227', 'preloadSubscriber': 'NONE (orphan emit)', 'web': 'n/a (export unsupported)', 'status': 'ORPHAN'},
]
sse_notes = [
 'Single endpoint GET /api/events (src/web/server/events.ts:40), text/event-stream, hijacked reply; auth = session user (401 otherwise).',
 'WebEventHub (events.ts:9) is an in-memory Map<userId, listeners>: events reach only the acting user, and only on the same Node process (no cross-instance fan-out; horizontal scaling would silently drop events).',
 'No heartbeat/keep-alive comments after the initial ": connected" (events.ts:54): idle-timeout proxies can drop the stream; EventSource auto-reconnects but events emitted during the gap are lost (no Last-Event-ID replay).',
 'Client shares one EventSource across subscribers and closes it when the last subscriber unsubscribes (src/web/client/api.ts:322-352).',
 'Any window.api.<domain>.on* without an explicit client override resolves to a no-op unsubscribe (api.ts:361), so missing event bridges fail silently.',
 'Browser upload progress is a separate client-only CustomEvent channel (varlens:web-upload, api.ts:28) driven by XHR upload.onprogress.',
]

tests = [
 {'test': 'tests/shared/types/preload-contract.test.ts', 'runsIn': 'default make test', 'enforces': 'WindowAPI top-level keys == preload keys == mockApi keys; selected domain modules use shared contracts; IpcResult source-string checks; caseMetadata not laundered via cast', 'blindSpots': 'does not check per-method forwarding inside the core-api/app-api wrappers: database wrapper is cast `as WindowAPI[\'database\']` (core-api.ts:331) and silently omits migrateToEncrypted/deletePlaintextBackup/setRecoveryPassphrase and drops create()\'s setupPassphrase; says nothing about web.'},
 {'test': 'tests/web-gate/handler-seam.test.ts', 'runsIn': 'make web-gate-static (opt-in; NOT default CI)', 'enforces': 'every shared domain has preload + main module; route override modules are all imported by dispatcher; routes never touch Postgres directly; override keys are pass-through/shared-logic/unsupported (ts-morph verdict) except audited exception files', 'blindSpots': 'treats unsupportedWebCapability as an acceptable verdict; never enumerates contract methods, so 404 (not-wired) methods and fixture-gated 501s pass; flat handlers (shell/system/updater/shortlist) excluded; does not verify autoroute arg-shape compatibility (annotations.deleteGlobal).'},
 {'test': 'tests/web-gate/web-client-api.test.ts', 'runsIn': 'web-gate-static', 'enforces': 'client Proxy RPC/error envelope, SSE bridging for the 5 bridged events, picker/upload behaviour', 'blindSpots': 'does not assert that every WindowAPI method is reachable; on* no-op fallback untested for unbridged events'},
 {'test': 'tests/web-gate/dispatcher-adapters-{core,read-seams,auth-import,assets-annotations-export}.test.ts', 'runsIn': 'web-gate-static', 'enforces': 'per-override unit behaviour with mocked session; unknown method -> 404; metrics', 'blindSpots': 'LOCKS IN the gaps: asserts 501 unsupported-web-capability for cohort association/rebuild, export, reference APIs (read-seams.test.ts:197-231, assets-annotations-export.test.ts:419-436); no coverage of not-wired methods'},
 {'test': 'scripts/ipc-parity/validate-fixtures.ts (make web-ipc-fixtures)', 'runsIn': 'prerequisite of web-gate-static', 'enforces': 'tests/fixtures/ipc-parity/manifest.json covers the same 23 IPC areas and its fixture files validate', 'blindSpots': 'area-level list is hard-coded; no method-level completeness'},
 {'test': 'tests/web-gate/parity/ipc-fixture-parity.test.ts + parity/ipc/*.ts', 'runsIn': 'make web-gate-parity / web-parity-e2e (opt-in; needs VARLENS_PG_URL + Electron build)', 'enforces': 'desktop-vs-web hash equality for ~76 method calls across 23 areas (REQUIRED_IPC_AREAS, scenarios.ts:27); runs web with VARLENS_WEB_PARITY_FIXTURES=1', 'blindSpots': 'runs with parity fixtures ON, so fixture-gated 501s (vep/hpo/protein/geneRef/export) look like parity although production returns 501; no scenarios for gnomad/myvariant/spliceai/jobs/debug/shell/system/updater/logs or panels.validateSymbols/autocomplete/PanelApp/STRING/exportBed, cases.deleteAll/deleteBatch, cohort association; LIKELY STALE: seeds via import.start with absolute server paths (ipc-fixture-parity.test.ts:178) but serverPathImportDisabled() is hard-coded true since 37167a54 (2026-06-13) while the harness was last touched 2026-05-26 -> web seed should 403 (verify by running).'},
 {'test': 'tests/web-gate/parity/data-manifest-parity.test.ts, import-and-filter.test.ts', 'runsIn': 'opt-in parity', 'enforces': 'import/filter output parity on manifest data', 'blindSpots': 'same server-path import seeding (data-manifest-parity-support.ts:244,298; import-and-filter.test.ts:261) -> likely broken by the server-path disable'},
 {'test': 'tests/web-gate/integration/*', 'runsIn': 'make web-gate-postgres / web-ci (opt-in)', 'enforces': 'server lifecycle, auth gates, must-change-password, metrics, openapi, migrations', 'blindSpots': 'no channel coverage'},
]
answer_missing_impl_test = 'NO. No test fails when a desktop channel has no web implementation. handler-seam checks module triples and override-key style; dispatcher tests assert 404/501 behaviour; the parity suite only covers listed scenarios (and with fixtures on). A completeness gate would need to enumerate every *DomainContract method + flat API and require each to be either routed (override/autoroute/client override) or explicitly allowlisted as desktop-only.'

doc = {
 'generatedAt': datetime.date.today().isoformat(),
 'repoRef': 'worktree agent-a441a5be6bf38012d @ 8a662b89',
 'method': 'static analysis (python extraction of preload wrappers/bindings, ipcMain registrations, web route override keys, task-type allowlists, client overrides) + manual review; no code executed',
 'counts': dict(counts),
 'totalRecords': len(out),
 'channels': out,
 'storageCapabilities': storage,
 'rendererGates': {'runtimeGates': renderer_gates, 'capabilityGates': storage['rendererConsumers'], 'ungatedWebFailures': ungated_web_failures, 'webGapsHiddenByCapabilityFlags': ungated_capability_gated, 'webGapsHiddenByRuntimeGate': ['protein.* and gnomad.* (runtime-features.ts:17)', 'database file lifecycle + postgres profiles (DatabasePicker.vue:20)', 'multi-file VCF import entry (AppSidebar.vue:24, AppToolbar.vue:122)']},
 'eventChannels': {'channels': events, 'sseNotes': sse_notes},
 'parityTests': {'tests': tests, 'anyTestFailsOnMissingWebImpl': answer_missing_impl_test},
 'deadOrHiddenWebRoutes': {
   'webOnlyOverrides': ['database:health (routes/database.ts:25) - no window.api method', 'import:selectFile/selectFiles/selectBedFile and batch-import:selectFiles/selectFolder/selectZip server overrides (return null/[]) are shadowed by client overrides and unreachable from the SPA'],
   'aliasAutoroutesReachableOnlyByDirectHttp': ['variants:filterOptions', 'cohort:query', 'cohort:summary', 'cohort:columnMeta', 'cohort:carriers', 'cohort:geneBurden', 'database:overview'],
   'aliasNote': 'These READ_TASK_TYPES are reachable as POST /api/<domain>/<method> but the SPA uses the preload method names (getFilterOptions, getVariants, ...). They bypass the per-route Zod validation the matching overrides apply (e.g. CohortSearchParamsSchema).',
 },
 'desktopDefectsFound': [
   'src/preload/window-api/core-api.ts:312-331: database wrapper omits migrateToEncrypted, deletePlaintextBackup, setRecoveryPassphrase (present in preload/domains/database.ts:13-17, contract, and main handlers) -> databaseStore.ts:202/216/227 call undefined on desktop (TypeError). Masked by `as WindowAPI[\'database\']` cast.',
   'src/preload/window-api/core-api.ts:316: create: (path, password) => databaseDomain.create(path, password) drops setupPassphrase -> first-run passphrase setup re-call from databaseStore.ts:144 never reaches main.',
   'Orphan desktop emits with no preload subscriber: cases:deleted (handlers/cases.ts:24), export:progress (handlers/export.ts:132,227).',
 ],
 'keyArchitectureFact': 'Web dispatch key = toTaskDomain(<window.api key>) + ":" + <preload METHOD name>, not the desktop IPC channel. Channels whose desktop name differs from the method (cohort:variants vs cohort:getVariants, panels:active-for-case vs panels:activeForCase, analysisGroups:* vs analysis-groups:*, variants:filterOptions vs getFilterOptions, protein:mapping vs getMapping, gnomad:variants vs getVariants) are matched by method name only.',
}
json.dump(doc, open(f'{HERE}/static-inventory.json', 'w'), indent=1)

# ------------------ markdown ------------------
def esc(s):
    return (s or '').replace('|', '\\|').replace('\n', ' ')

md = []
A = md.append
A('# VarLens desktop vs web: static `window.api` parity inventory\n')
A(f"Generated {doc['generatedAt']} from {doc['repoRef']} by static analysis only (nothing was executed). Machine-readable twin: `static-inventory.json`.\n")
A('## Summary\n')
A('| Classification | Count |\n|---|---|')
for k in (P, D, B, M, L):
    A(f'| {k} | {counts.get(k, 0)} |')
A(f'| **Total `window.api` methods / channels** | **{len(out)}** |\n')
A('Definitions: **PARITY** = reachable in web with equivalent behavior (transport substitutions like upload refs or SSE count). **DEGRADED** = works but with reduced or different behavior. **BROKEN** = wired, or called by the UI, but fails or is wrong for real calls. **MISSING** = desktop feature with a reasonable web equivalent that is not implemented (404, production 501, or no-op). **LEGITIMATELY-DESKTOP-ONLY** = the concept does not apply in web; the UX decision it needs is listed.\n')

A('### Most user-impactful non-PARITY channels\n')
top = sorted([o for o in out if o['classification'] != P], key=lambda o: -o['userImpact0to5'])[:20]
A('| # | Method | Class | Why |\n|---|---|---|---|')
for i, o in enumerate(top, 1):
    A(f"| {i} | `{o['preloadMethod'].replace('window.api.', '')}` | {o['classification']} | {esc(o['reason'])} |")
A('')

A('## Transport architecture\n')
A('**Desktop:** renderer `window.api.<d>.<m>()` → contextBridge (`src/preload/index.ts:20`) → `src/preload/window-api/create-window-api.ts:440` assembles the `core-api.ts`/`app-api.ts` wrappers → `src/preload/domains/<d>.ts` calls `ipcRenderer.invoke(\'<channel>\')` → `ipcMain.handle` in `src/main/ipc/handlers/<d>.ts` (registered from `src/main/ipc/domains/<d>.ts`) → `wrapHandler` + Zod validation → Postgres sessions use `session.getRead/WriteExecutor().execute({type, params})` and SQLite sessions use the legacy DatabaseService path → `IpcResult`. Push events use `webContents.send` / `safeEmit` → `ipcRenderer.on` (`src/preload/window-api/events.ts:5`).\n')
A('**Web:** `src/web/bootstrap.ts` imports `src/web/client/install-api.ts` (sets `window.__VARLENS_WEB__`, line 9, and `window.api = createApi()`) before the renderer. `createApi()` (`src/web/client/api.ts:559`) is a Proxy: `DOMAIN_OVERRIDES` (`api.ts:546`) handle shell, system, updater, and perf entirely on the client, plus pickers/uploads, SSE subscriptions and `export.revealInFolder`. Every other property becomes `httpInvoke` → `POST {BASE}/api/<windowKey>/<method>` with body `{args}` (`api.ts:101`), and any `on*` without an override is a silent no-op (`api.ts:361`). On the server, the auth preHandler (`src/web/server/auth.ts:225`) runs first, then the single Fastify route `/api/:domain/:method` (`src/web/server/dispatcher.ts:294`), which applies the pre-rotation gate (`:333`) and maps the camelCase key to kebab-case (`task-types.ts:153`). It tries three layers in order: (1) per-method override from `src/web/server/routes/*.ts` (`dispatcher.ts:237`), (2) `READ_TASK_TYPES` autoroute → read executor with **raw positional args** (`task-types.ts:13`, `dispatcher.ts:372`), (3) `WRITE_TASK_TYPES` autoroute + write audit (`task-types.ts:69`, `dispatcher.ts:392`). Anything else returns **404 `unknown method`** (`dispatcher.ts:412`). Errors come back as JSON `SerializableError` with a 4xx/5xx status, and the client returns them as IPC error envelopes. Uploads use `POST /api/import/upload` (`routes/upload-staging.ts:79`) and push events use SSE `GET /api/events` (`events.ts:40`).\n')
A(f"**Key consequence:** {doc['keyArchitectureFact']}\n")
A('Web storage is always the Postgres `StorageSession`. An autorouted call therefore runs the same executor task as the desktop handler\'s Postgres branch, but skips the desktop Zod validation, default filling and any in-process cache invalidation (for example `clearPanelIntervalCache`).\n')

A('## Per-domain channel tables\n')
A('Columns: preload method · desktop IPC channel · desktop handler · web mechanism (location) · web logic reuse · class · reason / UX decision.\n')
by = collections.OrderedDict()
for o in out:
    by.setdefault(o['domain'], []).append(o)
for dom, rows in by.items():
    c = collections.Counter(r['classification'] for r in rows)
    A(f"### `{dom}`  ({', '.join(f'{k} {v}' for k, v in c.items())})\n")
    A('| Method | Channel | Desktop handler | Web mechanism | Web logic | Class | Reason / UX decision |\n|---|---|---|---|---|---|---|')
    for r in rows:
        ux = f" **UX:** {r['webUxDecisionNeeded']}" if r['webUxDecisionNeeded'] else ''
        loc = f"{r['webMechanism']} (`{r['webLocation']}`)" if r['webLocation'] else (r['webMechanism'] or '')
        A(f"| `{r['preloadMethod'].replace('window.api.', '')}` | `{r['channel']}` | `{r['desktopHandler']}` | {esc(loc)} | {esc(r['webSharedLogic'])} | {r['classification']} | {esc(r['reason'])}{esc(ux)} |")
    A('')

A('## StorageCapabilities\n')
A(f"Type: `{storage['typeDefinition']}`. SQLite: `{storage['sqlite']}`. Postgres: `{storage['postgres']}`. Web overlay: `{storage['webOverlay']}`.\n")
A('| Flag | SQLite (desktop) | Postgres (desktop) | Web (served) |\n|---|---|---|---|')
for f, v in storage['flagsThatDiffer'].items():
    A(f"| `{f}` | {v['sqlite']} | {v['postgres']} | {v['web']} |")
A(f"\nAll other flags: {storage['allOtherFlags']}.\n")
A(f"Gate semantics: {storage['rendererGateSemantics']}.\n")
A('Flags declared but never read by the renderer: ' + ', '.join(f'`{x}`' for x in storage['flagsNeverReadByRenderer']) + '.\n')
A('### Renderer capability consumers\n')
A('| Capability path | Site | Effect |\n|---|---|---|')
for c in storage['rendererConsumers']:
    A(f"| `{c['path']}` | `{c['site']}` | {esc(c['effect'])} |")
A('')

A('## Renderer runtime gates (web vs desktop branching)\n')
A('| Site | Check | Effect |\n|---|---|---|')
for g in renderer_gates:
    A(f"| `{g['site']}` | {esc(g['check'])} | {esc(g['effect'])} |")
A('\n**Ungated web failures.** These non-PARITY methods are called from renderer code with no web gate, so the user sees an error or a silent no-op:\n')
for u in ungated_web_failures:
    A(f'- {u}')
A('\nGaps hidden by capability flags (the user sees a "not available" message): ' + ', '.join(ungated_capability_gated) + '. Gaps hidden by runtime gates: protein/gnomad viewer, database file lifecycle, multi-file VCF import entry.')
A('')

A('## Event / push channels\n')
A('| Channel | Desktop emitter | Preload subscriber | Web | Status |\n|---|---|---|---|---|')
for e in events:
    A(f"| `{e['channel']}` | {esc(e['desktopEmitter'])} | {esc(e['preloadSubscriber'])} | {esc(e['web'])} | {e['status']} |")
A('\nSSE transport notes:\n')
for n in sse_notes:
    A(f'- {n}')
A('')

A('## Dead, hidden, or alias web routes\n')
for x in doc['deadOrHiddenWebRoutes']['webOnlyOverrides']:
    A(f'- {x}')
A('- Alias autoroutes reachable only by direct HTTP: ' + ', '.join(f'`{x}`' for x in doc['deadOrHiddenWebRoutes']['aliasAutoroutesReachableOnlyByDirectHttp']) + '. ' + doc['deadOrHiddenWebRoutes']['aliasNote'] + '\n')

A('## Desktop defects found incidentally\n')
for x in doc['desktopDefectsFound']:
    A(f'- {x}')
A('')

A('## Existing parity tests and their blind spots\n')
A('| Test | Runs in | Enforces | Blind spots |\n|---|---|---|---|')
for t in tests:
    A(f"| `{t['test']}` | {esc(t['runsIn'])} | {esc(t['enforces'])} | {esc(t['blindSpots'])} |")
A(f"\n**Does any test fail when a desktop channel has no web implementation?** {answer_missing_impl_test}\n")

A('## Existing planning intent (for reconciliation)\n')
A('- `.planning/web/context/decisions/adr/0002-parallel-maintainability.md`: one `<domain>-logic.ts` per domain shared by both transports. It is violated by the batch-import (`startWebBatchImport`) and checkDuplicates reimplementations, and the per-route adapters for variants.query, transcripts, and annotations getGlobal/getForVariant duplicate validation instead of sharing it.')
A('- `.planning/web/backlog/web-browser-upload-and-downloads.md`: the **upload half is now implemented** (`routes/upload-staging.ts`, client pickers), so the doc is stale there. The **download half is still open**: export is 501 or capability-disabled.')
A('- `.planning/web/backlog/web-cohort-association-support.md`: asks to choose between implementing association or gating it in the UI. Neither has been done, so the run action is ungated and returns 501.')
A('- `tests/web-gate/README.md` and `handler-seam.test.ts` ROUTE_OVERRIDE_LOGIC_EXCEPTIONS: say web "intentionally disables external reference fetches" (gene-ref, hpo, protein, vep). That leaves HPO term entry, VEP/MyVariant/SpliceAI enrichment, and panel gene validation unusable in web without a recorded UX decision.')
A('- `.planning/web/backlog/phase3-execution-plan.md` planned hand-written `src/web/api-shim/<domain>.ts` files implementing each `*DomainContract`, so the compiler would catch missing methods. What shipped is a permissive Proxy (`api.ts:5-19`), which removes that compile-time completeness check.')
open(f'{HERE}/static-inventory.md', 'w').write('\n'.join(md) + '\n')
print(dict(counts), len(out))
print('UNGATED', ungated_web_failures)
