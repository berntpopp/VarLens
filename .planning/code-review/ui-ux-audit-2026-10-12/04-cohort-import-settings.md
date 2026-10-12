# 04 — Cohort, Import, Settings & Admin (Assessment A, independent)

- **Date:** 2026-10-12 · **Build:** v0.83.0 (`bfd3d80e`), web runtime, Postgres, `http://127.0.0.1:8797`, user `ui-gate-admin` (admin).
- **Method:** headless Playwright (Chromium) scripts in `~/.cache/varlens-session/uiux-1012/cohort-settings/` (s01–s71), axe-core 4 (WCAG 2.2 A/AA) + schema snippet 7.3 contrast sampler in light and dark, schema 7.1 layout-shift observer, network capture of every `/api/*` call, code reading for root causes. Viewports 1920×1080, 1440×900, 1280×720, 390×844.
- **Personas:** clinical geneticist (cohort carrier review, trio check), lab admin (accounts, external lookups, data governance), first-time researcher (import, settings, help).
- **Product-owner rule applied:** small text and compact controls are intentional. Nothing below asks for larger text or controls. Legibility is judged by contrast, weight, font, alignment and hierarchy.
- **Screenshots:** `screenshots/cohort-settings/NN-*.png` (cited by number below).
- **Evidence labels:** **VERIFIED** = reproduced (screenshot, measurement or captured API payload). **SUSPECTED** = from code reading only.

### Data hygiene (what I changed on the shared server)
- Imported cases: `audit-import-synthetic-HG005`, `audit-import-single`, `audit-import-trio-1`, `audit-import-trio-2`. The batch flow cannot rename cases, so it also created `synthetic-sv` and `synthetic-cnv`.
- Created user `audit-user` (Viewer, must change password) and tag `audit-tag`.
- Admin password not changed. In the change-password dialog I only typed values that fail validation, then cancelled.
- Theme changes live in my browser contexts' `localStorage` only. Sign-out ran only on a session I created myself, not on the shared cookie.
- The case count went from 10 to 16 while I worked, so the cohort totals in later screenshots differ from the earlier ones.

---

## 1. Scorecard

Only the dimensions assigned to this area are scored: D1, D2, D3, D9, D10, D11, D12, D13 and D14. `—` means the dimension does not apply to that view (schema §4). D3 is the worse of the light and dark results.

| View | vw | D1 7 | D2 6 | D3 7 | D9 6 | D10 9 | D11 7 | D12 6 | D13 10 | D14 5 | **View score** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Cohort view + gene burden | 13 | 50 | 50 | 75 | 50 | 50 | 50 | 25 | 50 (P1 cap) | 50 | **50.4** |
| Import (VCF/JSON, single, multi-sample, batch) | 9 | 75 | 75 | 75 | 50 | 75 | 50 | 50 | 25 (P1) | 75 | **59.5** |
| Settings, theme, account/admin, tags | 4 | 75 | 75 | 75 | 75 | — | 50 | 75 | — | 75 | **71.0** |
| About / FAQ / disclaimer | 2 | 75 | 75 | 75 | 75 | — | — | 50 | — | 50 (P1 cap) | **67.6** |
| Keyboard shortcuts (sheet + bindings) | 3 | 75 | 75 | 75 | 75 | 50 | — | 50 | — | 50 | **64.1** |
| **Area (vw-weighted)** | 31 | | | | | | | | | | **58.1 — needs work** |

Dimension profile across these 5 views (vw-weighted): D1 64 · D2 64 · D3 75 · D9 59 · D10 59 · D11 51 · D12 40 · D13 38 · D14 59. **Consistency (D12) and domain integrity (D13) pull the area down.** Both come from the cohort and import data paths, not from the visual layer.

Measured highlights:
- **axe: 0 serious/critical** on 22 states. Those are cohort, filter drawer, expanded carriers, gene burden, import dialog, Preferences, External Links, Custom Tags, Database Overview, account menu and User management, each in light and dark. The only text-contrast failure is the filter-drawer section overline (4.39:1, light theme).
- **Layout shift:**
  - Direct navigation to `/cohort`: CLS **0.042**, above the 0.02 budget. Sources: `table-container`, `applied-filters-bar--empty`, chip group.
  - Case → Cohort toggle: first rows after 28 ms with CLS 0.000.
  - Filter, search and sort interactions in the cohort: ≤ 0.001 each, all input-adjacent.

---

## 2. Findings

### P1

**C-P1-1 · The active-filter bar says "No filters applied" while a DSL query is filtering (case and cohort).** VERIFIED. Screenshots 04, 05, 11, 12.
- **What:** with `gene:CFTR AND impact:HIGH`, the cohort shows 1 of 1,659 variants and a "Filters 2" badge, but the applied-filter bar reads **"No filters applied"**. A plain search shows a `Search LMNA` chip (03), but DSL expressions produce no chip. The case view does the same (11).
- **Why:** this is a silent exclusion (D13e). A geneticist who glances at the bar believes nothing is hidden. The count pill and the badge are the only clues, and both are quieter than the bar.
- **Fix:** render one chip per parsed DSL clause, or a single `DSL: <expr>` chip with ✕, in the applied-filter bar. The bar must never print "No filters applied" while `searchTerm` or the DSL is non-empty. Apply this in the shared applied-filters component so case and cohort stay in parity.

**I-P1-1 · Columnar JSON import silently shifts every column when a row has fewer cells than the header.** VERIFIED.
- **Evidence:**
  - `tests/fixtures/import/columnar-format.json.gz` (the ui-gates seed) has **19 header ids but 18 values per row**: `selectedTranscript` is declared but absent from the rows.
  - The importer maps cells by position. As a result `cdna = "p.Arg1912*"`, `aa_change = "0"`, `gnomad_af = 40`, `cadd = 5000`, and `clinvar = "1"`. The source row had ClinVSig `"pathogenic"`, so **the pathogenic flag is lost**.
  - Captured in `variants/query` for case 1 and `cohort/getVariants`. The UI shows gnomAD AF 40.0000 and CADD 5000.0 without complaint (02, 06).
- **Root cause:** `src/main/workers/import-mapper-pipeline.ts:74-155`. `parseHeader` resolves column indices from the header, and nothing checks `row.length === header.length`. There is also no range check (AF ∈ [0,1]).
- **Why:** this is silent data corruption at the trust boundary. It is P0 by definition (a hidden pathogenic annotation) whenever any producer emits ragged rows, and the project's own gate fixture does. It also means `make ui-gates` audits nonsense data.
- **Fix:**
  - Reject a row, or fail the import with "row N has 18 values, header has 19", when the lengths differ.
  - Validate AF ∈ [0,1], with a warning in the import summary.
  - Repair the fixture: add the missing `selectedTranscript` value or drop it from the header.
  - Add a unit test with a ragged row.

**F-P1-1 · The FAQ makes false data-protection claims in the web edition.** VERIFIED. Screenshot 91-footer-open-faq. Root cause in `src/renderer/src/config/faqConfig.json:16,26,61`.
- **What:** "All data is stored in a local SQLite database on your machine. No data is transmitted externally or shared with third parties." Also "runs as a desktop application… all processing occurs locally", and "data persists in the local SQLite database".
- **Reality in web mode:** data sits in a server-side Postgres database. The External lookups screen (64) states, correctly, that turning a lookup on sends identifiers to gnomAD, UniProt, Ensembl, MyVariant, SpliceAI, PanelApp and STRING.
- **Why:** a lab admin or a data-protection officer can approve or refuse deployment based on this text. It contradicts the app's own External lookups screen.
- **Fix:** give each FAQ item an optional `runtime: 'desktop' | 'web'` field, or keep two answer variants, and select by runtime capability. Link the privacy answer to the External lookups screen and the audit log.

### P2

| ID | View | What / evidence | Root cause | Minimal fix |
|---|---|---|---|---|
| C-P2-1 | Cohort | **The cohort SV/CNV/STR views reuse the SNV column set.** SV rows show Ref `N`, Alt `<DEL>`, gnomAD, CADD and cDNA. There is no End, SV Type, Length, Support or VAF (17; headers captured). The case SV tab shows `End, SV Type, Length, Support, DR/DV, VAF, Precise` (120). This is a functional parity gap (D12). | `components/cohort/useCohortColumns.ts:12-31` defines a single static `baseHeaders` list | Derive cohort headers per `variant_type` from the same per-type column registry the case table uses. Add carrier columns on top. |
| C-P2-2 | Cohort | **Shortcuts `/`, Ctrl+Shift+F (and, SUSPECTED, Alt+Shift+C and Ctrl+Shift+X) do nothing in the cohort.** In the case view they work (s61: `/` focuses search, Ctrl+Shift+F opens the drawer). The shortcut sheet lists them without qualification (90). | `App.vue:410-422` routes them to `filterToolbarRef` (the case toolbar) only | Route them to the active view's toolbar through a small `activeFilterBar` ref that each view registers on mount. |
| C-P2-3 | Cohort + case | **Esc does not close the Filters or Columns drawer**, in either view (s05, s60: the drawer stays `--active`). The sheet says "Escape — Close drawer / blur search". Prior finding, still open. | Temporary `v-navigation-drawer` with no Esc handler | Add `@keydown.esc` on the drawers, or close them from the global Escape handler when one is open. |
| C-P2-4 | Cohort | **An invalid DSL query behaves differently in each view.** In the cohort, `gene:===` sends a request with **no** search term and shows all 1,647 variants (13). The case view applied the expression and showed 0 (12). In both, the only cue is a red outline; the message is in a hover-only tooltip (`DslSearchBar.vue:87-90`). | Cohort drops unparsable DSL; error text only in a tooltip | Use one rule for both views: keep the last valid result and show an inline `v-messages` error under the field ("Unexpected `=` at 6"). |
| C-P2-5 | Cohort | **The same variant is shown with different text in case and cohort** (chr22:29,001,799, s71): Consequence `intron variant` vs `intron_variant`; Transcript `ENST00000544604` vs `ENST00000544604.7`; cDNA `ENST…:c.426+14602_426+14605dup` vs `c.426+14602_426+14605dupCTAT`; empty AA Change `--` vs blank. The cohort row comes from an unnamed representative case (VEP vs SnpEff), so the HGVS differs without explanation. Prior raw-SO-term finding, still open. | Cohort cells bypass the case formatters; the representative annotation source is not surfaced | Route cohort cells through the same `utils/formatters.ts` functions. Tooltip on cDNA: "annotation from case X (VEP)". |
| C-P2-6 | Cohort | **The denominator mixes variant types.** The pill reads `1,647 / 1,659` with "No filters applied" on the SNV/Indel view (02). The 12 "missing" variants are the SV, CNV and STR records (`getSummary.unique_variants` counts every type). | Count pill uses the all-type total | Use the per-`variant_type` total for the denominator, or label it "of 1,659 (all types)". |
| C-P2-7 | Cohort | **Chromosome naming splits carriers.** `getColumnMeta` lists both `1` and `chr1`, `2` and `chr2`, and so on. The same locus imported with different naming is aggregated as two variants, so carriers are undercounted. | Raw `chr` used in the cohort summary key | Normalise `chr` (strip `chr`, map `M` to `MT`) at import or in the summary key. Show a warning when a cohort mixes styles. |
| C-P2-8 | Cohort | **The cohort's own columns are off-screen at the reference sizes.** At 1440×900 the last visible column is gnomAD AF; at 1280×720 it is ClinVar. Carriers, Cohort Freq and Het/Hom need horizontal scroll (table 2,092 px in a 1,150 px viewport; measured, 100-*). At 390 the row shows only Gene and Impact, so the locus is not visible (100-cohort-390x844). | Fixed widths plus a clinical-first order that puts cohort metrics last | In the cohort, place Carriers, Cohort Freq and Het/Hom right after Gene, before ClinVar. Under 600 px keep Chr:Pos as a combined sticky column. |
| C-P2-9 | Cohort → case | **"View in Case" loses the variant.** It opens `case?case=1&tab=shortlist`, which shows "No variants matched the shortlist filters" (32). The variant is neither selected nor searched, and **Back does not return** to the cohort (URL unchanged after `goBack`). | Navigation uses `router.replace` and passes no variant | `router.push({ path:'/case', query:{ case, tab:'snv', q:'chr:pos' } })` and select the row. |
| C-P2-10 | Gene burden | **Results and warnings use internal language.** Warnings render as raw codes (`AP1B1: FIRTH_CONVERGE_FAIL`, `APOE: ZERO_BURDEN`) in a red error banner while Fisher was the chosen test (26). "55 genes tested" sits next to a "69 genes" table (23), where zero-variant genes sort first in an ascending q-value sort. Fisher OR is "–" while its 95% CI is shown (0.113–220.637). The test runs with no qualifying-variant filter, so it includes common intronic variants, with no warning. The volcano plot is empty, with every point at 0,0 (24). | `AssociationResultsTable.vue` / `GeneBurdenView.vue` | Map warning codes to sentences and use warning (amber) severity. Show "14 genes had no qualifying variants (hidden)" and sort nulls last. Hide the CI when OR is undefined. Nudge or require a rarity/impact filter before Run. |
| C-P2-11 | Gene burden | **Run Analysis is disabled with no stated reason** (20). Hover shows no tooltip. Prior finding, still open. The overlap check (21) is now good. | `AssociationConfigPanel.vue:241` | Show the reason inline next to the button ("Select ≥ 1 case in each group"). |
| I-P2-1 | Import | **Upload errors show raw transport text and JSON:** `web upload: 400 Bad Request: {"error":"unsupported-file-type","message":"Only VCF, JSON…"}` (43). The message does not name the file. | `src/web/client/uploads.ts` throws the raw response | Show the `message` field only, plus the file name: "not-a-vcf.txt: only VCF, JSON, BED, GZIP and ZIP files are supported." |
| I-P2-2 | Import (batch) | **One bad file aborts the whole batch.** The files that did upload are deleted (`DELETE …ref=` 204 × 2) and the same unnamed raw error appears (47 before fix). | Batch upload is all-or-nothing | Upload each file on its own, list the rejected file as an error row in Review, and continue with the valid ones. |
| I-P2-3 | Import | **The preview claims "Auto-detected from VCF header" when nothing was detected.** For a header-less VCF (`detectedGenomeBuild: null`) the field silently shows GRCh38 under that hint (44). A wrong build means wrong gnomAD/UCSC links and liftover assumptions. | `VcfPreviewStep.vue:38` hard-codes the hint | When the build is null, show "Not detected — defaulted to GRCh38. Confirm before importing." in warning colour. |
| I-P2-4 | Import | **Single import does not check names; batch does.** The batch calls `batchImport/checkDuplicates` and shows NEW badges. In single and multi-sample import, typing an existing name (`HG002-VEP-panel`) or clearing the name produces no message, and the Import button stays enabled (42-dup-name, 42-empty-name). Duplicate names make the sidebar ambiguous, which is a wrong-case risk. | `VcfPreviewStep.vue` has no rules on case-name fields | Reuse `checkDuplicates` for each sample name. Require a non-empty name. |
| I-P2-5 | Import | **There are two import entry points with different mental models:** "Import Data" (single, multiple, folder or ZIP; each file becomes a case) and "Import VCF Files — Multi-file case (SNV + SV + CNV + STR)", which merges files into one case (50). Nothing explains the difference at the point of choice. | AppToolbar settings menu | Merge them into one dialog with a first question: "One case per file" or "Several files for one case". |
| S-P2-1 | Account | **After sign-out, Back renders a broken app shell** instead of the login page: "Cohort (0 cases)", Genome Build "undefined (undefin…", "No database", banner "cohort queries is unavailable until feature availability has loaded", and 14 × 401 errors (79). No data is exposed. | No 401 → login redirect in the web client bootstrap | On any 401 from `/api/*`, redirect to `/login?next=`. Send `Cache-Control: no-store` on the SPA shell. |
| S-P2-2 | Admin | **Create User reports the wrong reason.** With a 5-character password, the button stays enabled and the server error reads "Username, name and password are required." (82). The real rule is "at least 12 characters". | `auth/createUser` maps every invalid payload to one message; the form has no `minlength` rule | Add a client rule `v.length >= 12`, and give `password-too-short` its own server message. |
| S-P2-3 | Theme | **Theme flash for dark-OS users at sign-in.** The login page is forced light (`login.html:14,59`, `color-scheme: light`). Its comment says the app "ships no theme switch", which is no longer true. The app then resolves `warmDark`. Measured: body `rgb(240,244,248)` at 0–436 ms, then `.v-application` `rgb(18,20,26)`. The `<body>` stays light underneath (s30). Prior finding, still open, now in the reverse direction. | `src/web/login/login.html`; body background not themed | Let `login.html` honour `prefers-color-scheme` and the stored `themePreference`. Set the `body` background from the resolved theme before mount. |
| S-P2-4 | Theme (dark) | **The dark app bar is a large light fill:** `primary #7BAED4` across the full 48 px bar (72, 73). It is the brightest surface on screen, which causes glare in long sessions (eye-comfort guidance). | `plugins/vuetify.ts` warmDark `primary` used as the app-bar colour | In dark mode, give the app bar `surface-bright` and keep `primary` for accents. |
| X-P2-1 | Dialogs | **Focus is not returned to the trigger.** After Esc on Database Overview, External Links, Tags, Gene Panels, External lookups or Preferences, `document.activeElement` is `BODY` (s21). Prior finding, still open. | Vuetify dialogs opened from menu items lose their activator | Store the trigger element and `focus()` it on `afterLeave`, or use `v-dialog :activator`. |

### P3

| ID | View | What | Fix |
|---|---|---|---|
| C-P3-1 | Cohort | Position text is truncated mid-number (`156,134,600...`) at 9 digits (02), with no tooltip. | Size the Position column for 11 characters in tabular numerals, or apply the existing HGVS truncation-with-tooltip rule. |
| C-P3-2 | Cohort | The Columns drawer files CADD, Carriers, Cohort Freq and Het/Hom under **"External Links"** (16). | `config/columnGroups.ts:15-50`: add `cadd_phred` to `scores` and a `cohort` group for `carrier_count`, `cohort_frequency` and `het_count`. |
| C-P3-3 | Cohort | Default sort is carriers descending, but no header shows a sort indicator, and the Carriers column is off-screen at 1440 (`postgres-cohort-summary-query.ts:51`). | Show the sort arrow on Carriers by default. |
| C-P3-4 | Cohort | Two "Carriers" header labels: the expand column's accessible name and the real column. | Rename the expand header "Show carriers". |
| C-P3-5 | Cohort | The quick-filter tooltip stays visible after a click ("HIGH impact variants only" over the filter bar, 06, 29). | Use `open-on-click=false` / `:close-on-content-click`, or hide the tooltip on click. |
| C-P3-6 | Cohort | Filter-drawer differences from the case view: there are no Tags or Inheritance sections, the label is "gnomAD AF 1%" instead of "Frequency ≤ 1%", the sections come in a different order, and the in-drawer search placeholder ("Gene, position, HGVS…") differs from the toolbar's (14 vs case). | Share section definitions. Where a filter does not apply to cohorts, show it disabled with a reason rather than dropping it. |
| C-P3-7 | Cohort | The sidebar "Cohort" combobox shows "No data available" with no hint on how to create a cohort group (121). | Empty state: "Assign cases to cohorts in Case metadata → Cohorts". |
| C-P3-8 | Cohort | Expanded carrier rows: the Case and Zygosity columns are far apart. With the corrupted gate fixture, the zygosity chip shows a raw code ("2") (08). | Put zygosity next to the case name and always use the Het/Hom label. |
| I-P3-1 | Import | The empty footer band under the source cards is still there (40, prior). The preview step never names the selected file (41-b). | Remove the empty `v-card-actions`. Show the file name in "File Information". |
| I-P3-2 | Import | The summary has no "Open case" action (42-c-8000ms). The batch Review step allows no per-file rename, only a cryptic unlabelled "Remove from names" field (47). | Add an "Open" link on each succeeded row. Make batch names editable in place and label the field "Strip text from case names". |
| I-P3-3 | Import | An unannotated VCF imports with only an "Unannotated" chip (45). Impact, gene and shortlist will be empty. | Show a one-line notice: "No VEP/SnpEff annotation — impact filters and shortlist will be empty". |
| S-P3-1 | Prefs | "Display Name — Used for audit trail" is empty and separate from the account's display name ("UI Gate Admin", 65). Prior finding, still open. | In web mode, hide the field or show the account name read-only. |
| S-P3-2 | Menus | "External lookups" appears in both the settings menu and the account menu. "VarLens Web" opens a menu containing only `web:postgres` (prior finding, still open). | Keep one entry, in Settings and admin-only. Turn the "VarLens Web" chip into About (version, edition, licence, intended use). |
| S-P3-3 | Settings | Reset Columns and Reset Filters run immediately with no confirm and no undo (`App.vue:252-258`, SUSPECTED by code). | Snackbar with an Undo action. |
| S-P3-4 | Tags | The Add Tag form shows "Tag name is required" before any input (87a). | Validate on blur or submit. |
| S-P3-5 | Burden @ 390 | Group A and Group B stay side by side, and words break mid-token ("Sel / ect all", "audit- / import-trio-2"; 102). | Stack the groups below `sm` and use `word-break: normal`. |
| A-P3-1 | About | "About" is only the version button: "VarLens v0.83.0 · Web edition". Licence, intended use and the disclaimer are separate icons. The disclaimer itself is clear ("Research Use Only… Not for Diagnostic Use"). | One About sheet that holds version, edition, licence and the intended-use statement, with a link to the disclaimer. |

---

## 3. Case ↔ cohort parity matrix (project rule: must match)

| Aspect | Case view | Cohort view | Status |
|---|---|---|---|
| Free-text search | works, chip shown | works, chip shown (P0-4 fixed) | ✅ |
| DSL search chip in applied bar | missing | missing | ❌ both (C-P1-1) |
| Invalid DSL | applied, 0 results | silently dropped, all results | ❌ divergent (C-P2-4) |
| Quick presets (9) and ACMG chips | same 9 + P/LP/VUS/LB/B | same | ✅ |
| Filter drawer sections | + Tags, + Inheritance, "Frequency ≤ x%" | no Tags/Inheritance, "gnomAD AF x%", + custom % field | ❌ (C-P3-6) |
| Columns drawer groups | CADD under Scores | CADD and cohort metrics under "External Links" | ❌ (C-P3-2) |
| Default visible columns | Transcript visible | Transcript hidden | ❌ minor |
| Cell formatting (SO term, transcript, HGVS, empty glyph) | humanised, unversioned, `--` | raw, versioned, blank | ❌ (C-P2-5) |
| SV/CNV/STR columns | type-specific | SNV columns | ❌ (C-P2-1) |
| Keyboard `/`, Ctrl+Shift+F/X, Alt+Shift+C | work | dead | ❌ (C-P2-2) |
| Esc closes drawers | no | no | ❌ both (C-P2-3) |
| Default sort | chr, pos | carriers desc (unmarked) | ⚠ intentional, unlabelled (C-P3-3) |
| URL state (`?f=` etc.) | yes | yes (`/cohort?f={"i":["HIGH"]}` survives reload) | ✅ |
| Row identity / star / ACMG / comment actions | present | present | ✅ |

---

## 4. Nielsen heuristics (this area, 0–4)

| # | Heuristic | Score | Evidence |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Import progress is determinate and the summary is clear. But the applied-filter bar hides DSL filters (C-P1-1), the denominator mixes types (C-P2-6), and the burden summary contradicts its table (55 vs 69). |
| 2 | Match with the real world | 2 | Raw codes (`FIRTH_CONVERGE_FAIL`, `intron_variant`), "Remove from names", "cohort queries is unavailable…". The "Auto-detected" genome build claim is false when nothing was detected (I-P2-3). |
| 3 | User control and freedom | 3 | Logout, theme control and the tag-delete confirm all exist now. But Esc does not close drawers, Back after View in Case is broken, and Reset has no undo. |
| 4 | Consistency and standards | 1 | Parity matrix: 9 divergences. Two import entry points, External lookups listed twice, different HGVS strings for the same variant. |
| 5 | Error prevention | 2 | Burden overlap check and type-DELETE confirm are good. Duplicate or empty case names are accepted, ragged JSON rows are accepted (I-P1-1), and the create-user form allows a short password. |
| 6 | Recognition rather than recall | 3 | Presets, a grouped settings menu and good External-lookups copy ("Sends: … To: …"). DSL errors are hover-only. |
| 7 | Flexibility and efficiency | 2 | Shortcuts are dead in the cohort, View in Case drops context, and batch rows cannot be renamed. |
| 8 | Aesthetic and minimalist design | 3 | Calm and dense. Duplicated menu entries, an empty import footer band, and a glaring dark app bar. |
| 9 | Recognise, diagnose, recover from errors | 2 | Raw JSON upload errors that do not name the file, the batch aborts as a whole, and the create-user reason is wrong. Duplicate-user and password-mismatch messages are good. |
| 10 | Help and documentation | 2 | Clear disclaimer and the shortcut sheet is reachable by `?`. But the FAQ is false for web (F-P1-1) and the sheet does not hold for the cohort. |
| | **Total** | **22 / 40** | Prior global 20/40 |

---

## 5. Prior audit (2026-10-06) — status of findings in this area

| # | Prior finding | Status | Evidence |
|---|---|---|---|
| 1 | P0-3 case table stuck on skeleton after Cohort → case B, filter leaks | **FIXED** | s08: case B issues `variants/query`, no HIGH chip leaks (30, 31) |
| 2 | P0-4 cohort search is a no-op | **FIXED** | s03: `search_term:"LMNA"` sent, 3 results, chip shown (03) |
| 3 | Cohort shows raw SO terms, case humanises | **STILL OPEN** | s71: `intron_variant` vs `intron variant` (C-P2-5) |
| 4 | Column order differs case vs cohort | **FIXED** | Same clinical-first order (`useCohortColumns.ts:9-31`) |
| 5 | Star/comment icons overlap the "P" pill | **FIXED** | Not reproducible (02) |
| 6 | 53 targets < 24 px in cohort | **FIXED** | axe target-size: 0 serious/critical |
| 7 | Gene Burden Run disabled with no reason | **STILL OPEN** | 20 (C-P2-11) |
| 8 | Same case allowed in both burden groups | **FIXED** | Overlap alert (21) |
| 9 | One Gene Burden call per case | **FIXED** | One `cohort/runAssociation` request |
| 10 | Cohort ~1.3 s to first page | **FIXED** | 28 ms case → cohort toggle |
| 11 | Clear sends 2–5 requests / double reload | **FIXED** | One query + one allowed next-page prefetch |
| 12 | Import dialog empty footer band; Folder/ZIP in browser | **STILL OPEN** | 40 (I-P3-1) |
| 13 | Worker Threads shown in web Preferences | **FIXED** | 65 |
| 14 | Display Name duplicates the logged-in user | **STILL OPEN** | 65 (S-P3-1) |
| 15 | No theme control | **FIXED** | Account menu + Preferences: System/Light/Dark, persists in localStorage, follows OS |
| 16 | Dark theme broken (footer invisible, toggle 1.9:1) | **FIXED** | axe 0 serious in dark on 11 states |
| 17 | Theme flash at login → app | **STILL OPEN** (reversed) | Light login → dark app (S-P2-3) |
| 18 | User management unreachable | **FIXED** | Account → User management. Create, duplicate check, reset password, disable (80–84) |
| 19 | No logout | **FIXED** | Account → Sign out (78). Back-after-logout issue is new (S-P2-1) |
| 20 | About reads "Electron vweb" | **FIXED** | "Web edition" (91-footer-version) |
| 21 | Dialogs don't return focus to the trigger | **STILL OPEN** | X-P2-1 |
| 22 | "VarLens Web" menu only shows `web:postgres` | **STILL OPEN** | 52 (S-P3-2) |
| 23 | Esc doesn't close drawers despite the shortcut sheet | **STILL OPEN** | C-P2-3 |
| 24 | Search appears twice with different placeholders | **STILL OPEN** | C-P3-6 |
| 25 | Lingering tooltip after a click | **STILL OPEN** | 06, 29 (C-P3-5) |
| 26 | Chip wall wraps at 390 px | **STILL OPEN** (improved: 3 rows, was 4) | 100-cohort-390x844 |

**Counts: 14 FIXED · 12 STILL OPEN · 0 REGRESSED.** The sign-out shell (S-P2-1) and the false FAQ claims (F-P1-1) are new findings, not regressions: the web features they relate to did not exist before.

---

## 6. What works (keep)

- **Cohort core loop:**
  - Search, presets, sort and paging send exactly one query each.
  - URL state survives reload.
  - Carriers expand inline with zygosity.
  - The case → cohort switch is instant with zero shift.
- **Burden configuration:** overlap detection; denominators shown as chips (Group A: 2 / Group B: 2); plain-language assumptions ("Samples without a stored call are treated as reference…", "7 qualifying variants were left out because they are not on chromosomes 1–22").
- **Import:**
  - Multi-sample selection with a case name per sample and a live "Import 2 samples" label.
  - Determinate batch progress.
  - Duplicate check in batch.
  - Fast imports (1,585 variants in 151 ms server time).
- **Admin:**
  - The External lookups screen is a model of data-flow transparency: what is sent, to which host, and last changed by whom.
  - User creation enforces a temporary password and shows a "Must change password" badge.
  - Your own role is locked against change.
- **Destructive actions:** Delete All Cases requires typing DELETE and states the count (16 cases). Tag delete checks usage first.
- **Accessibility:** 0 serious/critical axe issues across all 22 audited states in both themes. The dark palette passes contrast.

## 7. Not verified / limits

- INP was not measured for this area; CLS was (see §1). Imports finished in under 1 s, so live progress, cancel and the ImportStatusBar chip could not be observed mid-run. They were checked in code (`ImportStatusBar.vue:8-34` is determinate and has a Cancel button).
- Folder and ZIP sources, cohort Export downloads, and logistic burden were not exercised.
- I did not sign in as `audit-user`, because the first sign-in forces a password change.
- Screen-reader output was inferred from DOM/ARIA (axe), not from NVDA or Orca.
