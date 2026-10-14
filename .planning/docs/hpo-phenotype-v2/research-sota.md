# S4 research: phenotype scoring state of the art (2026-10-14)

[V] = checked in the source code or full text. [A] = only the abstract or a secondary source was read. [U] = not verified.

## 1. Excluded (negated) phenotypes
- **LIRICAL** handles excluded terms in `PhenotypeLikelihoodRatio.lrForExcludedTerm` [V, source](https://github.com/TheJacksonLaboratory/LIRICAL/blob/master/lirical-core/src/main/java/org/monarchinitiative/lirical/core/likelihoodratio/PhenotypeLikelihoodRatio.java).
  - Disease annotated to the term (here f_D is the maximum frequency over the disease's annotations that are the term or one of its descendants): `LR = max(0.01, 1−f_D) / (1−bg)`.
  - Disease not annotated to the term: `LR = 1/(1−bg)`. This is a small bonus.
  - Term excluded in both the patient and the disease (NOT annotation): `LR = 1000`.
  - Observed patient term that the disease excludes: `LR = 1/1000`.
  - The readthedocs page describes this as a flat 1/1000 rule. That is inaccurate; the code above is the actual rule.
- **Measured effect** ([AJHG 2020, PMC7477017](https://pmc.ncbi.nlm.nih.gov/articles/PMC7477017)) [V]. Only 10 cases had excluded terms. With the excluded terms, the true diagnosis ranked 1 in all 10 with a mean post-test probability of 98.9%. Without them, the mean rank was 1.3 and the mean post-test probability 72.6%. The sample is anecdotal.
- **Exomiser** drops excluded terms. `PhenopacketSampleConverter` applies `.filter(f -> !f.getNegated())` [V, master](https://github.com/exomiser/Exomiser/blob/master/exomiser-core/src/main/java/org/monarchinitiative/exomiser/core/analysis/sample/PhenopacketSampleConverter.java). HiPhive and PhenIX never see them.
- **BOQA** ([Bauer 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3463114)) [V, text only; the equations are images].
  - Every term in the ontology has a query state: on or off. A term that is "off" is noisy evidence of absence, with α as the false-positive rate and β as the false-negative rate.
  - So BOQA has no 3-state concept of missing vs absent.
- **Pitfalls**
  - LIRICAL's floor of 0.01, combined with its default f = 1 when HPOA gives no frequency, makes every excluded but annotated term a 100× veto.
  - In the 2019 HPOA, only 10,756 annotations had a frequency [V, paper].
  - Annotation errors therefore become hard misses.

## 2. Missing vs absent
- [Phenopackets v2](https://phenopacket-schema.readthedocs.io/en/latest/phenotype.html) [V] defines `excluded` as "looked for, but found to be absent". Not assessed means the term is simply omitted. The other fields are `severity`, `modifiers`, `onset`, `resolution`, and `evidence`.
- LIRICAL and Phenopackets are 3-state: observed, excluded, or omitted (no effect).
- BOQA treats every omitted term as weak evidence of absence (via β). This penalises incomplete phenotyping, which is the norm in clinical practice.

## 3. Weighting key terms
- **PhenoApt** ([AJHG 2022, PMID 35063063](https://pubmed.ncbi.nlm.nih.gov/35063063/)) [A].
  - Users give integer weights per term (CLI `-w '1,2,2,1'`, [README](https://github.com/phenoapt/phenoapt)).
  - Weighting the "clinical indications" (the findings the causal gene must explain) improved top-10 by +37.3% and +21.4% relative in two cohorts.
  - Automatic TF-IDF weights gave +23.7% and +15.5%.
  - I did not verify the scoring formula (embedding dot product).
- **Phen2Gene** ([NARGAB 2020](https://academic.oup.com/nargab/article/2/2/lqaa032/5843800)) [A] weights terms by the skewness of each term's gene-score distribution. Its IC weighting does slightly worse.
- **Pitfall:** large weights let one mis-coded term dominate. Keep the weights bounded (1–3).

## 4. HPOA frequencies
- The categories are Obligate 100%, Very frequent 80–99%, Frequent 30–79%, Occasional 5–29%, Very rare 1–4%, and Excluded 0%.
- **LIRICAL** [V]:
  - Observed term: `LR = f_D/bg`.
  - bg = the mean of f over all diseases (Eq. 9).
  - A patient term more specific than the disease term is matched with `f·(1/#children)`.
  - No match: LR = 0.01.
- **BOQA:** the frequency is the probability that the feature is on. Only the k = 10 rarest annotations are treated as stochastic.
- **CADA** ([NARGAB 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8415429)) [A] can use frequency and enriches the graph with ClinVar cases.

## 5. Disease vs gene aggregation and annotation-breadth bias
- **Exomiser HiPhive:** the gene score is the maximum over its disease and model scores [V](https://github.com/exomiser/Exomiser/blob/master/exomiser-core/src/main/java/org/monarchinitiative/exomiser/core/prioritisers/HiPhivePriority.java).
- **PhenoDigm scorer** [V](https://github.com/exomiser/Exomiser/blob/master/exomiser-core/src/main/java/org/monarchinitiative/exomiser/core/phenotype/PhenodigmModelScorer.java):
  - `score = min(1, ½·(maxMatch/maxMatch_self + Σbest/(nQuery+nMatchedModelTerms) / bestAvg_self))`.
  - The denominators are the query's similarity to itself.
  - It is deliberately semi-symmetric: only model terms that match the query enter the average. The code says this is because models with 40+ terms "performed badly" under full symmetry.
- **LIRICAL and Phenomizer** score at disease level.
- **[Kulmanov & Hoehndorf 2017](https://pubmed.ncbi.nlm.nih.gov/?term=10.1186/s13326-017-0119-z)** [A]: most measures grow with annotation size even when the entities are unrelated. This is the cause of VarLens's ρ ≈ 0.57.
- A gene-level union makes this worse: a gene behind 8 diseases has the union of their annotations.

## 6. Calibration
- **Phenomizer** ([Köhler 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2756558)) [V]:
  - Score: one-sided Resnik best-match average.
  - p-value: Monte Carlo with 10⁵ random queries per disease for each query size 1–10, followed by Benjamini–Hochberg correction.
  - Ranking by p-value beat ranking by raw score because the score distributions differ between diseases.
- **[Coleman, Danis, Reese & Robinson 2025](https://www.biorxiv.org/content/10.1101/2025.11.17.688933.full)** [V]:
  - On phenopacket-store (7,552 patients), Phenomizer did better without p-values, probably because HPOA has grown.
  - With noise, Phrank and SetSim beat Phenomizer.
- **Exomiser** bootstraps a p-value only for the combined score (500k samples) [V, `CombinedScorePvalueCalculator`].
- **LIRICAL** reports post-test probability, but the naive product of term LRs ("almost never true", per the authors) makes it overconfident.

## Recommendation for VarLens
These formulas are all per case, computed over the precomputed DAG.

1. **Store** `case_hpo_terms.status ∈ {observed, excluded}` (omission means not assessed) and `weight ∈ {1, 2, 3}`, with 2 meaning "key".
2. **Disease-level positive score**, then the maximum over the gene's diseases:
   - `S⁺(d) = ½·[ Σ_p w_p·max_t IC(MICA(p,t)) / Σ_p w_p·IC(p)  +  Σ_{t∈d, matched} f̃_t·max_p IC(MICA) / Σ_{t∈d, matched} f̃_t·IC(t) ]`.
   - This is the PhenoDigm-style semi-symmetric score, normalised to patient self-similarity, so it lies in [0, 1].
   - The second half uses only the disease terms that are some patient term's best match. That is the breadth fix.
   - f̃ is the HPOA frequency. Use 0.5 when the frequency is unknown, not LIRICAL's 1.0.
   - Gene score: `S⁺(g) = max_d S⁺(d)`. The UI explains it as "best disease = X".
3. **Excluded penalty** (subsumption-aware and capped):
   - Drop any excluded term x that is an ancestor of an observed term, because it contradicts the observation.
   - Reduce the excluded terms to their most general members (excluding "Seizure" already excludes every seizure subtype).
   - For each remaining x: `f_d(x) = max f̃_t over the disease's annotations t that are x or a descendant of x`, and `ℓ_x(d) = log((max(ε, 1−f_d(x))) / (1−bg(x)))` with ε = 0.05.
   - **Against double counting:** group the ℓ_x by top-level organ system (the children of HP:0000118). Take the minimum ℓ per organ system, then `E(d) = max(−C, Σ_systems min ℓ)` with C = ln 20.
   - Excluded terms also annotated as NOT in the disease get +ln 2 (not ×1000).
   - Final score: `S(d) = S⁺(d) + λ·E(d)/C`. Tune λ on the training folds only.
   - Explain each penalty as "excluded *Microcephaly*, frequent (f = 0.9) in D".
   - Why disease level here: frequencies are per disease. A gene-level union would make a gene with many diseases look contradicted by every exclusion.
4. **Calibration:** per case, report `z = (S − mean_g S)/sd_g S` and the percentile over all genes. Both come from the same pass and are free.
   - Optional test arm: a per-disease null mean and sd for query sizes 1–10, precomputed offline as Phenomizer does, used as a z-score against breadth bias.
   - Keep this only if it improves the pre-registered metrics (Coleman 2025 found that p-values can hurt).
   - Do not present LR products as probabilities.

## Simulating excluded and key terms
- **Published simulation designs:**
  - Phenomizer: frequency-weighted sampling; noise = half as many random terms as disease features (unrelated to the disease terms); imprecision = replace a term with a random non-root ancestor.
  - BOQA: frequency sampling; false positives at rate α; false negatives at rate β (removing a term also removes its descendants); then s of the most specific terms.
  - Coleman 2025: noise = 20 common terms (IC < ln 10).
  - Real excluded terms: phenopacket-store 0.1.27 has 10,377 cases and 132,795 excluded terms ([arXiv 2609.02473](https://arxiv.org/html/2609.02473)) [A]. Use it as an external check.
- **Proposed generator for excluded terms:**
  - (a) Penetrance negatives: for each annotation t of the true disease that was not sampled as present, mark t excluded with probability q·(1−f_t), with q ≈ 0.3.
  - (b) Rule-outs of differential diagnoses: take the top 5 diseases most similar to the true disease. Sample 1–3 features that are frequent in them (f ≥ 0.3) and not annotated to the true disease.
  - (c) Errors: at rate 5%, exclude a frequent feature of the true disease.
  - Report results by arm, including a no-excluded arm that must reproduce the current numbers exactly.
- **Key terms:** mark the true-disease term with the highest f·IC as key, mirroring PhenoApt's "clinical indication". Add an adversarial arm where the key term is a noise term, to measure how much harm weighting can do.

Not verified: PhenoApt's scoring formula and the weight values used in its trials; AMELIE and PhenoBrain internals (not relevant: literature-trained and LLM ensembles); pyhpo/hpo3 options beyond `method` / `kind` / `combine = funSimAvg / funSimMax / BMA` (none of them supports negation or weights). Risk: every constant in the recommendation (ε, C, λ, q, 0.5 for unknown frequency) is a design choice and must be tuned only on the training folds.
