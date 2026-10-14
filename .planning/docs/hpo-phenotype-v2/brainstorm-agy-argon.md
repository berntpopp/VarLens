I will start by reading the four specified files (`src/shared/phenotype/resnik.ts`, `src/shared/phenotype/hpo-sources.ts`, `src/main/services/phenotype/hpo-similarity-db.ts`, and `.planning/artifacts/shortlist-sim/2026-10-14-resnik/gene-ranking.md`) to examine the current HPO DAG structure, Resnik BMA implementation, annotation parsing, and benchmark findings.
Here is the technical design and critical evaluation for **VarLens Phenotype Scoring v2**, grounded in [`src/shared/phenotype/resnik.ts`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/resnik.ts), [`src/shared/phenotype/hpo-sources.ts`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/hpo-sources.ts), [`src/main/services/phenotype/hpo-similarity-db.ts`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/main/services/phenotype/hpo-similarity-db.ts), and the benchmark results in [`.planning/artifacts/shortlist-sim/2026-10-14-resnik/gene-ranking.md`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/.planning/artifacts/shortlist-sim/2026-10-14-resnik/gene-ranking.md).

---

## Preliminaries & Shared Notation

- **DAG**: $G_{\text{HPO}} = (V, E)$ restricted to the `HP:0000118` (*Phenotypic abnormality*) subtree via [`phenotypeClosure`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/hpo-sources.ts#L113-L122), with $|V| \approx 18,900$ terms, $|E| \approx 24,000$ direct `is_a` edges, and topological order `topo` (parents before children) in [`buildHpoIndex`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/resnik.ts#L55-L102).
- **Information Content**: $\text{IC}(t) = -\ln(n(t)/N) \in [0, \text{IC}_{\max}]$ computed by [`informationContent`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/hpo-sources.ts#L195-L209) over $N \approx 9,162\text{–}12,400$ annotated diseases ($\text{IC}_{\max} = \ln N \approx 9.4\text{ nats}$).
- **Resnik similarity**: $\text{sim}(a, b) = \max_{u \in \text{Anc}(a) \cap \text{Anc}(b)} \text{IC}(u) = \text{IC}(\text{MICA}(a, b))$.
- **Corpus**:
  - Genes $g \in \mathcal{G}$ ($|\mathcal{G}| = 5,268$), diseases $d \in \mathcal{D}$ ($|\mathcal{D}| \approx 12,400$ total; $|\mathcal{D}_G| \approx 7,200$ linked to genes in `genes_to_phenotype.txt`), gene-to-disease mapping $\mathcal{D}(g)$ ($\sim 7,500$ pairs).
  - Positive disease annotations $t \in T_d^+$ with parsed frequency $f(d, t) \in (0, 1]$ ($A_D^+ \approx 220,000$ pairs across $\mathcal{D}_G$).
  - Negative disease annotations $t \in T_d^-$ where `qualifier = 'NOT'` or `isAbsent(frequency)` in [`hpo-sources.ts`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/hpo-sources.ts#L144-L150) ($\sim 2,500$ pairs).
- **Patient Profile**:
  - Present terms $P^+ = \{(p_i, w_i)\}_{i=1}^{k^+}$ with weight $w_i \ge 1$ ($w_i = 1$ default; $w_i \in \{2, 3\}$ for key/core clinical findings).
  - Excluded terms $P^- = \{e_j\}_{j=1}^{k^-}$ (examined and observed absent).
  - Not-assessed terms: $V \setminus (\text{Anc}(P^+) \cup \text{Desc}(P^-))$.

---

## (a) Three Candidate Algorithm Designs

### Candidate 1: Gene-Level Frequency-Weighted Resnik BMA + Capped Contrapositive Exclusion (`FreqResnik-Gene`)

An evolutionary upgrade of [`scoreAllGenes`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/resnik.ts#L139-L172) that stays at the gene level ($T_g^+ = \bigcup_{d \in \mathcal{D}(g)} T_d^+$) with aggregated frequency $f(g, t) = \max_{d \in \mathcal{D}(g)} f(d, t)$.

#### Exact Formulas
1. **Forward (Patient $\to$ Gene)**:
   $$\text{Fwd}(P^+, g) = \frac{\sum_{i=1}^{k^+} w_i \max_{t \in T_g^+} \left[\text{sim}(p_i, t) \cdot \big((1 - \alpha) + \alpha f(g, t)\big)\right]}{\sum_{i=1}^{k^+} w_i}, \quad \alpha = 0.25$$
2. **Reverse (Gene $\to$ Patient, frequency-weighted expectation)**:
   $$\text{Rev}(P^+, g) = \frac{\sum_{t \in T_g^+} f(g, t) \max_{i=1..k^+} \text{sim}(p_i, t)}{f_0 + \sum_{t \in T_g^+} f(g, t)}, \quad f_0 = 1.0$$
3. **Contrapositive Exclusion Penalty**:
   By Modus Tollens on `is_a`, if a patient lacks $e_j \in P^-$, they must lack every descendant $t \in \text{Desc}(e_j)$. If $g$ is annotated with $t \in T_g^+ \cap \text{Desc}(e_j)$, the contradiction is proportional to $\text{IC}(e_j)$ and the gene's expected frequency $f(g, t)$:
   $$\text{Pen}(P^-, g) = \min\left(\tau_{\max},\; \lambda \sum_{j=1}^{k^-} \text{IC}(e_j) \cdot \max_{t \in T_g^+ \cap \text{Desc}(e_j)} f(g, t)\right)$$
4. **Total Score**:
   $$S_1(P^+, P^-, g) = \max\left(0,\; \frac{1}{2}\big(\text{Fwd}(P^+, g) + \text{Rev}(P^+, g)\big) - \text{Pen}(P^-, g)\right)$$

- **Missing vs. Excluded**: Missing (not assessed) terms contribute $0$ to $\text{Pen}(P^-, g)$ and only passively lower $\text{Rev}(P^+, g)$ in proportion to $f(g, t)$ if an entire branch of expected features is unrepresented in $P^+$. Excluded terms $e_j \in P^-$ actively deduct $\lambda \, \text{IC}(e_j) f(g, t)$ when $t \in \text{Desc}(e_j)$.
- **Key-Term Weights**: Entered as $w_i$ in $\text{Fwd}(P^+, g)$ (see Section (e) for the low-IC dilution caveat and fix).
- **Complexity per Case**: $k^+$ forward DP passes + 1 union DP pass + 1 bitmask downward pass over $(V, E)$ and $A_G \approx 250\text{k}$ gene-term pairs:
  $$O\big((k^+ + 2)(V + E) + (k^+ + 1)A_G\big) \approx 3.5\text{ ms per case}$$
- **Explainability**: Lists per-patient-term best $(p_i \leftrightarrow t)$ MICA and per-exclusion $(e_j \leftrightarrow t)$ penalty, but cannot attribute the score to a specific Mendelian disease when a gene causes multiple disorders.
- **Failure Modes**:
  1. **Chimeric syndrome matching**: For pleiotropic genes (*LMNA*, *FGFR2*, *COL2A1*, *FLNA*), a patient matching 2 features of Disorder A and 2 features of Disorder B scores high against $T_g^+$ even though no single disease has both.
  2. **Cross-disease exclusion contamination**: If *LMNA* causes both isolated Dilated Cardiomyopathy (`OMIM:115200`, no progeria/lipodystrophy) and Dunnigan Lipodystrophy (`OMIM:151660`, $f = 0.95$ lipodystrophy), aggregating $f(g, t) = \max_d f(d, t)$ penalizes *LMNA* when lipodystrophy is excluded in a cardiomyopathy patient.
  3. **Correlated query inflation**: Entering 3 overlapping seizure terms triples epilepsy's weight in $\text{Fwd}(P^+, g)$.

---

### Candidate 2: Disease-Level Correlation-Corrected Log-Likelihood Ratio (`Disease-cLR`, LIRICAL-Style)

Scores each disease $d \in \mathcal{D}_G$ via a log-likelihood ratio comparing the probability of the observed $(P^+, P^-)$ under disease $d$ vs. the background disease corpus, discounting correlated terms, then aggregates $S_2(g) = \max_{d \in \mathcal{D}(g)} \text{LLR}(d)$.

#### Exact Formulas
1. **Positive Term Log-LR** (for $p_i \in P^+$ matched to $t^* = \arg\max_{t \in T_d^+} \text{sim}(p_i, t) \cdot f(d, t)$ with $m_i = \text{MICA}(p_i, t^*)$):
   - If $p_i \in \text{Anc}(t^*)$ (exact or imprecise ancestor match, $m_i = p_i$):
     $$\ln \text{LR}^+(p_i, d) = \ln \frac{\max(f_{\min}, f(d, t^*))}{n(p_i)/N} = \text{IC}(p_i) + \ln \max(f_{\min}, f(d, t^*))$$
   - If $m_i \neq p_i$ (cross-branch MICA match, with background false-positive rate $\epsilon = 0.05$):
     $$\ln \text{LR}^+(p_i, d) = \ln\left((1 - \epsilon)\frac{\text{IC}(m_i)}{\text{IC}(p_i)} f(d, t^*) e^{\text{IC}(m_i)} + \epsilon\right)$$
2. **Correlation Correction (IC-Conditional Novelty Discount)**:
   Order $P^+$ by descending $w_i \text{IC}(p_i)$. Discount each term by the fraction of its information already shared with higher-priority patient terms, and further cap multiple $p_i$ hitting the exact same disease term $t^* \in T_d^+$:
   $$\nu_i = 1 - \max_{r < i} \frac{\text{IC}(\text{MICA}(p_i, p_r))}{\text{IC}(p_i)} \in [0, 1]$$
3. **Excluded Term Log-LR** (for $e_j \in P^-$):
   Let $f_{\text{excl}}(d, e_j) = \max_{t \in T_d^+ \cap \text{Desc}(e_j)} f(d, t)$ (or $0.99$ if $e_j \in \text{Anc}(T_d^+)$ is obligate). With annotation error floor $\delta = 0.02$:
   $$\ln \text{LR}^-(e_j, d) = \ln \frac{\max(\delta,\; 1 - f_{\text{excl}}(d, e_j))}{1 - e^{-\text{IC}(e_j)}} \le 0$$
   (Plus $\ln \delta$ whenever $p_i \in \text{Desc}(t_{\text{not}})$ for an explicit $t_{\text{not}} \in T_d^-$.)
4. **Disease & Gene Score**:
   $$\text{LLR}(d) = \sum_{i=1}^{k^+} w_i \, \nu_i \ln \text{LR}^+(p_i, d) + \sum_{j=1}^{k^-} \nu_j^- \ln \text{LR}^-(e_j, d), \quad S_2(g) = \max_{d \in \mathcal{D}(g)} \text{LLR}(d)$$

- **Missing vs. Excluded**: Missing terms are marginalized out ($\text{LR} = 1 \implies \ln \text{LR} = 0$). Excluded terms contribute $\ln \text{LR}^-(e_j, d) < 0$ (e.g., excluding a $90\%$ feature gives $\ln(0.10 / 0.98) \approx -2.28\text{ nats}$).
- **Complexity per Case**: $k^+$ forward DP passes + 1 downward exclusion pass over $(V, E)$ and $A_D^+ \approx 220\text{k}$ disease-term pairs:
  $$O\big((k^+ + 1)(V + E) + k^+ A_D^+\big) \approx 4.5\text{–}6.0\text{ ms per case}$$
- **Explainability**: High clinical intuition (per-term Bayes factor in decibans/nats for the winning disease $d^*(g)$).
- **Failure Modes**:
  1. **One-sided breadth bias returns when $P^- = \emptyset$**: Because unobserved disease terms have $\ln \text{LR} = 0$, there is **no reverse penalty** for a heavily annotated disease having 80 unmatched features. As shown in [`gene-ranking.md`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/.planning/artifacts/shortlist-sim/2026-10-14-resnik/gene-ranking.md#L42-L44), one-sided scoring collapses under noise ($\text{Hit}@10 = 14.3\%$ vs $30.3\%$ symmetric, $\rho = 0.80$).
  2. **Unbounded score scale across case sizes**: A patient with 12 HPO terms produces $\sim 3\times$ the LLR of a patient with 4 HPO terms, breaking fixed-threshold rule bins in the VarLens DSL unless post-normalized.
  3. **Fragility to missing HPOA frequencies**: When $60\%$ of OMIM annotations lack frequencies, $\ln f(d, t^*)$ is dominated by arbitrary imputation constants.

---

### Candidate 3: Disease-Level IC-Decoupled Frequency-Weighted BMA with Contrapositive Exclusion (`Disease-FreqBMA`, Calibrated Hybrid)

Scores at the **disease level** ($d \in \mathcal{D}_G$) using a correlation-corrected, frequency-weighted symmetric Resnik BMA with zero-centered key-term contrast and directional contrapositive exclusion attenuation, then projects to genes via $S_3(g) = \max_{d \in \mathcal{D}(g)} S_3(d)$.

#### Exact Formulas

1. **Hierarchy Sanitization & Patient IC-Decoupling**:
   - Remove any excluded term $e \in P^-$ that is an ancestor of or equal to a present term ($P^- \leftarrow P^- \setminus \text{Anc}(P^+)$).
   - Prune redundant ancestors within $P^+$ (if $p_a \in \text{Anc}(p_b) \setminus \{p_b\}$, drop $p_a$ and set $w_b \leftarrow \max(w_b, w_a)$) and within $P^-$ (if $e_a \in \text{Anc}(e_b) \setminus \{e_b\}$, drop $e_b$).
   - Sort $P^+$ by descending $w_i \text{IC}(p_i)$ and compute each term's **IC novelty weight** $\nu_i$ to prevent double-counting correlated siblings:
     $$\nu_i = 1 - \beta_{\text{corr}} \max_{r < i} \frac{\text{IC}(\text{MICA}(p_i, p_r))}{\max(\text{IC}(p_i), \text{IC}(p_r))}, \quad \beta_{\text{corr}} = 0.5$$

2. **Disease-Level Forward Similarity (with Scale-Safe Key-Term Contrast)**:
   For $p_i \in P^+$ and disease $d$:
   $$m^+(p_i, d) = \max_{t \in T_d^+} \left[ \text{sim}(p_i, t) \cdot \big((1 - \alpha_f) + \alpha_f f(d, t)\big) \right], \quad \alpha_f = 0.25$$
   Because $\text{sim}(p_i, t) \le \text{IC}(p_i)$, naively weighting by $w_i$ in $\frac{\sum w_i m^+(p_i, d)}{\sum w_i}$ lowers the score when a user marks a broader term ($\text{IC}(p_i) < \overline{\text{IC}}$) as a key term (see Section (e).5). Instead, combine the novelty-weighted forward BMA with a **zero-centered key-term contrast** on relative match quality $r(p_i, d) = \frac{m^+(p_i, d)}{\text{IC}(p_i)} \in [0, 1]$:
   $$\text{Fwd}(P^+, d) = \frac{\sum_{i=1}^{k^+} \nu_i \, m^+(p_i, d)}{\sum_{i=1}^{k^+} \nu_i} + \kappa_{\text{key}} \, \overline{\text{IC}}(P^+) \frac{\sum_{i=1}^{k^+} \nu_i (w_i - 1) \big(2 r(p_i, d) - 1\big)}{\sum_{i=1}^{k^+} \nu_i w_i}$$
   where $\overline{\text{IC}}(P^+) = \frac{\sum \nu_i \text{IC}(p_i)}{\sum \nu_i}$ and $\kappa_{\text{key}} = 0.35$. When $w_i = 1\;\forall i$, the second term is $0$. When $w_i > 1$, matching the key term ($r > 0.5$) strictly boosts $d$ regardless of $\text{IC}(p_i)$, and missing the key term ($r < 0.5$) strictly demotes $d$.

3. **Disease-Level Reverse Similarity (Empirical-Bayes Frequency-Weighted Expectation)**:
   $$\text{Rev}(P^+, d) = \frac{\sum_{t \in T_d^+} f_{\text{pos}}(d, t) \max_{p_i \in P^+} \text{sim}(p_i, t)}{f_0 + \sum_{t \in T_d^+} f_{\text{pos}}(d, t)}, \quad f_0 = 1.0$$
   Here $f_0 = 1.0$ acts as a Dirichlet shrinkage prior so ultra-sparse 1-term diseases in HPOA cannot achieve an artificial $100\%$ reverse score on a single non-specific match, while frequent hallmarks ($f_{\text{pos}} \ge 0.8$) dominate the expectation and rare 2% case-report features barely affect the denominator.

4. **Contrapositive Exclusion & Disease-`NOT` Attenuation**:
   - **Patient exclusions ($e_j \in P^-$ vs. $T_d^+$)**: Only descendants $t \in T_d^+ \cap \text{Desc}(e_j)$ are contradicted:
     $$c^-(e_j, d) = \text{IC}(e_j) \cdot \max_{t \in T_d^+ \cap \text{Desc}(e_j)} f_{\text{excl}}(d, t)$$
   - **Disease `NOT` annotations ($t_{\text{not}} \in T_d^-$ vs. $P^+$)**: Contradicted if patient has $p_i \in P^+ \cap \text{Desc}(t_{\text{not}})$:
     $$c_{\text{not}}(t_{\text{not}}, d) = \text{IC}(t_{\text{not}}) \cdot \mathbb{I}\big[\exists p_i \in P^+ : t_{\text{not}} \in \text{Anc}(p_i)\big]$$
   - **Normalized Exclusion Load**:
     $$E(P^+, P^-, d) = \frac{\sum_{j=1}^{k^-} c^-(e_j, d) + \sum_{t_{\text{not}} \in T_d^-} c_{\text{not}}(t_{\text{not}}, d)}{\text{IC}_{\text{ref}}}, \quad \text{IC}_{\text{ref}} = 4.0$$
   - **Attenuated Disease & Gene Score**:
     $$S_{\text{pos}}(P^+, d) = \gamma \text{Fwd}(P^+, d) + (1 - \gamma) \text{Rev}(P^+, d), \quad \gamma = 0.55$$
     $$S_3(P^+, P^-, d) = S_{\text{pos}}(P^+, d) \cdot \exp\Big(-\lambda_{\text{excl}} \min\big(E_{\max},\; E(P^+, P^-, d)\big)\Big), \quad \lambda_{\text{excl}} = 0.45,\; E_{\max} = 2.5$$
     $$S_3(g) = \max_{d \in \mathcal{D}(g)} S_3(P^+, P^-, d), \quad d^*(g) = \arg\max_{d \in \mathcal{D}(g)} S_3(P^+, P^-, d)$$

#### Vectorized DP & Bitmask Complexity on the 19k-Term DAG
- **Positive DP ($k^+$ terms)**: Exactly as in [`resnik.ts`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/resnik.ts#L151-L163), $k^+$ calls to `markAncestors` + `propagate` ($O(k^+(V+E))$), plus 1 `propagate` on `union` ($O(V+E)$).
- **Single-Pass Bitmask Exclusion DP (up to 32 excluded terms in 1 pass)**:
  Allocate `exclMask = new Uint32Array(V)`. Set bit $j$ at `exclMask[e_j] |= (1 << j)` for each $e_j \in P^-$. Run **one** topological pass over `ix.topo`:
  ```ts
  for (let i = 0; i < topo.length; i++) {
    const t = topo[i]
    let m = exclMask[t]
    for (let j = parentOffsets[t]; j < parentOffsets[t + 1]; j++) m |= exclMask[parents[j]]
    exclMask[t] = m
  }
  ```
  After this single $O(V + E)$ pass ($\sim 0.05\text{ ms}$), `exclMask[t]` has bit $j$ set iff $t \in \text{Desc}(e_j)$.
- **Disease CSR Scan**: Over $|\mathcal{D}_G| \approx 7,200$ gene-linked diseases and $A_D^+ \approx 220,000$ `(disease, term, freq)` entries (`Int32Array` + `Float32Array`), total work is $O\big((k^+ + 2)(V + E) + (k^+ + 1)A_D^+ + |\mathcal{D}_G|\big) \approx \mathbf{3.0\text{–}4.5\text{ ms}}$ per case.

---

### Summary Comparison of the 3 Candidates

| Dimension | Candidate 1: `FreqResnik-Gene` | Candidate 2: `Disease-cLR` | Candidate 3: `Disease-FreqBMA` (Hybrid) |
| :--- | :--- | :--- | :--- |
| **Granularity** | Gene union ($5,268$ genes) | Disease max ($\sim 7,200$ diseases $\to$ gene) | Disease max ($\sim 7,200$ diseases $\to$ gene) |
| **Pleiotropy handling** | Poor (chimeric matches; cross-disease exclusion bleed) | Excellent (each disease evaluated coherently) | Excellent (each disease evaluated coherently) |
| **Noise robustness** | High (symmetric BMA) | Low-Moderate (unobserved disease terms have $\ln \text{LR}=0$) | Very High (frequency-weighted reverse BMA + $f_0$ prior) |
| **Score scale** | Bounded $[0, \text{IC}_{\max}]$ | Unbounded $(-\infty, +\infty)$, grows with $k^+$ | Bounded $[0, \text{IC}_{\max}]$, invariant to $k^+$ |
| **Per-case runtime** | $\sim 3.5\text{ ms}$ | $\sim 5.5\text{ ms}$ | $\sim 3.5\text{–}4.5\text{ ms}$ |
| **Explainability** | Gene-level term pairs only | Best disease + per-term LLR | Best disease $d^*(g)$ + matched hallmarks + contradicted exclusions |

---

## (b) Recommended Design & Justification

**Recommendation: Candidate 3 (`Disease-FreqBMA`)**.

1. **Fixes the Clean vs. Noisy Trade-Off in [`gene-ranking.md`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/.planning/artifacts/shortlist-sim/2026-10-14-resnik/gene-ranking.md)**:
   In the Sprint 3 benchmark, switching from one-sided to gene-level symmetric BMA boosted noisy $\text{Hit}@10$ by $+15.9\text{ pp}$ (`14.3% -> 30.3%`) but lost $-3.6\text{ pp}$ on clean profiles (`92.4% -> 88.8%`) and left $\rho(\text{score}, \text{annotation count}) = 0.56\text{–}0.59$. Both artifacts stem from taking the union of all diseases per gene and dividing equally by $|T_g|$:
   - Multi-disease genes are penalized on clean profiles because a patient with Disease A lacks the terms of Diseases B, C, and D.
   - Well-studied diseases with 30 rare ($1\text{–}5\%$) case-report annotations are penalized unless weighted by $f_{\text{pos}}(d, t)$, while 1-term stub diseases are over-rewarded unless regularized by $f_0$.
   Scoring at the disease level with frequency-weighted reverse BMA and $f_0 = 1.0$ resolves both defects simultaneously.
2. **Clinically Sound Exclusions on Allelic Disorders**:
   In clinical genetics, excluding a hallmark feature is often used to distinguish allelic disorders of the *same* or *related* genes (or to rule out syndromic mimics of an isolated phenotype). Only disease-level scoring prevents an exclusion of a syndromic feature from penalizing an isolated allelic disorder of the same gene.
3. **Zero New External Data Dependencies & Same ~4 ms Envelope**:
   `genes_to_phenotype.txt` already carries `disease_id` on every row ([`parseGenesToPhenotype`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/hpo-sources.ts#L178)), and `phenotype.hpoa` already carries `qualifier` and `frequency` ([`parseHpoaDiseaseTerms`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/hpo-sources.ts#L158)). Replacing `gene_terms` in `hpo_similarity.db` with `disease_terms(disease_id, term, freq_pos, freq_excl, is_not)` and `gene_diseases(gene_symbol, disease_id)` keeps the SQLite file size under ~12 MB and per-case scoring around ~4 ms.
4. **Structured Per-Gene Explainability (`explain(gene)`)**:
   Computing a detailed explanation for all 5,268 genes upfront is unnecessary; `scoreAllGenes` only needs to return `scores: Float64Array(G)` and `bestDisease: Int32Array(G)` in ~4 ms, while a lazy `explainGene(ix, profile, gene)` reconstructs the exact match table for the top-N shortlisted genes in $< 0.05\text{ ms}$ per gene:
   - Best disease $d^*(g)$ (e.g., `OMIM:115200` + label),
   - Top positive contributions: `(patientTerm, matchedDiseaseTerm, micaTerm, micaIC, diseaseFreq, keyWeight, noveltyFactor)`,
   - Unmatched high-frequency hallmarks of $d^*(g)$ ($f \ge 0.80$ with low $\text{sim}$, marked *"not assessed"*),
   - Contradicted exclusions: `(excludedTerm, contradictedDiseaseTerm, diseaseFreq, penaltyPct)`.

---

## (c) Composition with the Evidence-Points Rule Engine

### 1. Effective Score Normalization & Binning
To prevent a patient with a single vague term (e.g., `Abnormality of the nervous system`, $\text{IC} = 0.4$) from getting a high score simply by matching that vague term $100\%$, modulate the score by a profile-information saturation factor before rule binning:
$$S_{\text{rule}}(g) = S_3(g) \cdot \min\left(1.0,\; \frac{\sum_{i=1}^{k^+} \nu_i \text{IC}(p_i)}{\text{IC}_{\text{sat}}}\right), \quad \text{IC}_{\text{sat}} = 7.0\text{ nats}$$
(A profile with $\ge 2$ moderately specific terms has $\sum \nu_i \text{IC}(p_i) \ge 7.0$, so the factor is $1.0$; a single vague term with $\text{IC} = 1.5$ is capped at $1.5 / 7.0 \approx 0.21$.)

Expose two fields to the ranking rule DSL:
- `hpo_resnik` (continuous float $\in [0, \text{IC}_{\max}]$, `null` when $P^+ = \emptyset$ and $P^- = \emptyset$),
- `hpo_exclusion_penalty` (or `hpo_contradicted`: boolean / float $E(P^+, P^-, d^*(g)) \ge 0.8$ across **all** $d \in \mathcal{D}(g)$).

| Bin | Condition on `hpo_resnik` ($S_{\text{rule}}$) | Default Evidence Points | Clinical Interpretation |
| :--- | :--- | :---: | :--- |
| **Strong Match** | $S_{\text{rule}} \ge 3.2$ | **+3** | High-specificity multi-feature syndrome match ($\sim$ACMG PP4-Moderate) |
| **Moderate Match** | $2.2 \le S_{\text{rule}} < 3.2$ | **+2** | Specific feature or coherent organ-system match ($\sim$ACMG PP4-Supporting) |
| **Weak Match** | $1.2 \le S_{\text{rule}} < 2.2$ | **+1** | Broad organ-system overlap |
| **Neutral / Unassessed** | $0.4 \le S_{\text{rule}} < 1.2$ or `null` | **0** | No meaningful overlap or no HPO terms entered |
| **Excluded / Contradicted** | $S_{\text{rule}} < 1.2$ AND $\min_{d \in \mathcal{D}(g)} E(d) \ge 0.8$ | **-1** | All diseases of the gene require a hallmark feature explicitly excluded in the patient |

### 2. Calibration Against Variant Evidence
- Fit isotonic / logistic bin log-likelihood ratios on the **training folds** of the spiked-exome benchmark:
  $$\text{LLR}_{\text{bin}}(b) = \ln \frac{P(S_{\text{rule}}(g_{\text{causal}}) \in b)}{P(S_{\text{rule}}(g_{\text{bg}}) \in b)}$$
- Align the bin thresholds so that $+1, +2, +3$ points correspond to empirical log-odds ratios of approximately $+1.0, +2.0, +3.0$ nats, ensuring phenotype evidence is calibrated on the same log-odds currency as variant consequence, gnomAD AF, and inheritance rules.

### 3. ClinVar-Visible Safety Guardrails
Phenotype scoring in clinical rare-disease diagnostics must obey an iron rule: **phenotype mismatch or exclusion must never bury a strong molecular diagnosis (ClinVar P/LP or high-confidence LoF)**.
1. **Non-Negative Floor for ClinVar P/LP Variants**:
   In the rule engine, the `-1` Contradicted/Excluded bin is gated by `NOT is_clinvar_plp`: any variant with ClinVar Pathogenic / Likely Pathogenic classification ($\ge 1\star$) has its phenotype point contribution floored at $\ge 0$. Exclusions can reduce a `+3` phenotype bonus to `+1` or `0`, but can never push a ClinVar P/LP variant below its baseline molecular score.
2. **Bounded Exponential Floor ($E_{\max} = 2.5$)**:
   Because $\exp(-\lambda_{\text{excl}} E_{\max}) = \exp(-0.45 \times 2.5) \approx 0.32$, even if a clinician mistakenly excludes two obligate features (e.g., age-dependent features not yet manifest in an infant), a strong 6-term positive match ($S_{\text{pos}} = 4.0$) retains $S_{\text{rule}} \approx 1.3$ (`+1` point) rather than collapsing to $0$.
3. **Cap on Maximum Phenotype Bonus (`+3` points)**:
   Ensure `+3` points is strictly less than the point gap between a rare coding/splice VUS and a common/benign variant, so phenotype acts as a rank-booster among plausible rare candidates without promoting benign polymorphism noise above a true ClinVar P/LP or de novo LoF variant.

---

## (d) Benchmark Protocol & Pre-Registered Ship Criteria

### 1. Gene-Grouped Cross-Validation (Zero Leakage)
- Construct the bipartite graph between the $5,268$ genes and their linked diseases in `genes_to_phenotype.txt`.
- Partition the connected components into **$K = 5$ stratified gene-grouped folds** (balanced by disease count and median annotation count per gene).
- Tune all free parameters ($\alpha_f, \beta_{\text{corr}}, \kappa_{\text{key}}, \gamma, f_0, \lambda_{\text{excl}}, E_{\max}$, and rule bin thresholds) on Folds 1–4; report out-of-fold metrics across all 5 folds (1,000+ sampled diseases for gene ranking; spiked ClinVar variants in `VARLENS_SIM_BACKGROUND_DIR` exomes for variant ranking).

### 2. Simulated Patient Profile Generation
Extend the existing generator in `scripts/shortlist-sim/phenotype/gene-ranking.ts` across the 3 existing noise strata (`clean`, `moderate`, `noisy`) plus 2 new clinical regimes:
- **Positive terms ($P^+$)**: 5 true terms sampled from $T_d^+$ with probability proportional to $f_{\text{pos}}(d, t)$, with ancestor imprecision and random noise terms per stratum ([`gene-ranking.md`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/.planning/artifacts/shortlist-sim/2026-10-14-resnik/gene-ranking.md#L10-L15)).
- **Key terms ($w_i$)**:
  - *Concordant clinical key terms*: Assign $w_i = 2.5$ to the 1–2 sampled true terms with highest $f_{\text{pos}}(d, t) \cdot \text{IC}(t)$ (simulating the primary referral symptom).
  - *Adversarial/noisy key term (in 25% of noisy cases)*: Assign $w_i = 2.5$ to one of the random noise terms or a 2-step-up imprecise ancestor.
- **Excluded terms ($P^-$)**:
  - *Differential-diagnosis exclusions (Realistic)*: For true disease $d$, find the top 10 phenotypic mimic diseases $d' \neq d$ (highest $S_{\text{pos}}(P^+, d')$ outside $\mathcal{D}(g_{\text{causal}})$). Sample $k^- \in \{2, 3\}$ high-frequency features $e \in T_{d'}^+$ ($f_{\text{pos}}(d', e) \ge 0.70$) that are absent from $\text{Anc}(T_d^+)$.
  - *Checklist exclusions*: Sample $k^- = 3$ high-prevalence clinical checklist terms (e.g., `Seizure`, `Microcephaly`, `Global developmental delay`, `Congenital heart defect`) absent from $\text{Anc}(T_d^+)$.
  - *Adversarial false exclusion (Stress test)*: Exclude 1 **true** high-frequency feature $t \in T_d^+$ ($f \in [0.5, 0.9]$) of the causal disease itself (simulating incomplete penetrance, pre-onset infant evaluation, or clinical exam error).

### 3. Metrics to Report
1. **Ranking accuracy**: Tie-averaged $\text{Hit}@1, \text{Hit}@10, \text{Hit}@50, \text{Hit}@100$, median rank, and $\text{MRR}$ with 2,000-replicate disease-clustered bootstrap 95% CIs and paired $\Delta$ vs. current `hpo_resnik`.
2. **Pleiotropy & Annotation-Breadth Bias**:
   - Spearman $\rho(\text{score}, |T_g|)$ and $\rho(\text{score}, |\mathcal{D}(g)|)$.
   - Stratified $\text{Hit}@10$ for single-disease genes ($|\mathcal{D}(g)| = 1$) vs. pleiotropic genes ($|\mathcal{D}(g)| \ge 3$).
3. **Differential Mimic Separation**: Median rank ratio $\text{rank}(g_{\text{causal}}) / \min_{g' \in \text{mimics}} \text{rank}(g')$ with vs. without $P^-$.
4. **Variant-Level Shortlist Metrics** (when background exomes are mounted): Paired $\Delta \text{Hit}@1/5/10$ vs. no-phenotype and vs. Sprint-3 `hpo_resnik`, plus score-decile calibration curve.

### 4. Pre-Registered Ship Criteria (All Must Pass)
1. **Primary Gain (`moderate` & `noisy` with realistic $P^-$ + key terms)**: Paired $\Delta \text{Hit}@10 \ge +3.0\text{ pp}$ with 95% bootstrap CI lower bound $> +1.0\text{ pp}$ over Sprint-3 `hpo_resnik`.
2. **Clean-Profile Recovery ($P^- = \emptyset, w_i = 1$)**: Paired $\Delta \text{Hit}@10 \ge +2.0\text{ pp}$ on `clean` profiles (recovering the pleiotropy loss from Sprint 3's `88.8%` back above `91.0%`), and non-inferiority ($\Delta \text{Hit}@10 \ge -0.5\text{ pp}$) on `moderate`/`noisy` when no exclusions or weights are supplied.
3. **Bias Reduction**: Spearman $\rho(\text{score}, |T_g|) \le 0.40$ across all strata (down from $0.56\text{–}0.59$).
4. **Adversarial Safety**: Under the 1-false-exclusion stress test, $\text{Hit}@50$ degrades by $\le 2.0\text{ pp}$ relative to $P^- = \emptyset$, and ClinVar P/LP variant $\text{Hit}@10$ degrades by $0.0\text{ pp}$.
5. **Latency Budget**: Production p95 scoring time across all 5,268 genes $\le 8\text{ ms}$ (target $\le 5\text{ ms}$); index load $\le 250\text{ ms}$.

---

## (e) Critical Pitfalls & Concrete Engineering Mitigations

### 1. DAG Polarity Hazards: Excluded Terms as Ancestors/Descendants of Present Terms
- **Pitfall A (Excluded ancestor of Present, $e \in \text{Anc}(p)$)**: A clinician applies a "normal neurological exam" macro that excludes `Seizure` (`HP:0001250`), then adds `Febrile seizure` (`HP:0002373`) as present. Because `Febrile seizure` $\implies$ `Seizure`, every gene matching `Febrile seizure` also lies in $\text{Desc}(\text{Seizure})$ and gets hit by the exclusion penalty.
- **Pitfall B (Excluded sibling via MICA)**: If someone scores exclusions using $\text{sim}(e, t) = \text{IC}(\text{MICA}(e, t))$, excluding `Microcephaly` (`HP:0000252`) penalizes `Macrocephaly` (`HP:0000256`) because they share the parent `Abnormality of skull size` ($\text{IC} \approx 2.6$).
- **Mitigation**:
  - **Never use MICA for exclusions**: Only penalize $t \in T_d^+$ when $t \in \text{Desc}(e)$ strictly along `is_a` (enforced automatically by the downward bitmask propagation in Candidate 3).
  - **Positive overrides ancestor exclusion**: Before scoring, compute $\text{Anc}(P^+)$ via [`markAncestors`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/resnik.ts#L119-L132) and strip any $e \in P^-$ with $e \in \text{Anc}(P^+)$. (Conversely, if $p \in \text{Anc}(e)$ strictly—e.g., `Seizure` present, `Myoclonic seizure` excluded—keep both, as this legitimately narrows the seizure subtype).

### 2. Missing Frequencies (~60% of OMIM) & Small-Cohort `1/1` Fractions in `phenotype.hpoa`
- **Pitfall**: In `phenotype.hpoa`, ~60% of OMIM rows have an empty `frequency` field (`""`), while many case-report rows have `1/1` or `2/2`. If `""` is imputed as `0.50` and `1/1` is parsed as `1.00`, then:
  - Excluding a feature that was only ever reported in 1 patient (`1/1`) or listed without frequency (`""`) in OMIM inflicts a massive false exclusion penalty.
- **Mitigation**: Parse `frequency` into **two distinct values** per `(disease_id, hpo_id)` at DB build time in [`hpo-sources.ts`](file:///home/bernt-popp/development/VarLens-wt/sprint-3/src/shared/phenotype/hpo-sources.ts):
  - **Jeffreys/Beta smoothing for fractions `m/n`**:
    $$\hat{f}(m, n) = \frac{m + 0.8}{n + 2.0}$$
    so `1/1` smooths to $1.8 / 3.0 = 0.60$ (not $1.0$), while `49/50` is $0.958$. Pool $\sum m_k / \sum n_k$ when multiple fraction rows exist for the same `(disease_id, hpo_id)`.
  - **HPO frequency term mapping (`HP:0040280`–`HP:0040284`)**:
    | HPO Term | Label | $f_{\text{pos}}$ (Midpoint) | $f_{\text{excl}}$ (Conservative Lower Bound) |
    | :--- | :--- | :---: | :---: |
    | `HP:0040280` | Obligate (100%) | $1.00$ | $0.95$ |
    | `HP:0040281` | Very frequent (80–99%) | $0.895$ | $0.80$ |
    | `HP:0040282` | Frequent (30–79%) | $0.545$ | $0.30$ |
    | `HP:0040283` | Occasional (5–29%) | $0.17$ | $0.05$ |
    | `HP:0040284` | Very rare (1–4%) | $0.025$ | $0.01$ |
    | `""` (Missing) | Unquantified annotation | **$0.35$** | **$0.15$** |
  - Using the conservative lower bound $f_{\text{excl}}$ ($0.15$ when frequency is missing; lower bracket edge for ORPHA categories; posterior 10th percentile for `m/n`) guarantees that strong exclusion penalties are **only** triggered by proven high-penetrance features.

### 3. ORPHA vs. OMIM Database Asymmetry & Duplicate Disease Entities
- **Pitfall**: A gene in `genes_to_phenotype.txt` is often linked to both an `OMIM:` ID (sparse frequencies, mostly `""`) and an `ORPHA:` ID (dense categorical frequencies) for the *same* disorder. If missing frequencies default to `0.50` while the empirical mean of ORPHA frequencies is `~0.35`, OMIM and ORPHA entries sit on mismatched baselines.
- **Mitigation**: Setting $f_{\text{pos}}(\text{missing}) = 0.35$ matches the empirical mean of quantified HPOA annotations. Because Candidate 3 takes $\max_{d \in \mathcal{D}(g)} S_3(d)$, having both OMIM and ORPHA records for a gene naturally selects whichever curation has better alignment without double-counting their union.

### 4. Age-of-Onset & Sex-Dependent Features
- **Pitfall**: Evaluating a neonate or infant where late-onset features (`Intellectual disability`, `Ataxia`, `Retinitis pigmentosa`, `Choreoathetosis`) are not yet present—or where an EHR checklist marks them as absent—or a female patient where male-limited terms (`Cryptorchidism`, `Hypospadias`) are absent.
- **Mitigation**:
  1. Parse the `onset` and `sex` columns of `phenotype.hpoa` during DB build.
  2. When patient sex or age/onset class is provided on the case, zero out $f_{\text{pos}}(d, t)$ and $f_{\text{excl}}(d, t)$ for any annotation incompatible with the patient's sex or whose onset term (`HP:0003581` *Adult onset*, `HP:0003621` *Juvenile onset*, etc.) exceeds the patient's age bracket.
  3. Even when patient age/sex are not recorded, the exponential cap $E_{\max} = 2.5$ ensures that unmanifested late-onset exclusions cannot zero out a strong early-onset match.

### 5. The Low-IC Key-Term Dilution Trap
- **Pitfall**: In Resnik similarity, $\text{sim}(p_i, t) \le \text{IC}(p_i)$. If a clinician marks a broad clinical category like `Global developmental delay` ($\text{IC} \approx 1.8$) or `Seizure` ($\text{IC} \approx 2.1$) as a key term ($w_1 = 3.0$) alongside a specific dysmorphic term ($\text{IC} = 6.0, w_2 = 1.0$), a naive weighted average $\frac{3(1.8) + 1(6.0)}{3 + 1} = 2.85$ is **lower** than the unweighted average $\frac{1.8 + 6.0}{2} = 3.90$—meaning a gene that matches the key term $100\%$ gets **penalized** when the user marks it as a key term!
- **Mitigation**: Use Candidate 3's **zero-centered relative-match contrast** $\big(2 \frac{m^+(p_i, d)}{\text{IC}(p_i)} - 1\big)$ for $(w_i - 1) > 0$. Because $r(p_i, d) = \frac{m^+(p_i, d)}{\text{IC}(p_i)} \in [0, 1]$ is normalized by the query term's own IC, a full match ($r = 1$) always adds a positive bonus and a miss ($r = 0$) always subtracts a penalty, independent of whether the key term has low or high absolute IC.
