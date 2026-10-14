# Plan: HPO phenotype scoring for CNVs and STRs

Spec: `.planning/specs/2026-10-14-hpo-cnv-str-scoring.md`. Refs #600, #581, #582. Upstream: varlens-annotation-workflows#3, #4 and #5.

- **Batch branch:** `feat/hpo-cnv-str`, cut from `feat/hpo-phenotype-v2`. It is rebased onto `main` once v2 merges.
- **Lanes:** each lane runs in its own worktree outside the repo (`VarLens-wt/`) and merges into the batch branch. No lane edits a file another lane owns.
- **Heavy gates** run serialised, inside the memory-capped wrapper.

## Waves and dependencies

```
W0 contracts ─┬─ L1 ref-data ──┐
              ├─ L2 cnv ───────┼─ L5 wiring ─┐
              ├─ L3 str ───────┤             ├─ W3 merge, review, bench run, outcome
              └─ L4 ui ────────┴─ L6 bench ──┘
External gate for L5's CNV half: the multi-gene VEP CNV import test (separate lane).
```

| Lane | Needs | Unblocks |
|---|---|---|
| W0 contracts | — | all |
| L1 ref-data | W0 | L5 (real reference tables), L6 |
| L2 cnv | W0 | L5, L6 |
| L3 str | W0 | L5, L6 |
| L4 ui | W0 (types + fixtures) | W3 visual check |
| L5 wiring | L1, L2, L3. **CNV half also needs the import-test lane's verdict** that every CSQ gene of a multi-gene VEP CNV lands in `variant_transcripts` on both backends. If not, that fix comes first. | W3 |
| L6 bench | L1, L2, L3 (pure modules + DB builder) | W3 outcome |

**Reserved migrations:** SQLite v TBD, PostgreSQL 00TBD. None is expected: the derived fields are never stored, and the reference data lives in `hpo_similarity.db`. Reserve numbers only if review forces persisting the STR locus id.

## W0: contracts (one agent, committed on the batch branch first)

Owns:
- `src/shared/types/locus-reference.ts` (new): `DosageGene`, `DosageRegion`, `StrLocus`, `LocusReference`.
- `src/shared/types/hpo-profile.ts`: `HpoExplanation.locus?: HpoLocusNote`.
- `src/shared/config/hpo-locus-scoring.config.ts` (new):
  - dosage weights, coverage thresholds (spec §4);
  - the AnnotSV INFO key names, as placeholders until #3 fixes them;
  - STR decoy-free defaults.
- `src/shared/phenotype/phenotype-score.ts`: `explainDisease(ix, cs, d)` factored out of `explainGene`, which becomes a one-line wrapper, plus `sidak(cs, score, n)`.
- `src/main/services/phenotype/hpo-similarity-db.ts`: `HpoGeneScorer.scoreDiseases`, `explainDisease`, `sidak` (implemented; they are small).
- `src/main/services/scoring/evidence/case-context.ts`: types only.
  - `LightRow` gains the optional fields.
  - `DerivedFields` gains `hpo_best_locus`, `cnv_gene_count`, `str_band`, all null-filled.
  - `GeneContext.hetHits`.
- `src/shared/types/shortlist.ts`: `str_repeat_id`, `str_variant_catalog_id`, `str_repeat_unit`.
- `src/shared/dsl/column-registry.ts`: the three new fields in `SHORTLIST_DERIVED_COLUMNS`; `hpo_best_locus` also goes in `HPO_DERIVED_COLUMNS`.
- `src/shared/config/shortlist-evidence.config.ts`: `types: ['sv', 'cnv', 'str']`, `enabled` stays false.
- `src/shared/types/hpo-data.ts`: `HpoDataStatus.sources`.

Tests:
- `sidak(s, 1) === s` for every gene of the fixture index.
- `explainGene` output unchanged (snapshot).
- `scoreDiseases` max and unknown-id behaviour.
- Registry: new keys are `caseOnly` + `shortlistOnly` and absent from the cohort column metadata.
- `npx vitest run tests/shared/ipc tests/shared/types/preload-contract.test.ts`.

## W1 lanes (parallel)

### L1 ref-data

Owns:
- `src/shared/config/hpo-data.config.ts`: source URLs, pinned STRchive and Mondo tags + digests, `builderVersion: 6`.
- `src/main/services/phenotype/hpo-data-update.ts`: multi-source download, per-source fallback to the installed copy (spec §3), one atomic rename, ClinGen header and row-floor checks.
- `src/shared/phenotype/reference-sources.ts` (new, pure): ClinGen TSV, STRchive JSON and Mondo `xref` parsers.
- `src/shared/str/str-overrides.ts` (new): FMR1, ATXN2, HTT, DMPK, ATXN3.
- `src/main/services/phenotype/locus-reference-db.ts` (new):
  - `writeLocusReference(db, sources)`;
  - `readLocusReference(path)`, with the same mtime cache key as the phenotype index.
- `hpo-similarity-db.ts`: **builder function only**.
  - One call to `writeLocusReference`.
  - Admit region and catalogue diseases into `diseases`/`disease_terms`, never into `gene_diseases`.
- `src/main/services/phenotype/hpo-build-worker*.ts` and `scripts/build-hpo-similarity-db.ts`: pass the new sources through.
- `src/web/server/routes/hpo-data.ts`: status shape, if it re-maps fields.

Tests:
- Parser fixtures: trimmed real headers of each source, a malformed header, and a file under the row floor.
- Builder:
  - ORPHA:273, OMIM:611913 and OMIM:612475 are indexed;
  - `gene_diseases` and every gene score are byte-identical to the v4 build on the fixture (spec CNV-5).
- Update:
  - a digest mismatch on STRchive or Mondo fails closed;
  - a ClinGen failure leaves the installed DB untouched;
  - status lists `sources`.

### L2 cnv

Owns:
- `src/shared/phenotype/cnv-score.ts` (new, pure):
  - type from `sv_type`/CN with the male X/Y rule;
  - weights, Šidák, coverage, `S_cnv`;
  - locus note.
- `src/main/services/reference/gene-intervals.ts` (new): the sorted per-chromosome span index extracted from `gene-fallback.ts`.
  - `overlapping(chr, a, b)` returns all spans.
  - `span(symbol)` serves whole-gene containment.
- `src/main/import/vcf/gene-fallback.ts`: use the extracted index, with no behaviour change.
- INFO dosage parsing for #3: a small function in `cnv-score.ts` keyed by the W0 config names.

Tests (`tests/shared/phenotype/cnv-score.test.ts`):
- the weight table row by row;
- single-gene DEL with w = 1 equals the SNV score;
- a whole-gene DUP of an HI 3 / TS-unknown gene ranks below the same DEL on a matching profile;
- HI 30: 0.3 without a second hit, 1.0 with CN 0 or with `hetHits ≥ 1`;
- coverage piecewise at 0.29, 0.3, 0.8 and 1.0;
- the region beats the gene in the 16p11.2 worked example;
- INFO HI/TS overrides ClinGen;
- CSQ gene list vs interval fallback;
- INV/BND/INS give null.

The existing gene-fallback tests must stay green unchanged.

### L3 str

Owns:
- `src/shared/phenotype/str-score.ts` (new, pure):
  - locus resolution order;
  - band from copies, else Stranger status;
  - rotation/reverse-complement motif gate;
  - evidence, AR, XR and `femaleOnly` gates;
  - `scoreDiseases`;
  - locus note with onset.

Tests (`tests/shared/phenotype/str-score.test.ts`):
- every row of spec §5.4;
- RFC1 AAAAG gives normal;
- a Refuted locus gives null;
- an unparsable `REPCN` falls back to status;
- `HOXA13_1` suffix resolution;
- coordinate fallback in both builds;
- an off-catalogue row gives null fields;
- unknown sex never suppresses.

### L4 ui

Owns:
- `src/renderer/src/components/shortlist/rank-tooltip-phenotype.ts`: `PhenotypeLines.locus`.
- `RankScoreTooltip.vue`: render the line.
- `src/renderer/src/components/panels/HpoDataRow.vue`: source versions and attribution.
- `docs/` user page section: CNV/STR phenotype scoring, data sources and licences.
- Renderer mock data for `HpoDataStatus.sources`.

Tests:
- Tooltip lines for the CNV region route, the CNV gene route, STR, and SNV (no locus line), with the dosage source named.
- `HpoDataRow` renders sources.
- Visual check in the dev build, light and dark.

## W2 lanes (parallel)

### L5 wiring

Owns:
- `src/main/services/scoring/evidence/case-context.ts` (logic):
  - `derived()` dispatches on `variant_type`;
  - `hetHits` from the pass-1 gene map.
- `rank-page.ts`: `toLightRow` copies the non-SNV fields; `withHpoExplanations` uses the locus explanation for CNV/STR rows.
- `score.ts`: the new fields in the DSL environment.
- `src/main/database/shortlist-evidence.ts` and `src/main/storage/postgres/PostgresShortlistService.ts`:
  - open the locus reference and gene intervals per case build;
  - make the batched CSQ gene read for CNV rows (`cnvGenes`).
- STR projections on both backends: `variant-filter/base-query-and-joins.ts`, `PostgresVariantReadRepository.ts` and `shortlist-query.ts`. Split the projection list if the PostgreSQL file passes 600 lines.
- `ShortlistService.ts`: the reference path, if not already passed.

Tests:
- case-context with CNV and STR rows, with and without HPO terms (`cnv_gene_count` and `str_band` are still set).
- **Backend parity:** the same CNV/STR fixture case ranked on SQLite and PostgreSQL gives identical derived fields (web-gate integration).
- Evidence ranking with `structuralTypes.enabled` overridden on in the test: an STR-scoped and a CNV-scoped group compile and score.
- An annotated multi-gene VEP CNV fixture from `../varlens-annotation-workflows` uses the CSQ gene set end to end.

### L6 bench

Owns:
- `scripts/shortlist-sim/cnv-str/**` (new) and its tests: a locus-level ranker over the pure scorers, background loaders, ablation arms A0–A3 + sum, and the STR trick arms.
- `.planning/artifacts/shortlist-sim/<date>-cnv-str/`:
  - `protocol.md`, **committed before any run**, freezing seeds, arms and criteria from spec §7;
  - then the report.

Tests:
- Arm wiring on a 3-case fixture.
- A0 reproduces the naive max.
- Deterministic seeds.

## W3: merge and decide

1. Merge the lanes into the batch branch in order W0, L1–L4, L5, L6, resolving only expected conflicts (there should be none).
2. A ponytail review per lane, then Codex and agy on the merged scorer (`cnv-score.ts`, `str-score.ts`, the builder change).
3. Run L6 and fill spec §10 Outcome. Any flag flip per type is a separate, user-approved commit.
4. Recheck the upstream issues: once #3 fixes the INFO key names, update the config placeholders and the fixture test.

## Verification gates

| When | Command | Bar |
|---|---|---|
| Every lane, before merge | `make typecheck`, `make lint-check`, `make format-check`, `make agent-check`, lane `npx vitest run …` | green, no file > 600 lines added to the baseline |
| L1, L5 (workers, DB, IPC) | `make rebuild-node && make test` | green |
| L1, L5 (web route, PostgreSQL parity) | `VARLENS_WEB=1 make test` | green, with a fresh PostgreSQL DB per branch |
| L4 | dev build, open the app, hover CNV/STR/SNV rows in the shortlist, light + dark | locus line correct, no layout shift |
| Batch | `make ci` | green |
| Batch, before push (HPO build worker touched) | commit, then `make preflight-full` | green receipt; report reused and unavailable checks |
| Outcome | L6 report against spec §7 | every criterion stated with its CI; failures keep the flag off |
