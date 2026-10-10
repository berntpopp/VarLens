What this repo does: VarLens supports case and cohort variant review, filtering, annotation, and evidence review. This audit assumes a researcher moving repeatedly between dense tables and details, using a desktop window or a zoomed desktop/browser window, with occasional database/network failures.

**Scope and evidence.** Read-only audit initially at `6de042dde31e628b0bfd5305775f5e87102c4737` on `chore/sprint-1-hardening-cleanup`, rechecked at current commit `8c2e01b480e0dd09a8b47aff2ad722314468d0d7` after concurrent work was committed. The case-table error path remains unchanged at the latter commit. Examined the case/cohort filter bars, DSL input and integration, pagination/error path, details and extension sections, carrier navigation, panel sizing, keyboard routing, presets, theme tokens, and connected tests. No application code changed. Findings below are source-confirmed; interactive verification is explicitly outstanding unless the coordinating audit supplies it separately.

**Issue deduplication.** Seven proposed defects are retained. The existing open [#93](https://github.com/berntpopp/VarLens/issues/93) already owns embedded alignment review and graceful IGV connection recovery; add the current silent-failure evidence there rather than file an eighth duplicate. Open [#124](https://github.com/berntpopp/VarLens/issues/124) owns per-case filter persistence and its audit trail, so those are not new requests here. Closed [#41](https://github.com/berntpopp/VarLens/issues/41) delivered keyboard shortcuts; finding 4 is a remaining active-view dispatch defect, not a request to implement those shortcuts from scratch. Closed [#504](https://github.com/berntpopp/VarLens/issues/504) concerned saved-preset fidelity and numeric fields; finding 5 concerns losing every management entry point after hiding all presets.

**Implementation integrity verdict: coherent foundation with workflow gaps.** The shared toolbar, semantic icon buttons, case/cohort loading presentation, theme tokens, per-type tables, and capability explanations form a consistent VarLens interface. The defects are chiefly incomplete connections between those components: discarded error state, shortcuts bound to an inactive view, and summary/navigation state that omits the active query or variant.

The detector ran once against nine current Vue components and one incorrectly addressed CSS target. It returned `[]`, but exited **1** because `src/renderer/src/assets/custom.css` does not exist; the actual file is `src/renderer/src/assets/styles/custom.css`, which was inspected manually. This is a partial static scan, not a passed quality gate. Artifact: [impeccable-ui-workflows.json](../../artifacts/filtering-ux-audit-2026-10-10/impeccable-ui-workflows.json). No detector findings were promoted without verification.

Committed screenshots inspected: `filter-dsl-autocomplete.png`, `cohort-view.png`, and `variant-details.png` under `docs/public/screenshots/`. Their footer identifies v0.30.0 and their warm palette differs from current v0.82.0 Clinical Slate tokens in `src/renderer/src/plugins/vuetify.ts:33–100`. They establish historical layout only; they are not current contrast or sizing evidence.

**Provisional source-review score.** This is an audit triage score, not a measured accessibility or performance certification.

| Dimension | Score / 4 | Basis and limit |
| --- | --- | --- |
| Accessibility | 2 | Good focus/name foundations; DSL suggestion state is not exposed semantically. Assistive technology not run. |
| Performance | 3 | Lazy details sections, deferred hidden work, skeleton/stale state, and dedicated interaction tests. No new timing measurement. |
| Responsive design | 2 | Explicit column budgets, toolbar overflow, and full-width details; filter-drawer clamp can shrink below its own minimum. |
| Theming | 3 | Current light/dark token pairs and dark nested-table correction; all transient UI states not rendered. |
| Implementation integrity | 3 | Shared product-specific controls; remaining cross-component wiring defects below. |
| Total | **13 / 20** | Significant targeted work; no case for a visual redesign from this review. |

**Must fix**

1. **[P1] Show case query failures before users trust retained rows.** Category: error/recovery and result integrity. Confidence: high, source-only.

   **Evidence:** `src/renderer/src/composables/useOffsetPagination.ts:220–227` retains previous rows/count and stores an error. `src/renderer/src/components/variant-table/useVariantData.ts:90–102` does not take that error from the pagination composable, and its return at `:258–282` does not expose it. `src/renderer/src/components/VariantTable.vue:411–440` therefore has no error state, while `:227–242` always labels an empty table “No variants match your filters.” The loading presenter announces the retained count once loading becomes false (`src/renderer/src/composables/useTableLoadingState.ts:29–36`).

   **Trigger and impact:** Load case rows, apply a different filter, and make the next query reject or time out. The filter controls change, old rows remain, and the stale indicator ends without a failure banner. A first-load failure instead looks like a valid zero-result search. This can mislead review and makes recovery guesswork.

   **Smallest fix:** Return the existing pagination error through `useVariantData`; render a visible error and Retry using the pattern already present in `src/renderer/src/components/CohortTable.vue:4–17`. Retained rows must remain explicitly marked as previous results after failure; reserve the zero-result message for successful queries.

   **Acceptance:** A failed first query shows an error and Retry, never “No variants match.” A failed refilter preserves rows only with an explicit previous-results message, does not announce them as the new result, and Retry uses the current filter. Successful retry clears the error.

   **Existing coverage:** `tests/renderer/composables/useOffsetPagination.test.ts:148` covers error state and `:420` covers preserving previous rows. The `useVariantData` component test mocks pagination without an error field (`tests/renderer/components/variant-table/useVariantData.test.ts:46–60`); no inspected case-table test asserts visible query failure and recovery.

2. **[P1] Include applied DSL conditions in the visible filter summary.** Category: filtering clarity and result integrity. Confidence: high, source-only. Merge with any broader DSL state issue rather than filing a duplicate.

   **Evidence:** `src/renderer/src/components/FilterToolbar.vue:651–662` includes DSL conditions in the badge count but excludes them from `mergedActiveFiltersList`. The same split occurs at `src/renderer/src/components/cohort/CohortFilterBar.vue:351–365`. `src/renderer/src/components/SlimFilterToolbar.vue:183–199` displays “No filters applied” when that list is empty. `src/renderer/src/composables/useDslFilterIntegration.ts:67–85` keeps the applied DSL filters separate from the editable input.

   **Trigger and impact:** Clear filters, enter `gnomad_af:<:0.01`, and press Enter. Results and the filter badge use the condition while the applied-filter strip can still say “No filters applied.” Editing the text afterward changes the only visible expression even though the previous condition remains applied until Enter.

   **Smallest fix:** Derive summary entries from the applied `dslColumnFilters`, using the existing column-filter formatting, and route their close actions to that same state. Track the last applied DSL text only if needed to label a changed draft “Press Enter to apply.” Do not introduce another independent filter store.

   **Acceptance:** Case and cohort show each applied DSL condition in the summary; “No filters applied” appears only when the effective query has none. A draft edit cannot silently replace the displayed applied condition. Clearing a DSL chip removes the effective condition and updates counts; editing or invalidating raw text leaves the applied state explicit.

   **Existing coverage:** `tests/renderer/composables/useDslSearch.test.ts` covers parsing mode and suggestion insertion. Existing toolbar tests and filter-chip E2E files do not establish this applied-DSL summary contract in the inspected paths.

3. **[P1] Expose DSL suggestions and errors to keyboard and assistive-technology users.** Category: accessibility. Confidence: high for missing semantics; rendered assistive-technology behavior needs verification.

   **Evidence:** `src/renderer/src/components/DslSearchBar.vue:3–20` names the input but has no combobox role, expanded state, suggestion relationship, or active-descendant binding. `:103–111` removes the menu wrapper's ARIA without adding the corresponding input semantics. The suggestion list and rows at `:45–82` have no option identifiers or option selection state; arrow handling at `:216–254` changes only `highlightedIndex`. Errors exist only in an anchored tooltip at `:87–93`, with input details hidden at `:10`.

   **Trigger and impact:** Type a partial column, arrow through the suggestions, then enter malformed DSL. Sighted users see highlight/error color, but the input does not expose the current suggestion or a durable linked error message. A scanner of the closed base view can miss this interaction gap.

   **Smallest fix:** Complete the existing custom combobox: input role/expanded/controls/active-descendant; listbox and stable option IDs/selected state. Expose the parse message in an input-linked inline status/error region. Keep the input focused when dismissing only the suggestion popup; a separate Escape can retain the documented blur behavior if needed.

   **Acceptance:** A keyboard-only user can inspect, accept, dismiss, and resume suggestions without losing the editing position. The accessibility tree names the active option and expanded state. An invalid expression exposes its message without pointer hover; a corrected expression removes the error. Test both the toolbar and drawer instances.

   **Existing coverage:** `useDslSearch.test.ts` tests suggestion data, not rendered semantics. `tests/ui-gates/a11y.gate.ts:17–32` runs five base states in both themes; `tests/ui-gates/support/app-states.ts` does not open DSL suggestions or enter malformed DSL. Add one rendered autocomplete interaction regression, not another parser-only test.

**Should fix**

4. **[P2] Route search/filter shortcuts to the currently visible view.** Category: keyboard/navigation. Confidence: high, source-only.

   **Evidence:** `src/renderer/src/App.vue:415–421` sends search, filter drawer, columns drawer, and clear-all to `filterToolbarRef`. That ref is the case `FilterToolbar` mounted at `src/renderer/src/views/CaseView.vue:432–450`. The cohort toolbar exposes only `dslColumnFilters` (`src/renderer/src/components/cohort/CohortFilterBar.vue:610–611`). Shortcut hints remain visible in the shared toolbar (`src/renderer/src/components/SlimFilterToolbar.vue:71–88`) and global help (`src/renderer/src/components/KeyboardShortcutsDialog.vue:61–68`).

   **Trigger and impact:** Open cohort and press `/`, Ctrl/Cmd+Shift+F, Alt/Option+Shift+C, or Ctrl/Cmd+Shift+X. These cannot act on the cohort toolbar: with a null case ref they do nothing; if the case ref is retained, they can act on hidden case state. The interface advertises commands that do not operate on the user's current task.

   **Smallest fix:** Expose the same small command surface from the cohort filter bar through its existing parent refs, then dispatch by active view. Gate commands while the case Shortlist hides the filter toolbar.

   **Acceptance:** Each advertised shortcut operates on case and cohort independently; clear-all never alters an inactive view. Switching views and using the Shortlist does not open a hidden drawer or steal focus into hidden search. Verify both a fresh cohort visit and a cohort visit after opening a case.

   **Existing coverage:** `tests/renderer/composables/useKeyboardShortcuts.test.ts` verifies key-to-callback mapping and modifier behavior. It does not verify App-to-active-view dispatch. Add a route-level interaction regression.

5. **[P2] Keep preset management reachable when every preset is hidden.** Category: discoverability/recovery. Confidence: high, source-only.

   **Evidence:** `src/renderer/src/components/PresetBar.vue:4` conditionally removes the whole bar, including Save and Manage at `:27–45`, when `visiblePresets.length` reaches zero. Both alternate drawer entries use the same condition: `src/renderer/src/components/FilterDrawer.vue:50–69` and `src/renderer/src/components/cohort/CohortFilterDrawer.vue:50–69`. The Manage dialog permits hiding every entry (`src/renderer/src/components/PresetManageDialog.vue:40–52`). No other renderer entry point to this dialog was found.

   **Trigger and impact:** Hide all presets and close Manage. The toolbar and Filters drawer both lose Manage, so the user cannot restore a preset through the interface. Saving current filters also disappears, even though filters still exist.

   **Smallest fix:** Gate only the preset chips on a non-empty visible list. Keep the existing Manage action present, and keep Save present when an effective filter is active. Apply this to the bar and both drawers.

   **Acceptance:** Hide all, close, reopen Manage, and restore one preset in case and cohort. With all presets hidden, an active filter can still be saved. Empty/loading/error preset states remain distinguishable.

   **Existing coverage:** `tests/e2e/filter-phase3-presets.e2e.ts:212–280` opens Manage and hides/restores one preset. It does not close the dialog with zero visible presets. Extend that workflow with the zero-visible boundary.

6. **[P2] Stop viewport changes from shrinking the filter drawer below its usable width.** Category: zoom/responsiveness. Confidence: high for sizing behavior; visual clipping needs live confirmation.

   **Evidence:** `src/renderer/src/components/filters/FilterDrawerShell.vue:83–97` sets a maximum of 40% of the viewport and writes it directly into `panelWidth` on resize. This bypasses its declared 250px minimum (`:85–91`). At a 512px effective viewport the drawer becomes 204px; at 390px it becomes 156px. The watcher is not immediate, so opening at a width and resizing to that same width can produce different layouts. The details panel already has explicit narrow/full-width handling (`src/renderer/src/components/VariantDetailsPanel.vue:318–324`).

   **Trigger and impact:** Open Filters at desktop width and zoom or resize to a narrow effective viewport. The header, fields, and footer must fit a drawer narrower than the component's own minimum, obstructing the controls needed to recover from restrictive filters.

   **Smallest fix:** Derive effective drawer width with a viewport-safe minimum and a full-width narrow mode, using the existing details-panel approach. Preserve the stored user width separately instead of overwriting it during viewport shrinkage.

   **Acceptance:** Opening directly and resizing to 390, 512, 768, and 1024 CSS px produce the same usable drawer width. Close, Clear All, Done, and every filter input remain reachable at 200% zoom. Returning to wide width restores the user's chosen width. No app-wide horizontal overflow is introduced.

   **Existing coverage:** `tests/renderer/utils/responsive-layout.test.ts` covers details-panel caps and column budgets, not this filter-drawer watcher. One width-boundary regression plus a narrow/zoomed interaction check covers the gap.

7. **[P2] Preserve exact variant identity when opening a cohort carrier in a case.** Category: navigation/continuity. Confidence: high for discarded identity; end-to-end destination needs live confirmation.

   **Evidence:** `src/renderer/src/components/CohortTable.vue:555–564` emits chr/pos/ref/alt alongside the carrier case. `src/renderer/src/views/CohortView.vue:27–37` ignores those identifiers and constructs only a gene/cDNA search, or no search when both are absent. It calls generic case selection at `:58`; the target case follows its usual default-tab logic (`src/renderer/src/views/CaseView.vue:157–197`), including Shortlist. No exact selection or requested variant type is passed.

   **Trigger and impact:** Open “View in Case” for a variant without cDNA, a non-shortlisted variant, or a structural/copy-number variant in a mixed-type case. The user can land on a broad gene search or the default tab instead of the selected variant, losing the review context and having to find it again.

   **Smallest fix:** Carry the existing exact identity plus variant type into case navigation, open the matching type tab, and select/scroll to the matching row after it loads. Keep the broad gene search as a separate action if desired; no new navigation framework is needed.

   **Acceptance:** Two variants sharing a gene with missing cDNA remain distinguishable. “View in Case” opens the chosen variant in an SNV, SV, and CNV case even when Shortlist is the default. Missing/deleted targets produce an explicit message rather than a silent broad search. Test one route-level identity round trip.

   **Existing coverage:** `tests/renderer/components/cohort/CarrierExpandedRow.test.ts:210–215` checks that the carrier case ID is emitted. That does not assert exact variant continuity through the destination view.

**Strengths to preserve**

- The case table already explains a successful empty filter result and offers a direct Clear filters action (`VariantTable.vue:227–242`); replicate this in cohort after distinguishing errors.
- `usePanelFocus.ts:23–58` moves focus into lazy-mounted details and returns it to the opener/selected row. Details have a named aside, a heading, and an explicit close action.
- The cohort error banner has Retry, carrier-load errors have Retry, and carrier tests cover stale responses and workspace changes. Reuse these established recovery patterns.
- Clinical Slate centralizes light/dark text and semantic colors (`plugins/vuetify.ts:33–100`). The dark override for nested `bg-grey-lighten-3` surfaces exists in `assets/styles/custom.css:235–243`; the fixed-light class alone is not evidence of a dark-mode defect.
- The shared icon button and `assets/styles/a11y.css:27–42` deliberately retain dense controls while enforcing a 24px floor. Small Vuetify size props alone are not evidence that the rendered target is undersized.
- Lazy details sections, lazy first-open protein views, deferred hidden-table work, automatic row fitting, and explicit column preferences support a dense review workflow without unnecessary loading. Existing interaction gates provide an appropriate place for timing/shift checks; no new performance claim was measured here.

**High-value capability opportunities — not confirmed bugs**

- **Give each variant type a useful narrow-screen column budget.** `utils/responsive-layout.ts:45–82` gives unknown extension columns priority 100. At narrow widths, CNV copy number and end/length, or SV type/support/end, lose to the generic SNV-oriented priorities. Preserve explicit user choices, but supply per-type default priorities using the existing column definitions. Acceptance: a fresh CNV/SV view shows its essential interval/call evidence at 768px without first opening Columns.
- **Make structural locus review interval-aware.** Local IGV currently uses `chr:pos-pos` for every variant (`ExternalLinksSection.vue:193`), although CNV/SV data includes `end_pos`. Offer a bounded interval jump, with a clear coordinate/build label and breakpoint handling for translocations. This is a capability enhancement; the current control promises a locus jump, not a full interval review.
- **Expose the distinction between editing and applying DSL.** Plain search auto-applies, while DSL waits for Enter (`useDslFilterIntegration.ts:56–67`). A small “Press Enter to apply”/“Applied” state, an accessible parse message, and one discoverable syntax example would clarify the existing model. Preserve keyboard entry and avoid a separate query-builder system unless users request one.
- **Give cohort empty results the case table's recovery path.** `CohortDataTable.vue:172–184` supplies loading and expanded-row slots but no custom no-data slot. A simple “No variants match” plus Clear filters action would reduce backtracking without adding a new empty-state component family.

**Current CNV/SV visualization capability inventory**

| Capability | What the current code provides | Concrete next step |
| --- | --- | --- |
| Type-specific case review | SV and CNV tabs and table definitions include position, end, type, length, gene, call quality, and caller; CNV adds copy number/homozygosity, SV adds support/DR-DV/VAF/precision (`components/variant-table/cnv-columns.ts:13–53`, `sv-columns.ts:16–51`). | Make the existing column defaults type-aware at narrow widths before adding another view. |
| Selected-call evidence | `ExtensionDetailsSection.vue:111–259` shows type/caller, length/end, and SV or CNV evidence fields. It is intentionally case-only (`VariantDetailsPanel.vue:52–56`) because cohort aggregates lack per-call fields. Shared details also contain transcripts, annotation scores, ACMG, tags, comments, and activity. | Add a compact interval identity line with build, start/end, type, and length above the evidence fields. Use explicit unknown values; do not imply a missing call-quality value is a passed check. |
| Gene/protein plots | The protein modal has Lollipop, Gene Structure, and 3D tabs (`protein/ProteinVisualizationModal.vue:45–50`). The selected point is highlighted and optional same-gene case variants are added (`:305–331`); the lollipop requires a parseable protein position (`:264–279`). Gene-structure input is a point with chr/pos/ref/alt, with no interval end (`:189–201`; `composables/useGeneStructurePlot.ts:42–50`). | Extend the existing gene-structure view with an interval band for CNV/SV end coordinates and affected exons, retaining point rendering for SNVs. Only offer protein-position rendering when meaningful data exists. This is an enhancement, not a missing promised CNV plot. |
| Build context | Cohort exposes Genome Build and variant-type controls (`components/CohortView.vue:1–30`); imports expose build selection; link-out settings have a GRCh37/GRCh38 selector. Details identity currently prints chr:pos and alleles (`VariantIdentitySection.vue:39–50`), and gene-structure's axis text explicitly says GRCh38 (`useGeneStructurePlot.ts:373`). | Carry the case's declared build into the displayed locus/plot context; surface mismatch/unknown states before offering interval visualization or build-specific external links. Verify the gene-structure source assembly before claiming cross-build plotting. |
| Cross-type prioritization and selection | Shortlist displays typed SV/CNV summaries, scores, and a “View in … tab” action (`shortlist/ShortlistTable.vue:99–111`, `:356–358`). Case table row selection opens shared details; cohort row expansion lists carriers and supports case navigation. | Preserve exact selected identity during type-tab and carrier navigation; use finding 7 as the first small correction. |
| Cohort comparison | Cohort offers build/type scoping, carrier counts, cohort frequency, zygosity counts, and per-carrier expansion (`cohort/useCohortColumns.ts:12–30`, `CarrierExpandedRow.vue:14–52`). Its base columns do not expose interval ends or per-call CNV/SV evidence. | Add a compact per-carrier evidence comparison after selecting a structural interval, using existing data where available. State matching rules explicitly; this inventory does not establish interval-overlap matching or cross-caller equivalence. |
| Local/read-level review | A capability-gated Local IGV action sends `chr:pos-pos` to port 60151 (`ExternalLinksSection.vue:187–205`). Renderer/source searches found no embedded alignment viewer or BAM/CRAM linking UI. The existing request catches connection failure only to a log, then stops the spinner. | Continue [#93](https://github.com/berntpopp/VarLens/issues/93): first add actionable failure/retry feedback and interval/build context to the existing action; then add explicitly linked alignment tracks. No need to add an embedded viewer just to fix silent connection failure. |

No dedicated genome-wide CNV copy-number/read-depth plot or SV breakpoint-arc view was found in the renderer component/composable search. The current plotting surfaces are the gene/protein views and association Manhattan/volcano plots. A new CNV overview should require an actual segment or read-depth series; do not fabricate a continuous plot from isolated scalar call fields. A small interval-over-gene view reusing existing components is the first useful enhancement.

**Interactive verification handoff**

1. Reject a case query after changing filters; confirm stale rows, live announcements, and lack of retry UI. Repeat with first load.
2. Exercise the four filter shortcuts in cohort before and after visiting a case, and on Shortlist.
3. Apply a DSL-only filter, edit it without Enter, enter malformed syntax, and inspect the input/listbox accessibility tree while arrowing through suggestions.
4. Hide every preset, close Manage, and attempt recovery through both toolbar and drawer.
5. Open Filters wide, then resize/zoom to 768/512/390 CSS px. Also inspect the cohort toolbar: unlike case, its ACMG chips are unconditionally rendered (`CohortFilterBar.vue:64–77`), which may crowd actions. This crowding is not reported as confirmed without rendered evidence.
6. Open a carrier in a case for an unannotated or non-shortlisted variant, then repeat for mixed-type data.
7. In desktop, click Local IGV with its listener unavailable. In dark mode, inspect hidden rows in Manage Presets (`PresetManageDialog.vue:26` uses `bg-grey-lighten-4`, outside the existing dark `grey-lighten-3` override); no contrast failure is asserted from source alone.

**Recommended action order:** fix visible query errors and truthful applied-filter state first; complete DSL semantics; then repair shortcuts, preset recovery, drawer sizing, navigation continuity, and IGV feedback. Impeccable command mapping: `$impeccable harden` for failures and recovery, `$impeccable clarify` for applied state, `$impeccable adapt` for drawer sizing, followed by `$impeccable polish` after behavior checks pass.

**Verdict:** Keep the current interface system; repair state visibility and workflow continuity before adding more controls.

**Not checked:** No application server, browser tab, screen reader, IGV listener, application test suite, ABI rebuild, or `make ci` was run by this audit worker. The coordinating audit owns live checks. No claims of current contrast conformance, measured performance, or complete cross-platform behavior follow from this source review.
