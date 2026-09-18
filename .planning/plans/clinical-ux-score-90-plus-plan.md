# Execution Plan: Implementing Clinical UX Improvements Beyond 90/100

**Document Status:** READY FOR ADVERSARIAL REVIEW  
**Author:** Antigravity (Pair Programming Agent)  
**Spec Reference:** `.planning/specs/clinical-ux-score-90-plus-spec.md`  
**Execution Target:** `feat/clinical-ux-impeccable-audit-optimization`

---

## Phase Breakdown & Concrete Work Packages

### Phase 1: Case View & Tabular Ergonomics (Case View: 81 $\rightarrow$ 94)
1. **WP 1.1: Sticky Identifier Columns in `data-table-shared.css`**:
   - Implement `.sticky-column-1` (`left: 0`) and `.sticky-column-2` (`left: 80px`) with high contrast background and subtle drop shadow separator.
   - Bind classes to `annotations` and `variant identifier` in `VariantTable.vue` and `ShortlistTable.vue`.
2. **WP 1.2: Persistent Patient Phenotype Summary Banner in `CaseView.vue`**:
   - Query or access current case metadata from `caseMetadataStore`.
   - Render a high-density 34px context bar below tabs: `Proband: Male, 4y` + top 3 HPO chips with overflow tooltip + `Edit` button opening `CaseMetadataModal.vue`.
3. **WP 1.3: Two-Stage Escape Handling in `VariantTable.vue`**:
   - Check if detail drawer is open. If open, close drawer without clearing row selection. If closed, clear row selection.

### Phase 2: Shortlist & DSL Workflow Acceleration (WE: 78 $\rightarrow$ 95)
1. **WP 2.1: Shortlist Table Keyboard Navigation in `ShortlistTable.vue`**:
   - Add `@keydown.down`, `@keydown.up`, `@keydown.enter`, `@keydown.s` to candidate list container.
   - Support rapid keyboard triage matching `VariantTable`.
2. **WP 2.2: DSL Search Autocomplete Keyboard Traversal in `DslSearchBar.vue`**:
   - Implement `highlightedSuggestionIndex` with `ArrowDown` and `ArrowUp` cycle.
   - Select suggestion on `Enter` or `Tab`. Close menu on `Escape`.

### Phase 3: Clinical ACMG Scaffolding & Local IGV Bridge (Variant Details: 82 $\rightarrow$ 93)
1. **WP 3.1: ClinGen SVI 2020 PM2 Default & Criteria Rationales**:
   - In `AcmgEvidenceGrid.vue` and `acmg-calculator.ts`, default PM2 weight to Supporting (1 pt), with an explicit toggle to upgrade to Moderate (2 pts).
   - Add a ClinGen SVI badge and expandable rationale field for selected criteria.
2. **WP 3.2: 1-Click Local IGV REST Broadcast in `ExternalLinksSection.vue`**:
   - Implement `jumpToIgv(chr, pos)` pinging `http://localhost:60151/goto?locus=...`.
   - Display informative toast if IGV port is closed.

### Phase 4: Verification, Adversarial Review & Chaos Testing
1. **WP 4.1: Adversarial Review via Claude CLI (Opus)**:
   - Submit the specification and plan to Claude Code Opus for aggressive critique and boundary stress-testing.
   - Incorporate all findings.
2. **WP 4.2: Automated Playwright Monkey Test**:
   - Author and run `tests/e2e/monkey-test-clinical-ux.e2e.ts` simulating rapid user interactions across tabs, drawers, and keyboards.
3. **WP 4.3: Full CI Test & Quality Suite**:
   - Pass `typecheck`, `lint:check`, `format:check`, and all 415+ `vitest` suites.
4. **WP 4.4: PR Preparation**:
   - Final review and prepare clean PR draft.
