# 01 — Design re-audit (Assessment A), 2026-10-12 evening

**Build:** origin/main `1d9c2d6c` (PRs #588 #592 #593 #594 #598 merged), web build (`VARLENS_WEB_BASE=/`), gate server on port 8831, schema `reaudit_design_*`, seeded as in the morning run: gate cases a/b/c, HG002 VEP and SnpEff, trio proband, SV, CNV, STR and edge cases (all imported as GRCh38).
**Method:** impeccable critique, Assessment A only, using the same schema as the baseline (`01-evaluation-schema.md`).
- Dimensions D1, D2, D3 and D9–D14, banded 0/25/50/75/100, with the P0/P1 caps. D3 is the worse of light and dark.
- Hands-on headless Playwright at 1440×900 and 1280×720, plus 390×844 for the table, in light and dark theme.
- Three area evaluators used the morning report split (02 case workflow, 03 details/viewers, 04 cohort/import/settings). The full evidence for each area is in the appendices below.
- Product rules applied: density is intentional, the UI is config-driven, and case↔cohort parity is mandatory.

**Caveats:**
- One evaluator per area; the schema asks for at least 2.
- 3D only rendered with `--use-angle=swiftshader`.
- The server could not reach Ensembl, so F-10, F-15 and gene structure in dark mode were not rechecked.
- External lookups were switched on server-wide for short windows and reset each time.
- No screen reader was used, and axe was run only where noted.

## 1. Per-view scorecard (Assessment A): baseline → now

The baseline rows for Details, Gene schema, 3D and Case metadata were recomputed **without D4**, so they are comparable to tonight's dimension set. The numbers originally reported were 43, 44, 50 and 63.

| View | vw | Baseline A | Now A | Δ | Main drivers |
|---|---|---|---|---|---|
| Login + disclaimer | 3 | 87.5 | **83.6** | −3.9 | D12 100→75: login uses system fonts while the app ships Inter |
| Home / case list / shell | 8 | 70.6 | **75.0** | +4.4 | D9 50→75 (sidebar follows Back/Forward, N-01 fixed), D14 50→75 |
| Case variant table | 22 | 54.1 | **63.1** | +9.0 | D9/D10/D11/D12→75 (DSL chips, DSL errors, drawer stays open, Esc). D2 and D13 held at 50 by P1s (N-case-1 AF clipped, R-01 rest); D1 and D3 stay 50 |
| Variant details panel | 16 | 42.5 | **68** | +25.5 | P0 F-01 fixed; ClinVar + GT/DP/GQ/AB/FILTER shown; quick chips locked when evidence exists; heading names the variant; clean HGVS |
| Gene schema / lollipop | 6 | 43.1 | **72** | +28.9 | renders (683 aa); labelled buttons; search; keyboard stepping; variant-of-interest panel; List view; CVD-safe ClinVar (min ΔE 23.9) |
| 3D structure | 4 | 49.5 | **59** | +9.5 | legible dark side panel; still a uniform grey model, variant residue not focused, desktop-only error advice |
| Cohort + gene burden | 13 | 50.4 | **65.9** | +15.5 | DSL chips; cohort shortcuts; parity divergences 9→3 real + 2 cosmetic |
| Case metadata / annotations | 5 | 61.5 | **62** | +0.5 | Sex select and HPO input still stale; Overview tab unreadable |
| Import | 9 | 59.5 | **63.5** | +4.0 | short JSON rows now rejected (I-01 fixed); genome-build confirmation cannot be skipped silently; AF = 40 still accepted |
| Export | 5 | 80.2 | **80.2** | 0 | unchanged |
| Settings / theme / admin | 4 | 71.0 | **75.0** | +4.0 | dark app bar fixed; sidebar header glare remains |
| About / FAQ | 2 | 67.6 | **75.0** | +7.4 | FAQ now describes desktop and web editions correctly (H-01 fixed) |
| Keyboard shortcuts | 3 | 64.1 | **75.0** | +10.9 | header help button, shortcut hints in tooltips, cohort bindings work, Esc closes drawers |
| **Assessment A, vw-weighted** | 100 | **56.6** | **68.1** | **+11.5** | band: needs work → just under acceptable |

For the Assessment A dimensions: there is no open P0, and D13 is ≥ 50 on the case table and the details panel, so neither the P0 cap nor the D13 cap binds. Gates owned by B (D6/D7/D8, CLS, axe) are not assessed here. Two of them are worth noting for B:
- Cohort page-load CLS is 0.0206 (median of 3), just over the 0.02 budget.
- A stale upload chip has an unnamed progress bar, which axe flags as serious on every later view (N-cohort-3).

## 2. Nielsen 10 heuristics (0–4)

| Area | Baseline | Now |
|---|---|---|
| Case workflow (login, shell, table, export, shortcuts) | 24/40 | **32/40** |
| Details, viewers, case annotation | 20/40 | **29/40** |
| Cohort, import, settings, FAQ | 22/40 | **29/40** |
| **Sum (3 areas)** | **66/120** | **90/120** |

Consistency (heuristic 4) is now the weakest heuristic, scoring 2 in the cohort area. The per-heuristic tables are in the appendices.

## 3. Baseline P0/P1 status

| ID | Was | Status |
|---|---|---|
| F-01 hidden Shortlist answers ↓/Enter/s | P0 | **FIXED**: ↓ then `s` stars only the visible row, and Enter opens it |
| D-01 DSL filter shows "No filters applied" | P1 | **FIXED** in case and cohort (one chip per clause) |
| D-02 server error shown as empty result | P1 | **FIXED** |
| P-01 no ClinVar / call quality in the panel | P1 | **FIXED** |
| P-02 quick chip contradicts evidence | P1 | **FIXED**: chips locked when evidence exists, with an Override path |
| P-03 Esc while editing a comment saves and closes the panel | P1 | **PARTLY FIXED → P2**: no longer saves, but still closes the whole panel |
| N-01 sidebar highlights the wrong case after Back | P1 | **FIXED** |
| L-01 / F-05 empty lollipop | P1 | **FIXED** |
| C-01 ClinVar red/green only | P1 | **FIXED**: min ΔE 23.9 under deuteranopia (was 2.5) |
| I-01 / I-P1-1 ragged JSON shifts columns | P1 | **FIXED**: rejected with a row/column count message |
| H-01 / F-P1-1 false FAQ data claims | P1 | **FIXED** |
| R-01 / F4 locus hidden at narrow width | P1 | **PARTLY FIXED, still P1**: Chr/Pos stay visible; Ref/Alt hidden at 390 px; at 720×450 the pagination is unreachable |
| X-01 / F-06 panel open/close shifts the table | P1 | **FIXED**: CLS 0.010 / 0.015 |
| X-02 app-bar focus ring | P1 | **FIXED** |
| X-03 columns drawer checkboxes unnamed | P1 | **FIXED** |
| E-01…E-05 (desktop only) | P1 | not in scope (web re-audit) |

Finding totals per area (details in the appendices):
- **Case:** 9 fixed, 5 partly fixed, 16 still open, 0 regressed.
- **Details:** 14 fixed, 14 still open or partly fixed, 7 not rechecked, 0 regressed.
- **Cohort:** 22 fixed, 21 still open, 0 regressed.

## 4. Open P1 and the most important new findings

- **N-case-1 (NEW, P1, case table, D13/D1):** at 1440×900 the gnomAD AF column is cut off at the right edge. A value of 0.0193 shows as "0.0", 3.3e-3 as "3.3", and a true 0 as an empty cell, so a 1.9 % variant reads as absent. It was probably already present at baseline (same table width) but was not reported.
- **R-01 remainder (P1):** see §3.
- **N-cohort-1 (P2):** a gnomAD AF of 40 imports without a warning and shows as "40.0000", so the rare presets would hide that variant. Raise it to P1 if a real producer emits such values.
- **N-cohort-3 (P2):** after the multi-file import is cancelled, a stale "2/2 (100%)" upload chip stays in the app bar, and its progress bar has no accessible name.
- **N-details-1 (P2):** in dark theme the selected viewer tab has 2.38–2.59:1 contrast.
- **N-details-2 (P2):** the plot help says "Esc leaves the variant", but Esc closes the whole viewer.
- **N-details-3 (P2):** the 3D error message gives desktop advice ("--disable-gpu") in the web build.
- **N-details-4 (P2):** the ClinVar chip has no label and can be read as the user's own ACMG VUS.
- **N-case-2 (P2):** the result-count pill is clipped.
- **N-case-4 (P2):** the AA Change and cDNA cells keep the transcript prefix and cut off the change itself.
- **N-cohort-2 (P2):** the variant-type chip on multi-file import measures 2.08:1.
- **Main remaining P2s:**
  - Cohort SV/CNV/STR tabs still show SNV columns.
  - Carriers and frequency columns are off-screen at 1440 and 1280.
  - Burden: OR shows as "–" next to a confidence interval, the volcano plot is empty and has no axis titles, and Run is disabled without a reason.
  - The cohort details panel shows no scores, AF or calls (F-26).
  - Metadata: the Sex select and HPO input are stale (F-17).
  - 3D: no residue focus or colouring (F-16).
  - In dark theme, the glare moved from the app bar to the sidebar "Cases" header.
  - No genome build is shown next to HGVS.

## 5. Design-director verdict (synthesis)

**Design specificity is up.** The viewers are now grounded in the clinical task: labelled entry points, a variant-of-interest context, a table equivalent for the marks, and protein search by HGVS p./c. The details panel finally leads with identity, ClinVar and call quality.

**Cognitive load is lower:**
- DSL filters are visible as chips.
- The drawer stays open between clicks.
- Shortcuts are discoverable from the header and from tooltips.

**What still undercuts the work:**
- **Width budget:** the clinically decisive right-hand columns are cut off or off-screen at 1440 (gnomAD AF in the case table, Carriers and frequency in the cohort).
- **Unfinished cohort parity:** variant-type columns, filter-drawer sections and column groups still differ from the case view.
- **Mode-boundary leaks:** desktop-only advice appears in the web build, there are two import entry points, and the shell typography differs between the login page and the app.

**Emotional journey:** the high-stakes moments are now reassuring. These are:
- the genome-build confirmation;
- the evidence-locked ACMG chips;
- the ragged-JSON rejection.

The valleys are the end of an import (a stale upload chip) and the burden screen (an empty plot and a disabled Run with no reason given).

---

# Appendix A — Case workflow evidence (notes-case.md)
# Re-audit (Assessment A, design) — area `case`

- Build: origin/main `1d9c2d6c` (v0.84.0), web runtime, Postgres, http://127.0.0.1:8831. Date 2026-10-12 (afternoon).
- Method: headless Playwright chromium, scripts `scripts-case/s01`–`s27`, screenshots `shots/case/`. 1440×900 primary, 1280×720, 1920×1080, 390×844, 720×450 (= 200 % zoom at 1440×900). Light + dark (OS `prefers-color-scheme` and in-app preference). Contrast sampler = schema 7.3 (`scripts-case/cr.js`). Ground truth: same known-answer tasks as baseline §2 (counts compared with baseline truth values).
- Writes: filters/sort/presets only (all cleared and verified clean at the end: cases 1, 2, 4 and cohort show "No filters applied"), one CSV export download (`dl-case/`). No stars, comments, ACMG, tags, columns or presets saved. One wrong-password login attempt.
- Shared server: other evaluators imported `reaudit-design-*` cases and toggled external-lookup settings during my run; neither affects these findings.

## 1. Per-view scorecard (baseline → now)

Weights D1 7 · D2 6 · D3 7 · D9 6 · D10 9 · D11 7 · D12 6 · D13 10 · D14 5. Caps: open P1 in a dim → 50.

| View | D1 | D2 | D3 | D9 | D10 | D11 | D12 | D13 | D14 | Score (baseline → now) |
|---|---|---|---|---|---|---|---|---|---|---|
| Login + disclaimer | 75 | 100 | 100 | — | — | 75 | 75 | — | 75 | 87.5 → **83.6** |
| Home / case list / shell | 75 | 75 | 75 | 75 | 75 | 75 | 75 | 75 | 75 | 70.6 → **75.0** |
| Case variant table (shortlist, drawers, presets, DSL, columns, empty, SV/CNV/STR, 390) | 50 | 50 (P1 R-01 residual) | 50 | 75 | 75 | 75 | 75 | 50 (P1 N-case-1) | 75 | 54.1 → **63.1** |
| Export | 75 | 75 | 75 | 100 | 75 | 100 | 75 | 75 | 75 | 80.2 → **80.2** |
| Keyboard shortcuts (sheet + bindings + tooltip hints) | 75 | 75 | 75 | 75 | 75 | — | 75 | — | 75 | 64.1 → **75.0** |

Area (vw: login 3, home 8, table 22, export 5, shortcuts 3; total 41): baseline 63.6 (4 views) → now **(3·83.6 + 8·75 + 22·63.1 + 5·80.2 + 3·75)/41 = 69.9** (5 views; same 4 views as baseline: 69.5).

Evidence per score:

**Login + disclaimer**
- D1 75: centred card, clear hierarchy; card still moves 29.5 px down when the error alert is inserted (form y 398.75 → 428.25) (F21).
- D2 100: legible sizes, single weight scale.
- D3 100: light and dark both clean; dark login has no flash (body #12141A from the first frame).
- D11 75: "Invalid username or password." is clear, but focus goes to `<body>` after the error (F21).
- D12 75 (was 100): login uses the system stack (`-apple-system … Arial`, `document.fonts.size = 0`) while the app now ships Inter + JetBrains Mono — the first screen looks like a different product (N-case-5).
- D14 75: disclaimer is explicit ("Research Use Only / Not for Diagnostic Use"); still inner scroll (818/630 px), 2 px outline round the whole card, small CTA (208×24) on a thin footer (F22).

**Home / case list / shell**
- D1 75: calm welcome, navy app bar; "All cases loaded" footer still noise; dark-theme sidebar "Cases" header is a #9CC4E4 light-blue slab (X-04 residual).
- D2 75: Inter bundled, tabular counts; login font mismatch is cross-view.
- D3 75: sampler 0 text failures light/dark; search-cases placeholder at 0.38 opacity (≈2.4:1).
- D9 75 (was 50): N-01/F3 fixed — after Back/Forward the active sidebar item equals the h1/title (VEP-panel ↔ SnpEff verified both ways).
- D10 75: Ctrl+click now shows a checkbox selection mode, but still opens the clicked case and has no bulk bar (F20).
- D11 75 / D12 75 / D13 75: counts correct, labels consistent.
- D14 75 (was 50): tooltips carry shortcut hints ("Keyboard Shortcuts (?)", "Toggle filters (Ctrl+Shift+F)"); case-list ⓘ now explains Ctrl+Click/right-click, but only on hover (click opens nothing).

**Case variant table**
- D1 50: still horizontal scroll at 1440 (wrapper 2044 vs 1160 px, 9 of 15 default columns), 14 full rows at 1440×900, 9 at 1280×720, 19 at 1920×1080 (target 25). Chip row now single-line slide group (no wrap). Five chrome icons per row remain (☆ ☑ 💬 + 2 link-outs). Count pill clipped in several states (N-case-2). Partially visible right-aligned AF column (N-case-1).
- D2 50 (cap): Courier New gone, JetBrains Mono + Inter bundled, `tabular-nums` on Position, Ref/Alt, AF, CADD (X-10, F10 fixed). Capped by the 200 % zoom residual of R-01 (720×450: footer at y 495–557 > 450, page does not scroll, pagination unreachable). AA Change truncation hides the p. change (N-case-4).
- D3 50: 0 text failures (sampler) on table, filtered table, shortlist, empty state, filter drawer, columns drawer, light and dark. Active LP pill now #B34D00 (≈7:1) with a ✓ icon. The search placeholder still renders at 0.87×0.38 alpha in light theme (≈2.4:1) and carries the instruction "Gene, chr:pos, or filter…" — one text failure keeps the band at 50 (F26). Semantic roles now uniform (VUS neutral grey).
- D9 75 (was 50): case/tab/f/q/sort in URL, Back/Forward restores and sidebar is in sync; page index still lost on reload ("26-50" → "1-25", F18).
- D10 75 (was 65): (a) keyboard loop ↓ Enter Esc a/c/p works, focus returns to the row after each dialog (100); (b) presets 1 click, drawer stays open while clicking MOD then LOW (15 → 37 rows), DSL errors inline (75; malformed expression still becomes free text); (c) column visibility persists (100); (d) no bulk actions (25); (e) panel docks at 1440 with CLS 0.010/0.015, overlays at 1280 (75).
- D11 75 (was 50): F1 and F2 fixed — DSL clauses render as chips ("gnomAD AF < 0.001 or missing", "Gene = MTMR3"); unknown field / non-number / parse errors show inline under the field ("Unknown field 'foo'", "'abc' is not a number for 'gnomad_af'", "Expected rparen…"), no request is sent, last valid result is kept (same in cohort). Remaining: sort-only lights the red Clear (F13), count pill clipped (N-case-2), empty-state text clipped (F19).
- D12 75 (was 50): Esc closes both drawers and focus returns to the opener; filter shortcuts work in cohort; case/cohort invalid-DSL behaviour identical. Remaining cosmetic: "Impact MODERATE" (drawer) vs "Impact 1 selected" (preset/URL); "CADD >= 20" / "<= 1%" vs "≤ 1.00%"; empty glyphs "--" and "- -"; ClinVar raw casing ("pathogenic", "likely pathogenic") next to "Benign"; SNV presets on SV/CNV/STR tabs.
- D13 50 (cap): all known-answer tasks correct (table in §1a). HGVS fixed (no doubled prefix, `p.Pro4=` decoded, panel header `ZNRF3 · ENST00000544604.7:c.426+…`). Capped by new P1 N-case-1 (gnomAD AF shows only the mantissa at the 1440 viewport edge: 0.0193 → "0.0", 3.3e-3 → "3.3", 2.0e-5 → "2.0", true 0 → blank). Also open: no genome build anywhere (F11d), preset AF chip omits "incl. missing" (F14), Ref/Alt hidden at 390 px.
- D14 75: column-header help with definitions, sources and thresholds on every column (CADD PP3/BP4 cut-offs, BA1/PM2 notes on gnomAD AF, Impact vs SO term) — the best help in the product; DSL autocomplete + inline errors; shortlist explainer. Not 100: sheet's "Escape … blur search" is wrong (N-case-7), case-list help is hover-only.

**Export**
- Same as baseline: menu shows "Download CSV · 15 variants / Download Excel (.xlsx) · 15 variants"; snackbar names the file; CSV = 15 rows + header with Impact (IMPACT) and Consequence (SO term) correctly separated. No genome build or filter summary in the file (D13 75); Export button has no tooltip (others do) (D12 75).

**Keyboard shortcuts**
- D10 75 (was 50): `/`, Ctrl+Shift+F, Alt+Shift+C, Ctrl+Shift+X work in case and cohort; Esc closes drawers; `?`, Alt+Shift+D/Q/L/O all open their target; single-key row keys do not fire while typing in search (2.1.4 ok). Esc in the search field neither blurs nor clears (two presses tested).
- D12 75 (was 50): sheet is generated from the same list as the bindings and tooltips (`config/keyboardShortcuts.ts`); the cohort gap is closed. One false claim (Esc "blur search").
- D14 75 (was 50): sheet reachable by `?` and footer button; shortcut hints in tooltips (Filters, Columns, Star "s on selected row", Keyboard Shortcuts "?"); Import tooltip lacks its Alt+Shift+O hint (N-case-8).
- D1/D2/D3/D9 75: tidy two-column sheet, kbd chips in mono; scrolls slightly at 900 px.

### 1a. Known-answer tasks (baseline §2), re-run

| # | Task | Expected | Now | Verdict |
|---|---|---|---|---|
| T1 | Preset Rare (1%), case 4 | 91 | 91, chip "AF ≤ 1.00%" | ✅ (chip still silent about missing AF, F14) |
| T2 | Search MTMR3 | 147 | 147, chip "Search MTMR3" | ✅ |
| T3 | `gnomad_af:<:0.001` | 68 | 68, chip "gnomAD AF < 0.001 or missing" | ✅ and F1 fixed |
| T4 | `… AND gene:=:MTMR3` | 10 | 10, two chips | ✅ |
| T5 | Drawer Impact MOD | 15 | 15, chip "Impact MODERATE" | ✅ |
| T6 | Preset HIGH Impact, case 1 | 12 | 12 | ✅ |
| T7 | Preset HIGH Impact, case 4 | 0 | empty state, chip "Impact 1 selected" | ✅ |
| T8 | CSV export, Impact = MODERATE | 15 rows | 16 lines (header + 15) | ✅ |
| T9 | Out-of-order responses (MTMR3 delayed 1.2 s, then THOC5) | THOC5, 107 | 107 | ✅ |
| T10 | Sort (sampled Position, gnomAD AF, CADD, Impact, Gene, Chr asc/desc) | monotone, aria-sort cycles | monotone; aria-sort ascending/descending; Impact by severity | ✅ (6 of 12 columns re-sampled) |

## 2. Baseline findings

| ID | Status | Evidence |
|---|---|---|
| F1 / D-01 DSL shows "No filters applied" | **FIXED** | chips per clause, case and cohort (s05, s24) |
| F2 / D-02 error shown as empty result | **FIXED** | client-side validation, inline message, no request, last valid result kept (s05, s25) |
| F3 / N-01 sidebar wrong after Back | **FIXED** | active item = title after Back and Forward (s08) |
| F4 / R-01 column budget hides identity | **STILL OPEN (reduced)** | Chr+Position now kept at 390 and 720; Ref/Alt still hidden at 390; at 720×450 footer y 495–557 > viewport 450, page not scrollable → pagination unreachable at 200 % zoom (s13). P1 kept for the reflow part |
| F5 / X-01 panel shift | **FIXED** | CLS open 0.010, close 0.0147 at 1440 (s07); chip row is a slide group |
| F6 drawer closes per click; Esc | **FIXED** | MOD then LOW applied with drawer open; Esc closes; focus back on "Filters 1" (s06) |
| F7 DSL error feedback | **STILL OPEN (partly fixed)** | inline errors fixed; `gene = "BRCA1" AND (af < 0.01 OR` still runs as free-text search (0 rows, chip "Search gene = …"); field still ~200 px; error message overlays the preset row (N-case-3) |
| F8 default columns do not fit 1440 | **STILL OPEN** | 2044 vs 1160 px; per-cell link icons on Chr and Position remain |
| F9 sticky lead header cells covered | **FIXED** | ★/Chr headers stay on top after scroll (s07) |
| F10 / X-10 hairline Courier, three stacks | **FIXED** | Ref/Alt/Transcript/cDNA in JetBrains Mono; body Inter; Courier gone |
| F11 / X-05 HGVS defects | **PARTLY FIXED** | (a) `p.Pro4=` decoded, (b) shortlist `ENST…:c.2446G>A` no extra prefix, (c) panel header single transcript — fixed; (d) no genome build anywhere — open. Copy button not rechecked |
| F12 ACMG/ClinVar colours, VUS ≈ P | **FIXED** | ClinVar text colours P #8E1B1B, LP #B34D00, VUS grey #5C6370, B #0B2E6B; toolbar ACMG pills neutral outline, active adds ✓ |
| F13 sort counts as filter | **STILL OPEN** | after sort only, Clear turns red while bar says "No filters applied"; Ctrl+Shift+X resets sort (s08) |
| F14 imprecise chips | **STILL OPEN** | "Impact 1 selected" (preset/URL) vs "Impact MODERATE" (drawer); preset "AF ≤ 1.00%" without "incl. missing" (DSL chip does say "or missing") |
| F15 / X-11 raw formatting | **PARTLY FIXED** | fixed: SV/CNV lengths "5.00 kb"/"500.00 kb", End with separators, STR "full mutation", SO terms humanised ("Synonymous"). Open: "--" vs "- -", `>=`/`<=` in presets and drawer vs `≤` in chips, raw ClinVar casing in JSON cases, SV "Precise 1/0" |
| F16 / X-04 bright dark app bar | **PARTLY FIXED** | app bar #30353E in dark; sidebar "Cases" header still #9CC4E4 slab in dark |
| F17 Impact cannot express MODIFIER/missing | **STILL OPEN** | drawer still HIGH / MOD / LOW |
| F18 page not in URL | **STILL OPEN** | page 2 → reload → "1-25 of 1585" |
| F19 empty state centred on full table | **STILL OPEN** | "…or clearing all fi" clipped at 1440 (s05) |
| F20 Ctrl+click opens the case | **STILL OPEN** | selection checkboxes appear, but gate-case-b also opens; no bulk bar |
| F21 login focus + jump | **STILL OPEN** | focus BODY; +29.5 px |
| F22 disclaimer scroll/outline/CTA | **STILL OPEN** | v-card-text 818/630; 2 px outline round card; CTA 208×24 |
| F23 shell nits | **STILL OPEN** | case-list ⓘ hover-only (now with useful text); "VarLens Web" menu = web:postgres; "All cases loaded"; no case-list sort |
| F24 / X-03 columns drawer names, reorder | **PARTLY FIXED** | 26/26 checkboxes named ("Show Chr", getByRole finds Transcript); reorder still drag-handle only (2.5.7) |
| F25 hit areas 18 px | **STILL OPEN** | preset chips 18 px high, no `::after` extension; sort icons 16 px (header itself is the button) |
| F26 placeholder 0.38 | **STILL OPEN** | light 0.38 opacity (dark 0.5 is fine) |
| F27 SNV presets on SV/CNV/STR | **STILL OPEN** | same 9 presets incl. CADD/AF on SV, CNV, STR tabs |
| F28 / I-01 impossible values (ragged import) | **FIXED** | ragged rows rejected (commit 37309508); case 1 now AF 0, CADD 40.0, ClinVar "pathogenic" |
| F29 shortlist rows/links | **STILL OPEN** | 57 px rows; Links column clipped at 1440; ClinVar chip truncated "Uncertain si…" (no overlap with ★ any more) |
| F30 a11y details | **STILL OPEN** | one `role=button aria-hidden` autocomplete icon; app title and case name are `role=button` in the tab order |
| X-02 app-bar focus ring | **FIXED** | 2 px white (light) / #E4E7EC (dark) outline, offset 2 px, visible on all 9 controls |
| X-06 Esc drawers / focus return | **FIXED** | both drawers close on Esc in case and cohort; focus returns to opener; after ACMG/comment dialogs focus returns to the row. Residual: Esc does not blur search (N-case-7) |
| X-07 theme flash | **FIXED (OS-driven)** | OS dark → login and app dark from first frame. Residual P3: in-app "Dark" with OS light shows one light frame (N-case-6) |
| F-01 (P0, area 03) hidden shortlist hijacks keys | **NOT RECHECKED (sanity pass only)** | shortlist → SNV tab: ↓↓ Enter opened the highlighted SNV row (29,004,331 A>C) and `a` named the same variant; `s` not pressed (no writes) |
| Keyboard shortcuts baseline (C-P2-2 cohort shortcuts, C-P2-3 Esc) | **FIXED** | s18 |

Combined-report items: FIXED D-01, D-02, N-01, X-01, X-02, X-03 (names), X-06, X-07 (OS-driven), X-10 · PARTLY X-04, X-05, X-11 · OPEN R-01 (reflow/pagination at 200 %).

Tally for the 30 F-items: FIXED 9 (F1 F2 F3 F5 F6 F9 F10 F12 F28) · PARTLY 5 (F7 F11 F15 F16 F24) · OPEN 16 (F4 F8 F13 F14 F17 F18 F19 F20 F21 F22 F23 F25 F26 F27 F29 F30) · REGRESSED 0.

## 3. New findings

| ID | Sev | View | Dim | Finding | Evidence / repro | Fix |
|---|---|---|---|---|---|---|
| N-case-1 | **P1** | Case table | D13, D1 | **The gnomAD AF column is cut off at the 1440 viewport edge and shows only the mantissa.** Right-aligned values lose their exponent and last digits: 0.0193 → "0.0", 3.3e-3 → "3.3", 2.0e-5 → "2.0", 0.5131 → "0.5"; a true 0 renders as an empty cell. "0.0" reads as "absent from gnomAD" (PM2) for a 1.9 % variant. | `/case?case=4&tab=snv` at 1440×900, default columns; every AF cell is 46–47 % visible (s26, `26-af-clip.png`). Likely present at baseline too (same 2044 px table), not reported then | Never leave a numeric column partially visible: fit the default set at 1440 (F8, Locus cell), or fade/mask the last partial column, or put a sticky right shadow + "more columns →" affordance; at minimum left-align or truncate with an ellipsis so a clipped number is visibly incomplete |
| N-case-2 | P2 | Case table | D11, D1 | **The result-count pill is clipped**: 20 px at 390×844 (no digits visible), 37 px at 1440 with the panel open ("1,"), 93 px at 1280×720 ("1,585 / 1,5"). aria-label is correct. | s14 | Give the pill `flex-shrink: 0` and drop lower-priority toolbar items (ACMG pills, labels) first |
| N-case-3 | P3 | Case table | D1 | DSL inline error message overlaps the first preset chips ("Rare Pathogenic", "Rare HIGH") | `24-case-dsl.png` | Render the message in the reserved applied-filter row, or push it into the toolbar's own row height |
| N-case-4 | P2 | Case table | D2, D13 | **AA Change / cDNA truncation hides the change itself**: cells show `ENSP00000383189.4:p...`, `ENST00000400335.9:c.12A>C` fits but longer ones `ENST00000616432.5:c.151...`. The transcript prefix wins over the clinically relevant p./c. part. | `11-synonymous.png` | Show `p.Pro4=` / `c.12A>C` in the cell with the versioned transcript in the tooltip (Transcript already has its own column), or middle-truncate |
| N-case-5 | P3 | Login | D12, D2 | Login page uses the system font stack; the app uses bundled Inter/JetBrains Mono | s27 font check (`document.fonts.size = 0` on /login) | Load the same font CSS on `login.html` |
| N-case-6 | P3 | Shell | D5 hand-off | One light frame (#F0F4F8) before dark when the in-app theme is Dark and the OS is light | s21 | Write the resolved theme class from localStorage in the inline `<head>` script of index.html |
| N-case-7 | P3 | Shortcuts | D12, D14 | Sheet says Escape "Close drawer / blur search"; Esc in the search field keeps focus and text (two presses) | s17 | Blur on Esc when no menu is open, or change the sheet text |
| N-case-8 | P3 | Shell | D12 | "Import data" tooltip has no Alt+Shift+O hint, unlike Filters/Columns/Star/Keyboard Shortcuts | s17 | `withShortcut('Import data', 'import')` |
| N-case-9 | P3 | Case table | D1 | Long DSL chips clip their own ✕ (e.g. "gnomAD AF < 0.001 or missing") and long values ("Consequence = synonymous_var…") | `24-case-dsl.png`, `11-synonymous.png` | Truncate the value text, never the remove button |

## 4. Nielsen 10 heuristics (case workflow area)

| # | Heuristic | 10-06 | Baseline (10-12 am) | Now | Evidence |
|---|---|---|---|---|---|
| 1 | Visibility of system status | 2 | 2 | **3** | DSL chips, sidebar in sync, drawer results visible while editing. Count pill clipped in several states; partial AF column |
| 2 | Match with real world | 2 | 3 | **3** | SO terms humanised, "full mutation", kb lengths, column definitions. Raw ClinVar casing, "Precise 1/0" |
| 3 | User control & freedom | 2 | 3 | **3** | Esc closes drawers, focus returns. Clear still wipes sort; Esc does not blur search |
| 4 | Consistency & standards | 1 | 2 | **3** | One type system, one HGVS formatter, case/cohort parity for DSL and shortcuts. Chip label variants, `>=` vs `≤`, login font |
| 5 | Error prevention | 1 | 2 | **3** | Unknown fields and non-numbers rejected before a request. Malformed expressions still fall back to free text |
| 6 | Recognition rather than recall | 3 | 3 | **4** | Every column header defines the field with thresholds; DSL autocomplete; shortcut hints in tooltips |
| 7 | Flexibility & efficiency | 3 | 3 | **3** | Drawer stays open, shortcuts in cohort, `p` key. No bulk actions, no page in URL |
| 8 | Aesthetic & minimalist design | 2 | 2 | **3** | Single-line preset row, bundled type, quiet ACMG pills, navy app bar. Still horizontal scroll at 1440 and 5 icons per row |
| 9 | Recognise, diagnose, recover from errors | 1 | 1 | **3** | Inline, specific messages ("'abc' is not a number for 'gnomad_af'"), last valid result kept. Message overlaps chips; malformed free-text gets 0 rows silently |
| 10 | Help & documentation | 3 | 3 | **4** | Column-header help, shortcut sheet from the same source as bindings, preset tooltips, shortlist explainer |
| | **Total** | 20 | **24** | **32 / 40** | |

## 5. Design-director paragraph

The build has moved from "Vuetify default with good bones" to a product with a voice: a navy app bar with a readable focus ring, bundled Inter with JetBrains Mono for loci and HGVS, neutral outlined ACMG pills that only take colour when active, and a ClinVar text scale where VUS is finally grey rather than danger-orange. Cognitive load in the case table dropped where it mattered most: the applied-filter row now tells the truth for every DSL clause, errors are explained in place instead of masquerading as "No variants match", and the drawer stays open so a clinician can build "MOD + LOW + rare" while watching the count move. The emotional arc for Dr. Mara is now trust → speed instead of trust → doubt; the remaining doubt comes from layout, not logic — at 1440 px the table still runs 900 px past the viewport, and the last visible column (gnomAD AF) is sliced so "0.0193" reads "0.0". That single partial column is now the most dangerous pixel on the screen. Strengths: (1) column-header help with real thresholds (CADD PP3/BP4 calibrations, BA1/PM2 notes) is better than most commercial tools; (2) the keyboard model is coherent across case, cohort, tooltips and the sheet because it comes from one list; (3) all ten known-answer tasks still pass, including the out-of-order race. Next design moves: a compact Locus cell plus moving link-outs to hover to fit 1440, a non-shrinking count pill, and per-type presets on SV/CNV/STR.

## 6. Not done / limits

- One evaluator; no screen reader. axe not run by me (technical pass owns D8).
- XLSX not opened; Copy-HGVS button not exercised; column drag-reorder not driven.
- `s` (star) not pressed, so F-01 is only sanity-checked.
- T10 re-sampled 6 of 12 sortable columns.

# Appendix B — Details & viewers evidence (notes-details.md)
# Re-audit (design A) — area `details` — 2026-10-12, origin/main 1d9c2d6c, v0.84.0, http://127.0.0.1:8831
Method: headless Playwright Chromium (`--use-angle=swiftshader --enable-unsafe-swiftshader`; note `--use-gl=swiftshader` made pdbe-molstar fail with "Could not create a WebGL rendering context", ANGLE works). 1440x900 + 1280x720, light + dark. Scripts `scripts-details/`, shots `shots/details/`.
External lookups were switched on server-wide (vep, myvariant, spliceai, gnomad, protein) in short windows (12–90 s each, ~8 windows), always reset to off in `finally`. The server could not reach Ensembl REST (gene structure: `{"success":false,"error":"fetch failed"}`; Fetch VEP added no transcripts), so F-10/F-15 and the gene-structure dark check could not be verified.
Writes: case 5 (star on var 1986, ACMG VUS + PM2/PP3 on var 2325), case 6 (sex male, HPO HP:0001250). All reverted: per-case rows deleted (getPerCase -> null), sex -> null, HPO list [] (verified via API).

## 1. Per-view scores (baseline -> now)
| View | D1 7 | D2 6 | D3 7 | D9 6 | D10 9 | D11 7 | D12 6 | D13 10 | D14 5 | Score |
|---|---|---|---|---|---|---|---|---|---|---|
| Details panel | 50->75 | 50->75 | 50->75 | 50->75 | 25->75 | 50->50 | 50->50 | 25->75 | 50->50 | 43 -> **68** |
| Gene schema / lollipop | 25->75 | 50->75 | 25->50 | 75->75 | — | 25->75 | 50->75 | 50->75 | 50->75 | 44 -> **72** |
| 3D structure | 50->75 | 50->50 | 25->50 | 75->75 | — | 50->50 | 50->75 | 50->50 | 50->50 | 50 -> **59** |
| Case metadata modal | 75->75 | 75->75 | 50->50 | 75->75 | 50->50 | 50->50 | 50->50 | 75->75 | 50->50 | 63 -> **62** |
(Baseline scores included D4; "now" scores are over D1 D2 D3 D9–D14 only. Case metadata is essentially unchanged; the -1 comes from dropping D4=75.)

Evidence per score:
- Panel D1 75: the heading names the variant ("THOC5 · p.Met180Val"), and the identity block now has a call row (GT·DP·GQ·AB·FILTER) and ClinVar (a03, c01). Sections are still equal-weight.
- Panel D2 75: the HGVS is clean (`ENST00000490103.6:c.538A>G`, p. on its own line). The ellipsis on the VEP title hides the p. (N-6).
- Panel D3 75: the contrast sampler found 0 text failures in light (CADD "--" was 2.59:1). Dark is legible (z-panel-1440-dark). Selected vs disabled ACMG chips are ambiguous (N-8).
- Panel D9 75: scroll resets to 0 on variant switch (500 -> 0). The identity stays in view.
- Panel D10 75: F-01 fixed (↓ then s wrote only the visible row; Enter opened the visible row). Quick chips are locked when evidence exists.
- Panel D11 50: Esc in the comment field no longer saves, but it still closes the whole panel (F-04 residual). The timestamp under an empty comment is still misleading, the snackbar does not name the variant, and a failed Fetch VEP shows nothing (N-9, suspected).
- Panel D12 50: the cohort panel still says "Scores available in Case Analysis mode" (F-26). The panel title differs by source.
- Panel D13 75: ClinVar and call data are present, HGVS is fixed, and the ACMG override contradiction is gone. Residual gaps: no genome build beside the coordinate, and the ClinVar chip has no label (N-4).
- Panel D14 50: the "Set from evidence: use Override in the Evidence editor." hint is good. Score cut-off tooltips were not confirmed.
- Lollipop D1 75: plot, variant-of-interest side panel, legend sentence, Plot/List switch, ±10/25/50/100 aa windows (e02). A search hint tooltip covers the side-panel heading (N-5).
- Lollipop D3 50: dark mode, selected header tab is white on rgb(144,164,174): **2.59:1** (N-1). The light header is 7.24:1.
- Lollipop D11 75: the plot renders (229 SVG nodes, "683 aa" chip). Gene structure has a real error state with Retry, though the message is the raw "fetch failed".
- Lollipop D12 75: cohort mode draws a "Cohort carriers" track ("height = carriers") using the same component (k04). The tracks legend still says "Your variant" (N-7).
- Lollipop D13 75: L-01 fixed. Domains are still empty ("No annotated domains", InterPro; suspected upstream).
- Lollipop D14 75: inline "how to read" sentence, keyboard help button, search examples ("e.g. 180 · p.180 · M180V · c.538A>G · chr22:…").
- 3D D3 50: the side panel is now legible in dark (F-14 fixed there). The dark selected tab is **2.38:1** (N-1).
- 3D D11 50: on WebGL failure the web build tells the user to "restart the application… launch with --disable-gpu" (N-3).
- 3D D13 50: the cartoon is still uniform grey although the pLDDT legend is shown, and the residue of interest is neither highlighted nor focused. The list names the variant "ENSP00000420306.1…" (F-16, N-6).
- Metadata D3 50: the selected "Overview" tab is still navy on slate (h01; baseline 1.59:1).
- Metadata D10/D11 50: after Sex -> Male the select still shows "Unknown" while the header shows male. After adding Seizure, the input keeps "Seizure" and typing "micro" gives "No matching HPO terms". The banner stays "No clinical phenotypes recorded" (m2 log).
- Metadata D12 50: the tabs are plain `<button>`s with no role/aria-selected. Dialog height jumps between tabs: 450 / 402 / 402 / 602 px.

## 2. Baseline findings
| ID | Status | Evidence |
|---|---|---|
| F-01 P0 hidden Shortlist keys | **FIXED** | SNV tab: click KREMEN1, Esc, ↓ (EMID1 highlighted), s -> single `upsertPerCase [5,1986,{starred:true}]`. Enter opened EMID1 · p.Ala109Gly. |
| F-02 no ClinVar / GT / quality | **FIXED** | "Uncertain significance" chip plus "GT 0\|1 · DP 1997 · GQ 651 · AB 0.48 · FILTER PASS". Chip unlabeled (N-4). |
| F-03 quick chip contradicts evidence | **FIXED** | With PM2+PP3 the chips are disabled (pointer-events none) and the panel says "Set from evidence: use Override in the Evidence editor." A forced click sent no write. |
| F-04 Esc saves comment and closes panel | **STILL OPEN (partly fixed, now P2)** | No save (0 writes), and the comment is a keyboard-reachable role=button (tabindex 0). But the first Esc in the textarea still closes the panel (c03b). |
| F-05 empty lollipop | **FIXED** | Plot renders, 683 aa. Domains still empty. |
| F-06 dock CLS 0.21 | NOT RECHECKED | Stability is out of my dims. |
| F-07 scroll kept, generic title | **FIXED** | scrollTop 500 -> 0 on switch. Title "MTMR3 · p.Gly764Cys". |
| F-08 HGVS doubled, %3D | **FIXED** (residual: no genome build) | `ENST00000490103.6:c.538A>G` / `ENSP00000420306.1:p.Met180Val`. |
| F-09 score colour-only, AF red, date | **PARTIAL** | gnomAD AF is now a neutral grey chip. REVEL/SpliceAI/AM are still green tonal chips. Tooltips and the "Cached from" date were not verified (VEP unreachable). |
| F-10 VEP transcripts c./p. "--" | NOT RECHECKED | Fetch VEP returned no transcripts (Ensembl unreachable from the server). |
| F-11 Esc closes panel over overlays | **FIXED** (tag menu) | Esc in the tag menu leaves the panel open. The comment-field case is in F-04. |
| F-12 STR / intergenic "Unknown Gene" | NOT RECHECKED | |
| F-13 activity / comment timestamps | **STILL OPEN** | "10/12/2026, 8:27:21 PM" shown under an empty case comment after an ACMG-only change. The snackbar says "Classified as Uncertain significance" without naming the variant. Author not rechecked. |
| F-14 dark plot / 3D panel | **FIXED** (3D side panel legible, lollipop legible) | The new dark tab contrast is N-1. Gene structure dark could not be rendered. |
| F-15 gene structure axis / exons | NOT RECHECKED | Ensembl fetch failed. |
| F-16 3D grey, residue not focused, legend clipped | **STILL OPEN** | f-light-3d: uniform grey, no focus, "<50" at the right edge. |
| F-17 sex select / HPO input / banner stale | **STILL OPEN** | m2 log (see D10/D11). |
| F-18 Overview tab 1.59:1, no role=tab, height jump | **STILL OPEN** | h01. role=null. Heights 450/402/602. |
| F-19 row "VU:" clipped grey pill | **STILL OPEN** | d03 row 29,539,391 action cell. |
| F-20 CADD "--" / Import chip contrast | **FIXED** | 0 sampler failures in light. |
| F-21 18 px ACMG chips without hit padding | **STILL OPEN** | chip height 18; span with tabindex, no role/name. |
| F-22 protein icon / ⚥ | **PARTIAL** | Labelled "Lollipop" / "3D structure" buttons, with disabled reasons ("No protein position for this variant", plus a Gene structure link). ⚥ is still in the metadata modal. |
| F-23 scope toggle | NOT RECHECKED | |
| F-24 tags dead end | **STILL OPEN** | "No tags available. Create tags in Settings." No link, no inline create. |
| F-25 panel width | NOT RECHECKED at 1920 | 400 px at 1440 and 1280. |
| F-26 cohort panel scores | **STILL OPEN** | "Scores available in Case Analysis mode". No AF, ClinVar or call row (k02). |
| P-01 / P-02 / P-03 | FIXED / FIXED / PARTIAL | = F-02 / F-03 / F-04. |
| L-01 | **FIXED** | = F-05. |
| C-01 ClinVar colours under deuteranopia | **FIXED** | Machado deutan on legend colours P(142,27,27), LP(179,77,0), VUS(92,99,112), LB(43,108,176), B(11,46,107): min ΔE76 = 23.9 (LB–B), P–LP 24.4. Baseline LP–LB was 2.5. ◆ shape plus labels. |
| X-05 HGVS | **FIXED** in the panel | No genome build tag. |
| X-08 hard-coded low contrast | **PARTIAL** | Panel chips pass. ACMG evidence buttons not measured. |
| X-09 colour semantics | **PARTIAL** | AF no longer red. VUS/P collision not re-measured in the panel. |
| X-14 dark plot labels | **PARTIAL** | Lollipop keeps a light plot surface in dark, so labels are legible. Gene structure could not render. New dark tab contrast is N-1. |

Counts: FIXED 14 (F-01, 02, 03, 05, 07, 08, 11, 14, 20, P-01, P-02, L-01, C-01, X-05) · STILL OPEN / PARTIAL 14 · NOT RECHECKED 7 · REGRESSED 0.

## 3. New findings
- **N-details-1 · P2 · viewer dialog (lollipop/3D), dark · D3.** The selected header tab is white on light slate: 2.59:1 on Lollipop Plot, 2.38:1 on 3D Structure (f-dark-lollipop, f-dark-3d). Light mode is 7.24:1. Repro: dark theme, open Lollipop.
- **N-details-2 · P2 · lollipop · D11/D8.** The in-plot keyboard help says "Esc leaves the variant", but Esc with a focused variant closes the whole viewer dialog (dialogs 1 -> 0). Repro: Tab to plot, →, Esc.
- **N-details-3 · P2 · 3D, web · D11.** The WebGL failure text reads "Try restarting the application… launch with --disable-gpu flag", which is desktop advice in the web build (`useMolstarViewer.ts:269`).
- **N-details-4 · P2 · panel identity · D13.** The ClinVar significance is a grey chip ("Uncertain significance") with no "ClinVar" label, right under the coordinates. It can be read as the user's own ACMG VUS.
- **N-details-5 · P3 · lollipop · D1.** The search-hint tooltip opens on load and covers the "Variant of interest" heading. Seen at 1440 and 1280, in light and dark.
- **N-details-6 · P3 · panel title / 3D list · D2/D12.** For VEP imports the title is "THOC5 · ENSP00000420306.1:p.Met180…" (truncated); for SnpEff it is "THOC5 · p.Met180Val". The 3D list shows "ENSP00000420306.1…" instead of p.Met180Val.
- **N-details-7 · P3 · cohort lollipop · D12.** The legend still says "Tracks: Your variant" while the track is labelled "Cohort carriers". Carrier count is encoded by height only (no number visible).
- **N-details-8 · P3 · ACMG chips · D3/D8.** With evidence present, the selected class (VUS) is a light-grey fill like the disabled chips, so selected and disabled look the same. Chips are `span tabindex=0` with no role or accessible name.
- **N-details-9 · P2 · SUSPECTED · Fetch VEP · D11.** When the VEP call fails (server cannot reach Ensembl here), the transcript section shows no error and the transcript count stays 1 (g02). Gene structure, by contrast, shows an error state.
- **N-details-10 · P3 · lollipop search · D10.** The partial query "Glu177" returns "No match", while "Glu177Lys", "M180V", "180" and "c.538A>G" all give suggestions.
- 1280x720 note: the panel is a 400x640 overlay (scroll 591/1289). The new call row pushes the ACMG heading to y = 705, at the 720 px fold (baseline 578). The sticky specific title makes up for it.

## 4. Nielsen (details, viewers, case annotation) — baseline -> now
| # | Heuristic | Base | Now | Evidence |
|---|---|---|---|---|
| 1 | Visibility of status | 2 | 3 | Specific title; ACMG snackbar + Undo; gene-structure error state. VEP failure silent (N-9). |
| 2 | Match real world | 2 | 3 | HGVS fixed; ClinVar humanised. ⚥ remains; ClinVar chip unlabeled. |
| 3 | User control | 2 | 3 | Esc no longer saves; tag-menu Esc is contained. Esc still closes the panel from the comment field and the viewer from the plot (N-2). |
| 4 | Consistency | 2 | 2 | Cohort panel gap (F-26); title differs by source; metadata tabs are not tabs. |
| 5 | Error prevention | 1 | 3 | F-01 fixed; quick chips locked when evidence exists. |
| 6 | Recognition | 2 | 3 | Identity always visible; labelled viewer buttons; disabled reasons. |
| 7 | Flexibility | 2 | 3 | Viewer search/keyboard/List view; ±aa windows; shortcuts. |
| 8 | Aesthetic | 2 | 3 | Data louder (call row, clean HGVS); viewer calm. |
| 9 | Error recovery | 3 | 3 | Retry on gene structure; raw "fetch failed"; desktop advice in web 3D error. |
| 10 | Help | 2 | 3 | Viewer "how to read" + keyboard help + search examples. Score cut-offs unverified. |
| | Total | 20 | **29/40** | |

## 5. Design director
Specificity is much higher. The panel now leads with what a geneticist reads first: gene · protein change, clean HGVS, coordinate, ClinVar, and the call quality line. The viewer has become a real tool, with a variant-of-interest side panel, neighbourhood table, windows, Plot/List and search examples. The colour-blind-safe ClinVar ramp (blue vs red-orange, ◆ shape) makes it trustworthy. Cognitive load drops because the panel no longer loses the identity on scroll, and the ACMG model is honest (no silent overrides).

The emotional journey still has friction:
- Escape is over-eager in two places: the comment field closes the panel, and the plot closes the viewer.
- The case-metadata modal is untouched: the stale select, the sticky HPO input and the invisible Overview tab make case annotation feel unreliable.
- The cohort panel feels second-class.

Strengths:
1. The ACMG evidence workflow, with its "Set from evidence" lock.
2. The lollipop's variant-of-interest context and the cohort-carriers parity.
3. Clear capability-gated disabled states with reasons.

# Appendix C — Cohort, import, settings evidence (notes-cohort.md)
# Re-audit (design, Assessment A) — area `cohort`: Cohort + gene burden, Import, Settings/theme/account/admin/tags, About/FAQ
Build: origin/main 1d9c2d6c (v0.84.0, web, Postgres) at http://127.0.0.1:8831, user ui-gate-admin. Headless Playwright Chromium, axe-core 4 (WCAG 2.2 A/AA) + schema 7.3 contrast sampler in light and dark, layout-shift observer, API capture.
Scripts: `scripts-cohort/s01–s31.js`, fixtures in `scripts-cohort/fx/`. Screenshots: `shots/cohort/NN-*.png`.
Hygiene: imported reaudit-design-nobuild, -trio-a, -trio-b, -jsonok, -afrange (ragged one was rejected). All deleted at the end, so the case list is back to the original 10. Tag reaudit-design-tag was created and deleted. Theme changes stayed in my own browser contexts. Sign-out ran only on a session I created. No user was created: the form blocks short passwords.

## 1. Scorecard (baseline -> now)
Weights: D1 7, D2 6, D3 7, D9 6, D10 9, D11 7, D12 6, D13 10, D14 5.

| View | D1 | D2 | D3 | D9 | D10 | D11 | D12 | D13 | D14 | Score |
|---|---|---|---|---|---|---|---|---|---|---|
| Cohort + gene burden | 50 | 75 | 75 | 75 | 75 | 75 | 50 | 50 | 75 | **65.9** (was 50.4) |
| Import | 75 | 75 | 50 | 50 | 75 | 75 | 50 | 50 | 75 | **63.5** (was 59.5) |
| Settings/theme/account/admin/tags | 75 | 75 | 75 | 75 | — | 75 | 75 | — | 75 | **75.0** (was 71.0) |
| About / FAQ | 75 | 75 | 75 | 75 | — | — | 75 | — | 75 | **75.0** (was 67.6) |

Evidence:
- **Cohort**
  - D1 50: the table is 2,104 px wide in a 1,160 px viewport at 1440. Carriers starts at x=1538 and Cohort freq at 1666, so both are off-screen at 1440 and 1280 (s03).
  - D2 75: positions are no longer truncated, numerals are tabular, HGVS is monospace. Words still break mid-token in burden at 390 (81).
  - D3 75: axe shows 0 serious/critical and the contrast sampler 0 fails on cohort, filters, carriers and burden, in light and dark (s26).
  - D9 75: View in Case opens the variant with its panel, and Back restores `/cohort?q=` (s06, 09). The sidebar Cohort combobox is still "No data available".
  - D10 75: `/`, Ctrl+Shift+F, Alt+Shift+C, Ctrl+Shift+X, Esc, `e` and Enter all work in the cohort (s03, s29). The DSL error is inline. There is no rarity/impact nudge before a burden run.
  - D11 75: DSL clauses show as chips. Burden warnings are amber sentences. Run Analysis is still disabled with no reason given. The volcano plot is empty with untitled axes, and Fisher OR shows "–" next to a CI (24, 25).
  - D12 50: one functional parity gap. The SV/CNV/STR tabs lack the case table's End, SV Type, Length, Support, VAF, Repeat Unit and copies columns (s04 vs s05). The drawers and column groups also still differ.
  - D13 50: chromosome names are normalised and the per-type denominator is stated (s07, column tooltips). But STR rows in the cohort show only `<STR17>` with Gene/Impact/ClinVar instead of repeat unit and copies. The cohort AF comes from an unnamed representative case: 0.5131 in the cohort vs "--" in HG002-SnpEff.
  - D14 75: every column header has a definition with thresholds, the shortcut sheet now holds in the cohort, and the burden assumptions are stated.
- **Import**
  - D1 75: the empty footer band under the source cards is still there. The "Genome build" label is indented 16 px off the section grid (32).
  - D2 75: no clipping in the wizard. Text in the multi-file type select is clipped (49b).
  - D3 50: in the multi-file dialog the "SV" chip measures 2.08:1 and "Unknown caller" 2.59:1 (axe color-contrast ×2, light).
  - D9 50: there are still two entry points with different models ("Import VCF Files" vs "Import Data"), and Folder/ZIP are offered in the browser.
  - D10 75: one click confirms the build, and the multi-sample naming is fluent.
  - D11 75: a bad file is named and skipped ("1 file skipped: reaudit-design-bad.txt: not an importable file type"). A ragged row fails with "Row 1 has 18 values but the header declares 19 columns". The summary has no Open-case action. A stale upload chip stays in the app bar.
  - D12 50: batch silently accepts tag-only build evidence that the single-file flow makes you confirm. The two import models are still separate.
  - D13 50: build confirmation and the row-length check are solid. But gnomAD AF = 40 imports with no warning and displays as "40.0000" (s22).
  - D14 75: the build hints are explanatory. There is no notice for unannotated VCFs.
- **Settings**: the dark app bar is now rgb(48,53,62). There is no theme flash: the body is rgb(18,20,26) from the first frame. Back after sign-out lands on `/login?next=` with 0 × 401. Create User disables the button below 12 characters. Focus returns to the trigger after Esc. Still open: External lookups appears twice, the VarLens Web menu holds only `web:postgres`, Display Name is separate from the account name, Reset has no undo, and the Add Tag form shows "required" before any input.
- **About/FAQ**: the FAQ now describes the desktop and web editions correctly, names every external service, and says lookups are admin-enabled and audit-logged. About is still only "VarLens v0.84.0 · Web edition". The FAQ still says "single-variant analysis only", although Gene Burden exists.

## 2. Baseline findings — status
| ID | Status | Evidence |
|---|---|---|
| C-P1-1 DSL shows "No filters applied" | **FIXED** (cohort) | `gene:CFTR AND impact:HIGH` → chips "Gene ~ CFTR", "Impact ~ HIGH" (04). Case-view DSL was not re-tested here. |
| I-P1-1 ragged JSON shifts columns | **FIXED** | Rejected with "Row 1 has 18 values but the header declares 19 columns". The fixture is repaired (19/19). The AF range check is still missing (N-cohort-1). |
| F-P1-1 false FAQ data claims | **FIXED** | FAQ "How is my data stored?" and "Is my data shared?" cover both editions (s25). |
| C-P2-1 SV/CNV/STR use SNV columns | **STILL OPEN** (improved) | Ref, gnomAD, CADD and cDNA are dropped, but there is no End, Length, SV Type, Support, VAF, RU or copies. |
| C-P2-2 `/`, Ctrl+Shift+F dead in cohort | **FIXED** | `/` focuses search, C-S-F opens Filters, Alt+Shift+C opens Columns, C-S-X clears. |
| C-P2-3 Esc doesn't close drawers | **FIXED** | 2 → 1 active drawers after Esc (only the sidebar remains). |
| C-P2-4 invalid DSL dropped | **FIXED** | `gene:===` keeps the last valid query and shows inline "Expected colon, got operator". |
| C-P2-5 case vs cohort cell text | **FIXED** | chr22:29,001,799: "intron variant", ENST00000544604.7 and the cDNA are identical in both views. P3 residue: the representative-case source is unnamed. |
| C-P2-6 denominator mixes types | **FIXED** | The pill shows the per-type count (SNV 1,647, SV 5, CNV 3, STR 4). The tooltip defines the denominator per type. |
| C-P2-7 `1` vs `chr1` | **FIXED** | getColumnMeta chr = chr1…chrX only. |
| C-P2-8 cohort columns off-screen ≤1440 | **STILL OPEN** | Carriers at x=1538 (1440) and the same at 1280. At 390 only Chr/Position are visible. |
| C-P2-9 View in Case loses variant | **FIXED** | `/case?case=5&tab=snv`, banner "Showing variant chr22:29001799 T>TTATC opened from the cohort view", panel open, Back restores the cohort query. |
| C-P2-10 burden internal language / 55 vs 69 / OR-CI / empty volcano | **STILL OPEN** (partly fixed) | Warnings are amber sentences, and the summary "68 genes tested … 1 not tested" matches the "68 genes" table. Still open: OR "–" next to a CI, an empty volcano with untitled axes, no qualifying-variant nudge. |
| C-P2-11 Run disabled, no reason | **STILL OPEN** | Disabled, with no tooltip and no inline reason (20). |
| I-P2-1 raw upload errors | **FIXED** | Named banner "1 file skipped: …bad.txt: not an importable file type" (47). |
| I-P2-2 one bad file aborts batch | **FIXED** | The batch continues with 4 files and lists the skipped one (40). |
| I-P2-3 false "Auto-detected" build | **FIXED** | See §6 (genome-build confirmation). |
| I-P2-4 duplicate/empty names in single import | **FIXED** | "A case named 'HG002-VEP-panel' already exists", "Case name is required" (also for whitespace), "Each sample needs its own case name". Import is disabled in each case. |
| I-P2-5 two import entry points | **STILL OPEN** | Same two menu items (30). |
| S-P2-1 Back after sign-out broken shell | **FIXED** | Lands on `/login?next=%2Fcase`, 0 × 401. |
| S-P2-2 Create User wrong reason | **FIXED** | The hint says "At least 12 characters…", and Create stays disabled for "abcde". |
| S-P2-3 theme flash at login | **FIXED** | The dark login page matches the app. The body is rgb(18,20,26) throughout. |
| S-P2-4 / X-04 dark app bar slab | **FIXED** | App bar rgb(48,53,62). The sidebar header is now the bright slab (N-cohort-7). |
| X-P2-1 focus not returned | **FIXED** (Preferences checked) | After Esc, activeElement = "Application settings" button. |
| C-P3-1 position truncated | **FIXED** | "156,134,600" shown in full. |
| C-P3-2 cohort metrics under "External Links" | **STILL OPEN** | The Columns drawer still lists CADD, Carriers, Cohort freq and Het/Hom under EXTERNAL LINKS (12). |
| C-P3-3 default sort unmarked | **STILL OPEN** | No aria-sort or arrow on any header. |
| C-P3-4 two "Carriers" headers | **STILL OPEN** | The expand column is still named "Carriers". |
| C-P3-5 lingering quick-filter tooltip | **FIXED** | No visible tooltip after click and move. |
| C-P3-6 filter-drawer differences | **STILL OPEN** | Cohort has no Tags/Inheritance, uses "gnomAD AF 1%" vs "Frequency <= 1%", and orders sections differently. |
| C-P3-7 Cohort combobox empty state | **STILL OPEN** | "No data available". |
| C-P3-8 carrier Case/Zygosity far apart | **STILL OPEN** | Case at x≈304, Zygosity at x≈1167 (08). The chip now reads "hom". |
| I-P3-1 empty footer band; file not named in preview | **STILL OPEN** | 31, 32. |
| I-P3-2 no Open action; "Remove from names" | **STILL OPEN** | 36, 40. |
| I-P3-3 no unannotated notice | **STILL OPEN** | Only an "Unannotated" chip (82). |
| S-P3-1 Display Name duplicate | **STILL OPEN** | 65. |
| S-P3-2 External lookups twice; VarLens Web menu | **STILL OPEN** | s24. |
| S-P3-3 Reset with no undo | **STILL OPEN** | `App.vue:260-266` resets immediately (code). |
| S-P3-4 "Tag name is required" before input | **STILL OPEN** | Shown as soon as Add Tag opens. |
| S-P3-5 burden @390 | **STILL OPEN** | "Sele / ct all", "reaudit- / design-" (81). |
| A-P3-1 About thin | **STILL OPEN** | Version + edition only (54). |
| Combined I-01 / H-01 / X-07 / X-12 | **FIXED** | As above. X-12 in this area covers upload errors, burden codes and duplicate names. |
| Combined D-01 | **FIXED for cohort** | Case view not re-tested here. |
| Cohort page-load CLS 0.042 | **STILL OPEN** (marginal) | 3 runs: 0.0195 / 0.0250 / 0.0206, median 0.0206 > 0.02. The case → cohort toggle is 0.0064. |

Counts: **22 FIXED · 21 STILL OPEN · 0 REGRESSED** (CLS line counted as open; combined-report duplicates not double-counted).

## 3. NEW findings
| ID | Sev | View | Dim | Evidence / repro |
|---|---|---|---|---|
| N-cohort-1 | P2 | Import | D13 | JSON with GnomadAF = 40 (fx/reaudit-design-afrange.json) imports with no warning. The case table shows gnomAD AF "40.0000" for BRCA1 c.5123C>T, which is pathogenic. Every rare preset would hide it. The leftover of I-P1-1's "validate AF ∈ [0,1]". (It becomes P1 under the floor rule if any real producer emits it.) |
| N-cohort-2 | P2 | Import (multi-file) | D3/D8 | Per-file variant-type v-select: the value chip is clipped to "S" (SV) at 2.08:1, "Unknown caller" is 2.59:1, and axe reports `label` ×2 (unnamed selects). Users cannot verify the type assignment. Repro: Import VCF Files → Browse → nobuild.vcf + synthetic-sv.vcf (49b). |
| N-cohort-3 | P2 | App bar after multi-file upload | D11/D8 | Cancelling the multi-file dialog leaves a "2/2 (100%)" upload chip in the app bar. Its progressbar has no name: axe `aria-progressbar-name` serious ×2 in every later view (prefs, tags, users, FAQ), in both themes (65). |
| N-cohort-4 | P3 | Import (batch) | D12 | Batch assigns a build from header tags alone ("reaudit-design-tagonly · GRCh38", "1 from header tags only"). The single-file flow treats the same evidence as "Select the build to continue" and pre-selects nothing. |
| N-cohort-5 | P3 | Import (build) | D11/D2 | The "— header disagrees" suffix is ambiguous. In the conflict case it sits on GRCh37, the build that the Reference header *names*. Clicking Import without a build swaps the reason ("No genome build found in this file…") for the generic "Choose the genome build these coordinates use." "~1 variants" is not pluralised correctly. |
| N-cohort-6 | P3 | Cohort | D1 | The inline DSL error message box overlaps the preset-chip row below the search field (04). |
| N-cohort-7 | P3 | Theme (dark) | D3/D5 | The sidebar "Cases (15)" header is a bright light-blue `primary` slab in dark, so the glare moved from the app bar to the sidebar (60, 65). |
| N-cohort-8 | P3 | Cohort vs case | D12 | The count pill shows "1" in the cohort but "1 / 1,585" in the case view. |
| N-cohort-9 | P3 | Import (multi-file) | D11 | The file subtitle shows the raw internal ref "web-upload:1e94da05-…". The banner says "Detected 2 VCF file(s) — Sniffles2 pipeline" for a VEP SNV file plus a Sniffles SV file. |
| N-cohort-10 | P3 | FAQ | D14 | "currently supports single-variant analysis only" contradicts Gene Burden. "Classifications are based on … CADD scores, gnomAD frequencies" misdescribes the manual ACMG evidence editor. |
| N-cohort-11 | P3 | Cohort @390 | D1 | Only Chr and Position are visible, and the Gene column is off-screen (80). |

## 4. Nielsen (area), baseline -> now
| # | Heuristic | Base | Now | Evidence |
|---|---|---|---|---|
| 1 | Visibility of status | 2 | 3 | DSL chips, per-type counts, burden summary = table. Run-disabled reason missing. Stale upload chip. |
| 2 | Real world match | 2 | 3 | Burden warnings in sentences, plain build copy. Still "header disagrees", "web-upload:<uuid>", "Remove from names". |
| 3 | User control | 3 | 3 | Esc closes drawers, Back works everywhere. Reset has no undo. |
| 4 | Consistency | 1 | 2 | Parity gaps: SV/CNV/STR columns, drawer sections, column groups, pill format. Two import models. Batch vs single build rule differs. |
| 5 | Error prevention | 2 | 3 | Duplicate/empty names blocked, build must be chosen, ragged rows rejected, short password blocked. AF range not checked. |
| 6 | Recognition | 3 | 3 | Header definitions with thresholds, inline DSL errors. |
| 7 | Flexibility | 2 | 3 | All cohort shortcuts work, View in Case keeps context. No batch rename. |
| 8 | Aesthetic/minimal | 3 | 3 | Calm, and dark app bar fixed. Empty footer band, dark sidebar slab, clipped type chips. |
| 9 | Error recovery | 2 | 3 | Named file errors, row-level JSON error, batch continues. |
| 10 | Help | 2 | 3 | FAQ correct for web. About still thin, and one FAQ line is stale. |
| | **Total** | **22/40** | **29/40** | |

## 5. Case ↔ cohort parity matrix (redone)
| Aspect | Case | Cohort | Status |
|---|---|---|---|
| Free-text search + chip | yes | yes | ✅ |
| DSL chips in applied bar | (not re-tested) | per-clause chips | ✅ cohort |
| Invalid DSL | inline error | keeps last valid + inline error | ✅ |
| Presets / ACMG chips | 9 + P…B | same | ✅ |
| Filter drawer sections | + Tags, + Inheritance, "Frequency <= x%" | no Tags/Inheritance, "gnomAD AF x%", different order | ❌ (C-P3-6) |
| Columns drawer groups | CADD under Scores | CADD + cohort metrics under External Links | ❌ (C-P3-2) |
| Cell formatting | humanised SO, versioned tx, `--` | identical | ✅ |
| SV/CNV/STR columns | type-specific | generic (no End/Length/RU/copies) | ❌ (C-P2-1) |
| Keyboard `/`, C-S-F, Alt+Shift+C, C-S-X, Esc | work | work (+ `e` expand, Enter panel) | ✅ |
| Count pill | "n / total" | "n" | ⚠ (N-cohort-8) |
| Default sort | chr,pos | carriers desc, unmarked | ⚠ (C-P3-3) |
| URL state | yes | yes (`?build=&q=`, Back restores) | ✅ |
| Row actions star/ACMG/comment | yes | yes | ✅ |
| Chromosome naming | chrN | chrN (normalised) | ✅ |
Baseline: 9 divergences. Now: 3 functional/structural gaps (❌) plus 2 cosmetic (⚠).

## 6. Genome-build confirmation (new step) — detail
- **Detection succeeds (contig lengths):** GRCh38 is pre-selected. Hint: "Contig lengths match GRCh38 (25 of 25)." An ⓘ button holds the evidence list. GRCh37 carries "— header disagrees". Picking GRCh37 anyway turns the hint amber: "The contig lengths are GRCh38. Variants imported as GRCh37 get the wrong chromosome names and links."
- **Header tags only:** nothing is pre-selected. GRCh38 is marked "· suggested". Hint: "Found in the bcftools header (grch38). No contig lengths to confirm it. Select the build to continue."
- **Nothing found:** nothing is pre-selected. Hint: "No genome build found in this file. Choose the build these coordinates use."
- **Conflict** (GRCh38 lengths vs `##reference=hg19`): nothing is pre-selected. Hint: "Contig lengths say GRCh38, but the Reference header says GRCh37. Check before importing."
- **Cannot be skipped silently:** clicking Import with no build shows the inline error "Choose the genome build these coordinates use." and moves focus to the first radio. No API call is made (s15, 33). The same holds in batch ("Build for files without one" plus the JSON hint "JSON files carry no genome build…").
- `import/start` carries `genomeBuild` explicitly (s17).
- **Multi-file dialog:** has the same control and applies one build per case.
- **Weak spots:** batch accepts tag-only evidence without asking (N-cohort-4), and the wording issues in N-cohort-5. Detection from a single contig (chr1 only) counts as definitive and pre-selects; that is acceptable because chr1 lengths differ between builds.

## 7. Design director
The area now feels designed, not just assembled. The cohort table speaks the case table's language: same cell formatters, same chips, same keys. The column headers carry clinically exact definitions (BA1/PM2 caveats, CADD calibration bands), and that is the most distinctive and trustworthy layer in the product. Cognitive load dropped where it mattered most. Hidden DSL filters are gone. Denominators are per type and defined. View in Case lands on the variant with a "Show all variants" escape. The genome-build step makes an invisible default into an explicit, evidence-backed choice in one radio row, without a banner. The emotional journey is now mostly steady, with three rough spots. Gene burden still ends in an anticlimax: an empty volcano, "–" odds ratios and 68 warnings for a 2-vs-2 run. The multi-file importer looks less finished (clipped type chips, raw upload refs). And in dark mode the glare moved to the sidebar header. Strengths:
1. Data-flow honesty: FAQ, External lookups, build evidence.
2. Error copy that names the file, row and reason.
3. Keyboard parity across case and cohort.
