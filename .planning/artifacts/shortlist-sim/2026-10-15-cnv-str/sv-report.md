# SV Shortlist Evidence Scoring Report (`#581`)

**Date:** 2026-10-15
**Related issues:** `#581` (SV & CNV shortlist evidence scoring), `#580` (simulation framework), `#642` (CNV/STR locus scoring)

---

## 1. Summary

Shortlist evidence scoring (`SHORTLIST_EVIDENCE_CONFIG.structuralTypes.enabled.sv = true`) is enabled for structural variants (`variant_type = 'sv'`) alongside CNV and STR rows:

1. **Dosage SVs (`DEL` and `DUP`)**: Share the exact `scoreCnv` (`A3 = max(S_gene, S_region)`) locus scorer validated in `report.md`. Their `variant_transcripts` (CSQ) gene sets are batch-loaded in pass 1 (`GeneContextBuilder.cnvIds`) with interval fallback (`cnvEnd(row) = row.end_pos ?? row.pos + Math.abs(row.sv_length ?? 0)` against `gene_reference.db`) and single-gene fallback (`row.gene_symbol`), populating `hpo_resnik`, `hpo_best_disease`, `hpo_conflicts`, `hpo_best_locus`, `cnv_gene_count`, and the tooltip locus note (`kind: 'gene' | 'region'`).
2. **Balanced and insertion SVs (`INV`, `INS`, `BND`)**: `scoreCnv` returns `null` (copy-neutral / non-dosage direction), and `GeneContext.locus(row)` returns `null` when `cnv_gene_count === null`, so `derived(row)` and `withHpoExplanations` fall back to gene-level HPO scoring (`geneHpo(row.gene_symbol, info)`) and gene-level tooltip explanations (`hpo.explain(row.gene_symbol)`).
3. **SV-scoped rule groups (`variantType: 'sv'`)**: Evaluate SV-specific fields (`sv_type`, `sv_length`, `sv_support`, `sv_vaf`, `cnv_gene_count`) alongside global phenotype (`hpo_resnik`, `hpo_best_locus`) and ClinVar/impact groups.

---

## 2. Corpus & Simulation Validation (`report.md` Cross-Reference)

Because `DEL` and `DUP` structural variants use the identical `scoreCnv` (`A3 = max(S_gene, S_region)`) model as CNV rows, the full simulation and real-corpus validation in `.planning/artifacts/shortlist-sim/2026-10-15-cnv-str/report.md` applies directly:

| Benchmark / Corpus | Size | Result |
| --- | --- | --- |
| Phenopacket structural-variant corpus | 636 SV phenopackets | Extracted from phenopacket-store `0.1.26`; 130 real DEL/DUP cases across 12 recurrent syndromes (`N >= 5`) |
| Simulated ClinGen / ClinVar DEL/DUP cases | 386 cases | Spiked into 1000G Phase 3 & GATK-SV backgrounds (3,202 structural variants per sample) |
| Top-1 / Top-5 recall (`A3 = max(S_gene, S_region)`) | 130 real + 386 simulated | **95.4% Top-1 / 96.2% Top-5** on real cases; **94.8% Top-1 / 96.4% Top-5** on simulated cases |
| Acceptance criteria (`CNV-1` .. `CNV-6`) | 6 / 6 gates | **PASS** (beats `A1` on single-gene DEL/DUP and `A2` on multi-gene syndrome loci; zero non-causal regressions) |

---

## 3. End-to-End Verification

- `tests/shared/evidence/ruleset-problems.test.ts`: Verifies `{ sv: true, cnv: true, str: true }` default structural-type enablement and independent flag gating for `variantTypeScope` and group `variantType`.
- `tests/main/database/shortlist-cnv-str-locus.test.ts`: Imports `synthetic-sv-vep.vcf` alongside `synthetic-cnv-vep.vcf` and `synthetic-str.vcf` on SQLite (and PostgreSQL parity when `VARLENS_RUN_POSTGRES_E2E=1`), asserting multi-gene `DEL` SV scoring via `scoreCnv` (`cnv_gene_count = 2`, `NIPA2` locus note) and balanced `INV` SV fallback to `PMP22` gene-level HPO scoring.
