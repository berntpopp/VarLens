# Web Settings & Admin Inventory (Track 4)

- **Date:** 2026-10-06
- **Branch:** `feat/web-mode-completeness` (base `main` 8a662b89)
- **Instance:** built web bundle (`VARLENS_WEB_BASE=/ npm run build:web`), `127.0.0.1:8840`,
  Postgres throwaway DB `varlens_track4`, schema `web_dev_track4`, logged in as the bootstrap
  admin. Data: GIAB trio `tests/test-data/vcf/trio-region.vep.vcf.gz` (3 cases, 5,187 variants).
- **Method:** headless Playwright (Chromium) opening every Settings menu entry, the header
  menus, footer actions, case metadata, and every admin action; console errors and every
  `/api/*` response ≥ 400 recorded per step. A static routing map (every `window.api` method
  vs. web dispatcher overrides / read- and write-task autoroutes / client-side shims) was
  generated to find unrouted methods. Scripts: `probe2.mjs`, `panel.mjs`, `route-map.cjs` in
  this folder.

Status legend: **works** · **broken** (error noted) · **desktop-only** (hidden/disabled in
web with an explanation) · **gap** (left for the parity spec).

## Before / after

| # | Area / action | Before (main) | After (this branch) | Root cause |
|---|---|---|---|---|
| 1 | Settings › Database Overview | works | works | — |
| 2 | Settings › Import Data (single / multiple / folder / ZIP) | works (upload + `import:start` verified via API) | works | — |
| 3 | Settings › Import VCF Files (multi-file case) | hidden in web | hidden in web (**gap**) | UI gate `v-if="!isWebMode"` in `AppToolbar.vue`; the server *does* route `import:startMultiFile` and capabilities report `multiFileVcf: true`. Candidate for the parity spec. |
| 4 | Settings › External Links (toggle, persists across reload) | works | works | — |
| 5 | Settings › Custom Tags (create) | works | works | — |
| 6 | Settings › Gene Panels › open | **broken**: `POST /api/geneRef/info` → 501 (console error) | works (gene-reference footer shows HGNC build) | `gene-ref:info/assemblies` overrides gated by `webParityFixturesEnabled()` (fixture-only); container did not ship `gene_reference.db`. |
| 7 | Gene Panels › gene search (autocomplete) | **broken**: `POST /api/panels/autocomplete` → 404; dropdown also threw `TypeError: reading 'symbol'` | works (FTS5 results) | (a) no web route override for `panels:autocomplete`; (b) `GeneAutocomplete.vue` read `item.raw` in the `v-autocomplete` item slot, but Vuetify 4 passes the raw item (latent desktop bug too). JSON `null` limit → treated as absent. |
| 8 | Gene Panels › Paste list (validate symbols) | **broken**: `POST /api/panels/validateSymbols` → 404, nothing validated | works (approved / alias / unknown) | No web route override for `panels:validateSymbols`. |
| 9 | Gene Panels › Save new panel | **broken** (no genes could be added) | works (`panels:create` + `setGenes`, listed) | Consequence of 7/8. |
| 10 | Gene Panels › Import PanelApp | **broken**: `POST /api/panels/searchPanelApp` → 404 ("Unknown API method") | desktop-only: hidden + note | No web route; needs the outbound PanelApp client on the server. |
| 11 | Gene Panels › StringDB Generate | **broken** (generate → 404) | desktop-only: hidden + note | No web route for `panels:generateStringDb` (outbound STRING API). |
| 12 | Gene Panels › Export BED | **broken** (404) | desktop-only: hidden + note | No web route for `panels:exportBed`; desktop writes via a save dialog path, web needs a download route (export track owns downloads). |
| 13 | Gene Panels › Update gene reference | **broken** (404) | desktop-only: hidden + note | No route for `gene-ref:checkUpdates/update`; the web reference file is part of the deployed image. |
| 14 | Panel filters (case/cohort) | **broken** server-side (stub threw) — not reachable while panels could not be created | unblocked; not E2E-verified with a panel filter | `src/web/stubs/gene-reference-loader-stub.ts` threw for `getGeneReferenceDb()`, which `PostgresCohortRepository` uses for panel intervals. Now a node:sqlite-backed `GeneReferenceDb`. |
| 15 | Settings › Application Preferences | works, but shows desktop-only **Worker Threads** ("Auto: 31 threads", no effect in web); no theme control | Worker Threads hidden in web; Theme System/Light/Dark added | `system.setWorkerThreads` is a client-side no-op shim in web (`SYSTEM_API`). |
| 16 | Settings › Reset Columns / Reset Filters | works | works | local preferences only |
| 17 | Settings › Delete All Cases | **broken**: enabled, then "all-case deletion is not available for PostgreSQL yet." | disabled with that reason as subtitle (**gap**) | Capability `cases.deleteAll: false` for Postgres and no web route (`cases:deleteAll`, `cases:deleteBatch` unrouted). Track 5b (delete job) may lift it. |
| 18 | Header › "VarLens Web" database menu | works (shows `web:postgres`) | works | Desktop DB lifecycle (`database:open/create/rekey/…`) intentionally unrouted. |
| 19 | Header › Sign out | **absent** (server had `auth:logout`, no UI) | works: account menu → Sign out → `/login`; next API call 401 | No UI. |
| 20 | Header › Change own password | **absent** (only the forced-rotation flow) | works (account menu dialog → `auth:changePassword`) | No UI. |
| 21 | Admin › User management UI | **absent** (`UserManagement.vue` mounted nowhere) | admin-only dialog from the account menu | Component never mounted. |
| 22 | Admin › List users | API works, no UI | works | — |
| 23 | Admin › Create user | **broken**: `auth:createUser` → 501 "disabled for this single-tenant release" | works (temp password, forced rotation; duplicate → 409) | Deliberate stub in `routes/auth.ts`. Reversed per the user's request for full admin; audited as `api_write` on the `user_account` entity. |
| 24 | Admin › Change role | **absent**: no `auth:setRole` (404); a second admin was impossible | works (promote/demote; never demotes the last active admin; not on self) | No method + Postgres 0008 partial unique index `users_only_one_active_admin`. New IPC/web method `auth:setRole` (desktop + web) and migration 0017 dropping the index; first-admin bootstrap now serialized by an advisory xact lock. |
| 25 | Admin › Reset password | API works, no UI; unknown user silently 200 | works (UI); unknown user → 404 | `resetPassword` UPDATE never checked the row count. |
| 26 | Admin › Disable user | API works, no UI | works (confirm dialog) | — |
| 27 | Admin › Re-enable user | **absent** | works | New method `auth:reactivateUser` (desktop + web). |
| 28 | Footer › Log viewer / FAQ / Disclaimer / Shortcuts | works | works | — |
| 29 | Footer › About | shows "Electron vweb" | "Web edition" | `system.getVersion` web shim returns `electron: 'web'`. |
| 30 | Case metadata › HPO term search | **broken**: `hpo:search` → 501 rendered as "No matching HPO terms" | explicit "not available in the web version" note; real failures say "HPO search failed" | 501 gate (`unsupportedWebCapability('hpo.search')`) + UI treated errors as empty results. |
| 31 | Case metrics › metric autocomplete subtitles | latent: `item.raw` undefined (Vuetify 4) | fixed (`internalItem.raw`) | Vuetify 4 slot API change. |
| 32 | Details panel › Fetch VEP | **broken**: `vep:fetch` → 501 | hidden in web | `unsupportedWebCapability('vep.fetch')`. |
| 33 | Details panel › Protein / ClinVar lollipop | explained "not available" dialog (pre-existing) | unchanged | `protein:*` 501, `gnomad:getClinVarVariants` unrouted. |
| 34 | Cohort › Gene Burden › Run analysis | not exercised; `cohort:runAssociation` answers 501 | unchanged (**gap**) | `unsupportedWebCapability('cohort.runAssociation')`. |
| 35 | Export (case / cohort) | disabled by capability | not touched — owned by `fix/web-postgres-export` | — |

## Unrouted / gated web methods (input for the parity spec)

Generated with `route-map.cjs` (every `window.api` method vs. dispatcher overrides, read/write
task autoroutes and the client shims in `src/web/client/api.ts`).

- **Gated by `unsupportedWebCapability` (501):** `hpo.search`, `hpo.clearCache`,
  `protein.getMapping/getDomains/getStructure/getGeneStructure`, `vep.fetch/cancel/clearCache/getCacheStats`,
  `cohort.runAssociation/cancelAssociation/rebuildSummary`, `export.variants/cohort`
  (export track). `gene-ref.info/assemblies` were in this list and are now served.
- **No web route (404 "Unknown API method"):** `cases.deleteAll/deleteBatch`,
  `panels.searchPanelApp/importPanelApp/generateStringDb/exportBed`,
  `gene-ref.checkUpdates/update`, `myvariant.fetch/clearCache`, `spliceai.fetch/clearCache`,
  `gnomad.getVariants/getClinVarVariants`, `jobs.list/get/progress`,
  `debug.queryCountersGet/Reset`, `database.*` desktop file/encryption/profile lifecycle.
  `panels.validateSymbols/autocomplete` were in this list and are now routed.
- **Client-side shims (intentional):** `system.*`, `updater.*`, `perf.*`, `shell.*`,
  `export.revealInFolder`, file pickers (`import.select*`, `batchImport.select*`).

## Notes

- Audit entries for create / role / re-enable use `action_type = 'api_write'`,
  `entity_type = 'user_account'`, `new_value.method = 'auth:<method>'` to avoid an audit
  CHECK-constraint migration; dedicated `auth_user_create` / `auth_role_change` action types
  would need one.
- Migration 0017 must be numbered against whatever other tracks add; it is a single
  `DROP INDEX IF EXISTS`.
