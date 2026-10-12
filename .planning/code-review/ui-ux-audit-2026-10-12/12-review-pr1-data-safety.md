# 12 — Review PR 1 `fix/data-safety-audit` (6 commits, `git diff origin/main...HEAD`)

**What this change does:** It covers 08a items 1-4 and 7 plus 08d item 10. Import now fails when a columnar row has a different number of values than its header (the fixture is repaired, and the 100-case cache rebuilds when its source changes). The hidden Shortlist table ignores keys. Esc in a comment edit no longer saves the text or closes the panel. Quick ACMG chips are locked when evidence exists (panel, case rows and cohort rows). The sidebar highlight follows the open case. A leftover full-text search is cleared in DSL mode. D-01 and D-02 (items 5-6) were already on main from #565 (the parser rejects unknown fields, unsupported operators and NaN, and `dsl:` chips are built), so they are rightly not part of this branch. I traced the code; 9 changed test files pass (95 tests, no type errors).

## Must fix
1. **The docs screenshot job still imports the broken 18-of-19 layout** (`tests/e2e/test-data/demo-case.json`, used by `tests/e2e/screenshots.e2e.ts:19`, run by `docs.yml` build-screenshots). It has the same header as the fixture, and all 50 rows are missing `selectedTranscript`. With the strict check this import now fails, so the screenshot capture breaks (until now it captured shifted CADD/AF/ClinVar data). **Fix:** apply the same repair (insert `0` at index 8 in every row). That is the only other ragged file in `tests/`; I scanned every header+data JSON there.
2. **Esc in a menu opened by mouse still closes the panel** (`VariantDetailsPanel.vue:556-558`; `VariantTable.vue:605-612`; `CohortDataTable.vue:455-461`). A menu that a click opened keeps focus on its button inside the panel (`vuetify/.../VMenu.js` moves focus into the menu only on keyboard open). So `e.target.closest('.v-overlay')` misses it, and the Tags menu plus Esc closes both. Separately, the table Esc handlers close the panel or deselect, and they rely on `isInputFocused()`, which only knows about dialogs. **Fix:** at `useTableKeyboardNav.ts:50`, widen the selector to `.v-dialog.v-overlay--active, .v-menu.v-overlay--active`, and use that same check in the panel instead of the `e.target` test. The new test fakes a `.v-overlay` around the target, so it cannot catch this.

## Should fix
3. **A note alone locks the quick chips** (`useAnnotationDialogs.ts:626`, `VariantDetailsPanel.vue:416` → `hasMeaningfulAcmgEvidence`, which counts `notes`). If the user typed only a note, the chips lock and the hint says "Set from evidence", but no evidence decides the class. The user can then classify only through Override. **Fix:** lock only on confirmed criteria or `is_override` (a 3-line sibling helper in `utils/acmg/acmg-undo.ts`). P-02 otherwise holds. Without evidence the chips work, and with evidence the Evidence editor or Override still classifies, from the panel, the case-row menu and the cohort-row menu.
4. **Hardcoded user-facing text.** `ACMG_EVIDENCE_LOCK_HINT` is correctly in `shared/config/domain.config.ts`. These are inline:
   - The new import error at `FieldMapper.ts:58-60`: a new `IMPORT_MESSAGES` entry in `src/shared/config/` (main and web both show it).
   - `'Click to add...'` (`InlineEditableText.vue:54`): a pre-existing default that is never shown, since `CommentsSection.vue:25,58` pass their own inline placeholders. Move all three to `src/renderer/src/config` (now that the element is keyboard-focusable, the text should not say "Click").
   - `'—'` (`InlineEditableText.vue:5`): the shared empty-value glyph planned in PR 2.
   - `'Evidence editor...'` and `'Clear classification'` (`AcmgQuickMenu.vue`): touched, but they were already there.

## Nice to have
5. **Enter on the focused comment also reaches the table's window Enter handler** (`InlineEditableText.vue:13`; `VariantTable.vue:594-600` sees a div, not an input), which re-sends `row-click` for the selected row. **Fix:** use `@keydown.enter.prevent.stop` and `@keydown.space.prevent.stop`.

## The other extra checks
- **I-01:** The check is skipped when there is no header (legacy positional files: `columnCount` is undefined). Empty trailing values stay `null` slots in JSON, so they count toward the length. The `.json` and its `.gz` are byte-identical once unzipped, and the sha256 and size match `sources.json:283,296`. Old 100-case manifests have no hash, so they rebuild once. Both import paths share `createMapperPipeline`, so SQLite and PG get the check together.
- **F-01:** When the Shortlist tab is visible, VariantTable gets `interactive=false` and the shortlist gets `true`, so no keys are lost. When it is hidden, all 5 shortlist handlers return early. Cohort has no shortlist.
- **N-01:** No loop. A click calls `selectCase(id)`, which returns false. A programmatic change is echoed once and swallowed by the guard. A cancelled draft goes through the code that was already there. `null` never sets the guard.
- **Parity:** The panel, the quick menu and the DSL composable are shared between case and cohort. The sidebar exists only for cases.

Verdict: fix 1 and 2 first.
Not checked: whether real producer files (outside `tests/`) ever have rows longer than the header; strict `!==` now rejects those, although extra trailing values never shifted data. Also not checked: full `make ci`, and the app in a browser.
