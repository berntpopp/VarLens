---
phase: 15-external-links
verified: 2026-01-27T23:03:00Z
status: passed
score: 10/10 must-haves verified
---

# Phase 15: External Links Verification Report

**Phase Goal:** User can open variant-specific pages on gnomAD, ClinVar, and OMIM directly from the variant table, with fully configurable link templates via a settings UI.

**Verified:** 2026-01-27T23:03:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can click variant table data values to open external genomic databases | ✓ VERIFIED | VariantTable.vue has clickable spans with external-link class and openExternalLink handlers on pos, chr, clinvar, gene_symbol columns |
| 2 | Clicking position value opens gnomAD variant page in default browser | ✓ VERIFIED | getLinkForColumn('pos') resolves gnomAD URL template, window.api.shell.openExternal called |
| 3 | Clicking chr value opens UCSC Genome Browser in default browser | ✓ VERIFIED | getLinkForColumn('chr') resolves UCSC URL template with hg19/hg38 mapping |
| 4 | Clicking ClinVar significance opens ClinVar coordinate search in default browser | ✓ VERIFIED | getLinkForColumn('clinvar') resolves chr:pos:ref:alt search URL |
| 5 | Clicking gene symbol opens OMIM gene search in default browser | ✓ VERIFIED | getLinkForColumn('gene_symbol') resolves OMIM gene search URL |
| 6 | VarSome and Franklin links appear in variant table virtual columns | ✓ VERIFIED | virtualLinks computed property adds _link_{id} columns dynamically, v-for generates slots |
| 7 | External links are configurable via settings dialog accessible from gear icon | ✓ VERIFIED | App.vue has mdi-cog button calling externalLinksSettingsRef?.show(), ExternalLinksSettings.vue exists with 381 lines |
| 8 | Link configurations persist in localStorage | ✓ VERIFIED | externalLinksStore.ts uses watch(links, saveLinks) with localStorage.setItem(STORAGE_KEY) |
| 9 | Domain allowlist includes all 6 required genomic databases | ✓ VERIFIED | shell.ts ALLOWED_DOMAINS contains gnomad.broadinstitute.org, ncbi.nlm.nih.gov, omim.org, genome.ucsc.edu, varsome.com, franklin.genoox.com |
| 10 | Domain allowlist is synced dynamically from renderer to main process | ✓ VERIFIED | syncDomains() calls window.api.shell.updateDomains on init and config changes, shell.ts has userDomains + shell:updateUserDomains handler |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/renderer/src/utils/externalLinks.ts` | 8 URL builder functions + resolveUrlTemplate | ✓ VERIFIED | 317 lines, exports buildGnomadUrl, buildClinvarUrl, buildClinvarSearchUrl, buildOmimUrl, buildOmimGeneSearchUrl, buildUcscUrl, buildVarsomeUrl, buildFranklinUrl, resolveUrlTemplate, GenomeBuild type |
| `src/main/ipc/handlers/shell.ts` | Expanded ALLOWED_DOMAINS with 6 genomic databases | ✓ VERIFIED | 64 lines, ALLOWED_DOMAINS contains 8 entries (2 original + 6 genomic), userDomains array, shell:updateUserDomains handler, isDomainAllowed checks both |
| `tests/renderer/externalLinks.test.ts` | Unit tests for URL builders | ✓ VERIFIED | 62 tests pass, covers all 8 builders + resolveUrlTemplate with null checks, encoding, build mapping |
| `src/renderer/src/components/VariantTable.vue` | Clickable link cells with external-link class | ✓ VERIFIED | Contains external-link class, openExternalLink async function with window.api.shell.openExternal, dynamic slots for chr/pos/clinvar/gene_symbol/virtualLinks, snackbar error handling, CSS for .external-link, .external-link:hover, .external-link--clicked, .external-link__icon |
| `src/renderer/src/stores/externalLinksStore.ts` | Pinia store with localStorage persistence | ✓ VERIFIED | 254 lines, ExternalLinkConfig type, 6 default links, CRUD actions (updateLink, toggleLink, addCustomLink, removeLink, resetToDefaults), computed getters (enabledLinks, linksByColumn, virtualLinks, configuredDomains), watch(links, saveLinks, {deep:true}), syncDomains on init and change |
| `src/renderer/src/components/ExternalLinksSettings.vue` | Settings dialog with genome build selector, link list, CRUD forms | ✓ VERIFIED | 381 lines, v-dialog with v-btn-toggle for genome build, link list with v-switch toggles, edit form with URL template editor, add custom link, delete confirmation, reset to defaults, defineExpose({show}) |
| `src/renderer/src/App.vue` | Gear icon in app bar opening settings dialog | ✓ VERIFIED | Contains v-btn with mdi-cog icon, @click="externalLinksSettingsRef?.show()", imports and refs ExternalLinksSettings |
| `src/preload/index.ts` | Exposed updateDomains IPC method | ✓ VERIFIED | shell.updateDomains: (domains: string[]) => ipcRenderer.invoke('shell:updateUserDomains', domains) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| VariantTable.vue | externalLinks.ts | Import resolveUrlTemplate | ✓ WIRED | Line 219: import { resolveUrlTemplate, type VariantLinkData } |
| VariantTable.vue | externalLinksStore | useExternalLinksStore | ✓ WIRED | Line 218: import useExternalLinksStore, line 234: const linksStore = useExternalLinksStore() |
| VariantTable.vue | window.api.shell.openExternal | IPC call in openExternalLink | ✓ WIRED | Line 328: const result = await window.api.shell.openExternal(url), error handling with snackbar |
| externalLinksStore | window.api.shell.updateDomains | syncDomains action | ✓ WIRED | Line 222: window.api.shell.updateDomains(domains), called on init (line 236) and watch (line 230) |
| App.vue | ExternalLinksSettings.vue | Gear icon click handler | ✓ WIRED | Line 11-12: v-btn @click="externalLinksSettingsRef?.show()", line 62: <ExternalLinksSettings ref="externalLinksSettingsRef" /> |
| ExternalLinksSettings.vue | externalLinksStore | Store actions | ✓ WIRED | Uses linksStore.toggleLink (line 42), addCustomLink (line 332), updateLink (line 340), removeLink (line 358), resetToDefaults (line 369) |
| shell.ts | userDomains | IPC handler | ✓ WIRED | Line 36: ipcMain.handle('shell:updateUserDomains', ...), line 37: userDomains = domains, line 30: allDomains = [...ALLOWED_DOMAINS, ...userDomains] |
| preload/index.ts | shell:updateUserDomains | IPC invoke | ✓ WIRED | Line 73: updateDomains: (domains: string[]) => ipcRenderer.invoke('shell:updateUserDomains', domains) |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| EXTL-01: Variant table rows include clickable data values linking to gnomAD, ClinVar, and OMIM | ✓ SATISFIED | VariantTable.vue has clickable spans on pos (gnomAD), clinvar (ClinVar), gene_symbol (OMIM) with external-link icon suffix |
| EXTL-02: gnomAD link opens variant page using chr-pos-ref-alt URL format in default browser | ✓ SATISFIED | Default gnomAD link template: https://gnomad.broadinstitute.org/variant/{chr}-{pos}-{ref}-{alt}?dataset={dataset_gnomad} |
| EXTL-03: ClinVar link opens coordinate search using chr:pos:ref:alt URL format in default browser | ✓ SATISFIED | Default ClinVar link template: https://www.ncbi.nlm.nih.gov/clinvar/?term={chr}%3A{pos}%3A{ref}%3A{alt} |
| EXTL-04: OMIM link opens gene search using gene symbol in default browser | ✓ SATISFIED | Default OMIM link template: https://omim.org/search?search={gene} |
| EXTL-05: External link URLs are constructed with proper URL encoding of variant data components | ✓ SATISFIED | resolveUrlTemplate applies encodeURIComponent to ref, alt, gene variables (lines 296-298) |
| EXTL-06: Shell openExternal domain allowlist is expanded to include gnomad.broadinstitute.org, ncbi.nlm.nih.gov, and omim.org | ✓ SATISFIED | shell.ts ALLOWED_DOMAINS lines 15-20 include all 6 genomic databases (3 required + 3 additional: UCSC, VarSome, Franklin) |

**Additional features (from Plan 15-03):**
- URL template system with 10 variable placeholders: {chr}, {pos}, {ref}, {alt}, {gene}, {build}, {build_ucsc}, {dataset_gnomad}, {pos_start}, {pos_end}
- Genome build selector in settings dialog (GRCh37/GRCh38)
- Custom link CRUD: add, edit, remove (built-in links protected)
- Reset to defaults functionality
- Dynamic virtual columns from store

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | No anti-patterns detected |

**Notes:**
- No TODO/FIXME comments in production code
- No placeholder returns or empty implementations
- No console.log-only functions
- All URL builders have proper null checks and URL encoding
- Tests comprehensively cover edge cases (62 tests pass)

### Human Verification Required

#### 1. Visual link affordance

**Test:** Open the app, navigate to variant table, observe position/chr/clinvar/gene values.

**Expected:** 
- All clickable values show a small external-link icon (mdi-open-in-new) as suffix
- Hovering over clickable values shows underline
- Clicking a value briefly highlights it before opening browser

**Why human:** Visual appearance and hover states cannot be verified programmatically.

#### 2. External database page correctness

**Test:** Click position value (should open gnomAD), click chr value (should open UCSC), click ClinVar chip (should open ClinVar), click gene symbol (should open OMIM), click VarSome/Franklin "View" links.

**Expected:**
- gnomAD page loads with correct variant (chr-pos-ref-alt matches clicked variant)
- UCSC Genome Browser shows region centered on variant position
- ClinVar search results match chr:pos:ref:alt coordinates
- OMIM gene search results match gene symbol
- VarSome and Franklin pages load correct variant

**Why human:** External page content verification requires human judgment and network access.

#### 3. Settings dialog functionality

**Test:** Click gear icon in app bar, toggle a link off, observe variant table updates, edit a URL template, add a custom link, delete a custom link, reset to defaults, change genome build.

**Expected:**
- Settings dialog opens with all 6 default links listed
- Toggling a link off immediately removes it from variant table
- Editing URL template changes link destination
- Adding custom link creates new virtual column
- Deleting custom link removes its column
- Reset to defaults restores original 6 links
- Changing genome build affects gnomAD dataset (r2_1 vs r4) and UCSC db (hg19 vs hg38)
- All settings persist after app restart

**Why human:** Complex UI interactions and visual feedback require human testing.

#### 4. Domain allowlist security

**Test:** Try to add a custom link with a non-HTTPS URL or a domain not in the allowlist.

**Expected:**
- Non-HTTPS URLs are rejected by shell.openExternal with "Only HTTPS URLs allowed" error
- Non-allowlisted domains are rejected with "Domain not allowed" error
- Snackbar displays "Could not open link" error message

**Why human:** Security boundary testing requires deliberate malicious input.

#### 5. Franklin URL format validation

**Test:** Click Franklin "View" link for a variant, verify the page loads correctly.

**Expected:** Franklin variant page loads with correct variant data.

**Why human:** Franklin URL format has LOW confidence from research (noted in plan). Manual testing confirms format works or identifies needed fix.

### Gaps Summary

No gaps found. All must-haves verified.

**Phase 15 goal achieved:** User can open variant-specific pages on gnomAD, ClinVar, and OMIM directly from the variant table, with fully configurable link templates via a settings UI.

---

_Verified: 2026-01-27T23:03:00Z_
_Verifier: Claude (gsd-verifier)_
