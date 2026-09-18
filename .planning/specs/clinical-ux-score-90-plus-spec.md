# Specification: Elevating VarLens Clinical UX & Heuristics Beyond 90/100

**Document Status:** DRAFT FOR ADVERSARIAL REVIEW  
**Author:** Antigravity (Pair Programming Agent)  
**Target:** VarLens UI/UX Layer (`src/renderer/`)  
**Objective:** Propel all 5 Clinical Surface scores from 81–87 to **> 90/100** and Nielsen's 10 Usability Heuristics from 28/40 (70%) to **$\ge 36/40$ (90%+)**, conforming to ClinGen SVI 2020, ACMG/AMP 2015, and ISO 15189 / CAP diagnostic safety standards.

---

## 1. Problem Statement & Score Delta Baseline

In the preliminary clinical evaluation, VarLens achieved:
- **Case Analysis View:** 81 / 100
- **Variant Detail & ACMG Drawer:** 82 / 100
- **Filter Drawer & Advanced Query:** 86 / 100
- **Cohort Analysis View:** 87 / 100
- **Global App Shell & Databases:** 82 / 100
- **Nielsen's 10 Heuristics:** 28 / 40 (70%)
- **Lighthouse:** Best Practices 100, Accessibility 96, SEO 91, Dev Perf 42 / Prod Perf 95+

While technical polish and AST detector anti-patterns reached 0 warnings, critical clinical friction points hold the UX scores below 90:
1. **Locus Disorientation on Horizontal Scroll**: When clinicians scroll right in `VariantTable` to review population frequencies (gnomAD AF) or pathogenicity scores (CADD, REVEL, SpliceAI), chromosome, position, and gene scroll offscreen.
2. **Shortlist Keyboard Disconnect**: The default ranked `ShortlistTable` lacks keyboard listeners, forcing power users to switch between mouse and keyboard.
3. **Phenotype Recall Fatigue (Miller/Cowan Limit)**: Patient HPO terms and indications are buried in `CaseMetadataModal.vue`, forcing clinicians to rely on mental recall during variant triage.
4. **ClinGen SVI 2020 Non-Conformance (PM2 Weight)**: PM2 is grouped under Moderate (2 pts), violating modern ClinGen SVI recommendations that downgrade PM2 to Supporting (1 pt) for ultra-rare variants to prevent false-positive pathogenic calls.
5. **Missing Local IGV Broadcast Bridge**: Clinicians must manually copy/paste coordinates into IGV to verify raw BAM/CRAM read alignments.
6. **Destructive Escape Key in Variant Table**: Pressing `Escape` while inspecting a variant in the detail drawer clears both drawer and selected row state.
7. **DSL Autocomplete Keyboard Trap**: `DslSearchBar.vue` suggestions cannot be selected via arrow keys.

---

## 2. Technical Design Specifications

### Specification 1: Sticky Identifier Columns in Variant Tables
* **Target Files**: `src/renderer/src/components/data-table-shared.css`, `src/renderer/src/components/VariantTable.vue`
* **Mechanism**:
  - Make column 1 (`annotations`) sticky at `left: 0`, `z-index: 3`, with `background: rgb(var(--v-theme-surface))`.
  - Make column 2 (`variant-identifier` / `gene`) sticky at `left: [width-of-col-1]px`, `z-index: 3`, with `background: rgb(var(--v-theme-surface))` and a subtle trailing divider shadow (`box-shadow: 2px 0 4px rgba(0,0,0,0.06)`).
  - Ensure table scroller has `overflow-x: auto` and `contain: paint` to prevent horizontal leak.
  - Synchronize sticky positioning in header `<th class="sticky-col">` and body `<td class="sticky-col">`.

### Specification 2: Persistent Proband Phenotype Context Strip
* **Target Files**: `src/renderer/src/views/CaseView.vue`, `src/renderer/src/components/CaseMetadataCard.vue`
* **Mechanism**:
  - Mount a compact 34px high-density contextual strip immediately below the variant type tabs or above the table toolbar in `CaseView.vue`.
  - If a case is loaded, display:
    - Case ID / Name badge
    - Proband Sex & Age (e.g. `Male, 4y`)
    - Up to 3 HPO chips (e.g., `HP:0001250 Seizures`, `HP:0001263 Global dev delay`)
    - Overflow badge `+N more` with full tooltip listing all HPO terms
    - Fast 1-click edit button launching `CaseMetadataModal.vue`
  - Zero layout shift: Fixed container height (`min-height: 34px`) rendered with subtle bottom divider.

### Specification 3: Shortlist Table Keyboard Navigation & Triage
* **Target Files**: `src/renderer/src/components/shortlist/ShortlistTable.vue`, `src/renderer/src/views/CaseView.vue`
* **Mechanism**:
  - Wire `useTableKeyboardNav` or direct keydown listeners into `ShortlistTable.vue`.
  - Listen for:
    - `ArrowDown` / `ArrowUp`: Traverse candidate rows and update `selectedCandidate`.
    - `s` / `KeyS`: Toggle star status on the highlighted candidate.
    - `Enter`: Open / focus the detail drawer for the active variant.
    - `Escape`: Deselect candidate / close drawer.
  - Apply active selection outline with standard accessibility contrast.

### Specification 4: ClinGen SVI 2020 PM2 Default & Criterion Rationale Scaffolding
* **Target Files**: `src/renderer/src/components/acmg/AcmgEvidenceGrid.vue`, `src/renderer/src/utils/acmg/acmg-calculator.ts`
* **Mechanism**:
  - Update default Bayesian points for `PM2`:
    - ClinGen 2020 Default: **Supporting (1 pt)**.
    - Add explicit strength toggle badge allowing the user to upgrade PM2 to **Moderate (2 pts)** when allele frequency is absent in an exceptionally well-powered ethnically matched cohort.
  - Display a clean `ClinGen SVI 2020` recommendation chip in the ACMG panel.
  - For each active criterion chip, allow clicking to expand a dedicated 1-line `rationale` input that persists into the classification evidence JSON.
  - Prevent accidental 1-click `Pathogenic` assignment without at least one criterion selected (display an inline confirmation guidance prompt).

### Specification 5: 1-Click Local IGV REST Broadcast Bridge
* **Target Files**: `src/renderer/src/components/ExternalLinksSection.vue`, `src/renderer/src/components/variant-details/VariantIdentitySection.vue`
* **Mechanism**:
  - Add an "IGV" action button alongside external links.
  - When clicked, execute a non-blocking GET request to `http://localhost:60151/goto?locus=${encodeURIComponent(chr + ':' + Math.max(1, pos - 50) + '-' + (pos + 50))}`.
  - If IGV is running, it immediately navigates the BAM/CRAM alignment track to the variant locus.
  - If unreachable, show a non-blocking toast: "IGV port 60151 unreachable. Launch IGV and enable 'Enable port' in IGV Preferences."

### Specification 6: Safe Two-Stage Escape Key Handling
* **Target Files**: `src/renderer/src/components/VariantTable.vue`, `src/renderer/src/views/CaseView.vue`
* **Mechanism**:
  - When the user presses `Escape`:
    - Stage 1: If the variant detail drawer is open (`panelOpen === true`), close the drawer only. Retain table row highlight and focus so arrow-key traversal can resume uninterrupted.
    - Stage 2: If the drawer is already closed and `Escape` is pressed again, clear row selection.

### Specification 7: DSL Search Bar Keyboard Traversal
* **Target Files**: `src/renderer/src/components/DslSearchBar.vue`
* **Mechanism**:
  - In `DslSearchBar.vue`, track `highlightedIndex` in the suggestion list.
  - Intercept `keydown`:
    - `ArrowDown`: `highlightedIndex = (highlightedIndex + 1) % suggestions.length`.
    - `ArrowUp`: `highlightedIndex = (highlightedIndex - 1 + suggestions.length) % suggestions.length`.
    - `Enter` / `Tab`: Apply the highlighted suggestion into the search query.
    - `Escape`: Close suggestion menu without clearing search text.

---

## 3. Nielsen Heuristics Projected Impact

| Heuristic | Baseline | Projected | Key Levers |
|---|:---:|:---:|---|
| **H1: Visibility of System Status** | 3 / 4 | **4 / 4** | Instant IGV feedback toast, persistent phenotype status, search index highlights. |
| **H2: Match System / Real World** | 3 / 4 | **4 / 4** | ClinGen SVI 2020 PM2 standard terminology; clear HPO symptom descriptions. |
| **H3: User Control and Freedom** | 2 / 4 | **4 / 4** | Two-stage Escape key; undo-friendly transcript switches; non-destructive drawer closing. |
| **H4: Consistency and Standards** | 3 / 4 | **4 / 4** | Unified keyboard triage across `VariantTable` and `ShortlistTable`. |
| **H5: Error Prevention** | 3 / 4 | **4 / 4** | cDNA/AA tooltips preventing truncation misreads; evidence check before Pathogenic classifications. |
| **H6: Recognition Rather Than Recall** | 2 / 4 | **4 / 4** | Persistent patient HPO and indication context pinned at the top of the case workspace. |
| **H7: Flexibility & Efficiency** | 3 / 4 | **4 / 4** | Shortlist keyboard navigation; DSL arrow-key traversal; 1-click IGV alignment broadcast. |
| **H8: Aesthetic & Minimalist Design** | 4 / 4 | **4 / 4** | Zero AI side-tab borders, clean Material 3 tonal cards, stable scrollbar gutters. |
| **H9: Help Users Recognize & Recover** | 3 / 4 | **4 / 4** | Clear empty states with 1-click recovery; structured error boundaries. |
| **H10: Help and Documentation** | 2 / 4 | **4 / 4** | ClinGen SVI criterion decision badges & helper tooltips for auto-suggested rules. |
| **Total** | **28 / 40 (70%)** | **39 / 40 (97.5%)** | **Excellence Tier** |

---

## 4. Verification & Testing Protocol

1. **Unit & Integration Tests**: Run `npm run test` (all 415+ suites).
2. **Typecheck & Lint**: `npm run typecheck`, `npm run lint:check`, `npm run format:check`.
3. **Playwright Monkey Testing**: Execute automated chaos/monkey script on live Electron/web UI to assert zero crashes, zero unhandled rejections, and layout stability under rapid interaction.
4. **Detector Cleanliness**: Assert `impeccable detect` remains at **0 warnings**.
