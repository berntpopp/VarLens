# Evidence-rule shortlist with simulation-tuned points — design (v2)

**Date:** 2026-10-12 · **Status:** v2 after adversarial review (Codex gpt-6-astra xhigh, 24 findings, §10) · **Branch:** `feat/calibrated-shortlist-heuristic`
**Builds on:** `.planning/docs/2026-04-11-scoring-via-filters-vision.md`, PR #565 (DSL validation, complete-candidate ranking #537, STR pin #531, `info.<KEY>` filters #538).
**Related, unchanged here:** #553 (trio modes without a family), #538 cohort side.

## 1. Goal and decisions

Rank a case's small variants so the causal variant(s) appear in the first rows, using **annotation fields only**. Points per rule are **tuned and validated by simulation** (real ClinVar variants spiked into real exome backgrounds). Decisions with the user:

- **Primary data: varvis JSON exomes** (GRCh38). Fields used: `consequence` (IMPACT), `func` (Jannovar-style term), `gnomad_af`, `cadd`, `clinvar`, `gt_num`, `omim_mim_number`, `moi`, `hpo_sim_score`. (`hpo_match` is dropped by the importer and is not used.)
- **No ML, no ACMG input.** Points are empirical log-enrichments with stated support — ranking points, **not probabilities or likelihood ratios**.
- **The existing filter DSL is the rule language** (DRY).
- **Inheritance modes are first-class:** dominant (het), recessive homozygous, recessive possible compound heterozygous, X-linked.
- **Scope: SNV + indel.** STR out; SV/CNV keep their scorers and are not mixed into an evidence-scored list (different score units).
- **Patient data never leaves the machine.** No network request is derived from patient data (§4.2).

### Non-goals
ML; ACMG; STR/SV/CNV evidence rules; a graphical rule editor (rules are reviewed DSL/JSON; the tooltip shows per-row contributions); phasing; trio-mode changes (#553); claims beyond the validated population (three immunology exomes).

## 2. What exists and what changes

| Exists (main `20b07f07`) | Change |
|---|---|
| DSL grammar in `src/renderer/src/dsl/` | Move types, tokenizer, parser, column registry to `src/shared/dsl/`; renderer keeps autocomplete/translator, imports from shared. No grammar change. |
| Translator DSL → flat `ColumnFiltersParam` | Unchanged. |
| — | `src/shared/dsl/evaluate.ts`: compile a bounded AST into a row predicate with explicit semantics (§3.1). |
| Stage 1 SQL gate, paged; `mergeTopScored` per page | Kept for legacy presets. Evidence presets use a **two-pass** stream (§3.3). |
| `genotypeZygosity`, genotype classes; `isInPAR(chr,pos,build)` | Reused for derived fields. |
| Solo SQL inheritance modes | Unchanged. Finding logged as a follow-up issue: `candidate_compound_het` counts every het in the gene, common ones included. |
| `ipc-schemas.ts` (~1,000 lines) | New schemas go in `src/shared/types/evidence-ruleset-schemas.ts`. |

## 3. Evidence engine

### 3.1 Evaluator semantics (explicit; not "equal to SQL")
`compileRule(text, scope='shortlist')` parses with the shared parser and requires a non-null DSL AST (plain text is rejected), text ≤ 500 chars, depth ≤ 8, ≤ 64 nodes, no `@preset`.

| Case | Rule evaluator | Case/cohort filter bar (unchanged) |
|---|---|---|
| Numeric comparison, value null/non-finite | **false** | numeric ranges include empty (`includeEmpty=true`) |
| `consequence`, `clinvar` `=`/`!=` | same normalized category matching as the SQL severity filter (shared pure function extracted from `severity-filter.ts`) | severity filter |
| Text `=`/`!=` | exact | exact |
| `~` | case-insensitive substring, ASCII case folding; `%`/`_` literal | SQLite `NOCASE LIKE` with escaping (ASCII); PostgreSQL `ILIKE` may differ for non-ASCII — documented |
| `is:null`/`is:notnull` | `column-null-check.ts` semantics (blank text = null) | same |
| `info.<KEY>` | value classification extracted from `info-field-filter.ts` into a pure shared function used by SQL emitters and evaluator | same |

Rules fire only on present values; missingness is a rule of its own (`gnomad_af:is:null`). Tests: a semantics table, plus SQLite equality of matched IDs for every translator-accepted expression on non-null rows, plus the listed null differences asserted explicitly. PostgreSQL is checked through the same parity suite when a database is available.

### 3.2 Case context and derived fields
`scoreCase` receives `CaseContext { caseId, build, sex: 'male'|'female'|null, gene: Map<gene, GeneContext> }`.

| Field | Definition |
|---|---|
| `zygosity` | `hemi` if `gt_num` is haploid (`1`), or chr X non-PAR (`isInPAR`, case build) with `sex='male'` and a hom call; else `genotypeZygosity(gt_num)` (`./1`, `1/.` are assumed het). Unknown sex: X hom stays `hom`. |
| `gene_het_hits` | Distinct **normalized alleles** (§4.3 identity) among **eligible** rows (Stage-1 gate, SNV+indel, both types together) in the same gene with zygosity `het`. Computed in pass 1, before any mode is evaluated — no recursion. Null gene → counts only the row itself. |
| `gene_hits` | Same over all zygosities. |
| `moi` | Existing column (`AD, AR, XR, XD…`), matched with `~`. |

### 3.3 Two-pass ranking (memory-bounded, complete)
1. **Pass 1:** page through all eligible SNV+indel rows (existing `forEachCandidatePage`, both backends) projecting only `id, chr, pos, ref, alt, gene_symbol, gt_num` → `GeneContext` (allele sets, partner IDs). Memory ~100 bytes per eligible row.
2. **Pass 2:** page again, score each row with the full context, `mergeTopScored` into the top N.

Both backends call one shared function `rankEvidenceCandidates(pages, ctx, ruleset, topN)`. A test places compound-het partners on different pages and of different types (SNV + indel) and checks they find each other.

### 3.4 Ruleset model and aggregation
```ts
interface EvidenceRule  { id; label; when: string; points: number }       // DSL text
interface EvidenceGroup { id; label; scope: 'global' | ModeId; rules: EvidenceRule[] }  // decision list
interface ModeProfile   { id: ModeId; label; when: string; points: number } // 'ad'|'ar_hom'|'ar_comphet'|'xl'|'fallback'
interface EvidenceRuleset { version: 1; id: string; sha256: string; modes: ModeProfile[]; groups: EvidenceGroup[] }
```
- **Group = decision list:** the first rule (in order) whose `when` matches contributes its points; later rules in that group are ignored. Bins are exclusive by construction, so penalties cannot be masked by weaker penalties.
- **Global groups** apply under every mode; **mode-scoped groups** only under that mode.
- **Modes:** each specific mode is eligible when its `when` matches. `fallback` is always eligible and carries the calibrated "no compatible inheritance" points. Row score = `max over eligible modes m of (m.points + Σ global groups + Σ groups scoped to m)`; ties → mode order. Global penalties therefore apply in every mode and cannot be bypassed.
- **Explanation = exact contributions:** `rank_evidence` lists the mode points and each contributing rule; their sum equals `rank_score` (asserted).
- **Compound het:** `ar_comphet` rows return `rank_partners` (IDs of the other het alleles in the gene). The UI says "possible compound heterozygous" (no phase).
- **Pins:** starred pin as today. The ClinVar pin is configurable; the built-in evidence preset leaves it off (ClinVar is a scored group).
- **Validation:** unique IDs, every `when` compiles, |points| ≤ 20, ≤ 40 groups, ≤ 200 rules, `variantTypeScope ⊆ {snv, indel}`, and **no `inheritanceModes`/`analysisGroupId` in `baseFilters`** (modes are scored, not filtered). A stored preset that fails validation raises the existing `DatabaseError` path.

### 3.5 Contracts, UI, provenance
- `ScoredRow` gains optional `rank_mode`, `rank_evidence`, `rank_partners`; `RankConfig` gains optional `ruleset` (schema in the new file). The preload contract test and the parity manifest stay green (no new IPC channel; payload extension only).
- `ShortlistTable` shows evidence scores as signed points (`+12.5`). `RankScoreTooltip` lists mode and contributions.
- **Frozen artifact:** `src/main/database/evidence-rulesets/varvis-exome-v1.json` (content-addressed; `sha256` inside). The SQLite migration (v46) and the PostgreSQL migration (`0029_…sql`) **embed the JSON literal**, so the PG checksum covers it. Recalibration = new ruleset version + new preset name + new migration; seeded rows are never mutated.

### 3.6 Performance
Benchmarked as the **full request** (`getShortlist` on SQLite incl. both passes, scoring, explanations): budget 250 ms for a 7k-variant case, 2 s for a synthetic 100k-eligible case, measured on the dev host and recorded; CI asserts a 3× margin.

## 4. Simulation data

### 4.1 Backgrounds (local only)
Three varvis exomes (GRCh38, ~6.6–6.7k rows, all three inferred female from chrX heterozygosity — X-linked recessive in males is therefore **not testable**; stated as a limitation). Read through the production `ObjectFormatMapper` into an in-memory SQLite case via the production import. Path from `VARLENS_SIM_BACKGROUND_DIR`; the harness writes no background-derived row into the repository. Background ClinVar P/LP rows (4/4/9) are reported; a sensitivity analysis removes them.

### 4.2 Public candidate pool (patient-independent)
Built **without any patient information**, then frozen and committed (public data):
- Source: local ClinVar VCF `2026-04-26`; parsed header-aware (`CLNREVSTAT` compared as the full string).
- P/LP: `CLNSIG` exactly `Pathogenic`, `Likely_pathogenic` or `Pathogenic/Likely_pathogenic`; review status `criteria_provided,_multiple_submitters,_no_conflicts`, `reviewed_by_expert_panel` or `practice_guideline`; `ORIGIN` has a germline-related bit (1 germline, 4 prenatal, 16 inherited, 32 paternal, 64 maternal, 128 de novo, 256 biparental, 512 uniparental) and no somatic bit (2) — unknown-only (8) excluded; a named disease; exactly one gene; SNV/indel ≤ 50 bp.
- **Variant-level MOI:** from the asserted disease (`CLNDISDB` OMIM/Orphanet id) via the HPO annotation file `phenotype.hpoa` (public, pinned release). Exactly one of AD / AR / XLD / XLR required; otherwise excluded (counted).
- Frequency plausibility (after annotation): AD popmax ≤ 1e-4, AR/XL ≤ 1e-2.
- Benign decoys: `Benign`, `Likely_benign`, `Benign/Likely_benign`, same review/origin/size rules, popmax ≤ 1e-2.
- Sampling: ≤ 3 variants per gene, stratified by MOI, fixed seed; pool ≈ 4,000 P/LP + 2,000 decoys. Funnel counts reported.
- **Temporal stratum:** P/LP variants absent (or not P/LP) in the archived ClinVar release `2024-01` → "new since 2024" stratum.
- Only after freezing is the pool restricted **offline** to genes present in each background.

### 4.3 Normalization and identity
Pool and background alleles are normalized locally with `bcftools norm` against the pinned GRCh38 FASTA (REF checked, left-aligned, minimal; multiallelic records rejected). Identity = `chr:pos:ref:alt` after normalization. A spike identical to a background allele is not placed in that background.

### 4.4 Annotation and fidelity
- **Offline concordance study (local, no network):** background sites are annotated with the local VEP 115 + dbNSFP 5.3.1a pipeline and compared per site with varvis values. Outputs (aggregate only): the empirical VEP→varvis `func` mapping table, the gnomAD field that best matches varvis `gnomad_af` (exome / genome / joint, global vs popmax; log10 error), CADD agreement, missingness behaviour.
- **Spike annotation:** genefoundry (`vep-link annotate_variants_batch` on the MANE Select transcript, `gnomad-link get_variant_frequencies`) for the frozen pool, cross-checked against the same local pipeline (public data, per site). Spikes are projected into the varvis vocabulary with the **empirical** mapping; IMPACT comes from the measured varvis `func → IMPACT` table (deterministic in all 19,578 rows, incl. the quirk `mnv` = HIGH). Mappings without empirical support are excluded and counted, never invented.
- Gene-level `omim_mim_number`, `moi`, `hpo_sim_score` are copied from the background's rows of that gene (verified constant within every gene in all three backgrounds; re-asserted each run).

### 4.5 Simulated cases
- AD: one het. AR-hom: one hom. AR-comphet: two different P/LP alleles asserted for the **same AR disease**, both het; trans truth recorded. XLD: one het (female backgrounds). XLR: not simulated (no male backgrounds).
- Genotype **encodings** sampled from the background distribution per class (SNV/indel; het as `0/1`, `./1`, `1/.`). `qual` sampled per class and zygosity; no rule uses `qual`.
- **Decoy burden:** exactly 10 rare benign decoys per case from the background's genes.

### 4.6 Scenarios
- **Primary:** ClinVar masked on **all** rows (background, spikes, decoys) with ClinVar pins off; phenotype as present (spike genes chosen without regard to `hpo_sim_score`).
- **Secondary:** ClinVar visible; phenotype-free (`hpo_sim_score` masked on all rows); shuffled phenotype (permuted across genes within the case); missingness robustness (empirical joint missingness patterns resampled from background rows of the same `func` class; gene fields drop per gene).
- **Separate enrichment experiment** (not pooled): spike genes restricted to the case's top-decile `hpo_sim_score`.

## 5. Experiment protocol (frozen before the test run)

### 5.1 Endpoints
- **Primary:** Hit@10 under the **actual production ordering**, test folds, primary scenario, **macro-averaged** over consequence classes {LoF: `stop_gained`, `frameshift_*`, `splice_acceptor_variant`, `splice_donor_variant`, `start_lost`, `stop_lost`; missense; `inframe_indel`; other} and pooled over AD, AR-hom, AR-comphet, XLD. A compound-het case is a hit only when **both** alleles are within k.
- **Secondary:** Hit@1/5/20/50, MRR, median rank, rank CDF; tie-averaged P(hit@k) and E[1/rank] (analytic over random tie order, preceding pin partitions counted); filter sensitivity; burden (median eligible rows per case); **decoy intrusion** = mean decoys in the top 10 and share of cases with ≥ 1; per mode, per class, per background, temporal stratum; all scenarios.

### 5.2 Splits and point estimation
- Genes are assigned to 5 folds (fixed seed); a gene's observations in every background and scenario stay in one fold. Training counts exclude test-fold genes from **both** positives and background negatives. Leave-one-background-out is a secondary analysis.
- Bins are fixed now (no data-derived preprocessing): AF {<1e-5, <1e-4, <1e-3, <1e-2, missing}; CADD {≥30, ≥25, ≥20, ≥15, missing}; `hpo_sim_score` {≥0.15, ≥0.10, ≥0.05, >0, missing}; `func` classes as above; ClinVar {P/LP, VUS, conflicting, B/LB}; gene {OMIM-linked}.
- Per group with K bins plus the residual "no rule fired": `points(bin) = log2[ ((a_bin+1)/(A+K+1)) / ((b_bin+1)/(B+K+1)) ] − (same for the residual)`, rounded to 0.5, clipped to ±8. `a/A`: eligible training positives; `b/B`: eligible training background rows. Mode points the same over {AD, AR-hom, AR-comphet, XL, fallback}. Each bin reports support and a bootstrap interval.
- The shipped ruleset is refit on all folds **after** evaluation; reported performance comes only from the cross-validated test folds.

### 5.3 Compared scorers (identical cases)
1. "Tier 1 candidates" (current). 2. "All rare damaging" (current). 3. CADD descending. 4. AF ascending. 5. Evidence rules, hand-set points. 6. Evidence rules, simulation-tuned points. 7. Ablations of (6) by group and by mode. 8. **Same-gate comparisons:** (1)'s scoring under (6)'s gate, and (6)'s scoring under (1)'s gate.

### 5.4 Statistics
Cluster bootstrap over **gene clusters** (all observations of a gene across backgrounds, scenarios and pairs resampled together), 2,000 draws, fixed seed; 95 % percentile intervals for every endpoint and paired difference. No McNemar/Wilcoxon (independence fails). Each background is also reported separately. Required precision: ≥ 300 test gene clusters in the primary analysis, otherwise the report labels it underpowered.

### 5.5 Ship criterion (pre-registered)
The tuned preset is seeded as an **additional, non-default** built-in ("Evidence ranking (beta) — simulation-validated on 3 immunology exomes") when, in the primary analysis: lower 95 % bound of ΔHit@10 vs "Tier 1 candidates" > +3 points; upper bound of Δ mean decoys-in-top-10 ≤ +0.5; lower bound of filter sensitivity ≥ 0.97. Otherwise the report states the outcome and no preset is seeded. Making it the default requires independent validation backgrounds (follow-up).

## 6. Harness (`scripts/shortlist-sim/`, TypeScript via `jiti`)
`select-pool.ts` (ClinVar + hpoa → pool, funnel), `normalize.ts` (bcftools), `fetch-annotations.ts` (genefoundry; concurrency 6, retries, health check, one cache file per variant, resume), `concordance.ts` (local VEP on backgrounds → aggregate tables), `build-cases.ts`, `run.ts` (worker pool `min(6, cores)` over folds × scenarios; per case: one production Stage-1 pass per distinct gate, then all scorers in TS via the production `rankEvidenceCandidates`/legacy scorer with complete ordering), `metrics.ts`, `tune.ts`, `report.ts`. Outputs: `.planning/artifacts/shortlist-sim/<run>/` (`metrics.json`, `report.md`, SVG plots, `protocol.lock.json` with all input hashes). `make shortlist-sim` (not in CI). A test asserts the harness top-N equals `getShortlist` top-N on sampled cases.

## 7. Testing and gates
Unit: evaluator semantics table, bounds, derived fields (PAR, sex, assumed-het), decision-list and mode aggregation (explanation sum = score), ruleset validation, metrics (production order, tie-averaged values), bootstrap determinism, ClinVar/ORIGIN/hpoa parsing on synthetic files, normalization collisions, genotype encodings. Integration: both services with an evidence preset (ordered SQLite↔PostgreSQL equality, compound-het partners across pages and types, rollback isolation in the harness), migration v46 / PG 0029 idempotent and checksum-stable, renderer tooltip and score format, full-request benchmark. Harness smoke test on a committed synthetic background. Gates: `make typecheck`, `make lint-check`, `make rebuild-node && make test`, `make agent-check`, PostgreSQL parity with a local database, then `make preflight-full` before push.

## 8. Risks (residual)
Three immunology exomes from one lab (no claim of general validity); female-only backgrounds (no male XLR); CADD and other predictors carry indirect ClinVar-related training signal (audited and reported, not removable); ClinVar ascertainment bias (macro-averaging, temporal stratum); background P/LP carriers (sensitivity analysis).

## 9. Delivery
One branch, staged commits: (1) shared DSL move, (2) evaluator + derived fields, (3) ruleset schema + engine + two-pass services, (4) UI, (5) harness, (6) experiment run + report + tuned ruleset + migrations (only if §5.5 passes). Each stage passes its gates before the next.

## 10. Adversarial review resolution (Codex, 24 findings)
1 LR/ECE invalid → ranking points with support/CI, no probability claims, λ removed (§5.2). 2 Wrong independence → gene-cluster bootstrap, per-background reporting, CI-based ship criterion, non-default beta (§5.4–5.5). 3 Recursive gene counts / paging → non-recursive eligibility, two-pass, cross-type (§3.2–3.3). 4 SQL parity → explicit semantics table, shared extracted value functions (§3.1). 5 Phenotype construction → primary without hpo selection, phenotype-free/shuffled controls, separate enrichment experiment (§4.6). 6 Masking → all rows masked, pins off; predictor circularity audited (§4.6, §8). 7 Fidelity → offline per-site concordance + genefoundry cross-check (§4.4). 8 Invented vocabulary → empirical mapping only, unsupported excluded (§4.4). 9 Identity → bcftools normalization, collisions (§4.3). 10 ORIGIN/temporal → germline-related bits, archived release (§4.2). 11 Gene MOI ≠ variant MOI → disease-level MOI via hpoa, same-disease pairs (§4.2, §4.5). 12 X-linked → case context, `isInPAR`, sex rules, XLR limitation (§3.2, §4.1). 13 Comphet endpoint → both alleles (§5.1). 14 Expected-rank thresholding → production order primary, analytic tie-averages secondary (§5.1). 15 Unlabeled backgrounds → P/LP sensitivity analysis, fixed decoy burden (§4.1, §4.5). 16 Genotype/QUAL/dropout → empirical encodings, no QUAL rule, joint gene-consistent missingness (§4.5–4.6). 17 Open protocol → bins fixed, macro-average, refit policy, same-gate comparisons, training-only counts (§5). 18 Group signs/fallback → decision lists, global penalties, exact contributions (§3.4). 19 Units → SNV/indel only (§1, §3.4). 20 `hpo_match` → removed (§1). 21 Inheritance filters → rejected in evidence presets (§3.4). 22 Patient-conditioned queries → patient-independent frozen pool (§4.2). 23 Bounds/provenance → AST limits, content-addressed ruleset embedded in migrations (§3.1, §3.5). 24 Testing/perf → harness-vs-production test, ordered PG parity, full-request benchmark, preflight-full (§3.6, §6–7).
