# Ponytail fix plan — 2026-10-12 UI/UX audit

Merged from `08a` (data safety), `08b` (theme/colour/type), `08c` (layout/a11y/learnability), `08d` (desktop/cohort/import). Every root cause was opened in code at `bfd3d80e`. Several were corrected (marked ✱). Sizes are net lines of authored code.

**Total for all DO items: about 50 fixes, about +280 net lines.** The largest single items are the shared Esc/focus mechanism (+31), the theme-flash fix (+32) and column-header help (+25). No new dependencies.

## PR split (each PR is independently shippable, in this order)

### PR 1 — `fix/data-safety-audit` (wrong or missed data) · about +40 lines plus fixture repair
| Item | Fix | Size |
|---|---|---|
| F-01 P0 | `interactive` prop on Shortlist panel and table, the same guard `VariantTable` has | +8 |
| I-01 | `FieldMapper` rejects a row whose length ≠ header length. Repair `columnar-format.json(.gz)` (add `selectedTranscript` to all 50 rows) and its two hashes in `scripts/data-fixtures/sources.json` **in the same PR**. Delete the cached perf fixture once. | +8 |
| D-02 + **new `!~` bug** | DSL parser rejects unknown field, unsupported operator and NaN on numeric fields. **`!~` currently runs as "contains", so it shows exactly the variants the user excluded.** A query with errors is never applied. The cohort's existing error banner becomes shared and is used by the case table. | +12 |
| D-01 ✱ | DSL chips via existing `buildColumnFilterChips` in `FilterToolbar.vue` + `CohortFilterBar.vue` (not `SlimFilterToolbar`) | +5 |
| P-02 | Quick ACMG chips disabled when evidence exists, pointing to the existing Override (panel and case/cohort row quick-menu) | +10 |
| P-03 | Panel Esc ignores inputs and open overlays; cancelled edit never blur-saves; comment text keyboard-editable | +4 |
| N-01 ✱ | Sync CaseList through the existing `restoredCaseId` guard (the audit's watcher would re-fire the draft prompt) | +2 |
| C-P2-4 ✱ | Stale free-text search left behind while typing a DSL field; show the error inline | −4 |

### PR 2 — `fix/hgvs-and-formatting` · about −15 lines
- One `formatHgvs` used by the table, cohort, shortlist, panel, Copy and transcript list. Keep the `ENST…` prefix (it is the only transcript version stored), so don't strip it. Decode `%3D` at VCF import.
- Date: remove the extra `* 1000`. Reuse `ConsequenceCell` everywhere. One empty-value glyph. Absolute SV length. STR repeat ID as the title. Existing ClinVar cell in the shortlist.

### PR 3 — `fix/theme-semantic-colours` · about +35 lines
- **One CVD-safe semantic colour map** for ACMG, ClinVar, impact and zygosity. It adds only 3 new tokens (`acmg-lp`, `acmg-lb`, `acmg-b`), darkens `error` and moves `warning`. Every pair has ΔE ≥ 11 under normal, protan, deutan and tritan vision in both themes, and all text is ≥ 5.1:1. Toolbar chips derive from row chips, and the cohort gets it for free.
- `app-bar` / `on-app-bar` tokens (dark `#30353E`). The focus ring reads a variable set by the app bar.
- Delete the ACMG evidence inactive-colour map. Grey chips use `muted`. Fetch VEP and source chips use tokens. Drop gnomAD AF red and its dead branch.
- Plots and the 3D side panel sit on a light `v-theme-provider` surface in dark mode, matching the Mol\* canvas and PNG export.
- Theme flash: CSS `prefers-color-scheme` in the 3 HTML pages, a `data-theme` attribute, and the Electron window background from `nativeTheme`. An inline script would be blocked by the CSP.
- Courier New → existing `--font-mono` (10 sites, sizes unchanged). UI font: a one-line system-ui stack.
- Test: extend `tests/renderer/plugins/clinvar-theme-tokens.test.ts` (tokens only, ≥ 4.5:1 both themes, chip parity, lightness ratio).

### PR 4 — `fix/layout-a11y` · about +100 lines
| Item | Fix | Size |
|---|---|---|
| X-01 | One-line chip rows; preset row as `v-slide-group show-arrows`. **Measured:** panel CLS 0.21/0.31 → 0.011/0.012, mobile per-filter 0.18 → 0.0002 | ±8 |
| Cohort load CLS | Always render `PresetBar` with a minimum height instead of a late `v-if` | ±2 |
| Filter drawer closes per click ✱ | `disable-route-watcher` on `FilterDrawerShell.vue` (case and cohort) | +1 |
| Sticky header ✱ | `thead { z-index: 3 }` | +3 |
| X-03 | aria-labels + native `indeterminate` in the columns drawer; add filter/columns drawer states to `tests/ui-gates/support/app-states.ts` | +18 |
| X-06 | Esc on both drawers via existing `usePanelFocus`; one shared Esc guard; one global ~20-line focus-return listener for all dialogs | +31 |
| R-01 ✱ | Column priority Gene · Chr · Pos · Impact · ClinVar (720×450 pagination was reachable, not a bug) | ±11 |
| F-07 | Reset panel scroll on variant change; name the variant in the heading (trim 3 comments to stay < 600 lines) | +2 |
| L-01 | `??` → `||` for protein length, plus an empty-plot note | +4 |
| P-01 | ClinVar via existing `ClinVarCell` plus a GT/DP/GQ/AB/FILTER line from row data | +12 |

### PR 5 — `fix/desktop-audit` · about +40 lines
- E-01: the pool terminates a worker once it has reported every gene in its batch, and Cancel kills live workers (`WorkerPool.ts` only, +6).
- E-03: guard export paths against the current/recent database and its `-wal`/`-shm`/`-journal` files, in case, cohort and BED handlers (+14).
- E-02: delete `if (!isWebRuntime()) return` (`App.vue:383`).
- E-04: reuse the Recent-list open handler (−12).
- E-05: "No database is open" empty state; Import blocked until a database is open (+8).
- E-08/I-P2-4: throw the Postgres duplicate-name error type from SQLite too; name checks in the preview step (+17).
- E-09: check the file's first bytes before asking for a password (+7).
- Export AF/CADD as numbers.

### PR 6 — `fix/cohort-import-web-polish` · about +45 lines
- Cohort `/` and Ctrl+Shift+F.
- "View in Case" lands on the right tab.
- Burden: table count equals summary count, warnings as sentences.
- Hide SNV-only columns on cohort SV/CNV/STR tabs.
- Upload errors without raw JSON; one bad file skips instead of aborting the batch; "Not detected" genome build.
- Back after sign-out → login (reload on 401, but **not** on a user-mistake 401).
- Password rule 8 vs 12 aligned.
- FAQ copy true for both editions (desktop also makes external calls).

### PR 8 — `feat/bundled-fonts` (decided 2026-10-12: bundle) · about +10 lines plus 2 dependencies
- `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono` (Latin subset, imported once in the renderer and web entry so Vite bundles them for offline use). Set `--v-font-body` / `--font-mono` and `font-feature-settings: "tnum"` on data cells. Drop the system-stack line from PR 3.
- Ships after PR 3 and PR 4. Re-baseline `make ui-gates`, `make perf-interaction-gates` and the docs screenshots, and check truncation at 1280×720 and 1440×900 in light and dark.

### PR 7 — `feat/learnability-lite` · about +35 lines
- Column-header help: existing `data-tooltip` on `VariantColumnHeader` plus one help map (definition, source, thresholds).
- Shortcut hints in tooltips from one shared shortcut list.

## Deferred: needs your decision or a migration
1. ~~Bundle fonts~~ — decided: bundle (PR 8).
2. **`1` vs `chr1` normalisation** at import with a migration on both backends (~+45). This currently undercounts cohort carriers.
3. Cohort frequency denominator per variant type.
4. ACMG classifications and comments in export (+30).
5. Reopen the last database at startup (password / shared-machine security).
6. Required ACMG override reason (schema change).
7. Explain-why empty states, Ctrl/⌘K palette (~+120), clinical-question presets (migration). Live preset counts: **skip**.
8. Gene-structure ticks/exon labels, a shape cue for ClinVar in plots, and the cohort End column.

## Over-engineered proposals rejected
- Amber `warning` (merges with error under deuteranopia, ΔE 1.8).
- Inline localStorage theme script (blocked by the CSP).
- ~15 strength-specific ACMG tokens.
- Full re-theming of plots.
- A new worker `done` protocol.
- A prop-and-watch sidebar sync.
- Stripping `ENST` from HGVS.
- Live counts in preset tooltips.
- Seven heavier variants in reports 04/06 (listed in `08d`).

## Verify before claiming done (per PR)
- `make typecheck`, `make rebuild-node && make test`.
- PR 3/4: `make ui-gates` + `make perf-interaction-gates`, plus a visual check in light and dark.
- PR 5: `make preflight-full`.
- Re-run this audit's scripts (`~/.cache/varlens-session/uiux-1012/`) for the before/after scores.

## Addendum 2026-10-12 (after rebase onto v0.84.0 / `56ca9cb9`)
`main` gained PR #565 (filtering-UX audit batch) after this audit ran on 0.83.0. Items it may already fix, so they must be re-tested before coding: D-01 DSL chips + D-02 DSL errors (13c9f304, 6f70e993, 9ff2ed38), cohort `/` and Ctrl+Shift+F (bd935b61), "View in Case" exact carrier (abd00e5f), filter drawer on narrow viewports (15e6bddd), cohort genome build from URL (95b06e43).

Open issues from the parallel review (#545–#564, filed 2026-10-12) that this program covers — reference them in the PRs:
- #545 burden worker never exits → PR 5 (E-01).
- #547 VEP percent-encoding → PR 2 (decode at import + display). The issue's backfill migration remains open.
- #557 batch genome build → build-detection PR (doc `10`).
- #555 internal AF partitioned by build → denominator PR (doc `09`).

Decisions: chr names per build; merge colliding ACMG by keeping the newer one and logging the other; SV/CNV/STR no-calls stop counting as carriers; separate per-build annotations outside the main contigs is deferred (schema). Builds stored wrongly by past batch/JSON imports are re-checked **before** the chr migration (doc `10` risk). Everything config-driven (`src/shared/config`); every PR gets a ponytail review.
