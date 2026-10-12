# 03 — Variant details, viewers and adding information to cases

- **Date:** 2026-10-12 · **Build:** v0.83.0 (`bfd3d80e`), web mode, Postgres, `http://127.0.0.1:8797`, signed in as `ui-gate-admin` (role admin).
- **Evaluator:** Assessment A style (design-director heuristic walkthrough with clinical-geneticist personas), one evaluator. Scores are single-evaluator values, not medians.
- **Method:** headless Playwright (Chromium) at 1440×900, plus 1920×1080, 1280×800, **1280×720** and 390×844. Light and dark (`prefers-color-scheme`). I tested every interaction by hand on case 4 (HG002-VEP-panel), with checks on 5 (SnpEff), 7 (SV), 8 (CNV), 9 (STR), 10 (edge cases) and the cohort view. Measurements used the schema §7 snippets (contrast sampler, layout-shift observer, Machado CVD filter).
- **Screenshots:** `screenshots/details/` (`d*` = full window, `p-*` = panel crops).
- **Product-owner rule applied:** small text and controls are intentional, for density and for 1280×720. I do not report anything as "too small". Legibility is judged by contrast, weight, face and hierarchy, and hit area by padding.
- **Data hygiene:** I set and then reverted ACMG classes, evidence, a variant comment, stars, a case comment, sex, status, age and HPO terms on case 4. The audit-log entries remain. **I switched the server-wide External lookups on (VEP, MyVariant, SpliceAI, gnomAD, protein) three times, for about 1–2 min each, to test the viewers. Each time I switched them back off in a `finally` block.** Parallel agents may have seen them on during those windows.

Labels: **VERIFIED** = reproduced, with a screenshot or measurement. **SUSPECTED** = from code reading or ambiguous rendering only.

---

## 1. Scorecard

Band scores are 0/25/50/75/100. The P0/P1 caps from schema §1.2 are applied. `—` = not applicable.

| View | vw | D1 7 | D2 6 | D3 7 | D4 6 | D9 6 | D10 9 | D11 7 | D12 6 | D13 10 | D14 5 | **View score** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Variant details panel (identity, transcripts, scores, ACMG, tags, comments, links) | 16 | 50 | 50 | 50 | 50 | 50ᶜ | 25ᶜ | 50ᶜ | 50 | 25ᶜ | 50 | **43** |
| Gene schema / lollipop | 6 | 25 | 50 | 25 | 50 | 75 | — | 25 | 50 | 50ᶜ | 50 | **44** |
| 3D structure (pdbe-molstar) | 4 | 50 | 50 | 25 | 50 | 75 | — | 50 | 50 | 50 | 50 | **50** |
| Case metadata / annotations (modal, HPO, status, comments, metrics, data info, scope toggle) | 5 | 75 | 75 | 50 | 75 | 75 | 50 | 50ᶜ | 50 | 75 | 50 | **63** |

ᶜ = capped by an open P0 (25) or P1 (50) in that dimension and view.

**Gates relevant to the overall score:** an open **P0** (F-01) caps the overall score at 49. **D13 < 50 on the details panel** caps it at 59. The binding cap is **P0 → 49**.

How I banded the details panel:
- **D1:** the sections are flat and equal-weight. The header just says "Variant Details" and the identity block scrolls away (F-07).
- **D2:** the HGVS is malformed, and grey Courier New is used for the core identity.
- **D3:** two text contrast failures.
- **D4:** score significance is shown by colour alone.
- **D10:** capped by F-01.
- **D11:** capped by F-04.
- **D13:** capped by F-01, with F-02, F-03 and F-05 also open.

---

## 2. Nielsen heuristics: details, viewers and case annotation (0–4)

| # | Heuristic | Score | Evidence |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Good: ACMG saves give a snackbar with Undo (d05), and an unsaved-draft bar plus a leave guard (d06). Bad: comment saves give no confirmation; the lollipop renders blank with no message (d20); the panel heading never names the variant; "Cached from 8/23/58749" (p-vepdone-0). |
| 2 | Match between system and real world | 2 | The HGVS is doubled (`ENST…604:ENST…604.7:c.…`, d01). `p.Pro4%3D` is not decoded. STR loci show "Unknown Gene" (p-ext-9-str-1). The sex "Unknown" glyph is ⚥. A DEL length is shown as "-5.00 kb". |
| 3 | User control and freedom | 2 | Undo exists for ACMG. But **Esc while editing a comment saves the text and closes the whole panel** (F-04). Esc in the tag menu or protein dialog also closes the panel. |
| 4 | Consistency and standards | 2 | Quick-classify chips and the evidence editor can disagree: P is stored while the evidence shows VUS (F-03). Web uses button "tabs" where desktop uses `v-tabs`. In the cohort panel, scores are "available in Case Analysis mode" only. |
| 5 | Error prevention | 1 | **The hidden Shortlist table still receives ↓/Enter/s, so keyboard actions hit a variant you cannot see** (F-01). One click on "P" overrides the evidence with no reason asked. |
| 6 | Recognition rather than recall | 2 | Identity scrolls away when you switch variants (F-07). The DNA icon for "protein view" looks like an hourglass and is the same glyph as the gnomAD link. Score chips carry no cut-off explanation. |
| 7 | Flexibility and efficiency | 2 | Shortcuts exist (↓/Enter/a/s/c). But the panel does not follow ↓: you must press Enter each time. The HPO selector keeps the last label in its input, so the next search fails. |
| 8 | Aesthetic and minimalist design | 2 | Calm and dense, but the visual weight is inverted. Chrome (section headings, the accordion, 11 link tiles) is louder than the data. The alleles and HGVS are the quietest text in the panel (grey Courier). |
| 9 | Recognise, diagnose, recover from errors | 3 | Disabled lookups now explain themselves and name the fix (d18, transcript notice): a clear improvement. Viewer data failures are still silent (empty lollipop). |
| 10 | Help and documentation | 2 | ACMG criterion tooltips and ClinGen SVI notes are good (p-acmg-editor-3). There are no thresholds for CADD/REVEL/SpliceAI/AlphaMissense, and the "Annotation Scope: Case / All" toggle has no explanation (p-scope-section). |
| | **Total** | **20 / 40** | |

---

## 3. Findings

### P0

**F-01 · P0 · Case view (SNV/Indel tab) + details panel · D10/D13/D8 · VERIFIED.** The hidden Shortlist table handles the same keystrokes, so ↓, Enter and `s` act on a variant the user cannot see.
- **What:**
  - The Shortlist tab is visited by default, then kept mounted with `v-show`. Its keyboard handlers have no visibility or `interactive` guard.
  - In the SNV/Indel tab, ↓ moves *both* selections. Enter then opens the **hidden shortlist row**: KREMEN1 was highlighted, ↓ highlighted EMID1, and Enter opened **MTMR3 c.2446G>A**.
  - Pressing `s` stars the visible row **and** the hidden shortlist variant. EMID1 and MTMR3 chr22:30020105 were both starred (`p-d03-star-after-s.png`, `d03-shortlist-after-s.png`).
  - The second star is silent, because it lands on a tab that is not visible. It writes a triage annotation to the wrong variant.
- **Repro:**
  1. Open case 4, SNV/Indel, search `missense`.
  2. Click row 1 (KREMEN1), then press Esc.
  3. Press ↓ (EMID1 is highlighted), then `s`.
  4. Open the Shortlist tab: MTMR3 is starred.
- **Root cause:** `components/shortlist/ShortlistTable.vue:206-250`. The `onKeyStroke` handlers for ArrowDown/ArrowUp/Enter/`s`/Escape have no active check. They are kept alive by `views/CaseView.vue:474-476` (`v-if` + `v-show`). `VariantTable.vue` already guards with `props.interactive` and `viewActive`.
- **Fix:** give ShortlistPanel/ShortlistTable an `interactive` prop, set to `selectedVariantType === 'shortlist'`, and return early in each handler. Add a unit test: with the shortlist hidden, ↓ followed by `s` must not emit `toggle-star`.

### P1

**F-02 · P1 · Details panel · D13 · VERIFIED.** The panel shows no ClinVar significance and no genotype or quality data.
- The table shows ClinVar "Uncertain significance" for THOC5 c.538A>G, and **"Pathogenic"** for the CNV GENE_A DEL (case 8). The panel, where classification happens, shows neither (p-ext-8-cnv-0).
- The panel also shows no GT, zygosity, DP, GQ, AB or FILTER. For multi-allelic splits (case 10, `AGAAG>A`, GT `1/.`) it shows nothing about the split.
- The ACMG auto-suggest reads `clinvar`, but the user never sees it.
- **Fix:** add a compact "Call" row (GT · zygosity · DP · GQ · AB · FILTER) and a ClinVar line (significance, humanised) under the identity block in `VariantIdentitySection.vue`. Show "split from multi-allelic site" when `gt_num` contains `.`.

**F-03 · P1 · Details panel, ACMG · D13/D12 · VERIFIED.** A quick-classify chip silently contradicts the stored evidence.
- With PM2+PP3 applied (2 pts → VUS), one click on **P** stores Pathogenic. The evidence summary right below still says "Uncertain significance 2 net pts" (d08, p-acmg-mismatch).
- The table shows P. Nothing marks this as an override, and no reason is asked for.
- In the other direction, clearing the class with ✕ keeps the evidence, so the record shows "(has evidence)" with no class.
- **Root cause:** `VariantDetailsPanel.vue:440-465`. `handleQuickClassify` writes the classification without consulting `acmg_evidence`.
- **Fix:** when evidence exists, route a quick-chip click into the evidence editor's Override flow (`is_override: true`, reason required), or disable the quick chips and show "Set from evidence". The ✕ should offer "Clear class and evidence".

**F-04 · P1 · Details panel, comments · D11/D8 · VERIFIED.** Esc saves the comment edit and closes the panel, and comments cannot be edited by keyboard.
- I typed into the case comment and pressed Esc, expecting cancel. The text **was saved**: `annotations/upsertPerCase {per_case_comment:"Audit test comment (esc)"}`. The whole panel also closed.
- **Cause:**
  - `InlineEditableText.vue:25` cancels on Esc.
  - The window-level `keydown` in `VariantDetailsPanel.vue:546-555` closes the panel without checking for a focused input.
  - The textarea then blurs, and blur saves (`@blur="saveEdit"`).
- The display element (`InlineEditableText.vue:7`) is a `div @click`, with no `tabindex` or role and no key handler. Global and case comments therefore cannot be added by keyboard: the 26 focusable elements in the panel do not include them.
- **Fix:**
  - In `handleKeydown`, ignore events whose target is in an input or textarea, or whose `defaultPrevented` is set.
  - In `cancelEdit`, set a flag so the following blur does not save.
  - Render the display state as a `<button>` (or add `role="button" tabindex="0"` and Enter/Space handling).

**F-05 · P1 · Gene schema / lollipop · D13/D11 · VERIFIED.** The lollipop plot renders an empty canvas.
- With lookups on, the Lollipop tab shows toolbar, legend and counts (gnomAD 1279/4809, ClinVar 64), but **the SVG has 0 children** (d20, d25). The "683 aa" chip is missing from the header.
- `protein/getDomains` returns `{domains:[], proteinLength:0}`. `useProteinData.ts:49` uses `domainsQuery.data?.proteinLength ?? mapping.proteinLength`; `0` is not nullish, so the mapping's 683 is never used. `useLollipopPlot.ts:258` then returns early on `proteinLength <= 0`.
- No empty or error state is shown. Domains are also empty, which suggests InterPro parsing or caching failed upstream (SUSPECTED; that result is cached).
- **Fix:**
  - Use `||`, or prefer `mapping.proteinLength` when the domain result is 0.
  - Show "No domain data from InterPro; showing backbone only" when `domains.length === 0`.
  - Add a test with `getDomains → proteinLength 0` and a mapping of 683.
  - Investigate the empty InterPro result for Q13769.

**F-06 · P1 · Case view, panel open/close · D6 (noted for the stability report) · VERIFIED.** Docking the panel shifts the table by about 0.21 CLS.
- At 1440 px, opening the panel docks it and reflows the table. The layout-shift observer recorded **0.209 light / 0.211 dark**. The shifts are input-adjacent, but the project rule counts those (≤ 0.02).
- **Fix:** animate the docking with transforms only, or reserve the panel gutter once a variant has been opened.

**F-07 · P1 · Details panel · D9/D1/D13 · VERIFIED (prior finding still open).** The panel keeps its scroll position when you switch variants, and the heading never names the variant.
- After scrolling to ACMG and clicking another row, `scrollTop` stays at 410 (d28). The view opens on ACMG/Tags/Comments with no gene or HGVS visible. The header says only "Variant Details".
- A user who classifies right after switching cannot see *which* variant is in the panel, apart from the row highlight in a table that may be covered (it is covered at 1280×720, d34).
- **Fix:**
  - Reset the scroll container to the top when `variant.id` changes (`VariantDetailsPanel.vue:35`).
  - Make the toolbar title sticky and specific: `THOC5 · c.538A>G · p.Met180Val`.

### P2

**F-08 · P2 · Details panel, identity · D13/D2 · VERIFIED.** The HGVS transcript prefix is doubled, and `%3D` is not decoded.
- For VEP imports the panel shows `ENST00000490103:ENST00000490103.6:c.538A>G` (d01, d02). **Copy HGVS** copies the same invalid string, which VariantValidator and Mutalyzer will reject.
- Synonymous variants show `ENSP…:p.Pro4%3D` instead of `p.Pro4=`.
- **Cause:** VEP stores `cdna` as the full HGVSc and `transcript` unversioned, and `VariantIdentitySection.vue:22-24` prepends the transcript again. SnpEff stores `c.` only, so the two sources disagree.
- **Fix:** in the renderer, skip the prefix when `cdna` already contains `:`, and `decodeURIComponent` the `aa_change`. Normalising at import time is better still.
- The genome build is also missing beside `chr22:29,539,391` (schema D13b).

**F-09 · P2 · Details panel, scores · D4/D14/D13 · VERIFIED.**
- **Colour carries the meaning alone:**
  - After Fetch VEP, the score chips (REVEL 0.05, SpliceAI 0.00, AlphaMissense 0.05) mean "benign" or "deleterious" only through green, orange or red. There is no tooltip, cut-off or source (`AnnotationScoresSection.vue`; the thresholds live only in `getRevelColor` etc.).
  - gnomAD AF 3.6e-5 is painted **red** (`error`), which reuses the pathogenic or alarm colour to mean "rare".
- **Missing or broken values:**
  - CADD stays "--" for every case-4 variant, even with lookups on.
  - "Cached from 8/23/58749": `useVepEnrichment.ts:72` multiplies a millisecond timestamp by 1000.
- **Fix:**
  - Add a tooltip per score: value, cut-offs (for example ClinGen calibrated REVEL ≥ 0.644 / ≤ 0.290 for PP3/BP4) and source.
  - Use neutral colours for AF.
  - Drop the `* 1000` when the value is above 1e12.

**F-10 · P2 · Details panel, transcripts · D13/D1 · VERIFIED.**
- After Fetch VEP (4.9 s; SpliceAI 15 s), 47 transcripts are listed, but **every VEP-sourced row has cDNA "--" and protein "--"** (d33). Switching transcripts therefore cannot show the alternative c./p. notation.
- In the 400 px panel the cDNA, Protein and Status ("Use") columns sit off-screen to the right, and Impact is clipped. There is no MANE or canonical marker in view.
- During the fetch, the *whole* panel turns into a skeleton (p-vep-300), so the identity disappears.
- **Fix:**
  - Request `hgvs=1` (and `mane=1`, `canonical=1`) from VEP.
  - Show transcripts as two-line rows (ID + MANE tag / c. + p.) rather than a 7-column table.
  - Sort MANE Select first.
  - Use the skeleton only for the transcript section.

**F-11 · P2 · Details panel · D12/D8 · VERIFIED.** Esc closes the panel along with whatever overlay is open: the tag menu, the protein-unavailable dialog and the comment editor (see F-04). Same root cause as F-04 (`VariantDetailsPanel.vue:546`). **Fix:** let overlays consume Esc (check `e.defaultPrevented` or the Vuetify overlay stack).

**F-12 · P2 · Details panel, STR/SV/edge cases · D13 · VERIFIED.**
- STR rows whose locus is known (ATXN3, NOTCH2NLC) show **"Unknown Gene"** as the panel title, because `gene_symbol` is null and `REPID` is ignored (p-ext-9-str-1).
- Intergenic and split alleles also show "Unknown Gene" (prior finding, still open). It should read "Intergenic" or name the locus.
- SV DEL length reads "-5.00 kb", and CNV shows "Homozygosity Ref: 0.45 / Alt: 0.55", which is an odd label.
- The transcript table drops the version (`NM_002` for `NM_002.1`), and the intergenic transcript row shows empty cells.

**F-13 · P2 · Details panel, ACMG + activity · D11/D13 · VERIFIED.**
- The activity log does not say *who* made a change, which matters in multi-user web (p-activity). It records no-op entries ("Uncertain significance → Uncertain significance") and repeats the heading ("Activity Log" twice).
- The case comment area shows the *annotation row's* timestamp under an empty comment ("10/12/2026 9:58:39 AM (edited …)" after an ACMG-only change). `CommentsSection.vue:58-63` uses the row timestamps, not the comment's.
- Case comments (modal Comments tab) store no author either: the `caseComments/list` payload has no user field.
- Snackbars ("Classified as Uncertain significance") do not name the variant.

**F-14 · P2 · Gene structure + 3D, dark theme · D3 · VERIFIED.**
- **Gene structure (d26):** in dark mode the plot title "THOC5 - THOC5-216" and the variant label are dark grey on near-black. The legend bar stays light, but its "Legend:" and "ClinVar Significance:" labels are near-white.
- **3D (d27):** the right side panel stays white while its text turns light, so "ClinVar:", "Your Variants (1)" and the variant name become invisible.
- **Fix:** bind the SVG text fill and the side-panel surface to theme tokens (`rgb(var(--v-theme-on-surface))`, `surface`).

**F-15 · P2 · Gene structure · D13/D2 · VERIFIED.**
- The axis repeats tick labels ("29.52 Mb" three times, "29.55 Mb" twice), so labels need 2 decimals at this span.
- Exon numbers collide ("17 16" renders as "1Ꞁ6", "11 10" as "1110").
- The 5′/3′ end label at the left is ambiguous for this minus-strand gene (SUSPECTED orientation issue).
- The variant mapping (c.538 → near exon 6) looks correct.

**F-16 · P2 · 3D structure · D13/D8 · SUSPECTED (headless WebGL).**
- The AlphaFold v6 model loads (about 14 s), but it renders uniformly grey even though the pLDDT legend is shown. The variant residue 180 is neither highlighted nor focused on load; it appears only as a list entry "Pos 180 ★".
- The pLDDT legend is clipped at the right ("<50").
- One Mol* button has no accessible name. Tab order reaches the presets, then 5 unnamed icon buttons.
- **Fix:** apply the pLDDT theme by default, focus the variant residue (`focusResidue`), and label the Mol* toolbar buttons. Re-check in a GPU browser.

**F-17 · P2 · Case metadata modal · D11/D10 · VERIFIED.**
- After choosing Sex → Male, the select kept showing "Unknown" while the header already showed ♂. It was correct only after a reload (d13 vs reload log).
- Adding an HPO term leaves its label in the search input. Typing the next term produces "Seizuremicro" → "No matching HPO terms" (d13).
- The proband banner kept "No clinical phenotypes recorded" until the page was reloaded.
- **Fix:** clear the autocomplete `search` after selection, bind the selects to the store value, and invalidate the banner query after `assignHpoTerm` / `upsert`.

**F-18 · P2 · Case metadata modal tabs · D3/D8 · VERIFIED (prior finding still open).**
- The selected web tab is navy text on slate: **1.59:1** (rgb(30,58,95) on rgb(69,90,100)), so "Overview" is unreadable (d10, d14).
- The web tabs are plain `v-btn`s with no `role="tab"` or `aria-selected`. Desktop uses `v-tabs` (`CaseMetadataModal.vue:28-55`).
- The dialog also jumps vertically when switching tabs, because its height changes.
- **Fix:** use `v-tabs` in both runtimes, or give the active button `color="white"` with an underline plus `role=tab`/`aria-selected`, and set a fixed `min-height` on the body.

**F-19 · P2 · Table ACMG cell · D1/D3 · VERIFIED.** After classifying, the row shows a "VUS" pill clipped to "VU:", in light grey on grey, inside the row-action cell (p-row-acmg-cell). **Fix:** use a fixed-width abbreviation slot (P/LP/VUS/LB/B) with an outline that has its own contrast, not a fill truncated by the icon column. Keep the size and fix the clipping and contrast.

### P3

- **F-20 · Identity · D3/D2.** The two text contrast failures in the panel are the CADD "--" chip (**2.59:1**) and the "Import" source chip (4.22:1 light / 3.87:1 dark). HGVS and coordinates are grey `Courier New`, so the alleles are the quietest text in the panel.
  - **Fix:** without changing size, use the theme `on-surface` colour and a monospace face with clearer glyphs at 12–14 px. Data should be loud and chrome quiet.
- **F-21 · Hit areas · D8.** The ACMG quick chips render 18 px tall with no extra padding hit-zone. **Fix:** keep the visual chip and extend the clickable area through padding or a pseudo-element to at least 24 px (WCAG 2.5.8). Do not enlarge the chip.
- **F-22 · Icon semantics.** "Open protein view" uses the same DNA glyph as the gnomAD link and reads as an hourglass. The sex-unknown icon is ⚥.
- **F-23 · Annotation scope toggle.** "Annotation Scope: Case | All" sits in the filter drawer with no explanation of "All" (global annotations across cases). The panel never says which scope its ACMG belongs to (only "Global: X" when one exists).
- **F-24 · Tags.** "No tags available. Create tags in Settings." gives no inline create or link.
- **F-25 · Panel width.** The default is 400 px at 1920 px too (d29-panel-1920), so the transcript table overflows even where space exists. Consider clamping to `min(560px, 30vw)` at 1920 px or wider; the resize handle exists.
  - The resize handle is mouse-only (`tabIndex -1`, no keyboard alternative, WCAG 2.5.7).
- **F-26 · Cohort-mode panel.** It shows "Scores available in Case Analysis mode": not even gnomAD AF. The representative HGVS comes from an arbitrary case (here SnpEff). This is a cohort-parity gap in the details view (d31).

---

## 4. 1280×720 check (product-owner request)

At 1280×720 the panel is an overlay (400×640) with no scrim and covers the Gene, Impact and ClinVar columns (d34). Identity, transcripts and scores fit above the fold, and the ACMG chips sit right at the fold (section top 578 px of 720). The scroll content is 1181 px for a 591 px viewport.

The density is workable. The cost is that both F-07 (identity scrolls away) and F-02 (missing call and ClinVar data) get worse: the covered table cannot serve as the identity cue. A sticky variant title (F-07) is the cheapest high-value change here. It adds no size.

## 5. What works (keep)

- **ACMG evidence workflow:**
  - Drafts with an "Unsaved: VUS · 2 pts · PM2, PP3" bar and Apply/Discard.
  - A leave guard when switching variants with a pending draft (d06).
  - An undo snackbar for every ACMG write.
  - Strength-grouped criteria with ClinGen SVI notes and struck-through deprecated codes (p-acmg-editor-3).
- **Persistence:** ACMG class and evidence, variant comments, stars, case comments, metadata and HPO all persisted across a reload, and the table reflected ACMG and comment state at once.
- **The "a" shortcut** opens the evidence dialog for the correct, visible row, with full identity in its title (d04).
- **Panel focus:** focus moves into the panel heading on open and returns to the originating row on close. The close button is named.
- **Capability-gated lookups:** an explicit dialog explains why the protein view and VEP are unavailable and how an admin enables them (d18). This replaces the silent 501/404s.
- **HPO search** is bundled and fast (9 results for "seizure" in about 1.5 s including typing), with IDs shown.
- **SV/CNV/STR extension sections** are compact and domain-native: STR thresholds, display unit, status chip; SV precision, support and VAF (p-ext-7-sv-0, p-ext-9-str-1).
- **Gene-structure view** maps the case variant onto the right exon, with ClinVar diamonds and a scale bar (d22).

## 6. Status of prior (2026-10-06) findings in this area

| Prior finding | Status | Evidence |
|---|---|---|
| Panel keeps the previous scroll position when another variant is opened | **STILL OPEN** | F-07, d28 (scrollTop 410 retained) |
| Panel overlays with no scrim, up to 800 px, not viewport-capped | **FIXED** | Docks at ≥ 1440 px; clamp in `clampDetailPanelWidth`; 400 px overlay at 1280 |
| "Fetch VEP" clipped to 8 px | **FIXED** | Full button (p-vepdone-0) |
| Gene header disagrees with the selected row (P0-1) | **FIXED** (not reproduced) | Panel matched the clicked row in every test |
| ClinVar 404 / protein 501 fail silently | **FIXED** | Capability dialog and notices (d18). Lollipop data failure is new and silent (F-05) |
| "Unknown Gene" for intergenic/MT | **STILL OPEN** (and extended to STR) | F-12 |
| ACMG one-click commit with no confirm, undo or ack | **FIXED** (evidence editor drafted; quick chips have undo) | d05, d06. Residual contradiction: F-03 |
| "(has evidence)" stale after all evidence removed | **FIXED** | `hasMeaningfulAcmgEvidence`; header cleared after cleanup |
| ACMG tooltip lingers and covers the grid | **STILL OPEN** | p-acmg-editor-3 (PP3 tooltip covers the Moderate/Supporting rows after a click) |
| Comment placeholder about 2.6:1 | **FIXED** | Sampler found no placeholder failures in the panel |
| HPO 501 shown as "No matching HPO terms" | **FIXED** | Bundled HPO returns results (d12). New issue: F-17 |
| Case-metadata "Overview" tab nearly invisible | **STILL OPEN** | F-18, 1.59:1 |
| Panel close button unnamed; focus not moved or restored | **FIXED** | IconButton label; `usePanelFocus` (focus → h2 → row) |
| Impact plain in the table but a red chip in the panel | **STILL OPEN** (minor) | Panel transcript Impact chip vs plain table text |
| Protein modal (137 KB) mounted unconditionally | **FIXED** | `useMountOnFirstOpen` |
| "? ?" status icons read as help | **FIXED** (labelled); residual ⚥ glyph | F-22 |
| ClinVar underscores | **FIXED in the SNV table**, **STILL OPEN in the Shortlist** (`Uncertain_significance`, d03) | Outside my core view; noted for the table report |

**Counts: FIXED 11 · STILL OPEN 6 · REGRESSED 0.**

## 7. Suggested order of work (smallest diffs first)

1. **F-01:** guard the ShortlistTable keystrokes with `interactive`, plus one unit test.
2. **F-04 / F-11:** make the panel's Esc handler ignore inputs and open overlays; stop blur from saving after a cancel; make InlineEditableText a button.
3. **F-05:** fix `??` → `||` for `proteinLength` and add an empty-domain state.
4. **F-07:** reset the panel scroll on variant change and use a sticky specific title.
5. **F-03:** route quick chips through the override when evidence exists.
6. **F-02:** add the Call and ClinVar row to the identity block.
7. **F-08 / F-09 (date):** renderer-only string fixes (HGVS prefix, `%3D`, `*1000`).

The rest are theme-token fixes (F-14, F-18, F-19, F-20) and VEP request flags (F-10).
