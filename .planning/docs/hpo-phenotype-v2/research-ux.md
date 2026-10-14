# S4 UX research: phenotype status and key-term weighting in VarLens

Repo: VarLens-wt/sprint-3 @ 9335522e. Phentrieve is not integrated into VarLens (no code reference found).

## 1. External patterns

| Tool | Excluded / absent | Key term | Explanation |
|---|---|---|---|
| PhenoTips | A Y/N pair per term. Nothing selected means not assessed. The record keeps both "observed" and "not observed (pertinent negative)" | none | none |
| Phenopackets v2 | `excluded: true`. A term that is not listed is not assessed. Excluded never means "unknown" | none (modifiers/severity only) | n/a |
| Face2Gene CLINIC | You paste notes, press **Extract**, then mark each suggested term present or absent | none | none |
| Doc2Hpo | NegEx marks the term, shown in **red** with an **"N" toggle button** on each concept. Double-click deletes. You can highlight text to add a term | none | none |
| Phentrieve (own frontend) | Statuses: affirmed / negated / normal / uncertain. Negated shows as a pink chip plus an assertion-toggle icon button with an aria-label (`PhenotypeCollectionPanel.vue:83-121`) | none | none |
| LIRICAL HTML | The report header lists observed **and excluded** terms. Each term gets a bar (blue = supports, **red = works against**) | none | per term, per disease |
| Emedgene | Batch paste of terms or IDs, capped at 100, limited to HP:0000118 | none | none |
| RD-Connect GPAP | Observed / Not observed per term | none | none |

Takeaways:
- (a) Use three states, and "not assessed" is just the term being absent. Never store "not assessed".
- (b) Excluded must not rely on colour alone. Pair colour with a glyph or prefix ("N", minus, "no …").
- (c) Bulk entry from free text needs negation detection plus a per-term flip before you commit.
- (d) Explain per term and sign it, as LIRICAL does. Counter-evidence goes in its own visible group.
- No tool I surveyed offers a "key finding" marker. This is open ground, so keep it to a single star toggle.

## 2. VarLens today

- Picker: `src/renderer/src/components/HpoTermSelector.vue`. Chips at :5-19 are all `color="info"` and closable. The autocomplete is at :34-73. The emit at :94-97 is add/remove only. It searches the bundled `hpo-terms.json` through `useHpoBundled.ts:52`, and the web side uses `src/web/server/web-hpo-terms.ts`.
- Host: `CaseMetadataCard.vue:78-89`, the "Phenotypes" row.
- Case header: `case/ProbandContextBanner.vue:12-42` shows the first 3 terms as x-small primary chips (slice at :48-49), with the rest in a "+N more" tooltip.
- State: `composables/useCaseMetadata.ts:395-470` does optimistic assign/remove. `CaseHpoTerm` is at `shared/types/database.ts:507` and has no status or weight.
- Score: `main/database/ShortlistService.ts:311-312` passes plain `hpo_id`s to `openHpoGeneScorer`. The explanation lives in `shortlist/RankScoreTooltip.vue:45-55, 79-98` and is mounted once in `ShortlistTable.vue:385-400`. `EvidenceContribution` (`shared/types/evidence-ruleset.ts:49-56`) has no phenotype detail.
- Case-list HPO filter: `CaseList.vue:29-40`. It must match **present** terms only.
- Rules that apply: compact density, small text on purpose, tooltips `bg-secondary`, no `surface-variant`, `canUse()` for capabilities.

## 3. Design

### 3.1 Data contract (smallest)
Add `excluded: boolean` (default false) and `key: boolean` (default false) to `CaseHpoTerm`. Add one IPC `caseMetadata.updateHpoTerm(caseId, hpoId, {excluded?, key?})` using the domain-module pattern and add it to the parity manifest. A key term must be present, so the handler rejects `key && excluded`.

### 3.2 HpoTermSelector (extend, don't fork)
Split the chips into two labelled rows:
- **Present**: the current tonal `info` chips. A key term gets a prepended `mdiStar` icon (size 12) and `font-weight-bold`.
- **Excluded**: tonal `error` chips with a prepended `mdiMinusCircleOutline` icon, the label prefixed with visible text "no ", and `text-decoration: line-through` on the label only. That is four cues, so meaning survives without colour.

Clicking a chip opens a v-menu with these items: "Present", "Excluded (examined, absent)", "Key finding" (checkbox, disabled when excluded) and "Remove". Remove stays on the chip's close button.

The autocomplete gets an inline segmented `v-btn-toggle` "+ / −" that sets the status for the next add. The default is "+".

**Keyboard flow:**
- Type, then ↓/↑, then Enter to add as present.
- **Shift+Enter** adds as excluded. Mirror this in the placeholder: "Type term · Shift+Enter = excluded".
- Focus moves back to the input after each add.
- Chips are reachable with Tab. On a focused chip, `x` flips present/excluded, `k` toggles key, and Delete/Backspace removes.
- Expose this with `aria-keyshortcuts`.

### 3.3 Free-text bulk entry (phase 2, optional)
Add a "Paste notes…" text button that opens a dialog. Run negation scoping locally (offline; port Phentrieve's ConText rules, not the service). The dialog lists candidates as rows of the same chips with a status toggle, and an "Add N present, M excluded" button. Gate it with `canUse('hpoSearch')`. Skip it for v1 if time is short. Typed Shift+Enter already covers excluded entry.

### 3.4 Case header (ProbandContextBanner.vue:12-42)
Order the chips key first, then present, then excluded. Keep 3 visible plus overflow. Excluded chips use the same minus icon and "no " prefix.

The overflow tooltip groups its lines as "Key: …", "Present: …" and "Excluded: …".

Add `aria-label` to every chip, for example "Seizure, key finding" or "Microcephaly, excluded".

The empty state stays "No clinical phenotypes recorded". If only excluded terms exist, append "· no present phenotypes, phenotype score inactive".

### 3.5 Score explanation (RankScoreTooltip.vue)
Extend the row with an optional `phenotype?: { matched: {label, key, ic}[]; conflicts: {label, freq, disease}[]; disease?: string }`. The main side returns it with the score, at the scorer opened at `ShortlistService.ts:311`.

When it is set, render a block under the evidence rows. Cap each line at 3 items plus "+N":

```
Phenotype (hpo_resnik 4.2) · best: Dravet syndrome
✓ matched: ★ epilepsy · hypotonia · ID
⊖ conflicts: microcephaly excluded, 80 % in Dravet
```

The conflict line uses `text-error` plus the glyph, never colour alone. "matched" lists patient→gene best matches above an IC floor, so it shows ancestor matches as "seizure ≈ focal seizure".

The tooltip already opens without hover/focus (`ShortlistTable.vue:386-389`). Keyboard users need the score cell focusable (`tabindex=0`, `:data-rank-tip`) with the same tooltip on focus. That is an existing a11y gap, so fix it here.

### 3.6 Empty / error states
- No HPO data: keep `RankingHpoHint.vue` and add "excluded terms need HPO data" to its copy.
- Search failure: the existing `searchError` (:63-65) is enough.
- Status update fails: roll back optimistically (same pattern as `useCaseMetadata.ts:441-466`) and show a snackbar.
- Excluded-only cases: score null, with the header note above.

### 3.7 Parity
- Web: new IPC entries in the parity manifest as `sharedWrite`, plus the PG migration.
- Cohort: no cohort phenotype editor exists, so there is nothing to mirror. `CaseList.vue` HPO filter and `OverviewPhenotypesSection.vue:47-48` must filter `excluded = 0`, or add a "status" column there.

### 3.8 Files to touch
`HpoTermSelector.vue:5-19,34-73,94-97` · `CaseMetadataCard.vue:83-87` · `ProbandContextBanner.vue:12-49` · `useCaseMetadata.ts:395-470` · `shared/types/database.ts:507` · `MetadataRepository.ts:179` + PG read executor `:72` · `ShortlistService.ts:311-312` · `RankScoreTooltip.vue:28-35,79-98` · `ShortlistTable.vue:291-293,385-400` · `RankingHpoHint.vue` · `CaseList.vue:29-40` · `OverviewPhenotypesSection.vue:47-48` · shared/preload/main `ipc/domains/case-metadata` + parity manifest.
