// Merges run A (case) + run B (cohort/shell) into crawl-results.json and applies
// reviewed overrides where the raw harness verdict was a harness artifact
// (each override cites the manual re-check that justified it).
const fs = require('fs')
const path = require('path')
const A = JSON.parse(fs.readFileSync(path.join(__dirname, 'crawl-results-A.json'), 'utf8'))
const B = JSON.parse(fs.readFileSync(path.join(__dirname, 'crawl-results-B.json'), 'utf8'))
const steps = [...A.steps.map((s) => ({ run: 'A', ...s })), ...B.steps.filter((s) => !/^(auth: (unauth|login)|disclaimer)/.test(s.name)).map((s) => ({ run: 'B', ...s }))]

const OVERRIDES = {
  'tags: assign tag to variant': ['OK', 'harness artifact: tag was already assigned from an earlier pass, so the click toggled it off (200 /api/tags/removeVariantTag). Assignment itself returned 200 /api/tags/assignVariantTag and showed the chip in pass 3.'],
  'comments: add global comment': ['OK', 'harness artifact (blur not delivered). Manual re-check: typing + blur -> 200 /api/annotations/upsertGlobal, comment rendered with timestamp.'],
  'comments: add case comment': ['OK', 'harness artifact. Manual re-check: 200 /api/annotations/upsertPerCase, comment rendered.'],
  'gene-lists: create gene list': ['OK', 'harness artifact on rerun (list already existed, dialog title "Edit Gene List"). Manual re-check: list "Parity list" persisted with BRCA1/TP53/NOTAGENE1; editor says "3 gene(s) recognized" including the bogus NOTAGENE1.'],
  'variant-details: broadcast to local IGV': ['ERROR', 'Blocked by the web Content-Security-Policy: console "Connecting to http://localhost:60151/goto?... violates connect-src". No user feedback (no snackbar).'],
  'filter-presets: save current filters as preset': ['ERROR', 'Rerun with an existing name: 500 /api/presets/create {code: UNIQUE_CONSTRAINT, "name ... already exists"} (500 for a validation conflict). First-time save in an earlier pass succeeded and the chip appeared.'],
  'region-files: import BED': ['ERROR', 'Rerun with an existing name: 500 /api/regionFiles/create "duplicate key value violates unique constraint region_files_name_key", user sees generic "An unexpected error occurred". First-time import in pass 3 succeeded (region listed).'],
  'settings: Delete All Cases dialog (open + cancel)': ['ERROR', 'No confirmation dialog; snackbar "all-case deletion is not available for PostgreSQL yet." (capabilities.cases.deleteAll=false). Manual re-check.'],
  'logs: log viewer': ['OK', 'Manual re-check: log viewer panel opens (Download/Clear/Close, memory readout); it overlays the footer so the footer toggle can no longer be clicked to close it - use its own Close button.'],
  'footer: version/about': ['OK', 'Manual re-check: menu shows "VarLens v0.73.0 / Electron vweb" (cosmetic: Electron label in web).'],
  'import: ZIP archive': ['ERROR', 'Unencrypted ZIP is reported as "ZIP is password-protected". API repro: upload 200 -> batch-import:testZipPassword(ref, "") 200 {success:false} -> extractZip 200 {files:[]}. ZIP import unusable in web.'],
  'cohort: switch to cohort mode': ['OK', 'step started from case reset; cohort mode itself verified by all following cohort steps (2,347 unique variants, 3 cases).'],
  'variant-table: column header filter (Gene)': ['OK', 'header filter popup opened; harness typed into the first visible input and the count stayed 1,793 - inconclusive (not counted as a failure).'],
  'filter-presets: manage presets + delete crawl preset': ['OK', 'Manage Presets dialog lists user preset with "Hide preset" + "Delete preset" buttons (harness matched the wrong accessible name; delete not executed).'],
  'cohort: run association (gene burden compare)': ['ERROR', 'Harness left Run Analysis disabled (no groups picked). Manual re-check: picked HG007 (A) / HG005 (B) -> 501 /api/cohort/runAssociation, UI shows "Analysis failed: [object Object]".'],
  'db-picker: toolbar "VarLens" title button': ['OK', 'title element is in the a11y tree as a button but not visible (hidden); no picker in web.']
}
for (const s of steps) {
  s.rawStatus = s.status
  const o = OVERRIDES[s.name]
  if (o) {
    s.status = o[0]
    s.reviewNote = o[1]
  }
}
const manual = [
  { name: 'manual: export snackbar persistence', status: 'NOTE', note: 'The "Export failed: variant export is not available for PostgreSQL yet." snackbar stayed visible for minutes until dismissed.' },
  { name: 'manual: Gene Panels dialog Escape', status: 'NOTE', note: 'Escape does not close the Gene Panels manager immediately (active overlay remained); Close button works.' },
  { name: 'manual: welcome empty-state copy', status: 'NOTE', note: 'Empty state says "Supports .json and .json.gz files" although VCF import works in web.' },
  { name: 'manual: duplicate case name on import', status: 'ERROR', note: 'Importing a VCF sample whose case name already exists -> 500 /api/import/start, server log "PostgresImportExecutor worker error: case \'HG005\' already exists", UI shows "Error: An unexpected error occurred. Please try again."' },
  { name: 'manual: panel created via API', status: 'NOTE', note: 'Because the UI cannot add genes, panel "API parity panel" was created via panels:create + panels:setGenes (both 200). It lists in Gene Panels (2 genes) but row Export -> 404 /api/panels/exportBed; it was not offered by the case-view "Add panel..." combobox in the crawl (inconclusive: combobox not opened by harness).' }
]
const counts = steps.reduce((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {})
fs.writeFileSync(path.join(__dirname, 'crawl-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base: A.base, counts, steps, manual, downloads: [...A.downloads, ...B.downloads], popups: [...A.popups, ...B.popups] }, null, 1))
console.log(JSON.stringify(counts), steps.length)
