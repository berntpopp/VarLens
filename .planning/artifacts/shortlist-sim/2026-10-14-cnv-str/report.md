# CNV/STR phenotype scoring: validation report

Protocol: `protocol.md` (pre-registered, see `preregistration.md`). Code at `19b8c09e`.
Data: HPO DB v6 sources {"hpo":"v2026-09-01","clingen":"2026-10-14","strchive":"v2.28.0","mondo":"v2026-10-06"}.

## Criteria

| # | Result | Value |
|---|---|---|
| CNV-1 | **FAILED** | A3 − A0 Hit@10 Δ -3.0 [-7.6, -0.6] pp (bar ≥ −2.0) |
| CNV-2 | **FAILED** | A3 − A0 Hit@10 Δ -10.7 [-17.7, -3.5] pp, n = 386 (bar ≥ +5.0, lo > 0) |
| CNV-3 | PASS | A3 − A2 Hit@10 Δ 41.4 [29.0, 53.8] pp, n = 44 (bar ≥ +20) |
| CNV-4 | PASS | median ρ A3 -0.096 (A0 0.053; bar ≤ 0.25) |
| CNV-5 | PASS | 0 of 200 profiles differ over 5268 genes (v6: 5268) |
| CNV-6 | **FAILED** | p95 5.86 ms at 5000 CNVs (median 4.60); index load 112.9 ms |
| STR-1 | **FAILED** | 45 false leads in 300 trick cases |
| STR-2 | PASS | new − baseline Hit@1 Δ 27.9 [17.9, 38.3] pp (bar ≥ +5.0, lo > 0) |
| STR-3 | PASS | clean Δ 23.3 [14.1, 33.2] pp; moderate Δ 27.9 [17.9, 38.3] pp; noisy Δ 59.4 [48.1, 70.7] pp (bar ≥ −1.0 each) |
| STR-4 | PASS | ORPHA:273 0.880, ORPHA:401901 0.825, ORPHA:98757 0.930 |

CNV: not all pass, flag stays off. STR: not all pass, flag stays off.

## CNV

Counts: svPhenopackets 636, realCases 130, realGRCh37 86, realGRCh38 44, regionCases 44, regionDropped 34, clinvarEligible 342, clinvarCases 342.

Backgrounds (calls ≥ 1 kb per sample):
- GRCh37: 806*, 840*, 1678*, 1265*, 1480*, 709, 724, 790, 931, 862 calls (* ≥ 1 Mb carrier)
- GRCh38: 1798*, 1640*, 1371*, 1624*, 1761*, 1601, 1588, 1600, 1689, 1520 calls (* ≥ 1 Mb carrier)

Hit@k and MRR in %, 95 % locus-clustered bootstrap CIs (2,000 replicates).

### Real cases (phenopacket-store 0.1.27, observed terms)

n = 130 cases, 12 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| A0 | 57.9 [49.1, 86.2] | 83.1 [74.3, 100.0] | 88.8 [82.5, 100.0] | 69.9 [66.7, 91.5] |
| A1 | 48.3 [12.0, 68.7] | 89.4 [87.1, 97.2] | 93.8 [92.0, 99.1] | 64.4 [40.4, 81.2] |
| A2 | 41.3 [8.4, 60.6] | 78.3 [75.1, 96.4] | 85.8 [81.5, 99.1] | 55.8 [31.9, 76.6] |
| A3 | 41.3 [8.4, 60.6] | 78.3 [75.1, 96.4] | 85.8 [81.5, 99.1] | 55.8 [31.9, 76.6] |
| sum | 45.1 [13.3, 50.5] | 80.4 [48.6, 91.0] | 90.6 [77.1, 96.0] | 61.8 [29.8, 66.6] |

### Simulation, clean, all backgrounds

n = 386 cases, 232 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| A0 | 66.4 [58.3, 75.8] | 87.6 [82.9, 91.7] | 91.0 [86.8, 94.2] | 76.1 [70.4, 82.0] |
| A1 | 49.7 [39.9, 61.1] | 76.8 [70.5, 82.4] | 81.4 [75.2, 86.3] | 61.4 [54.9, 69.0] |
| A2 | 41.6 [31.2, 53.7] | 69.2 [60.9, 76.5] | 75.1 [68.0, 81.5] | 53.4 [45.2, 62.9] |
| A3 | 53.7 [40.8, 68.5] | 78.1 [69.4, 85.8] | 83.0 [76.3, 88.8] | 64.1 [53.9, 75.9] |
| sum | 53.1 [47.1, 58.9] | 71.7 [65.9, 77.2] | 84.0 [80.1, 87.6] | 63.2 [57.8, 68.4] |

### Simulation, moderate, all backgrounds

n = 386 cases, 232 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| A0 | 56.7 [47.7, 67.3] | 82.9 [77.1, 88.0] | 89.1 [84.5, 92.6] | 68.2 [61.4, 75.4] |
| A1 | 40.4 [31.4, 51.1] | 69.6 [62.9, 75.9] | 78.0 [71.6, 83.4] | 52.9 [46.2, 61.1] |
| A2 | 33.9 [24.6, 45.0] | 60.7 [51.5, 69.7] | 68.9 [60.5, 76.1] | 45.7 [37.4, 55.4] |
| A3 | 46.4 [34.4, 60.4] | 71.1 [60.7, 81.5] | 78.2 [69.7, 85.5] | 57.1 [46.5, 69.5] |
| sum | 50.1 [44.0, 56.0] | 65.4 [58.6, 71.8] | 75.5 [70.6, 79.9] | 59.7 [53.9, 65.2] |

### Simulation, noisy, all backgrounds

n = 386 cases, 232 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| A0 | 36.1 [30.1, 43.5] | 70.8 [65.3, 75.9] | 80.6 [75.0, 84.9] | 51.4 [46.6, 57.0] |
| A1 | 30.2 [22.9, 38.5] | 59.3 [53.8, 65.5] | 71.4 [64.5, 76.6] | 42.9 [37.1, 49.8] |
| A2 | 23.5 [16.7, 31.7] | 49.8 [41.8, 58.7] | 59.6 [52.0, 66.5] | 35.3 [28.7, 43.0] |
| A3 | 34.9 [25.5, 45.7] | 61.6 [51.5, 73.3] | 70.5 [62.2, 78.6] | 46.7 [37.7, 57.4] |
| sum | 46.6 [40.3, 52.8] | 63.6 [56.7, 70.0] | 72.4 [66.7, 77.5] | 56.3 [50.3, 62.1] |

### Simulation, moderate, ≥ 1 Mb backgrounds (CNV-2)

n = 386 cases, 232 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| A0 | 57.9 [49.1, 67.7] | 83.4 [77.8, 88.5] | 89.2 [84.7, 92.8] | 69.1 [62.5, 75.9] |
| A1 | 40.7 [31.7, 51.5] | 70.0 [63.5, 75.9] | 78.5 [72.1, 83.8] | 53.3 [46.6, 61.3] |
| A2 | 34.4 [25.1, 45.4] | 61.1 [52.0, 69.9] | 69.4 [61.1, 76.5] | 46.2 [38.0, 55.8] |
| A3 | 46.8 [34.8, 60.8] | 71.5 [61.3, 81.6] | 78.6 [70.3, 85.7] | 57.5 [47.0, 69.6] |
| sum | 38.0 [32.1, 43.9] | 65.3 [58.4, 71.7] | 75.2 [70.2, 79.6] | 53.4 [47.9, 58.9] |

### Simulation, moderate, ClinGen region cases (CNV-3)

n = 44 cases, 35 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| A0 | 68.6 [56.0, 80.8] | 84.2 [73.9, 93.6] | 87.0 [77.3, 95.5] | 75.2 [64.4, 85.5] |
| A1 | 44.3 [31.5, 57.5] | 59.5 [48.1, 71.4] | 69.3 [58.3, 80.5] | 51.0 [39.8, 62.6] |
| A2 | 36.0 [23.7, 49.5] | 49.3 [37.3, 61.2] | 58.6 [46.2, 71.0] | 43.0 [31.8, 55.1] |
| A3 | 99.8 [99.3, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 99.9 [99.6, 100.0] |
| sum | 70.9 [58.1, 81.5] | 84.3 [72.5, 93.5] | 87.8 [77.5, 95.7] | 78.3 [66.5, 87.3] |

## STR

Catalogue loci (hg38): 82; causal loci: 69.

### Causal, decoys none, clean

n = 69 cases, 66 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| new | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] |
| baseline | 76.7 [66.8, 85.9] | 89.1 [81.2, 95.6] | 91.3 [84.0, 97.1] | 81.8 [73.6, 89.2] |

### Causal, decoys none, moderate

n = 69 cases, 66 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| new | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] |
| baseline | 72.1 [61.7, 82.1] | 87.6 [79.2, 94.4] | 89.9 [81.9, 95.9] | 79.1 [70.9, 86.7] |

### Causal, decoys none, noisy

n = 69 cases, 66 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| new | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] |
| baseline | 40.6 [29.3, 51.9] | 69.1 [57.7, 79.3] | 81.9 [72.0, 90.3] | 52.9 [43.3, 61.9] |

### Causal, decoys population, clean

n = 69 cases, 66 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| new | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] |
| baseline | 76.7 [66.8, 85.9] | 89.1 [81.2, 95.6] | 91.3 [84.0, 97.1] | 81.8 [73.6, 89.2] |

### Causal, decoys population, moderate

n = 69 cases, 66 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| new | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] |
| baseline | 72.1 [61.7, 82.1] | 87.6 [79.2, 94.4] | 89.9 [81.9, 95.9] | 79.1 [70.9, 86.7] |

### Causal, decoys population, noisy

n = 69 cases, 66 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| new | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] |
| baseline | 40.6 [29.3, 51.9] | 69.1 [57.7, 79.3] | 81.9 [72.0, 90.3] | 52.9 [43.3, 61.9] |

### Causal, decoys all, clean

n = 69 cases, 66 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| new | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] |
| baseline | 76.7 [66.8, 85.9] | 89.1 [81.2, 95.6] | 91.3 [84.0, 97.1] | 81.8 [73.6, 89.2] |

### Causal, decoys all, moderate

n = 69 cases, 66 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| new | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] |
| baseline | 72.1 [61.7, 82.1] | 87.6 [79.2, 94.4] | 89.9 [81.9, 95.9] | 79.1 [70.9, 86.7] |

### Causal, decoys all, noisy

n = 69 cases, 66 clusters.

| Arm | Hit@1 | Hit@5 | Hit@10 | MRR (×100) |
|---|---|---|---|---|
| new | 95.7 [90.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 97.8 [95.0, 100.0] |
| baseline | 40.6 [29.3, 51.9] | 69.1 [57.7, 79.3] | 81.9 [72.0, 90.3] | 52.9 [43.3, 61.9] |

### Trick arms (STR-1)

| Arm | Cases | False leads | Examples |
|---|---|---|---|
| T1 | 60 | 0 |  |
| T2 | 60 | 0 |  |
| T3 | 60 | 0 |  |
| T4 | 60 | 0 |  |
| T5 | 60 | 45 | CHNG3_MIR7-2 2/3 full → OMIM:609893 (clean); CHNG3_MIR7-2 2/3 full → OMIM:609893 (moderate); CHNG3_MIR7-2 2/3 full → OMIM:609893 (noisy); CHNG3_MIR7-2 3/2 full → OMIM:609893 (clean); CHNG3_MIR7-2 3/2 full → OMIM:609893 (moderate) |

## Notes (hand-written after the single run; nothing re-run or tuned)

- **One run.** `run.ts --run cnv-str-2026-10-14` at `19b8c09e`, executed once. Downloads (sha256 in
  `DATA_DIR/external/cnv-str/SHA256SUMS`): 1KGP high-coverage SV freeze V3 `0b9a2635…`, phase-3 SV
  map `70cd6713…`, ClinVar `variant_summary.txt.gz` of 2026-10-14 `a5198a11…`.
- **Real cases: 130, not ≈ 110.** 636 SV phenopackets; dropped by the protocol rules: no chromosome
  in the text (F8 `GRCh37:a-b` labels, `g.a_bdel(GRCh37)`), terminal `pter`/`qter` deletions, end ≤
  start, unparsable labels. Clarification: one explicit NCBI 36 (hg18) case is dropped rather than
  assigned a build (the protocol only names GRCh37/38). 12 clusters, dominated by ANKRD11 (76) and
  EHMT1 (35), so the real-case CIs are wide.
- **ClinVar**: 342 eligible copy-number P/LP records, all used (cap 500).
- **Decision rules where the protocol was silent:** CNV-1 and STR-3 are judged on the point
  estimate, as the criterion text reads (CIs shown). STR-3 must hold at every level.
- **Why CNV-1/CNV-2 fail.** The dosage weights (A0 → A1) cost 9–11 pp Hit@10 in simulation (on real cases they gain 5 pp);
  Šidák (A1 → A2) costs another ~9 pp; the region route (A2 → A3) gives back ~9 pp overall and
  +41 pp on region diseases. With moderate profiles and ≥ 1 Mb backgrounds A3 is 10.7 pp **below** A0.
  The sum reference is also below A0. The gene route as specified is the problem, not the regions.
- **Why CNV-6 fails.** Scoring 5,000 CNVs: median 4.60 ms, p95 5.86 ms (host load average ≈ 10–12
  from parallel agents). Index load 112.9 ms is almost all the GRCh38 gene-interval index
  (re-measured: 140–170 ms; locus tables 4–5 ms). The import gene fallback loads the same index, so in
  the app it may already be warm; as pre-registered it counts, and the criterion fails.
- **Why STR-1 fails.** All 45 false leads are T5 rows at `CHNG3_MIR7-2`: STRchive v2.28.0 gives
  benign max 4 ≥ pathogenic min 3, so a normal draw of 3–4 copies is banded `full` and scored
  against OMIM:609893. It is the only catalogue locus with benignMax ≥ pathogenicMin. Real calls in
  that range would get the same false lead, so it is a scorer/catalogue bug (band rule or override),
  not only a generator artefact. T1–T4: 0 false leads.
- **STR numbers are optimistic by construction**: background rows are normal and so null, the causal
  row is usually the only scored one; baseline ignores alleles, so its decoy arms equal `none`.
