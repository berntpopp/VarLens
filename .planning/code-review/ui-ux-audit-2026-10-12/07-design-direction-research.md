# 07 — Design Direction: Dense, Legible, Learnable

- **Date:** 2026-10-12 · **Type:** desk research and design direction. The app was not tested for this document; other audit files cover that.
- **Hard constraint (product owner):** VarLens stays **information-dense** and must work at **1280×720 and in split screens**. Nothing here recommends larger text or larger controls. The question is how the best dense tools stay legible, calm and learnable at small sizes.
- **Scoring tie-in:** the numbers below are meant to satisfy `01-evaluation-schema.md` D1 (≥ 25 rows at 1080p in compact density, no horizontal scroll for the default columns at 1440) and D2 (dense table text ≥ 12 px, tabular figures, monospace HGVS, ≤ 3 sizes and 2 weights per view).
- **Evidence quality:** most clinical-vendor material is self-reported (help centres, brochures, webinars). Independent usability studies of these products barely exist; where I describe a product from general domain knowledge rather than a source, I mark it *(domain knowledge)*.

---

## 0. Code facts that shape this direction

Read from the worktree (`src/renderer/src`), not from the running app:

| Fact | Where | Consequence |
|---|---|---|
| Global `density: 'compact'`, no ripple, tooltips with a 400 ms open delay and `eager: false` | `plugins/vuetify.ts` | The density foundation is already right. What is missing is a *spec* for type, rows and color roles on top of it. |
| **No UI font is bundled.** Vuetify falls back to `var(--v-font-body, "Roboto", sans-serif)`. The boot splash uses `system-ui`. | `node_modules/vuetify/lib/styles/main.css`, `index.html` | On Windows without Roboto, text renders in **Arial**; on Linux in whatever `sans-serif` resolves to (often DejaVu Sans, which is much wider). Density, truncation and row fit differ per OS. That is the single largest legibility risk at small sizes, and it is invisible on a developer's Mac. |
| HGVS and allele cells use **`'Courier New'`** at `0.85em` | `assets/styles/table-cells.scss` | Courier New has thin strokes and a small x-height. At ~11 px it is the least legible monospace available. A `--font-mono` token (`ui-monospace, SFMono…`) already exists in `custom.css` but the table cells do not use it. |
| Ad-hoc `!important` size overrides (0.875 / 0.8125 / 0.6875 / **0.625 rem**) | `assets/styles/custom.css` | There is a de facto type scale, but it is undocumented and includes 10 px menu subheaders, which sit below the floor in §2.1. |
| A keyboard map exists (↑/↓, Enter, Esc, `s`, `c`, `a`, `e`, `/`, `?`) | `components/KeyboardShortcutsDialog.vue` | Shortcuts exist but are only discoverable through `?`. There is no command palette. Shortcut discovery (§4) is cheap to add. |
| `@vueuse/core` 15 is installed | `package.json` | `useElementSize`, `useStorage` and `useMagicKeys` cover container-width layout, persisted preferences and palette keys without new dependencies. |

---

## 1. Comparable products — what to steal, what to avoid

### 1.1 Clinical and genomics tools

| Product | Density and triage loop | ACMG and evidence UI | Learnability | Steal | Avoid |
|---|---|---|---|---|---|
| **Franklin (Genoox)** | Case → ranked variant list → variant page with tabs. | Classic tab shows each rule's score and explanation, editable in a popup (met/unmet, points). The newer **guided Variant Curation Interface** groups criteria into sections; each criterion is met/unmet/N/A with a strength level and a curator note, and the **suggested class recalculates live** from the met rules [1][2]. Supports classification per condition. | Video tutorials, community forum [3]. | Live class preview from criteria; section grouping of criteria; per-criterion strength and note. | Popup-per-rule editing (context loss); engine verdict shown as the default and easy to rubber-stamp. |
| **VarSome / VarSome Clinical** | Single-variant page with a very long card stack; the clinical edition adds case lists. | Automated ACMG with per-criterion explanations, used as a basis that labs then modify [4]. | Low: the variant page is self-explanatory because every card states its source. | **Every value carries its source and the rule that used it.** | Very long scroll for one variant; card-per-database layout repeats chrome. |
| **Emedgene (Illumina)** | AI-ranked candidates first. | **Evidence graph** linking disease ↔ gene ↔ inheritance ↔ phenotype ↔ variant, with each edge linking to its source [5][6]. | Explainability is the selling point. | "Why is this ranked here" as a visible, traceable chain. | A graph as the primary evidence view is slow to scan; a ranked list with reasons is faster. |
| **Moon (Diploid)** | Automated phenotype-driven ranking; separate **Filter view** for manual review outside the pipeline. **Reanalysis highlights cases whose top-5 changed** [7]. | Human review is mandatory per intended use [7]. | Autopilot reduces the first-run burden. | Highlight what changed since last time (re-annotation, new import). Separation of "ranked" and "manual filter" modes. | Black-box ranking without an explanation next to each rank. |
| **Alissa Interpret (Agilent)** | **Classification trees**: users drag filter components into a decision tree per indication [8]. | Lab-configured. | Steep; configured by a lab specialist, used by many. | Filter logic as a visible, named, ordered pipeline that one person curates and everyone else reuses. | Building the tree is an expert-only task. |
| **Golden Helix VarSeq** | **Filter chain**: an ordered stack of filter cards narrows the list; saved and re-applied to new runs [9]. Each card shows how many variants remain *(domain knowledge)*. | ACMG in VSClinical as a guided form *(domain knowledge)*. | Templates per panel. | **Per-step remaining counts** are the best "why did my list shrink" explanation in the category. | Desktop-heavy chrome; many floating windows. |
| **QCI Interpret (QIAGEN)** | Computed classification for every variant "with full transparency" [10]. | Computed criteria with reasoning. | Vendor-curated content reduces curation work. | Show the computed reasoning inline, not behind a click. | Marketing that "eliminates curation" encourages over-trust. |
| **seqr (Broad)** | Project → family page → variant search with **predefined searches that can be customized** [11][12]. Results are gene-variant pairs with interpretation fields inline. | Tags and notes, collaborative. | Predefined searches are the onboarding. | Named, documented starter searches ("De novo/dominant", "Recessive") as the first thing a new user clicks. | Long, multi-section filter form. |
| **Fabric Genomics** | AI-ranked (ACE/GEM) candidate list *(domain knowledge)*. | Guided ACMG *(domain knowledge)*. | — | Score with a one-line rationale. | Opaque score. |
| **Geneyx** | Case dashboard + table with presets *(domain knowledge)*. | ACMG auto-suggest *(domain knowledge)*. | — | Preset-first entry. | Many top-level tabs. |
| **ClinGen VCI** | Expert-panel curation, not triage [13]. | Criteria organised by **evidence type** (population, computational, functional, segregation…), each with the data that justifies it, plus peer review [13]. Open source (MIT). | Documented SOPs. | Criteria grouped by evidence type next to the data that supports them; **provisional → approved** state. | Not built for speed over hundreds of variants. |
| **gnomAD browser** | Gene → region → variant pages, dense but quiet tables; dataset toggle on every page [14]. Users' top complaint is **slow loading** (11 % of respondents) and they ask for exon numbers and more links out [15]. | n/a | Plain tables, consistent column semantics. | Quiet tables, colour only for consequence class; a dataset selector that is always in the same place. | Latency (temporal density matters more than layout). |
| **cBioPortal MutationMapper / ProteinPaint** | Lollipop on domain track; lollipop height = count, colour = consequence; ProteinPaint adds subtype breakdowns [16]. MutationMapper is population-oriented, not individual-variant oriented [16]. | n/a | Hover = full detail; click = filter the table. | **Linked brushing**: hover a lollipop → highlight table rows, and back. One consequence colour scale shared by plot and table. | Legend-only meaning; tiny overlapping heads. |
| **IGV / igv.js** | Track stack; extremely dense, but every track has a name column and a consistent height. | n/a | Expert tool. | Fixed left label gutter, uniform track height, keyboard pan/zoom. | Unlabeled colour encodings. |
| **DECIPHER** | Genome-browser + patient-phenotype pages *(domain knowledge)*. | Pathogenicity + contribution fields. | — | Phenotype overlap shown as matched/unmatched HPO terms. | Small-text grey labels. |

**Synthesis for VarLens:** the category's best ideas are (a) a **live, explainable ACMG preview** (Franklin VCI, ClinGen VCI), (b) **per-step filter counts** (VarSeq), (c) **named starter searches** (seqr), (d) **"what changed"** highlighting (Moon), and (e) **source on every value** (VarSome). None of them depends on large type.

### 1.2 Dense non-clinical tools

| Tool | What makes it dense *and* legible | Steal for VarLens |
|---|---|---|
| **Bloomberg Terminal** | "Conceal complexity": consistent workflow across thousands of functions; even a font change or a moved button is disruptive to experts [17]. Its real strength is near-instant loading (temporal density) [18]. | Stability of layout is a feature. Change chrome rarely, and keep the table's position constant. Prioritise latency over adding more on screen. |
| **Linear** | 2024 redesign raised density of navigation while cutting visual noise; the later refresh **dimmed the sidebar so content dominates**, compacted tabs, softened borders; themes generated in **LCH** for consistent perceived contrast [19][20]. | Quiet chrome, loud data. Sidebar a few notches dimmer than the table. Generate themes perceptually. |
| **Superhuman** | Cmd+K palette shows each action's shortcut on the right; **nudges the shortcut after a mouse action**; hover on any icon reveals its key [21]. | Shortcut in every tooltip and menu row; a one-time nudge after a mouse action. |
| **Raycast / command palettes** | One entry point that searches actions, entities and settings. | `Ctrl+K` over actions, cases, presets, columns, settings. |
| **Grafana / Datadog** | Panel headers with an info icon carrying the metric's definition; time range and filters always visible; "no data" explains the query. | Column-header info with definition and thresholds; explain-why empty states. |
| **Airtable / Notion databases** | Saved views (filter + sort + columns + density) as first-class, named tabs; row height setting per view. | Presets should save columns and density, not only filters. |
| **AG Grid / Glide Data Grid** | Compactness is a single `spacing` parameter from which all padding derives; row height is separate from font size [22]. Glide renders to canvas for millions of rows. | One `--vl-row-h` / `--vl-cell-px` token pair instead of per-component overrides. Keep server pagination (§6.4). |
| **Excel / Sheets** | Freeze panes, column resize, right-aligned numbers, conditional formatting. | Frozen identifier column, right-aligned numerics, colour scales only on score columns that need them. |
| **IBM Carbon data table** | Row sizes 24/32/40/48/64 px; header matches row; toolbar height matches size; zebra optional; ≤ 5 toolbar actions then overflow; titles 1–2 words, wrap then truncate with tooltip; expansion for slow or supplementary data, no expand-all by default [23][24]. | The size ladder and the toolbar rule (§2.3, §3). |
| **Figma UI3** | Collapsible, resizable side panels; property panels with 11 px labels and 12 px values; minimised UI mode. | Resizable details panel with remembered width; panel sections that collapse. |

---

## 2. "Dense but legible" spec for VarLens

### 2.1 Type families

| Role | Family | Why | Delivery |
|---|---|---|---|
| UI and data | **Inter Variable** (fallback `system-ui, 'Segoe UI', Roboto, sans-serif`) | Tall x-height; tabular figures; designed for screen UI with hinting choices that keep stems sharp at ~11 px [25]; one variable file covers 400–600. IBM Plex Sans is the alternative if a more "clinical/technical" voice is preferred. | Bundle locally (offline app): `@fontsource-variable/inter`, Latin subset only. Set `--v-font-body` and `--v-font-heading`. |
| HGVS, coordinates, IDs, alleles, DSL | **JetBrains Mono** or **IBM Plex Mono** (fallback the existing `--font-mono`) | Large x-height, clear `0/O`, `1/l/I` and `*` glyphs; legible at 12 px. Replace Courier New. | Bundle one weight (400) + 600 if needed. Use `--font-mono` everywhere, including `table-cells.scss`. |
| Numbers | Inter with `font-variant-numeric: tabular-nums` | Columns of AF, CADD, depth, positions align. | Apply on `.v-table` cells globally, not per class. |

Rule: **two families, two weights per view** (400 and 600). 500 only where Vuetify components use it internally.

### 2.2 Type scale (px / line height / weight / tracking)

| Token | Size | Line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `--vl-fs-title` | 15 | 20 | 600 | -0.005em | View titles, panel title (gene + HGVS) |
| `--vl-fs-body` | 13 | 18 | 400 | 0 | Table cells, panel values, menu items (current `0.8125rem`) |
| `--vl-fs-mono` | 12.5 | 18 | 400 | 0 | HGVS and coordinates; mono sets visually large, so 0.5 px smaller than body |
| `--vl-fs-meta` | 12 | 16 | 400 | +0.005em | Secondary values, sub-lines, footers, tooltips |
| `--vl-fs-label` | 11 | 14 | 600 | +0.04em, uppercase allowed (≤ 3 words) | Section labels, column-group labels, chip text |
| **Floor** | **11** | — | **≥ 600 if 11 px** | — | Nothing a user must read goes below 11 px. The existing 10 px (`0.625rem`) menu subheaders move to the 11 px label token. |

This maps to Fluent 2's web ramp (Caption 1 12/16, Body 1 14/20, Caption 2 10/14) [26] and Vuetify 4's MD3 `body-small` 12/16 and `label-small` 11/16 [27], but one step tighter at the body level, which is the point of a dense product. Prose (FAQ, help, ACMG criterion descriptions over two lines) uses 13/20.

### 2.3 Row heights and densities

One token pair drives every table, list and menu (AG Grid's "spacing" approach [22]):

| Density (user setting) | Row | Header | Cell padding x | Toolbar | Rows visible in the table body at 1080p* / 720p* | Reference |
|---|---|---|---|---|---|---|
| **Compact (default)** | **28 px** | 28 px | 6 px | 32 px | ~27 / ~13 | Between Carbon xs (24) and sm (32) [23] |
| Standard | 32 px | 32 px | 8 px | 36 px | ~24 / ~12 | Carbon sm, SAP Fiori compact (2 rem) [23][28] |
| Comfortable | 40 px | 36 px | 12 px | 40 px | ~19 / ~9 | Carbon md |

\*Assuming ~320 px of app chrome, toolbar, preset bar and footer at 1080 p, and ~360 px at 720 p.

- Font size **does not change** with density (SAP Fiori rule: compact shrinks controls and spacing, not text [28]). Only padding and row height change.
- Vuetify's own compact `v-data-table` row is about 36 px; set the row height explicitly through a CSS variable on the table rather than relying on the density prop.
- Header row equals row height (Carbon [23]). Column titles are 1–2 words; wrap to two lines at most, then truncate with a tooltip.
- Two-line rows (for example gene + transcript sub-line) are allowed only in Comfortable.

### 2.4 Contrast targets

| Text | Size/weight | WCAG 2.x target | APCA target (guidance) | Current token |
|---|---|---|---|---|
| Primary data (cell values, HGVS) | 12.5–13 px / 400 | **≥ 7:1** | Lc ≥ 90 preferred for small body text [29][30] | `on-surface` #1A1D23 on #FAFBFD ≈ 16:1 — keep |
| Secondary / meta | 12 px / 400 | ≥ 4.5:1, aim 5.5:1 | Lc ≥ 75 | `muted` #5C6370 ≈ 5.8:1 — keep, but **do not** use it at 11 px |
| Labels | 11 px / 600 | ≥ 7:1 | Lc ≥ 75–90 (small and heavy) | Use `on-surface` at 0.7 medium emphasis, not `muted` |
| Disabled, placeholder | any | exempt but ≥ 3:1 so users can read it | Lc ≥ 30–45 (spot text) | — |
| Meaningful non-text (input borders, focus ring, selected row edge, chart marks) | — | ≥ 3:1 (1.4.11) | Lc ≥ 45 | Focus ring = `primary`, 2 px |
| Decorative dividers, row rules | — | none; keep ~1.2–1.5:1 | Lc 8–15 | Hairline `rgba(on-surface, 0.08)` |

APCA Bronze sets no minimum font size [29], but its lookup tables require markedly higher contrast as size drops [30]; at 11–13 px the practical rule is: **small text gets near-maximum contrast, and size is never traded for grey.** Grey-on-grey (muted text on a grey-lighten-3 band) is the most common legibility failure in dense apps — avoid putting `muted` text on any tinted background.

### 2.5 Color roles

| Role | Rule |
|---|---|
| **Chrome** (app bar, sidebar, toolbars, borders) | Neutral, hue-free or slate-tinted, **quieter than the data**: sidebar background one step darker than the table surface, sidebar text at medium emphasis (Linear [20]). No saturated colour in chrome except the selected item and primary action. |
| **Primary** | Selection, focus, the one primary action per surface, links. Never used to mean clinical significance. |
| **Semantic — reserved scales** | Only four scales carry colour in data: **ACMG class** (P, LP, VUS, LB, B), **IMPACT** (`consequence`: HIGH, MODERATE, LOW, MODIFIER), **ClinVar significance**, **zygosity/inheritance** (optional). Each scale is defined once in the theme and reused by table, panel, lollipop and cohort. |
| **Redundancy** | Every colour-coded value also has text or a letter (`P`, `LP`, `VUS`…) and passes deuteranopia simulation; ACMG uses a diverging scale (red ↔ blue/teal) with VUS neutral so "uncertain" looks uncertain, not alarming. |
| **Chips** | Low-saturation tinted background + full-contrast text (≥ 7:1). No white text on mid-tone fills at 11 px. |
| **Score columns** | Monochrome by default; optional threshold tint (e.g. CADD ≥ 20, REVEL ≥ 0.5) as a 2 px left bar or bold weight, not a filled cell. |
| **Dark mode** | Full coverage, including app bar, Mol* canvas background, lollipop SVG and gene-structure tracks. Mol* and other canvases read theme tokens on mount and on theme change. Semantic colours lighten in dark mode (already done in `warmDark`). |

### 2.6 Icons, spacing, hit areas

- **Icons:** 16 px inline and in table rows; 18 px in toolbars; 20 px in the navigation rail. One family (MDI, already used). Icon-only buttons always have a tooltip with label + shortcut.
- **Spacing grid:** 4 px base; allowed steps 2, 4, 6, 8, 12, 16, 24. Between control groups 8 px; inside panel sections 12 px; panel edge 12 px (16 px only in dialogs).
- **Hit areas:** visual size may be 16–20 px, but each interactive target is **≥ 24×24 px** via padding, or satisfies the 24 px circle spacing exception in WCAG 2.5.8 [31]. In-row icon buttons: 24×24 box with a 16 px icon. Toolbar buttons: 28 px tall. The whole row is a click target for selection; in-row buttons stop propagation.
- **Row states:** hover = `rgba(on-surface, 0.04)`; selected = `rgba(primary, 0.10)` + 2 px `primary` left edge (colour plus shape); focused = 2 px outline. **Hairline rules by default, zebra as an option** (Carbon treats zebra as an optional modifier [24]); zebra helps wide tables that need horizontal scanning.
- **Alignment:** text left; numbers right with tabular figures; fixed decimals per column (AF in scientific notation or 4 significant digits, consistently); chips centred only in fixed-width status columns.

---

## 3. Design principles (ranked)

1. **Data loud, chrome quiet.** Data cells get full contrast and the reserved semantic colours; everything else steps back. *VarLens:* dim the sidebar and app bar one step, remove colour from toolbar buttons except the primary action, and put the case identity and the result count ("212 of 1,585") in the strongest type on the page.
2. **Latency is density.** Value per second beats value per pixel [18]. *VarLens:* keep the one-query-per-sort gate and placeholder data; never show a spinner where cached rows can stay visible; give the details panel instant first paint from the row data, then fill async sections.
3. **One type system, bundled.** *VarLens:* bundle Inter + one mono, set `--v-font-body`, replace Courier New, delete the 10 px overrides (§2.1–2.2). Same pixels on Windows, macOS and Linux.
4. **Density is a property of spacing, not of text size.** *VarLens:* the density setting changes `--vl-row-h` and `--vl-cell-px` only. The text stays 13 px in every density.
5. **Every number explains itself on hover.** *VarLens:* column-header tooltip = definition, source, version, threshold (e.g. "REVEL — missense ensemble; ≥ 0.5 supports PP3, ≥ 0.75 strong"), and the active filter on that column. One `columnHelp` record per column in `variant-table/columns.ts`, shared by case and cohort views.
6. **Explain the result set, not just show it.** *VarLens:* the result count is a button that opens "why these rows": active preset + each filter clause with the count it removed (VarSeq-style); zero results show which clause eliminated the most and offer one-click relaxations [32].
7. **Colour means clinical meaning, nothing else.** Four reserved scales (§2.5), each always paired with text. *VarLens:* audit chips and icons so no decorative colour competes with ACMG and IMPACT.
8. **Keep the triage loop on one screen.** Filter → inspect → classify without losing the table position. *VarLens:* `j/k` or ↑/↓ moves the row while the details panel stays open and updates; `a` opens ACMG in the panel (not a modal); after a classification the focus returns to the same row.
9. **Explainable ACMG, live.** Criteria grouped by evidence type next to the data that supports them; the computed class updates while toggling; show *which* combination rule fired ("PVS1 + PM2 → Pathogenic, rule i") and what one more criterion would change [1][13].
10. **Defaults that are a good first answer.** *VarLens:* starter presets named by clinical question ("Rare & damaging", "De novo candidates", "Recessive (hom/compound het)", "ClinVar P/LP"), each with a one-line description and its counts (seqr [11]).
11. **Stable layout, remembered state.** Experts navigate by position (Bloomberg [17]). *VarLens:* the table never jumps; skeletons reserve final row and panel size; panel width, column set, sort, density and last case are restored on launch.
12. **Progressive disclosure inside panels, not behind dialogs.** *VarLens:* panel sections collapse with remembered state; the panel has a sticky summary strip (gene, HGVS p./c., consequence, ACMG, GT, AF) that is enough for 80 % of triage decisions.
13. **Teach the keyboard through the mouse.** Shortcut in every tooltip and menu row; a palette that lists actions with keys (Superhuman [21]).
14. **Same thing, same place, same look.** One component per concept across case and cohort views (columns, chips, header help, empty states). Reinforces the cohort-parity rule.
15. **Truncate honestly.** Ellipsis + full value in a tooltip and in the panel; never break HGVS mid-token; middle-truncate long alleles (`AGCT…TTGA (152 bp)`) so both ends stay visible.
16. **Prefer inline status over toasts.** Import progress, re-annotation and background jobs show in the status bar with a clear end state; toasts only for undoable actions ("Classified as LP — Undo").
17. **Calm acknowledgement, not celebration.** Clinical tone: progress like "34 of 212 reviewed", a quiet check when a case reaches "all candidates classified", never confetti.
18. **Zoom is the user's "make it bigger".** The layout must survive 125–200 % zoom and OS scaling (which is what users with low vision will do), because density is fixed by design. Use `rem`, container-width breakpoints and no fixed pixel heights for text containers.

---

## 4. Learnability and engagement playbook

Ranked by impact ÷ effort. "Effort" assumes the existing Vuetify components and composables; none of these needs a new subsystem.

| # | Feature | Impact | Effort | Lean implementation |
|---|---|---|---|---|
| 1 | **Column header help with thresholds** | High: every user, every session | S | Add `help: { definition, source, thresholds }` to column definitions; render through the existing delegated tooltip (`useDelegatedTooltip`). Case and cohort views share it. |
| 2 | **Explain-why empty and result states** ("0 of 1,585 match *Rare HIGH*, because MAX_AF ≤ 0.001 removed 1,402 and IMPACT = HIGH removed the remaining 183. Try: *include MODERATE* (+41) · *MAX_AF ≤ 0.01* (+12)") | High at the moment of frustration | M | The count per clause is a set of `COUNT` queries with one clause dropped at a time (n clauses → n cheap counts, only when the result is 0 or on demand). Relaxation buttons apply a patched filter state. Reuse `EmptyState.vue`. |
| 3 | **Shortcuts in tooltips and menus + a one-time nudge** | High for speed users | S | Add a `kbd` slot/suffix to tooltips and `v-list-item` append; after a mouse-driven star/comment/ACMG, show a once-per-action hint in the status bar ("Tip: press S"). State via `useStorage`. |
| 4 | **Command palette (`Ctrl/⌘+K`)** | High: one door to everything | M | `v-dialog` + `v-autocomplete` over a static action registry (the same list as `KeyboardShortcutsDialog`) plus cases, presets, columns and settings; `useMagicKeys` for the binding. The shortcut dialog becomes generated from the same registry. |
| 5 | **Starter presets with descriptions and live counts** | High for first runs | S | Presets already exist (`PresetBar.vue`); add a description and lazy counts in the chip tooltip. Ship 4–6 clinical-question presets as defaults. |
| 6 | **Resume where you left off** | Medium-high, daily | S | Persist last case, preset, sort, page, selected variant, panel width and section state with `useStorage`; restore on launch with a quiet "Resumed: Case X" line. |
| 7 | **Live ACMG preview with the firing rule** | High for correctness and trust | M | The classifier exists; show the combination rule that fired and a "+1 criterion would make this LP" hint next to the class. No new data. |
| 8 | **Sample case on first run** | High for evaluation and teaching | S–M | Bundle a small, synthetic or public (GIAB-derived) fixture; an empty-state button "Open the sample case" imports it into a disposable database. |
| 9 | **Review progress per case** | Medium: engagement without gamification | S | "34 of 212 reviewed" from existing tags/classification state; a thin progress bar in the case header; a calm check when all candidates are classified. |
| 10 | **"What changed" badges** (new import, re-annotation, ClinVar update) | Medium | M | Compare a stored snapshot of class/annotation per variant; mark changed rows with a small dot and a preset "Changed since last review" (Moon [7]). |
| 11 | **First-run checklist (dismissible, 4 items)** | Medium | S | Import a case → apply a preset → open a variant → classify one variant. Ticks itself from app events; lives in the home view, never as a modal. |
| 12 | **Coach marks** | Low–medium | S | At most three, each shown once, only on first open of the filter drawer, the DSL search and the ACMG panel. Use `v-tooltip` with `:model-value` and a "Got it". |
| 13 | **DSL inline help** | Medium for power users | S | Autocomplete field names and operators in `DslSearchBar.vue` with examples (`gene:BRCA1 af<0.001`); show the parsed query as chips so users learn the grammar by seeing it. |
| 14 | **Saved views = filter + columns + sort + density** | Medium | M | Extend preset payload rather than adding a new object (Airtable/Notion). |

**Out of scope on purpose:** tours with many steps, achievement badges, onboarding videos inside the app, and AI explanations. They add surface, age badly, or do not fit the clinical tone.

---

## 5. Small-screen layout: case table + details panel

### 5.1 Breakpoints by **container width**, not viewport

Measure the main content area with `useElementSize` (VueUse) and drive layout from that; split screens and an open sidebar then behave correctly. CSS container queries (`container-type: inline-size`) are fine for purely visual changes inside the panel.

| Main area width | Sidebar (case list) | Details panel | Table |
|---|---|---|---|
| **≥ 1400 px** | Expanded 240–280 px | **Push**, resizable 380–560 px, default 440 | Full priority set |
| **1100–1399 px** (1280×720 laptop) | **Auto-collapses to a 48 px rail** when the panel opens; restores when it closes | Push, default 400 px, min 360 | Hide P3 columns automatically; show "+N columns" chip in the header that opens the columns drawer |
| **800–1099 px** (split screen) | Rail; opens as an overlay | **Overlay** from the right, 400 px, table stays scroll-locked underneath; `Esc` closes | P1 + P2 only |
| **< 800 px** | Overlay | **Full-width overlay** with a sticky "Back to list" and ↑/↓ variant stepping | P1 only; secondary values move into a sub-line (Comfortable only) or into the panel |

### 5.2 Column priority

- **P1 (always):** selection/star, Gene, HGVS p. (or c. when no p.), `func` (SO term), `consequence` (IMPACT), ACMG, genotype/zygosity.
- **P2:** gnomAD AF, CADD, REVEL/SpliceAI (one "worst score" column if space is short), ClinVar, depth/quality.
- **P3:** transcript ID, coordinates, ref/alt, remaining scores, tags, comments count.
- **Frozen left:** selection + Gene + HGVS stay sticky during horizontal scroll (`position: sticky` on the first cells), so the row's identity never scrolls away.
- User-set visibility always wins over automatic hiding; auto-hidden columns are listed, not silently dropped.

### 5.3 Details panel anatomy (works at 360 px)

1. **Sticky summary strip** (two lines, ~56 px): Gene · HGVS p. (mono) · ACMG chip / c. · consequence chip · GT · AF. Plus prev/next arrows and the position "12 / 212".
2. **Section index** as a row of 11 px labels (Summary, Transcripts, Scores, ACMG, Evidence, Protein, Notes) that scrolls to sections; sections collapse with remembered state.
3. **Key-value grid** at 13 px with 12 px labels in a 112 px label column; values wrap, HGVS never breaks mid-token.
4. **Viewers** (lollipop, gene structure, Mol*) load only when their section is expanded and visible, render to the panel width, and expand to a full-view dialog on demand.
5. The panel keeps **width, open sections and scroll position** when stepping between variants, so the eye finds the same field in the same place.

### 5.4 Zoom and scaling

At 1280×720 with 125 % OS scaling, the effective viewport is 1024×576. That falls in the split-screen tier above, which is the reason to use container-width tiers: the same rules give a working layout at 125–150 % zoom without a separate code path.

---

## 6. Vue 3 + Vuetify 4 implementation guidance

1. **Global defaults stay the single source of density.** Keep `defaults.global.density = 'compact'` in `plugins/vuetify.ts`; add the row tokens on `:root` (`--vl-row-h`, `--vl-cell-px`, `--vl-fs-*`) and switch them with a `data-density` attribute on `<html>` set from a preference store. Use `v-defaults-provider` only for local exceptions (e.g. comfortable dialogs) [33].
2. **Replace `!important` overrides with tokens.** The overrides in `custom.css` become rules that read `var(--vl-fs-body)` and so on; Vuetify 4's MD3 typography classes (`text-body-small` 12/16, `text-label-small` 11/16) are the fallback vocabulary for one-off text [27].
3. **Semantic theme colours.** Add the four reserved scales as theme colours (`acmg-p`, `acmg-lp`, `acmg-vus`, `acmg-lb`, `acmg-b`, `impact-high`…), defined for `warmLight` and `warmDark`, so `color="acmg-lp"` works on chips and the same tokens feed SVG/canvas through `useTheme().current.value.colors`.
4. **Dark mode for third-party canvases.** Mol*, the lollipop SVG and gene-structure tracks subscribe to the theme name and repaint (Mol* canvas background, label colours). Test the app bar in dark mode explicitly; it is the surface most often left light.
5. **No layout shift.** Skeleton rows have the exact row height token; the panel reserves its width before data arrives; image and canvas containers have fixed aspect boxes; result counts reserve their width with tabular figures (current CLS ≤ 0.02 gates enforce this).
6. **Pagination over virtualization for the case table.** The table is server-paginated with prefetch and an "Auto (fit)" page size; keep that. Pagination keeps a stable mental position ("page 3"), works with the CLS/INP gates and with server sort. Use `v-virtual-scroll` only for long client-side lists (case list, HPO pickers, column chooser).
7. **Preferences in one place.** Density, zebra, sidebar-auto-collapse, panel width, shortcut hints shown, checklist dismissed: one small store persisted with `useStorage`; on the web runtime the same keys work in browser storage.

---

## 7. Suggested sequence (smallest changes first)

1. Bundle Inter + JetBrains Mono, set `--v-font-body`, swap Courier New, define `--vl-*` type and row tokens, remove the 10 px overrides. (Typography debt; low risk, high visible gain.)
2. Column header help + shortcut hints in tooltips. (Learnability with no layout change.)
3. Explain-why empty state with relaxations; result-count popover.
4. Density setting (28/32/40) and zebra option; selected-row edge.
5. Sidebar auto-rail + container-width panel modes; frozen identifier columns; column priority.
6. Command palette from a shared action registry; starter presets with descriptions; resume state.
7. Live ACMG rule preview; review progress; sample case; "changed since" marker.

Each step is independently shippable and testable against `01-evaluation-schema.md`.

---

## 8. Sources

1. Genoox — Variant Classification Interface (guided ACMG classification). https://help.genoox.com/en/articles/14688107-variant-classification-interface-guided-acmg-classification
2. Genoox — Version 93.1 updates (VCI beta). https://help.genoox.com/en/articles/14771154-version-93-1-updates
3. Genoox — Variant interpretation video tutorial. https://help.genoox.com/en/articles/4548752-variant-interpretation-video-tutorial
4. Variant Selection and Interpretation: modified VarSome classifier of ACMG guidelines (Genes 2021). https://pmc.ncbi.nlm.nih.gov/articles/PMC8700904/
5. Illumina — Emedgene software. https://www.illumina.com/products/by-type/informatics-products/emedgene.html
6. IntuitionLabs — Emedgene overview (evidence graph). https://intuitionlabs.ai/software/emerging-specialized-niche-categories/genomic-data-interpretation-and-variant-classification/emedgene
7. Diploid Moon docs — Automated analysis; Reanalysis and Autopilot; Filter view. https://diploid.atlassian.net/wiki/x/HoAI · https://diploid.atlassian.net/wiki/x/OgAJ · https://diploid.atlassian.net/wiki/spaces/MOON/pages/1683881985/Filter+view
8. Agilent — Alissa Interpret datasheet (classification trees). https://www.agilent.com/cs/library/brochures/datasheet-alissa-interpret-5991-8498en-agilent.pdf
9. Golden Helix VarSeq overview (filter chain, saved workflows). https://programs.pacb.com/l/1652/2023-10-18/447jck
10. QIAGEN — QCI Interpret product page. https://www.qiagen.com/products/informatics-and-data/interpretation-content-databases/qiagen-clinical-insight-interpret-for-genereader/
11. Pais et al. — seqr: a web-based analysis and collaboration tool for rare disease genomics (Hum Mutat 2022; medRxiv). https://www.medrxiv.org/content/10.1101/2021.10.27.21265326.full.pdf
12. AI-Enhanced Sensemaking: generative-AI assistant for genetic professionals (arXiv 2412.15444; describes seqr search workflow and sensemaking as the core challenge). https://arxiv.org/abs/2412.15444
13. Preston et al. — ClinGen Variant Curation Interface (Genome Med 2022). https://pmc.ncbi.nlm.nih.gov/articles/PMC8764818/
14. gnomAD — v4.1 updates. https://gnomad.broadinstitute.org/news/2024-05-gnomad-v4-1-updates/
15. gnomAD — 2024 user survey results. https://gnomad.broadinstitute.org/news/2025-08-gnomad-2024-user-survey-results/
16. ProteinPaint (Zhou et al., Nat Genet 2016) and lollipop-tool comparison. https://pmc.ncbi.nlm.nih.gov/articles/PMC4973895 · https://www.news-medical.net/news/20151230/St-Jude-scientists-develop-interactive-tool-to-advance-understanding-of-mutations-that-fuel-pediatric-cancer.aspx
17. Bloomberg — How Bloomberg Terminal UX designers conceal complexity. https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity
18. Matthew Ström — UI density. https://mattstromawn.com/writing/ui-density/
19. Linear — How we redesigned the Linear UI. https://linear.app/blog/how-we-redesigned-the-linear-ui
20. Linear — Behind the latest design refresh. https://linear.app/blog/behind-the-latest-design-refresh
21. Superhuman — Shortcuts and Cmd+K. https://help.superhuman.com/article/478-superhuman-command
22. AG Grid — Theming: compactness. https://www.ag-grid.com/vue-data-grid/theming-compactness/
23. IBM Carbon — Data table style (row sizes). https://carbondesignsystem.com/components/data-table/style
24. IBM Carbon — Data table usage (zebra, toolbar, truncation, expansion). https://carbondesignsystem.com/components/data-table/usage/
25. Inter typeface documentation (features, small-size rendering). https://ctan.org/tex-archive/fonts/inter/doc · https://rsms.me/inter/
26. Microsoft Fluent 2 — Typography (web ramp). https://fluent2.microsoft.design/typography
27. Vuetify — MD3 typography utilities; v4 release notes. https://vuetifyjs.com/en/features/css-utilities/tailwindcss · https://vuetifyjs.com/en/blog/january-2026-update
28. SAP Fiori — Content density (cozy and compact). https://www.sap.com/design-system/fiori-design-web/v1-151/foundations/visual/cozy-compact
29. APCA Bronze simple mode. https://readtech.org/ARC/tests/bronze-simple-mode/
30. APCA-W3 (lookup tables, body-text +Lc 15 rule). https://github.com/Myndex/apca-w3
31. W3C — Understanding SC 2.5.8 Target Size (Minimum). https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
32. Empty-state guidance (attributed to NN/g; explain, suggest fixes, offer next action). https://www.setproduct.com/blog/empty-state-ui-design · https://v5-archive.patternfly.org/components/empty-state/design-guidelines
33. Vuetify — Global configuration and `v-defaults-provider`. https://vuetifyjs.com/en/features/global-configuration
