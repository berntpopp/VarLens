# Phase 4: Import UX — Smart Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the import dialog to support multi-file per case, auto-detection of variant type/caller/build, BED region filtering with padding, quality pre-filters, and per-file progress tracking.

**Architecture:** Extend existing BatchImportDialog with a new VCF-specific import flow. Multi-file selection triggers header scanning → auto-detection summary → import with filters. Uses existing VcfStrategy.import() with the new ImportFilters parameter.

**Tech Stack:** Vue 3 + Vuetify 3, TypeScript, existing IPC import infrastructure.

**Depends on:** Phase 1-2 backend (done) + Phase 3 frontend (type tabs).

**Design Spec:** `.planning/specs/2026-04-09-multi-variant-type-import-design.md` — Section 7.3

---

## File Inventory

### New Files

| File | Responsibility |
|---|---|
| `src/renderer/src/components/import/VcfImportDialog.vue` | Multi-file VCF import wizard dialog |
| `src/renderer/src/components/import/VcfFileList.vue` | File list with auto-detected type/caller/build |
| `src/renderer/src/components/import/ImportFilterOptions.vue` | BED filter + quality filter UI |
| `src/renderer/src/components/import/ImportProgressView.vue` | Per-file progress display |
| `src/renderer/src/components/import/ImportSummaryView.vue` | Post-import results summary |
| `src/main/ipc/handlers/import-preview.ts` | IPC handler for multi-file VCF header scanning |

### Modified Files

| File | Change |
|---|---|
| `src/main/import/vcf/vcf-preview.ts` | Add caller detection + variant type to preview result |
| `src/main/import/ImportService.ts` | Multi-file import session with case_import_files provenance |
| `src/main/ipc/handlers/import.ts` | New IPC channels for multi-file preview + filtered import |
| `src/preload/index.ts` | Expose new import IPC channels |
| App-level dialog host | Register VcfImportDialog alongside BatchImportDialog |

---

## Task 1: Enhanced VCF Preview with Caller/Type Detection

**Files:**
- Modify: `src/main/import/vcf/vcf-preview.ts`
- Modify: `src/main/ipc/handlers/import.ts`

- [ ] **Step 1: Read vcf-preview.ts and understand current preview**

Read `src/main/import/vcf/vcf-preview.ts`. Understand what it returns currently (variant count estimate, sample names, annotation type, genome build).

- [ ] **Step 2: Extend preview result with caller and variant type info**

Add to the preview result:
```typescript
interface VcfPreviewResult {
  // ... existing fields
  callerName: string | null
  callerVersion: string | null
  defaultVariantType: string
  defaultFilters: Partial<ImportFilters>
  estimatedVariantCount: number
}
```

Import and call `detectCaller()` during preview to populate these fields.

- [ ] **Step 3: Add multi-file preview IPC channel**

Add IPC handler `import:previewVcfFiles` that accepts an array of file paths and returns an array of preview results. Each file is scanned independently (header only, no full parse).

```typescript
// Request
{ filePaths: string[] }

// Response
{ previews: VcfPreviewResult[] }
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: extend VCF preview with caller detection and variant type info"
```

---

## Task 2: Multi-File Import Session in ImportService

**Files:**
- Modify: `src/main/import/ImportService.ts`
- Modify: `src/main/database/CaseRepository.ts`
- Modify: `src/main/ipc/handlers/import.ts`

- [ ] **Step 1: Add case_import_files insert method to CaseRepository**

```typescript
insertImportFile(
  caseId: number,
  filePath: string,
  fileSize: number,
  variantType: string,
  caller: string | null,
  variantCount: number,
  annotationFormat: string | null
): number
```

- [ ] **Step 2: Add multi-file import IPC channel**

Add `import:importVcfSession` handler that accepts:
```typescript
{
  caseId: number | null  // null = create new case
  caseName: string
  files: Array<{
    filePath: string
    variantType: string  // user-confirmed or auto-detected
  }>
  filters: ImportFilters
  genomeBuild: string
}
```

The handler:
1. Creates case if caseId is null (using first file's path/size)
2. Validates genome_build matches case (if existing case)
3. Imports each file sequentially via VcfStrategy with filters
4. Inserts case_import_files row for each file
5. Updates case variant_count total
6. Triggers ONE cohort summary update at the end (not per-file)
7. Emits progress events per file: `import:fileProgress`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add multi-file VCF import session with case_import_files provenance"
```

---

## Task 3: VCF Import Dialog Component

**Files:**
- Create: `src/renderer/src/components/import/VcfImportDialog.vue`
- Create: `src/renderer/src/components/import/VcfFileList.vue`
- Create: `src/renderer/src/components/import/ImportFilterOptions.vue`

- [ ] **Step 1: Create VcfFileList component**

Shows files with auto-detected metadata. Each row:
```
✓ wf_sv.vcf.gz    SV    Sniffles2 v2.6.3    GRCh38    319 variants
```

Type and caller cells are editable (v-select dropdown for override). Build shown as chip.

Props: `files: VcfPreviewResult[]`
Emits: `update:files` (when user overrides type/caller)

- [ ] **Step 2: Create ImportFilterOptions component**

Collapsed by default ("Advanced options..."). Contains:
- Checkbox: "Only PASS variants" (default from caller defaults)
- Number inputs: Min QUAL, Min GQ, Min DP (with caller-aware defaults)
- BED file selector: file picker button + padding input (default 50bp)
- If sibling BED file detected: auto-suggest with "Use as region filter?" prompt

Props: `filters: ImportFilters`, `callerDefaults: Partial<ImportFilters>`
Emits: `update:filters`

- [ ] **Step 3: Create VcfImportDialog wizard**

Three-step dialog:

**Step 1 — File Selection:**
- Drag & drop zone or browse button
- Accepts .vcf, .vcf.gz
- On file selection → call `import:previewVcfFiles` → move to Step 2

**Step 2 — Review & Configure:**
- VcfFileList showing auto-detected info
- Case selector: existing case dropdown or new case name input
- Warning banner for large files (>100K variants) suggesting BED filter
- ImportFilterOptions (collapsed)
- "Import" button

**Step 3 — Progress:**
- ImportProgressView (per-file progress bars)
- On complete → show ImportSummaryView

Use v-stepper or simple conditional rendering (matching existing BatchImportDialog pattern).

- [ ] **Step 4: Register dialog in app**

Add VcfImportDialog to the app's dialog host. Add a menu item or button to trigger it (alongside existing "Import" button). Could be a dropdown: "Import JSON" vs "Import VCF".

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add VCF import dialog with multi-file selection and smart defaults"
```

---

## Task 4: Progress and Summary Views

**Files:**
- Create: `src/renderer/src/components/import/ImportProgressView.vue`
- Create: `src/renderer/src/components/import/ImportSummaryView.vue`

- [ ] **Step 1: Create ImportProgressView**

Shows per-file import status:
```
✓ wf_cnv.vcf.gz — 101 CNVs imported
⧖ wf_sv.vcf.gz — importing... 62%
○ wf_snp.vcf.gz — pending (BED filter active)
○ wf_str.vcf.gz — pending
```

Listens to `import:fileProgress` IPC events. Shows overall progress bar.

Props: `files: VcfPreviewResult[]`
State: `fileStatuses: Map<string, 'pending' | 'importing' | 'done' | 'error'>`

- [ ] **Step 2: Create ImportSummaryView**

Shows post-import results:
```
Case "LB25-4957" updated

✓ 12,500 SNVs/indels  (from 4.2M, BED filtered)
✓ 280 SVs             (39 filtered: not PASS)
✓ 101 CNVs            (0 filtered)
✓ 16 STRs             (0 filtered)

Annotations: SnpEff + ClinVar (SV, CNV)
Reference: GRCh38

[View Case]  [Import More]  [Close]
```

Props: `results: ImportSessionResult`
Emits: `view-case`, `import-more`, `close`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add import progress tracking and post-import summary views"
```

---

## Task 5: Playwright E2E Tests for Import Flow

**Files:**
- Create: `tests/e2e/vcf-multi-type-import.e2e.ts`

- [ ] **Step 1: Write Playwright test for SV/CNV/STR import**

Test the end-to-end flow:
1. Launch app
2. Import synthetic SV VCF via IPC (bypassing file dialog)
3. Verify case created with SV variants
4. Import synthetic CNV VCF to same case
5. Verify variant type counts show both SV and CNV
6. Import synthetic STR VCF to same case
7. Verify all 3 types present
8. Verify variant type tabs appear in case view
9. Switch to SV tab → verify SV-specific columns visible
10. Switch to STR tab → verify STR-specific columns (disease, repeat unit)
11. Take screenshots of each tab for visual verification
12. Delete test case

```typescript
import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const VCF_DIR = resolve(__dirname, '../test-data/vcf')

// ... test implementation using IPC calls for import
// and DOM assertions for tab visibility and column content
```

- [ ] **Step 2: Run Playwright test**

Run: `xvfb-run --auto-servernum npx playwright test tests/e2e/vcf-multi-type-import.e2e.ts`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git commit -m "test: add Playwright E2E test for multi-variant type import and display"
```

---

## Task 6: BED Auto-Suggestion from Sibling Files

**Files:**
- Modify: `src/main/ipc/handlers/import.ts`
- Modify: `src/renderer/src/components/import/VcfImportDialog.vue`

- [ ] **Step 1: Add sibling BED file detection to backend**

When `import:previewVcfFiles` scans files, also scan the parent directory for `.bed` and `.bed.gz` files. Return them as `suggestedBedFiles: string[]` in the response.

```typescript
import { readdirSync } from 'fs'
import { dirname, extname } from 'path'

function findSiblingBedFiles(vcfPaths: string[]): string[] {
  const dirs = new Set(vcfPaths.map(dirname))
  const bedFiles: string[] = []
  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.bed') || file.endsWith('.bed.gz')) {
        bedFiles.push(resolve(dir, file))
      }
    }
  }
  return bedFiles
}
```

- [ ] **Step 2: Show auto-suggestion in import dialog**

When sibling BED files are found, show an inline suggestion:
```
ℹ Found regions.bed.gz in same folder. Use as region filter?
[Yes, filter to these regions]  [No thanks]
```

Clicking "Yes" populates the BED filter path and expands the filter options section.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: auto-suggest sibling BED files as import region filter"
```

---

## Verification

After all tasks:
1. `make lint` — clean
2. `make typecheck` — clean
3. `make test` — all unit tests pass
4. Playwright e2e test passes
5. Manual verification: `make dev` → import ONT test data → verify all tabs, filters, progress, summary
6. Take screenshots of key UX flows for review
