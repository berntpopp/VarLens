# 18 — Review: feat/protein-view-discoverability (7 commits, +1255/−207, read-only)

**What this change does:** It moves the protein modal into one shell-owned host (`ProteinViewHost`, `appState.openProteinView`). Five entry points open it: "Lollipop" / "3D structure" buttons beside the gene name, a 40px mini-lollipop strip, `p` on case/cohort/shortlist rows, and a "Protein view" row-menu entry. In the cohort view the modal plots every carrier of the gene, sized by `carrier_count`. Carrier mapping is mostly right: active filters, build and variant type are kept and only the search is dropped; `gene_symbol` matches exactly (`postgres-cohort-summary-query.ts:427`); variants at one position sum their carriers (`groupLollipopsByPosition`); the selected row is not counted twice; rows without a protein position are dropped. `canUse('proteinViewer')` is the only gate (no `typeof window.api` or `isWebRuntime`). The strip's height is fixed and its `v-if` comes from the variant itself, so it causes no layout shift. The modal is an overlay, so opening it shifts nothing.

**Must fix**
1. **Variants without a protein position lost the whole protein view** (`utils/protein-view.ts:35`, used by the buttons, menu item, host and `p`). This hits SVs, intronic, splice and UTR variants. On main the gene icon opened the modal for any variant with a gene, and its Gene-structure tab draws the genomic interval (`genomicVariant`/`variantInterval`), which is built for exactly these variants. Fix: block only on a missing gene or lookups being off. For a missing position, open on `gene-structure`, and disable only the Lollipop/3D buttons.
2. **Read-only viewers get no "Protein view" row menu in the case and cohort tables** (`AnnotationsCell.vue:33`). The entry lives inside the ACMG quick menu, whose button is `:disabled="readOnly"`. The shortlist menu, the panel buttons and `p` still work for viewers. Fix: when `readOnly`, open the menu with only the protein entry, or give the entry its own row action.

**Should fix**
3. **The 1000-row cap is silent** (`CohortTable.vue:673-685`). TTN-class genes in a 10k-exome cohort pass 1000 distinct variants under loose filters, and the plot then shows only the top 1000 by carrier count without saying so. Fix: send `_count_needed: true` and show "showing 1000 of N variants" in the legend. That is about 5 lines, and the `ponytail:` comment stays.
4. **The reason a header button is disabled cannot be reached by keyboard or screen reader** (`VariantIdentitySection.vue:6-24`). The reason sits in a `data-tooltip` on a non-focusable `<span>`, and the disabled `v-btn` cannot take focus. Fix: `aria-disabled` plus `aria-describedby`, or the visible reason line that `ProteinViewMenuItem` already uses (subtitle) and AppToolbar uses (`aria-disabled`).
5. **The lookups-off text is hard-coded** (`proteinViewConfig.ts:9`, "an administrator can enable them in Settings"). It replaces `capabilities.capabilityReason('proteinViewer')`, the server-specific reason, which the deleted panel test asserted. Fix: pass the store reason into `proteinViewBlockedReason`.
6. **The strip triggers UniProt/InterPro mapping and domains lookups on every row selection** (`ProteinPreviewStrip.vue:103-105`). The queries are the same cached ones the modal uses, so per gene there is no extra call. But they now fire without a click; j/k through 50 genes means 100 lookups (through the server on web). That is a product call on egress. If not, gate it behind a first click, or debounce it.

**Nice to have**
7. **Small labelling gaps.** The strip's "Gene" button should say "Gene structure", and the strip container has no `role="group"`/`aria-label`. The plot `<button>` is labelled. The 1000 limit and the 40px height are inline constants, not config.
8. **Duplicate length fallback.** `fix/layout-a11y` adds the same "InterPro answers 0, use the mapping" protein-length fallback to `useProteinData.ts`. After both merge, the strip should reuse it rather than keep its own copy (`ProteinPreviewStrip.vue:120-123`).

**Dense UI:** OK (x-small tonal buttons, 40px strip, `flex-wrap`). **Config:** copy and buttons live in `proteinViewConfig.ts`.

**Conflicts.** `fix/layout-a11y` overlaps 12 files and is the hard one:
- `VariantDetailsPanel.vue`: comments stripped and the heading changed right around the modal block this branch deletes.
- `VariantIdentitySection.vue`: that branch adds the ClinVar/call line after the header row this branch rewrites.
- `AcmgQuickMenu.vue`, `AnnotationsCell.vue`, `acmg-quick-menu.ts`, `App.vue`, `CohortTable.vue`, `VariantTable.vue`, `CohortDataTable.vue`, `ShortlistTable.vue`, and the tests `shared-menu.test.ts` and `ShortlistTable.test.ts`.

`fix/theme-semantic-colours` gives small, adjacent hunks in 8 files:
- `protein-utils.ts`: `getDomainColor` sits next to the rewritten `CLINVAR_COLORS`.
- `LollipopLegend.vue`: import line plus `<v-theme-provider>` wrapper.
- `useLollipopPlot.ts`, `ProteinTooltip.vue`, `VariantIdentitySection.vue` (font), `VariantDetailsPanel.vue`, `VariantTable.vue`, `ShortlistTable.vue`.

Verdict: fix 1 and 2 first.
Not checked: no tests, typecheck or app run (read-only review). Not verified whether the web route caps `limit` below 1000.
