---
phase: 15-external-links
plan: 03
subsystem: ui
tags: [pinia, vuetify, localStorage, URL-templates, IPC, domain-allowlist]

# Dependency graph
requires:
  - phase: 15-01
    provides: URL builder functions for external databases
  - phase: 15-02
    provides: External links UI in VariantTable
provides:
  - Configurable external link system with user-editable URL templates
  - Settings UI for managing links (enable/disable, edit, add custom, remove)
  - Dynamic domain allowlist synced from renderer to main process
  - Genome build selector affecting build-dependent URLs
affects: [16-batch-import, 17-omim, variant-table, external-databases]

# Tech tracking
tech-stack:
  added: [crypto.randomUUID for link IDs]
  patterns:
    - URL template resolution with variable substitution
    - Dynamic v-data-table headers from store
    - IPC domain allowlist sync pattern
    - LocalStorage persistence with defaults merging

key-files:
  created:
    - src/renderer/src/stores/externalLinksStore.ts
    - src/renderer/src/components/ExternalLinksSettings.vue
  modified:
    - src/renderer/src/utils/externalLinks.ts
    - src/renderer/src/components/VariantTable.vue
    - src/renderer/src/App.vue
    - src/main/ipc/handlers/shell.ts
    - src/preload/index.ts
    - src/shared/types/api.ts
    - tests/renderer/externalLinks.test.ts

key-decisions:
  - "Use template string with variable placeholders instead of hardcoded URL builders"
  - "Store genome build in externalLinksStore instead of VariantTable component state"
  - "Virtual link columns use dynamic slot generation with v-for"
  - "Domain extraction from templates using dummy variable substitution for URL parsing"
  - "Merge stored links with defaults on load to handle app updates with new built-in links"

patterns-established:
  - "URL template pattern: {chr}, {pos}, {ref}, {alt}, {gene}, {build}, {build_ucsc}, {dataset_gnomad}, {pos_start}, {pos_end}"
  - "Link column types: pos, chr, clinvar, gene_symbol, virtual (own column)"
  - "Dynamic v-data-table headers from computed store values"
  - "Renderer-to-main domain sync via IPC for security allowlist"

# Metrics
duration: 10min
completed: 2026-01-27
---

# Phase 15 Plan 03: Configurable External Links Summary

**User-configurable external database links with URL template editing, genome build selector, custom link CRUD, and dynamic domain allowlist sync**

## Performance

- **Duration:** 10 min (597 seconds)
- **Started:** 2026-01-27T22:47:52Z
- **Completed:** 2026-01-27T22:57:49Z
- **Tasks:** 6
- **Files modified:** 8 (2 created, 6 modified)
- **Commits:** 6 (5 task commits + 1 test commit)

## Accomplishments

- External link configurations stored in Pinia store with localStorage persistence
- Settings dialog accessible from gear icon in app bar with full CRUD for links
- URL template system with 10 variable placeholders for flexible link construction
- VariantTable renders all links dynamically from store (no hardcoded URLs)
- Domain allowlist synced automatically from renderer to main process
- All 6 default links (gnomAD, UCSC, ClinVar, OMIM, VarSome, Franklin) preserved as built-in defaults

## Task Commits

Each task was committed atomically:

1. **Task 1: Create external links Pinia store with URL template resolver** - `8a6b833` (feat)
   - Created externalLinksStore.ts with setup store pattern
   - Implemented resolveUrlTemplate function for variable substitution
   - 6 default link configurations with localStorage persistence

2. **Task 2: Add URL template resolver tests** - `c9622a9` (test)
   - 16 new tests for resolveUrlTemplate (62 total tests pass)
   - Verify template resolution matches hardcoded builder outputs
   - Test null safety, encoding, derived variables

3. **Task 3: Create ExternalLinksSettings dialog component** - `949875d` (feat)
   - Settings dialog with genome build selector
   - Link list with enable/disable toggles, edit/delete actions
   - Add/edit form with URL template editor and variable reference
   - Confirmation dialogs for delete and reset to defaults

4. **Task 4: Add gear icon to App.vue and wire up settings dialog** - `b8a522c` (feat)
   - Gear icon in app bar after DatabasePicker
   - Settings tooltip and dialog integration

5. **Task 5: Refactor VariantTable to use store for dynamic link rendering** - `4cfb400` (refactor)
   - Dynamic headers computed with virtual link columns from store
   - All data column links (chr, pos, clinvar, gene_symbol) use store
   - Dynamic virtual link slots with v-for
   - Removed hardcoded genomeBuild ref

6. **Task 6: Add dynamic domain allowlist sync via IPC** - `7c9b325` (feat)
   - shell:updateUserDomains IPC handler
   - Domain extraction from enabled link templates
   - Sync on store init and config changes
   - Updated ShellAPI type definition

## Files Created/Modified

**Created:**
- `src/renderer/src/stores/externalLinksStore.ts` - Pinia store for external link configurations with localStorage persistence, CRUD actions, computed getters, domain sync
- `src/renderer/src/components/ExternalLinksSettings.vue` - Settings dialog for configuring links with genome build selector, link list, add/edit form, variable reference panel

**Modified:**
- `src/renderer/src/utils/externalLinks.ts` - Added VariantLinkData interface and resolveUrlTemplate function for template variable substitution
- `src/renderer/src/components/VariantTable.vue` - Refactored to use store for all links, dynamic headers, removed hardcoded URL builders
- `src/renderer/src/App.vue` - Added gear icon and ExternalLinksSettings dialog integration
- `src/main/ipc/handlers/shell.ts` - Added userDomains array and shell:updateUserDomains IPC handler, updated isDomainAllowed
- `src/preload/index.ts` - Exposed updateDomains method in shell API
- `src/shared/types/api.ts` - Added updateDomains to ShellAPI interface
- `tests/renderer/externalLinks.test.ts` - Added 16 resolveUrlTemplate tests (62 total)

## Decisions Made

1. **Template variable design**: Use `{variable}` syntax with regex-based global replacement for ES2020 compatibility (avoid String.replaceAll)

2. **Defaults merging strategy**: On localStorage load, merge stored links with built-in defaults to handle app updates where new default links are added. Remove built-in links that no longer exist in current defaults.

3. **Domain extraction approach**: Extract domains from URL templates by substituting dummy values for variables, then parse with URL constructor. Catches invalid templates gracefully.

4. **Virtual link slot generation**: Use dynamic slot names with v-for to generate `item._link_{id}` slots for each virtual link. Headers computed property includes dynamic columns.

5. **Genome build location**: Store genome build in externalLinksStore instead of VariantTable component state, as it affects multiple links and should be user-configurable.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

1. **String.replaceAll compatibility**: Initial implementation used `String.replaceAll()` which requires ES2021 target. Fixed by using regex with global flag for ES2020 compatibility.

2. **Type definition location**: ShellAPI type needed update in `src/shared/types/api.ts` for updateDomains method. Added after Task 6 implementation.

All issues resolved during execution without blocking plan completion.

## Next Phase Readiness

**Ready for Phase 16 (Batch Import & ZIP Extraction):**
- External link system fully configurable by users
- Domain allowlist dynamically synced for security
- Genome build selector available for build-dependent links
- URL template pattern established for future link additions

**Potential future enhancements** (out of scope for v0.3.0):
- Import/export link configurations
- Link preview/test functionality
- Per-case genome build override
- Link usage analytics

---
*Phase: 15-external-links*
*Completed: 2026-01-27*
