#!/usr/bin/env python3
"""Mechanical extraction of window.api surface -> desktop channel -> web resolution.
Run: python3 -I extract.py <repo_root> <out_json>
"""
import json, os, re, sys

ROOT = sys.argv[1]
OUT = sys.argv[2]

def rd(p):
    with open(os.path.join(ROOT, p)) as f:
        return f.read()

def lineno(text, idx):
    return text.count('\n', 0, idx) + 1

# ---------- preload domain files: method -> channel ----------
PRELOAD_DIR = 'src/preload/domains'
const_maps = {
    'DEBUG_CHANNELS': {'queryCountersGet': 'debug:queryCounters:get', 'queryCountersReset': 'debug:queryCounters:reset'},
    'JOBS_CHANNELS': {'list': 'jobs:list', 'get': 'jobs:get', 'progress': 'jobs:progress'},
}
preload = {}  # file stem -> {method: (channel, line)}
for fn in sorted(os.listdir(os.path.join(ROOT, PRELOAD_DIR))):
    stem = fn[:-3]
    txt = rd(f'{PRELOAD_DIR}/{fn}')
    m = {}
    for mm in re.finditer(r"\n {4}(\w+): (?:async )?\([^)]*\)\s*=>", txt):
        method = mm.group(1)
        # look ahead within the next 900 chars for the first invoke
        seg = txt[mm.end(): mm.end() + 900]
        nxt = re.search(r"\n {4}\w+: (?:async )?\(", seg)
        if nxt:
            seg = seg[:nxt.start()]
        inv = re.findall(r"ipcRenderer\.invoke\(\s*'([^']+)'", seg)
        if not inv:
            c = re.search(r"ipcRenderer\.invoke\(\s*(\w+)\.(\w+)", seg)
            if c:
                inv = [const_maps[c.group(1)][c.group(2)]]
        ch = inv[-1] if inv else None
        m[method] = (ch, lineno(txt, mm.start() + 1))
    preload[stem] = m

DOMAIN_VAR_TO_FILE = {
    'analysisGroupsDomain': 'analysis-groups', 'annotationsDomain': 'annotations', 'auditLogDomain': 'audit-log',
    'authDomain': 'auth', 'batchImportDomain': 'batch-import', 'caseCommentsDomain': 'case-comments',
    'caseMetadataDomain': 'case-metadata', 'caseMetricsDomain': 'case-metrics', 'casesDomain': 'cases',
    'cohortDomain': 'cohort', 'databaseDomain': 'database', 'exportDomain': 'export',
    'filterPresetsDomain': 'filter-presets', 'geneListsDomain': 'gene-lists', 'geneRefDomain': 'gene-ref',
    'gnomadDomain': 'gnomad', 'hpoDomain': 'hpo', 'importDomain': 'import', 'myvariantDomain': 'myvariant',
    'panelsDomain': 'panels', 'proteinDomain': 'protein', 'regionFilesDomain': 'region-files',
    'spliceaiDomain': 'spliceai', 'tagsDomain': 'tags', 'transcriptsDomain': 'transcripts',
    'variantsDomain': 'variants', 'vepDomain': 'vep',
}

# ---------- window api assembly ----------
records = []
seen = set()
for wfile in ['src/preload/window-api/core-api.ts', 'src/preload/window-api/app-api.ts']:
    txt = rd(wfile)
    for blk in re.finditer(r"\n {4}(\w+): \{\n(.*?)\n {4}\}", txt, re.S):
        key = blk.group(1)
        body = blk.group(2)
        body_start = blk.start(2)
        for mm in re.finditer(r"(?:^|\n) {6}(\w+): ", body):
            method = mm.group(1)
            seg = body[mm.end(): mm.end() + 600]
            nxt = re.search(r"\n {6}\w+: ", seg)
            if nxt:
                seg = seg[:nxt.start()]
            line = lineno(txt, body_start + mm.start() + 1)
            rec = {'windowKey': key, 'method': method, 'preloadWrapper': f'{wfile}:{line}'}
            d = re.search(r"(\w+Domain)\.(\w+)\(", seg)
            if d:
                f = DOMAIN_VAR_TO_FILE[d.group(1)]
                ch, pl = preload[f].get(d.group(2), (None, None))
                rec.update(kind='invoke', channel=ch, preloadBinding=f'{PRELOAD_DIR}/{f}.ts:{pl}', preloadDomainFile=f)
            elif 'subscribeToIpcEvent' in seg:
                rec.update(kind='event', channel=re.search(r"subscribeToIpcEvent\('([^']+)'", seg).group(1))
            elif 'ipcRenderer.send' in seg:
                rec.update(kind='send', channel=re.search(r"ipcRenderer\.send\('([^']+)'", seg).group(1))
            elif 'ipcRenderer.invoke' in seg:
                rec.update(kind='invoke', channel=re.search(r"ipcRenderer\.invoke\('([^']+)'", seg).group(1))
            else:
                rec.update(kind='local', channel=None)
            records.append(rec)
            seen.add((key, method))

# debug / jobs (assembled directly from domain factories)
for key, stem in [('debug', 'debug'), ('jobs', 'jobs')]:
    for method, (ch, pl) in preload[stem].items():
        records.append({'windowKey': key, 'method': method, 'kind': 'invoke', 'channel': ch,
                        'preloadWrapper': 'src/preload/window-api/create-window-api.ts', 'preloadBinding': f'{PRELOAD_DIR}/{stem}.ts:{pl}',
                        'preloadDomainFile': stem})
        seen.add((key, method))

# preload-domain methods NOT exposed on window.api
FILE_TO_KEY = {v: None for v in DOMAIN_VAR_TO_FILE.values()}
key_by_file = {}
for r in records:
    if r.get('preloadDomainFile'):
        key_by_file[r['preloadDomainFile']] = r['windowKey']
for stem, methods in preload.items():
    key = key_by_file.get(stem)
    if key is None:
        continue
    for method, (ch, pl) in methods.items():
        if (key, method) not in seen:
            records.append({'windowKey': key, 'method': method, 'kind': 'invoke', 'channel': ch,
                            'preloadWrapper': None, 'preloadBinding': f'{PRELOAD_DIR}/{stem}.ts:{pl}',
                            'preloadDomainFile': stem, 'notExposedOnWindowApi': True})
# import registerDroppedFileEnrollmentToken is an internal helper channel
records.append({'windowKey': 'import', 'method': '(internal) registerDroppedFileEnrollmentToken', 'kind': 'invoke',
                'channel': 'import:registerDroppedFileEnrollmentToken', 'preloadWrapper': None,
                'preloadBinding': 'src/preload/domains/import.ts:20', 'internal': True})

# ---------- main handler location ----------
main_files = []
for d in ['src/main/ipc/handlers', 'src/main/ipc/domains']:
    for fn in sorted(os.listdir(os.path.join(ROOT, d))):
        if fn.endswith('.ts'):
            main_files.append(f'{d}/{fn}')
main_files += ['src/main/index.ts', 'src/main/services/AutoUpdater.ts', 'src/main/services/MainLogger.ts', 'src/main/ipc/utils/safeEmit.ts']
main_txt = {f: rd(f) for f in main_files}
CONST_LOC = {'debug:queryCounters:get': 'src/main/ipc/domains/debug.ts:11', 'debug:queryCounters:reset': 'src/main/ipc/domains/debug.ts:18',
             'jobs:list': 'src/main/ipc/domains/jobs.ts:21', 'jobs:get': 'src/main/ipc/domains/jobs.ts:34', 'jobs:progress': 'src/main/ipc/domains/jobs.ts:47'}

def find_main(channel, kind):
    if channel is None:
        return None
    if channel in CONST_LOC:
        return CONST_LOC[channel]
    pats = [r"ipcMain\.(?:handle|on|once)\(\s*'" + re.escape(channel) + "'"]
    if kind == 'event':
        pats = [r"(?:send|safeEmit)\(\s*'" + re.escape(channel) + "'", r"'" + re.escape(channel) + "'"]
    for p in pats:
        for f, t in main_txt.items():
            m = re.search(p, t)
            if m:
                return f'{f}:{lineno(t, m.start())}'
    return None

for r in records:
    r['desktopHandler'] = find_main(r['channel'], r['kind'])
    if r['kind'] == 'event':
        # also locate emitters
        ems = []
        for f, t in main_txt.items():
            for m in re.finditer(r"(?:send|safeEmit)\(\s*'" + re.escape(r['channel'] or '') + "'", t):
                ems.append(f'{f}:{lineno(t, m.start())}')
        r['desktopEmitters'] = ems

# ---------- web server: overrides + task types ----------
routes_dir = 'src/web/server/routes'
overrides = {}
for fn in sorted(os.listdir(os.path.join(ROOT, routes_dir))):
    if not fn.endswith('.ts'):
        continue
    t = rd(f'{routes_dir}/{fn}')
    keys = list(re.finditer(r"\n {4}'([a-z-]+:[A-Za-z]+)': \{", t))
    for i, mm in enumerate(keys):
        end = keys[i + 1].start() if i + 1 < len(keys) else len(t)
        body = t[mm.end(): end]
        overrides[mm.group(1)] = {'loc': f'{routes_dir}/{fn}:{lineno(t, mm.start() + 1)}', 'body': body, 'file': fn}

tt = rd('src/web/server/task-types.ts')
read_start = tt.index('READ_TASK_TYPES = [')
write_start = tt.index('WRITE_TASK_TYPES = [')
task_types = {}
for m in re.finditer(r"\n  '([a-z-]+:[A-Za-z]+)'", tt):
    kind = 'read' if m.start() < write_start else 'write'
    task_types[m.group(1)] = (kind, f'src/web/server/task-types.ts:{lineno(tt, m.start() + 1)}')
CAMEL = {'caseMetadata': 'case-metadata', 'caseComments': 'case-comments', 'caseMetrics': 'case-metrics', 'geneLists': 'gene-lists',
         'geneRef': 'gene-ref', 'regionFiles': 'region-files', 'analysisGroups': 'analysis-groups', 'batchImport': 'batch-import', 'audit': 'audit'}

# client-side overrides in src/web/client/api.ts
api = rd('src/web/client/api.ts')
def apiline(s):
    i = api.index(s)
    return f'src/web/client/api.ts:{lineno(api, i)}'
CLIENT = {
    ('perf', 'reportInteractive'): ('client-side-stub', apiline('reportInteractive: () => undefined'), 'no-op'),
    ('perf', 'isEnabled'): ('client-side-stub', apiline('isEnabled: () => false'), 'always false'),
    ('perf', 'getSnapshot'): ('client-rpc-to-unknown', apiline("getSnapshot: () => httpInvoke('perf'"), "POSTs /api/perf/getSnapshot -> 404 (no server route)"),
    ('perf', 'resetSnapshot'): ('client-rpc-to-unknown', apiline("resetSnapshot: () => httpInvoke('perf'"), "POSTs /api/perf/resetSnapshot -> 404"),
    ('shell', 'openExternal'): ('client-side-impl', apiline('openExternal: (url: string) =>'), 'window.open after allowlist check (static ALLOWED_DOMAINS only; user domains ignored)'),
    ('shell', 'updateDomains'): ('client-side-stub', apiline('updateDomains: (_domains'), 'no-op; user-added domains never take effect'),
    ('export', 'revealInFolder'): ('client-side-stub', apiline("if (prop === 'revealInFolder')"), 'returns {success:false}'),
    ('system', 'getVersion'): ('client-side-stub', apiline('getVersion: () =>'), "{app: __APP_VERSION__, electron:'web'}"),
    ('system', 'getUserDataPath'): ('client-side-stub', apiline('getUserDataPath: () =>'), "'web'"),
    ('system', 'getCpuCount'): ('client-side-stub', apiline('getCpuCount: () =>'), 'navigator.hardwareConcurrency (client CPU, meaningless for server)'),
    ('system', 'setWorkerThreads'): ('client-side-stub', apiline('setWorkerThreads: (_count'), 'no-op'),
    ('system', 'getWorkerThreads'): ('client-side-stub', apiline('getWorkerThreads: () =>'), '0'),
    ('system', 'getLogFilePath'): ('client-side-stub', apiline('getLogFilePath: () =>'), "''"),
    ('updater', 'checkForUpdate'): ('client-side-stub', apiline('checkForUpdate: () =>'), 'no-op'),
    ('updater', 'downloadUpdate'): ('client-side-stub', apiline('downloadUpdate: () =>'), 'no-op'),
    ('updater', 'installUpdate'): ('client-side-stub', apiline('installUpdate: () =>'), 'no-op'),
    ('updater', 'getStatus'): ('client-side-stub', apiline('getStatus: () =>'), "{state:'idle'}"),
    ('updater', 'onStatusChange'): ('client-side-stub', apiline('onStatusChange: (_callback'), 'no-op unsubscribe'),
    ('import', 'onProgress'): ('sse', apiline("subscribeWebEvent('import:progress'"), "SSE event 'import:progress' via GET /api/events"),
    ('import', 'selectFile'): ('client-side-impl+upload', apiline("if (prop === 'selectFile')"), '<input type=file> + XHR POST /api/import/upload -> upload ref'),
    ('import', 'selectFiles'): ('client-side-impl+upload', apiline("if (prop === 'selectFiles')"), '<input multiple> + upload refs'),
    ('import', 'selectBedFile'): ('client-side-impl+upload', apiline("if (prop === 'selectBedFile')"), '<input .bed> + upload ref'),
    ('import', 'enrollDroppedFiles'): ('client-side-impl+upload', apiline("if (prop === 'enrollDroppedFiles')"), 'uploads dropped File objects -> refs'),
    ('batchImport', 'onProgress'): ('sse', apiline("subscribeWebEvent('batch-import:progress'"), "SSE 'batch-import:progress'"),
    ('batchImport', 'onComplete'): ('sse', apiline("subscribeWebEvent('batch-import:complete'"), "SSE 'batch-import:complete'"),
    ('batchImport', 'selectFiles'): ('client-side-impl+upload', apiline("pickAndUploadFiles({\n              multiple: true,\n              accept"), '<input multiple> + uploads'),
    ('batchImport', 'selectFolder'): ('client-side-impl+upload', apiline("directory: true"), '<input webkitdirectory> + uploads'),
    ('batchImport', 'selectZip'): ('client-side-impl+upload', apiline("if (prop === 'selectZip')"), 'upload .zip then server testZipPassword probe'),
    ('variants', 'onAnnotationChanged'): ('sse', apiline("subscribeWebEvent('variants:annotationChanged'"), "SSE 'variants:annotationChanged'"),
    ('cohort', 'onSummaryRebuilt'): ('sse', apiline("subscribeWebEvent('cohort:summaryRebuilt'"), "SSE 'cohort:summaryRebuilt'"),
}
NOOP_ON_LOC = apiline("if (prop.startsWith('on'))")

for r in records:
    key, method = r['windowKey'], r['method']
    if r.get('internal'):
        r['web'] = {'mechanism': 'not-applicable', 'note': 'preload-internal helper; web enrollDroppedFiles uploads instead'}
        continue
    if (key, method) in CLIENT:
        mech, loc, note = CLIENT[(key, method)]
        r['web'] = {'mechanism': mech, 'loc': loc, 'note': note}
        continue
    if key in ('perf', 'shell', 'system', 'updater'):
        r['web'] = {'mechanism': 'client-undefined', 'loc': apiline('const DOMAIN_OVERRIDES'), 'note': 'domain fully replaced client-side; method missing -> undefined (TypeError on call)'}
        continue
    if method.startswith('on'):
        r['web'] = {'mechanism': 'client-noop-subscription', 'loc': NOOP_ON_LOC, 'note': 'any on* -> no-op unsubscribe; events never delivered'}
        continue
    if r.get('notExposedOnWindowApi'):
        r['web'] = {'mechanism': 'n/a-not-exposed', 'note': 'not exposed on desktop window.api either'}
        # still compute server key for info
    sk = f"{CAMEL.get(key, key)}:{method}"
    r['webServerKey'] = sk
    if sk in overrides:
        ov = overrides[sk]
        body = ov['body']
        if 'webParityFixturesEnabled' in body:
            mech = 'fixture-gated'
            note = 'returns 501 unsupported-web-capability unless VARLENS_WEB_PARITY_FIXTURES=1 + VARLENS_API_FIXTURES_DIR (test fixtures only)'
        elif 'unsupportedWebCapability' in body:
            mech, note = '501-unsupportedWebCapability', 'always 501'
        elif re.search(r"reply\.code\(501\)", body):
            mech, note = 'route-override(501-path)', 'override with explicit 501 branch'
        else:
            mech, note = 'route-override', ''
        logic = sorted(set(re.findall(r"\b(\w+ViaSession|startImport|startMultiFileImport|getVcfPreview|getVcfMultiPreview|cancelImport|extractZip|testZipPassword|cleanupZipTemp|searchVariants|getFilterOptions|getPanelWithGenes|exportPostgres\w+|upsertPerCaseAnnotationWithEvent|startWebBatchImport|getWebGeneReferenceDb|build\w+FixtureResponse|authService\.\w+|session\.listCases|session\.health)\b", body)))
        uses_exec = bool(re.search(r"get(Read|Write)Executor\(\)", body))
        cur = r.get('web', {})
        r['web'] = {**cur, 'mechanism': cur.get('mechanism') if cur.get('mechanism') == 'n/a-not-exposed' else mech,
                    'loc': ov['loc'], 'note': (cur.get('note', '') + ' ' + note).strip(),
                    'calls': logic, 'usesExecutor': uses_exec}
    elif sk in task_types:
        kind, loc = task_types[sk]
        r['web'] = {'mechanism': f'generic-bridge({kind}-task autoroute)', 'loc': loc,
                    'note': 'POST /api/<domain>/<method> -> session.get' + ('Read' if kind == 'read' else 'Write') + 'Executor().execute({type, params: rawArgs})',
                    'usesExecutor': True}
    else:
        if r.get('web', {}).get('mechanism') != 'n/a-not-exposed':
            r['web'] = {'mechanism': '404-not-wired', 'loc': 'src/web/server/dispatcher.ts:412', 'note': 'no override, not in READ/WRITE_TASK_TYPES -> 404 unknown method'}

# ---------- renderer usage ----------
ren_root = os.path.join(ROOT, 'src/renderer/src')
ren_files = []
for dp, dn, fns in os.walk(ren_root):
    if '/mocks' in dp or dp.endswith('mocks'):
        continue
    for fn in fns:
        if fn.endswith(('.ts', '.vue')):
            ren_files.append(os.path.join(dp, fn))
ren_txt = {os.path.relpath(f, ROOT): open(f).read() for f in ren_files}
for r in records:
    m = r['method']
    if m.startswith('('):
        continue
    pat = re.compile(r"\b" + re.escape(r["windowKey"]) + r"\??\s*\.\s*" + re.escape(m) + r"\b")
    hits = []
    for f, t in ren_txt.items():
        for mm in pat.finditer(t):
            hits.append(f'{f}:{lineno(t, mm.start())}')
    r['rendererCallSites'] = hits
    probable = []
    kp = re.compile(r"(?:\.|\b)" + re.escape(r['windowKey']) + r"\b")
    mp = re.compile(r"\.\s*" + re.escape(m) + r"\s*[(\n]|\b" + re.escape(m) + r"\s*\(")
    for f, t in ren_txt.items():
        if any(h.startswith(f + ':') for h in hits):
            continue
        if kp.search(t):
            mm = mp.search(t)
            if mm:
                probable.append(f'{f}:{lineno(t, mm.start())}')
    r['rendererProbableAliasedCallSites'] = probable

with open(OUT, 'w') as f:
    json.dump({'records': records, 'overrideKeys': sorted(overrides), 'taskTypes': task_types}, f, indent=1)
print(len(records), 'records;', len(overrides), 'override keys;', len(task_types), 'task types')
# overrides not matched to any window method
used = {r.get('webServerKey') for r in records}
print('UNMATCHED OVERRIDES:', [k for k in overrides if k not in used])
print('UNMATCHED TASK TYPES:', [k for k in task_types if k not in used])
