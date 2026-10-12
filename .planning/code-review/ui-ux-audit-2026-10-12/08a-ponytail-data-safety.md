# 08a — Ponytail fix review: data safety, filters, navigation, formatting

Scope: F-01, I-01, D-01, D-02, N-01, P-02, P-03, X-05, X-11 from `00-COMBINED-REPORT.md`, checked against code at `bfd3d80e`. All paths are relative to the worktree root. Nothing was changed except this file.

Two findings came up during verification that are not in the report:
- **DSL `!~` ("does not contain") actually runs as "contains".** It is merged into D-02 because the fix is the same.
- **The shortlist corrupts VEP HGVS** (`c.ENST…:c.…`). It is merged into X-05.

---

## Must fix

### 1. I-01: a columnar JSON row shorter than its header shifts every later column, and the ui-gates/perf fixture is malformed

- **What this is:** columnar JSON maps each value to a column by its position. If a row is missing one value, every later value lands in the wrong column.
- **Problem:** no code checks that a row has as many values as the header. Both `tests/fixtures/import/columnar-format.json` and its `.json.gz` twin have 19 header ids and 18 values in all 50 rows (`selectedTranscript` is missing). As a result CADD shows up as quality, AF shows up as CADD, and "pathogenic" is lost. The UI gates, perf E2E and import E2E all measure this corrupted data.
- **Fix:**
  - `parseHeader` also returns `columnCount: headerItems.length` (`src/main/workers/import-mapper-pipeline.ts:155`). Pass it through `createFieldMapper` into `FieldMapper`.
  - At `src/main/import/transforms/FieldMapper.ts:52`, after `const row = chunk.value`, add:
    ```ts
    if (this.columnCount !== undefined && row.length !== this.columnCount)
      throw new Error(`Row ${chunk.key + 1} has ${row.length} values but the header declares ${this.columnCount} columns`)
    ```
    The existing `catch` turns this into `callback(err)`, so the import fails loudly. Fail the whole file rather than skipping the row: if one row is ragged, the mapping for the whole file is suspect.
  - Repair the fixture: insert `0` after the `Transcript` value at index 8 in every row, in both `.json` and `.json.gz`. Then update the two `sha256`/`sizeBytes` pairs in `scripts/data-fixtures/sources.json:283,296`.
- **If we skip it:** any producer that emits ragged rows silently stores wrong AF, CADD and ClinVar values. Our own quality gates go on certifying garbage.
- **Who else uses the fixture (checked):**
  - Detection-only tests are unaffected: `tests/main/import/format-detection.test.ts`, `gzip-detection.test.ts`.
  - Tests that import the fixture assert only counts and success, so they stay green once the fixture is fixed:
    - `tests/e2e/import-full-flow.e2e.ts`
    - `tests/e2e/import-delete.e2e.ts`
    - `tests/e2e/renderer-perf-phase1.e2e.ts`
    - `tests/e2e/helpers/perf-fixture.ts`
    - `tests/ui-gates/support/gate-server.ts`
  - **They fail if the strict check ships without the fixture repair**, so both go in one PR.
  - No snapshot files reference the fixture.
  - `scripts/perf/build-100-case-fixture.mjs` copies whole rows, so the fix carries through. But its `manifestMatches()` does not hash the base fixture, so a stale cached 100-case set survives. Delete its output directory once after the fix.
  - Perf baselines under `.planning/artifacts/perf/phase1/` (gitignored) will move a little because the data is no longer shifted. Re-baseline before comparing.
  - The simulator writer (163 values in a 163-field header) and the import DoS test (empty header) still pass.
- **Skip from the report:** the "AF ∈ [0,1] range check". The length check removes the root cause; a range check only catches some of its symptoms.
- Root cause: VERIFIED — `src/main/workers/import-mapper-pipeline.ts:155`, `src/main/import/transforms/FieldMapper.ts:52-121`
- Size: about +8 lines of code, plus the fixture regeneration and 4 manifest values
- Test: `tests/main/import/FieldMapper.test.ts`: `createFieldMapper(dicts, indices, undefined, undefined, 19)` with an 18-value row must error with the "Row 1 has 18 values" message.
- Verdict: **DO**

### 2. F-01: the hidden Shortlist table still reacts to ↓, Enter and `s`

- **What this is:** the Shortlist tab stays mounted with `v-show` after its first visit, and its table listens for keys on the whole window.
- **Problem:** `ShortlistTable.vue:207-256` handles ArrowDown/ArrowUp/Enter/`s`/Escape without checking whether the table is visible. So `s` stars a variant the user cannot see, and Enter opens the wrong one. `VariantTable` already guards with `props.interactive` (`VariantTable.vue:567,580,593`); the shortlist was never given that guard.
- **Fix:** reuse the existing VariantTable pattern.
  - `CaseView.vue:474`: add `:interactive="selectedVariantType === 'shortlist'"` to `<ShortlistPanel>`.
  - `ShortlistPanel.vue:43` and `:190`: add `interactive?: boolean` and forward it to `<ShortlistTable :interactive="interactive">`.
  - `ShortlistTable.vue:39`: add `interactive?: boolean`. Start each of the 5 handlers with `if (props.interactive === false) return` (one-line edit each).
  - CaseView is the only parent of ShortlistPanel, and ShortlistPanel the only parent of ShortlistTable. There is no cohort counterpart (cohort has no shortlist).
- **If we skip it:** keyboard triage writes stars to the wrong variant with no visible sign. This is the only P0.
- Root cause: VERIFIED — `src/renderer/src/components/shortlist/ShortlistTable.vue:207-256`, `src/renderer/src/views/CaseView.vue:474-476`
- Size: about +8 lines
- Test: `tests/renderer/components/shortlist/ShortlistTable.test.ts`: mount with `interactive: false`, dispatch ArrowDown then `s` on `window`, and expect no `toggle-star` or `row-click` emit.
- Verdict: **DO**

### 3. P-03: Esc while editing a comment saves the text and closes the panel

- **What this is:** two Esc handlers race, and the blur that follows then saves.
- **Problem:** there are three steps:
  1. `InlineEditableText.vue:26` cancels.
  2. The window listener `VariantDetailsPanel.vue:546-550` closes the panel without looking at the focused element.
  3. The textarea unmounts, blurs, and `@blur="saveEdit"` (`:25`) saves the text the user meant to discard.

  The edit trigger is also a plain `div @click` (`:7`), so comments cannot be edited by keyboard.
- **Fix:**
  - `VariantDetailsPanel.vue:547`:
    ```ts
    if (e.key !== 'Escape' || !props.open || isInputFocused() || (e.target as Element | null)?.closest?.('.v-overlay')) return
    ```
    `isInputFocused` comes from `composables/useTableKeyboardNav.ts:48`. This also fixes F-11: Esc in the tag menu or the protein dialog no longer closes the panel.
  - `InlineEditableText.vue:68`: make `if (!isEditing.value) return` the first line of `saveEdit`. Cancel sets `isEditing=false` before the unmount blur fires, so that blur becomes a no-op.
  - `InlineEditableText.vue:7`: add `role="button" tabindex="0" @keydown.enter.prevent="startEdit" @keydown.space.prevent="startEdit"`. This is accessibility, so it is not optional.
  - The only user of InlineEditableText is `CommentsSection.vue`. The panel serves both case and cohort mode, so parity comes for free.
- **If we skip it:** "cancel" writes clinical comments the user meant to discard.
- Root cause: VERIFIED — `src/renderer/src/components/VariantDetailsPanel.vue:546-550`, `src/renderer/src/components/InlineEditableText.vue:25,68-77`
- Size: about +5 / −1 lines
- Test: new `tests/renderer/components/InlineEditableText.test.ts`: start an edit, type, press Esc on the textarea, then trigger blur. The `save` spy must not be called.
- Verdict: **DO**

### 4. P-02: a quick ACMG chip overwrites an evidence-based classification without saying so

- **What this is:** the P/LP/VUS/LB/B chips write the class directly, even when stored evidence says otherwise.
- **Problem:** `handleQuickClassify` (`VariantDetailsPanel.vue:440-465`) never looks at `hasAcmgEvidence` (`:407`). So "P" is stored while the evidence summary says VUS (2 pts), with no override marker. The row quick menu (`AcmgQuickMenu.vue`, used by `VariantTable.vue:246` **and** `cohort/CohortDataTable.vue:185`) has the same bypass.
- **Fix:** the smallest correct change is to stop the two paths from disagreeing. Do not build a new override flow; one already exists (`AcmgSummaryBar` "Override", `useAcmgEvidence.setOverride`).
  - Panel `:116`: `:disabled="!canWrite || hasAcmgEvidence"`. Hide the ✕ at `:121` when `hasAcmgEvidence`. Add one caption: "Set from evidence — use Override in the Evidence editor."
  - Quick menu: add `hasEvidence: boolean` to `AcmgMenuRequest` (`acmg-quick-menu.ts:13`). The row callers fill it from the row annotation's `acmg_evidence` via `hasMeaningfulAcmgEvidence` (`utils/acmg/acmg-undo.ts:89`). When it is true, disable the chips; "Evidence editor…" stays as the way forward. This is required for case/cohort parity.
- **Over-engineered in report 03:** "route the chip into the Override flow with a required reason". The evidence model has no reason field, so that needs a schema change. It is a DO-LATER design item. Disabling the chips closes the data-integrity hole now.
- **If we skip it:** the stored class and the documented evidence contradict each other, which is an audit-trail problem for clinical sign-off.
- Root cause: VERIFIED — `src/renderer/src/components/VariantDetailsPanel.vue:108-130,440-465`; same bypass in `components/acmg/AcmgQuickMenu.vue:13-24`
- Size: about +10 lines (panel about 3, menu and row callers about 7)
- Test: `tests/renderer/components/VariantDetailsPanel.acmg-quick.test.ts`: with an annotation that has PM2+PP3 evidence, the quick chips are disabled and clicking P does not call `setAcmgClassification`.
- Verdict: **DO** (the reason/override UX is DO-LATER)

### 5. D-02: a bad DSL query is shown as "no variants match" (plus the `!~` inversion found during review)

- **What this is:** the DSL parser sends any field name and any operator to the server. When the server rejects the query, the case table shows an empty result.
- **Problems:**
  1. `parser.ts:149,172,214` fall back to the raw token when `findColumn` misses (`colDef?.key ?? colToken.value`). Unknown fields therefore reach the server. On PostgreSQL that is HTTP 500 (`postgres-variant-column-filters.ts:40` throws a plain Error); on SQLite the key is silently ignored.
  2. **Found during review:** the parser accepts every `VALID_OPERATORS` entry (`parser.ts:33`), but `translator.ts:39-44` maps `!~`, `^` and `$` to plain `like`, which both backends run as a `%v%` substring match. `gene:!~:BRCA` therefore returns *only* BRCA variants: an inverted filter presented as an exclusion. `column-registry.ts:34-35` already says these operators are "excluded until the backend supports them", but the parser never enforces it.
  3. `applyDslFilters` (`useDslFilterIntegration.ts:67-92`) applies the expression even when `dslErrors` is non-empty. That is why case and cohort behave differently (C-P2-4).
  4. `VariantTable.vue` has no error branch (`:225-242`), although `useOffsetPagination` already exposes `error` (`useOffsetPagination.ts:81,225`) and `CohortTable.vue:4-18` already renders it with Retry.
- **Fix:** one validation point plus one reused banner.
  - `parser.ts`, `parseFilterRule`: resolve `const colDef = findColumn(colToken.value)` once, right after `expect('column')`. If it is missing, push `Unknown field '<x>'` and return null. If the operator is not in `colDef.operators` (is:null/notnull excepted), push `'<op>' is not supported for <field>`. If a numeric column gets a value that is not finite, push an error. Then delete the three `?? colToken.value` fallbacks and the duplicate `findColumn` calls.
  - `useDslFilterIntegration.ts:68`: right after `parseNow()`, add `if (dslErrors.value.length > 0) return`. The last valid result stays and the red field stays. One rule for both views, because both use this composable.
  - Move the cohort's alert from `CohortTable.vue:4-18` into `components/common/TableErrorAlert.vue` (`error`, `@retry`, `@close`). Use it in both tables. VariantTable needs `error` and `reloadCurrentPage`/`invalidateAndReload` from `useVariantData` (one destructure line plus 2 template lines). That keeps VariantTable (704 lines, in the baseline) from growing more than about 3 lines.
- **Over-engineered in report 02 F7:** "treat any input with `:`, `(` or an operator as DSL". Not needed once unknown fields are parse errors. Inline error text instead of a hover tooltip (`DslSearchBar.vue:87-90`) is a separate small item (F7) and not part of this fix.
- **If we skip it:** a typo reads as "no variant passes", and "does not contain" shows exactly the variants the user asked to exclude.
- Root cause: VERIFIED — `src/renderer/src/dsl/parser.ts:149,172,214`, `src/renderer/src/dsl/translator.ts:39-44`, `src/renderer/src/composables/useDslFilterIntegration.ts:67-92`, `src/renderer/src/components/VariantTable.vue:225-242`
- Size: parser about +8 / −6; composable +1; banner extraction about +20 new / −14 in CohortTable / +3 in VariantTable
- Test: `tests/renderer/dsl/parser.test.ts`: `parseDsl('foo:=:1')` and `parseDsl('gene:!~:BRCA')` each return `errors.length === 1` and `ast` with no rule. Add one `useDslFilterIntegration` case where an errored input does not call `emitFilters`.
- Verdict: **DO** (server-side 400 instead of 500 for unknown PG columns is DO-LATER; the client no longer sends them)

---

## Should fix

### 6. D-01: an active DSL filter shows "No filters applied" (case and cohort)

- **What this is:** the applied-filter bar lists drawer chips and column-header chips, but not DSL clauses.
- **Problem:** the badge counts DSL rules (`FilterToolbar.vue:651-656`, `CohortFilterBar.vue:364-366`), but `mergedActiveFiltersList` (`FilterToolbar.vue:659-662`, `CohortFilterBar.vue:352-355`) leaves them out. `SlimFilterToolbar.vue:183` is only the messenger; the report's root-cause line points at the wrong file.
- **Fix:** reuse `buildColumnFilterChips` (`utils/filters/activeFilters.ts:189`), which already turns ColumnFilters into labelled chips. The case column chips use it too.
  - In `useDslFilterIntegration.ts`, return
    ```ts
    dslChips = computed(() => buildColumnFilterChips(dslColumnFilters.value).map(c => ({ ...c, id: 'dsl:' + c.id.slice(4) })))
    ```
  - In both bars, spread `...dslChips.value` into the merged list, and in `handleClearFilter` add `if (filterId.startsWith('dsl:')) return handleDslClear()`.
  - Cohort: change the count to `mergedActiveFilters.value.length` (delete the `+ Object.keys(dslColumnFilters)`, which would now double-count).
  - The ✕ on any DSL chip clears the whole expression. Removing one clause would mean rewriting the user's text: DO-LATER.
- **If we skip it:** the user sees "No filters applied" over 68 of 1,585 rows and draws the wrong conclusion.
- Root cause: WRONG location in report (it is not `SlimFilterToolbar.vue:180`). The real cause is `src/renderer/src/components/FilterToolbar.vue:659-662` and `src/renderer/src/components/cohort/CohortFilterBar.vue:352-355`.
- Size: about +6 / −1 lines (CohortFilterBar is 621 lines and in the baseline; net +1 there)
- Test: `tests/renderer/components/CohortFilterBar.test.ts` (plus the case equivalent): after applying `gene:CFTR AND impact:HIGH`, `activeFiltersList` passed to SlimFilterToolbar has 2 `dsl:` chips.
- Verdict: **DO**

### 7. N-01: after browser Back the sidebar highlights a different case

- **What this is:** the case list keeps its own `selected` state, which only clicks update.
- **Problem:** URL restore (`useViewUrlBindings.ts:28-55`), delete and import all change `appState.selectedCaseId` without telling `CaseList` (`CaseList.vue:205`).
- **Fix:** reuse the existing `restoredCaseId` guard in `App.vue:291,298-301` (built so a programmatic highlight does not re-open the case).
  - `CaseList.vue:602`, `selectCase`: return early with `false` when `selected.value[0] === caseId`, otherwise set it and return `true`.
  - `App.vue:354`:
    ```ts
    watch(selectedCaseId, (id) => { resetCaseFilters(); if (caseListRef.value?.selectCase(id) === true && id !== null) restoredCaseId = id })
    ```
- **Correctness note on report 02's fix ("take `selectedCaseId` as a prop and watch it"):** done naively, it re-emits `case-selected`, which re-runs `handleCaseSelected` and the draft-leave prompt. The guard above avoids that.
- **If we skip it:** two contradicting "which case am I in" signals during triage, which is a wrong-case risk.
- Root cause: VERIFIED — `src/renderer/src/components/CaseList.vue:205,367-378,602-604`; not synced from `src/renderer/src/composables/useViewUrlBindings.ts:46-51`
- Size: about +4 / −2 lines
- Test: `tests/renderer/App.test.ts`: set `selectedCaseId` programmatically (simulating URL apply) and assert that `CaseList.selectCase` is called and `case-selected` is swallowed (no second `selectCase` on appState).
- Verdict: **DO**

### 8. X-05: HGVS shows a doubled transcript prefix, an encoded `%3D`, and the broken string is what Copy copies

- **What this is:** VEP stores full HGVS (`ENST….7:c.…`, `ENSP….8:p.Val74%3D`); SnpEff and JSON store a bare `c.…`. The renderer has no single formatter, so each place guesses.
- **Problems:**
  - `VariantIdentitySection.vue:21-25` (display) and `:125-130` (copy) prepend the unversioned `transcript` again.
  - **`ShortlistTable.vue:123-131` `ensureHgvsPrefix` produces `c.ENST…:c.…`** (found during review; it is in report 02 F11b but missing from the combined row).
  - `HgvsCell` (`table-cells/simple-cells.ts:277`) and the cohort cells (`CohortDataTable.vue:113-118`, which also use their own `'--'`) show `%3D` raw.
  - **No shared formatter exists.**
- **Fix:** add one helper in `src/renderer/src/utils/formatters.ts`:
  ```ts
  /** VEP stores full HGVS and %-encodes '='; SnpEff/JSON store bare c./p. */
  export function formatHgvs(v: string | null | undefined, transcript?: string | null): string | null {
    if (v == null || v === '') return null
    const s = v.replace(/%3D/gi, '=')
    return transcript && !s.includes(':') ? `${transcript}:${s}` : s
  }
  ```
  Use it in:
  - `HgvsCell` (1 line). Then switch the cohort cdna and aa_change cells to `<HgvsCell>` for parity; that deletes the cohort's custom spans.
  - VariantIdentitySection: one `hgvsText` computed used by both the display and `copyHgvs`, which deletes the duplicated concatenation.
  - Shortlist: replace `ensureHgvsPrefix` with `formatHgvs`, adding `c.`/`p.` only when the value has neither `:` nor the prefix.
  - The TranscriptSection cells (`:302-308`).

  At import, decode `%3D` once in `vcf-annotation-parser.ts:210-211,238-239` with the same replace. That keeps search and export correct for new imports. The display helper covers old databases.
- **Over-engineered or wrong in reports 02 and 03:** "strip an existing `ENST…:` prefix" and "normalise at import by stripping". Do not strip: the VEP value is the only place the transcript *version* lives (`transcript` is unversioned), and `ENST….7:c.…` is already valid HGVS. Just stop prefixing. The genome-build label is DO-LATER (needs a case-level build field in the strip).
- **If we skip it:** "Copy HGVS" copies a string that VariantValidator and Mutalyzer reject, and the shortlist shows invalid notation.
- Root cause: VERIFIED — `src/renderer/src/components/VariantIdentitySection.vue:21-25,125-130`, `src/renderer/src/components/shortlist/ShortlistTable.vue:123-131`, `src/main/import/vcf/vcf-annotation-parser.ts:210-211,238-239`
- Size: about +8 / −15 lines
- Test: `tests/renderer/utils/formatters.test.ts`, three cases: VEP full value plus transcript gives the value unchanged; bare `c.1A>G` plus `NM_1.1` gives `NM_1.1:c.1A>G`; `ENSP1:p.Val74%3D` gives `ENSP1:p.Val74=`.
- Verdict: **DO**

---

## Nice to have

### 9. X-11: raw and inconsistent value formatting

Each item below is a one-to-three-line change in code that already exists.

- **"Cached from 8/23/58749" (DO, Must-level effort for Nice-level risk).**
  - **Problem:** `useVepEnrichment.ts:72` does `new Date(cachedAt * 1000)`, but every cache stores milliseconds (`ApiCache.ts:86-94` and `bounded-api-cache.ts:57` use `Date.now()`).
  - **Fix:** drop `* 1000`.
  - **Over-engineered in report 03 F-09:** "drop the ×1000 when the value is above 1e12". The unit is always ms, so remove it outright.
  - Test: add to `tests/renderer/composables/useVepEnrichment.test.ts`: `cachedAt: Date.UTC(2026,9,12)` gives `getFullYear() === 2026`.
- **Raw SO terms in cohort (DO, parity).**
  - **Problem:** `CohortDataTable.vue:126` prints `func` raw.
  - **Fix:** use `<ConsequenceCell :consequence="value" />`, and make `ConsequenceCell` (`simple-cells.ts:264`) call `formatConsequence()` instead of its own `replace(/_/g,' ')`. Then `VariantTable.vue:159-169` can use the same cell (about −9 lines in a baselined file). `formatConsequence` should also split VEP `&` multi-terms (`intron_variant&non_coding…`), a one-line change at `formatters.ts:77`.
- **Three empty glyphs (DO).**
  - **Problem:** the shared constant is `EMPTY_VALUE_PLACEHOLDER = '--'` (`utils/formatters.ts:6`). The stray glyphs are:
    - `'—'` in `ExtensionDetailsSection.vue:88,96,101,106,174,317-318` and `ShortlistTable.vue:305`
    - `'--'` hard-coded in `CohortDataTable.vue:114,118,127`
    - `- -` because `GeneSymbolCell` puts `'--'` inside the letter-spaced `.gene-symbol` span (`simple-cells.ts:169`)
  - **Fix:** use the constant everywhere, and for the gene cell `if (!hasText(props.value)) return placeholder()`.
  - Leave `InlineEditableText`'s read-only `'—'` and `UserManagement` alone; they are not data cells.
- **SV length "-5.00 kb" / "-5000" (DO).**
  - **Problem:** `formatLength` (`ExtensionDetailsSection.vue:87-93`) computes `abs` but formats the signed value. The table shows raw `sv_length`, and `end_pos` has no separators.
  - **Fix:** format `abs`. Move `formatLength` to `utils/formatters.ts` and add `value:` getters for `sv_length`/`end_pos` in `variant-table/sv-columns.ts:20,22` (no VariantTable template growth), plus `ShortlistTable.vue:101`. DEL/DUP is already shown by SV Type.
- **STR "Unknown Gene" and `full_mutation` (DO).**
  - **Problem:** the panel title is `variant.gene_symbol ?? 'Unknown Gene'` (`VariantIdentitySection.vue:4`), and `formatText` prints raw tokens.
  - **Fix:** the title becomes `gene_symbol ?? _str_repeat_id ?? 'Intergenic'`. The field already reaches the panel; see `ExtensionDetailsSection.vue:36,264`. Status uses `val.replace(/_/g,' ')` in `formatText` and in the `str-columns.ts:50` getter.
- **Shortlist ClinVar `Uncertain_significance` (DO).** Use the existing `ClinVarCell` in ShortlistTable, as the case table does.
- Root cause: VERIFIED for every item, at the file:line refs above.
- Size: about +12 / −20 lines in total (net deletion)
- Test: the date test above, plus `tests/renderer/components/table-cells/simple-cells.test.ts`: `ConsequenceCell` with `intron_variant&non_coding_transcript_variant` renders humanised text. The rest are trivial; no test needed.
- Verdict: **DO** (the CNV "Homozygosity Ref/Alt" label is SKIP: wording, needs the domain owner)

---

## Summary

| # | ID | Item | Verdict | Size (net) |
|---|---|---|---|---|
| 1 | I-01 | Row/header length check + fixture repair (+ sources.json hashes) | DO | +8 code, fixture regen |
| 2 | F-01 | `interactive` guard on ShortlistTable keys | DO | +8 |
| 3 | P-03 | Esc ignores inputs/overlays; cancel blocks blur-save; keyboard-editable comments | DO | +4 |
| 4 | P-02 | Quick chips disabled when evidence exists (panel + case/cohort row menu) | DO (reason field DO-LATER) | +10 |
| 5 | D-02 | Parser rejects unknown field / unsupported op (`!~` inversion) / NaN; no apply on errors; shared error banner | DO | about +12 |
| 6 | D-01 | DSL chips via `buildColumnFilterChips`, case + cohort | DO | +5 |
| 7 | N-01 | Sync CaseList from `selectedCaseId` via `restoredCaseId` guard | DO | +2 |
| 8 | X-05 | One `formatHgvs` (no stripping) + `%3D` decode at import | DO (genome build DO-LATER) | about −7 |
| 9 | X-11 | ms date, ConsequenceCell everywhere, one empty glyph, abs SV length, STR title/status, shortlist ClinVar | DO | about −8 |

Not checked: I did not run any tests or the app; every claim comes from reading code at `bfd3d80e`. Whether Vuetify overlays move focus inside on Esc (the `.closest('.v-overlay')` guard in #3 relies on it) and the exact percent-encodings VEP emits besides `%3D` still need confirming in the browser.
Risk: #1 must land as one PR (strict check plus fixture plus hashes), or every import E2E and the ui-gates fail. Real-world columnar files with ragged rows will now fail import loudly instead of corrupting data silently, and that is intended.
