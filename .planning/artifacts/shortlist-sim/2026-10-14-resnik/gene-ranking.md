# hpo_resnik gene-ranking benchmark (public data)

HPO release v2026-09-01; 1000 of 9162 eligible OMIM/ORPHA diseases
(seeded sample), every one of 5277 genes in genes_to_phenotype.txt ranked per case.
Profiles: 5 frequency-weighted true terms (unknown frequency = 0.5),
the same true terms in every stratum; causal gene drawn uniformly from the disease genes.
Ranks are tie-averaged; intervals are 95 % percentile bootstrap over diseases
(2000 replicates).

| Noise level | imprecision | steps up | noise terms |
|---|---|---|---|
| clean | 0 | 0 | 0 |
| moderate | 0.4 | 1 | 2 |
| noisy | 0.6 | 2 | 5 |

## clean (1000 cases, median profile 5 terms)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, annotation count) |
|---|---|---|---|---|---|---|---|
| `hpo_resnik` (patient→gene BMA, production) | 62.5 [60.1, 65.0] | 92.4 [91.0, 93.6] | 98.4 [97.8, 99.0] | 99.3 [98.8, 99.7] | 1.0 [1.0, 1.5] | 0.732 [0.712, 0.751] | 0.68 |
| gene→patient BMA | 8.3 [6.6, 9.9] | 23.2 [20.6, 25.9] | 45.5 [42.6, 48.5] | 59.1 [55.9, 62.1] | 65.0 [56.0, 77.0] | 0.138 [0.120, 0.155] | 0.30 |
| symmetric BMA (mean of both) | 63.6 [60.6, 66.6] | 90.5 [88.6, 92.2] | 97.9 [97.0, 98.7] | 99.3 [98.7, 99.8] | 1.0 [1.0, 1.0] | 0.729 [0.705, 0.752] | 0.59 |
| exact term overlap count | 69.0 [66.7, 71.3] | 94.9 [93.7, 95.9] | 98.8 [98.2, 99.3] | 99.3 [98.8, 99.7] | 1.0 [1.0, 1.0] | 0.785 [0.766, 0.802] | 0.32 |

Paired ΔHit@10 (`hpo_resnik` − baseline, pp): reverse 69.2 [66.3, 72.1]; symmetric 1.9 [0.5, 3.3]; overlap -2.5 [-3.2, -1.9]

## moderate (1000 cases, median profile 7 terms)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, annotation count) |
|---|---|---|---|---|---|---|---|
| `hpo_resnik` (patient→gene BMA, production) | 22.6 [20.0, 25.1] | 56.3 [53.3, 59.1] | 79.1 [76.5, 81.5] | 85.5 [83.4, 87.6] | 7.0 [6.0, 8.5] | 0.335 [0.312, 0.358] | 0.75 |
| gene→patient BMA | 4.8 [3.6, 6.2] | 16.9 [14.6, 19.3] | 33.0 [30.2, 35.8] | 45.1 [42.1, 48.1] | 125.0 [110.0, 148.0] | 0.091 [0.078, 0.106] | 0.25 |
| symmetric BMA (mean of both) | 33.3 [30.3, 36.1] | 66.8 [63.9, 69.6] | 85.3 [83.1, 87.4] | 92.4 [90.7, 94.0] | 4.0 [3.0, 4.0] | 0.447 [0.422, 0.472] | 0.63 |
| exact term overlap count | 31.6 [29.2, 34.0] | 65.4 [62.7, 67.9] | 83.6 [81.7, 85.5] | 89.4 [87.8, 91.0] | 4.5 [3.5, 5.0] | 0.431 [0.407, 0.454] | 0.30 |

Paired ΔHit@10 (`hpo_resnik` − baseline, pp): reverse 39.4 [35.6, 43.0]; symmetric -10.5 [-13.3, -7.6]; overlap -9.0 [-11.9, -6.0]

## noisy (1000 cases, median profile 10 terms)

| Scorer | Hit@1 % | Hit@10 % | Hit@50 % | Hit@100 % | median rank | MRR | ρ(score, annotation count) |
|---|---|---|---|---|---|---|---|
| `hpo_resnik` (patient→gene BMA, production) | 3.5 [2.5, 4.8] | 14.3 [12.3, 16.5] | 33.9 [30.9, 36.8] | 48.0 [44.8, 51.0] | 118.5 [95.5, 138.0] | 0.074 [0.062, 0.086] | 0.80 |
| gene→patient BMA | 1.7 [0.9, 2.6] | 10.0 [8.2, 12.0] | 21.2 [18.7, 23.8] | 31.0 [28.2, 33.9] | 288.5 [247.0, 322.0] | 0.045 [0.036, 0.054] | 0.22 |
| symmetric BMA (mean of both) | 7.9 [6.2, 9.6] | 32.1 [29.2, 35.0] | 55.3 [52.3, 58.4] | 66.7 [63.9, 69.6] | 38.0 [32.0, 45.0] | 0.159 [0.142, 0.178] | 0.66 |
| exact term overlap count | 15.8 [14.0, 17.8] | 42.3 [39.6, 44.9] | 64.0 [61.4, 66.5] | 72.9 [70.6, 75.3] | 21.5 [18.5, 27.0] | 0.247 [0.227, 0.268] | 0.26 |

Paired ΔHit@10 (`hpo_resnik` − baseline, pp): reverse 4.3 [1.3, 7.3]; symmetric -17.8 [-20.6, -15.1]; overlap -27.9 [-30.5, -25.2]

Runtime of the production scorer per case (all 5277 genes, open → score → close):
median 235 ms, p95 395 ms.

Reproduce: `npm run build:hpo-db -- --out <data>/cache/hpo/hpo_similarity.db --tag v2026-09-01`,
download the same release's three raw files into `<data>/cache/hpo/raw-v2026-09-01/` (the
runner refuses them unless their sha256 matches the DB's `sources_sha256`), then
`npx jiti scripts/shortlist-sim/phenotype/gene-ranking.ts --run <name>` (1074 s wall, 0.75 GB peak).

## Reading

- **Direction is right, aggregation is not.** Patient→gene BMA (production) beats gene→patient
  BMA at every noise level (ΔHit@10 +69 / +39 / +4 pp), so the chosen direction is the better of
  the two one-sided averages. But once the profile carries imprecise or unrelated terms it loses
  to the symmetric BMA (−10.5 pp moderate, −17.8 pp noisy) and even to exact term overlap
  (−9.0 / −27.9 pp).
- **Annotation-count bias.** Production scores correlate with how many terms a gene carries
  (mean Spearman ρ 0.68 clean → 0.80 noisy; overlap 0.26–0.32). A noise term is matched by
  *some* term of a heavily annotated gene, so such genes float up whatever the patient has.
  This is the main reason it degrades under noise.
- **Optimistic in absolute terms.** genes_to_phenotype.txt is derived from the same disease
  annotations the profiles are sampled from, so the true terms of the causal gene are present
  verbatim (clean Hit@10 92 %). Compare scorers with each other, not with real-case Hit rates.
  Real referrals sit nearer the moderate/noisy strata.
- **Runtime** is ~0.24 s per case for all 5277 genes; a case scores only its own genes, far fewer.

Verdict for #600: `hpo_resnik` carries signal, but in its current one-sided form it should not
be put into a preset unchanged. The symmetric BMA (one extra
`resnikBestMatchAverage(geneTerms, patientTerms)` call) is the cheapest candidate fix. Confirm
with the variant-level benchmark before choosing.

## TODO: variant-level benchmark (needs the private backgrounds)

Blocked on 2026-10-14: the varvis exome backgrounds (`VARLENS_SIM_BACKGROUND_DIR`, default
`/run/media/bernt-popp/1819-E513/immunology_cases`) were not mounted. When available, spike the
ClinVar pool into the backgrounds with these noisy profiles and compare on the same gene-grouped
folds and seeds: (a) the varvis template without phenotype, (b) + varvis `hpo_sim_score` bins,
(c) + `hpo_resnik` bins tuned on training folds only (plus a hand-set bin version). Report
Hit@1/5/10 with cluster-bootstrap intervals, paired Δ vs (a) per noise level, and the
reliability of `hpo_resnik` by score decile. Run (c) with the symmetric BMA as well.
