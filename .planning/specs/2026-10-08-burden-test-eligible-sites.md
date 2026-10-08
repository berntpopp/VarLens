# Burden Test: Eligible Sites, Missing Calls and Minor Allele Frequency Spec

Date: 2026-10-08

Status: proposed

Issue: #520. Also closes the "association filters accepted then dropped" item of #510.

Checked against `main` at `bcbc86cf` (v0.81.0).

## Summary

The burden test reads a sample without a stored row as two reference alleles. The import stores
only carried alternate alleles: reference calls, no-calls (`./.`) and calls removed by import
quality filters all leave no row. "No row" therefore has several meanings that no imputation
rule can tell apart. Phase 1 restricts the test to sites where the arithmetic is defensible,
excludes sites with an unclear call, weights by minor allele frequency and states the remaining
assumption in the result. It needs no schema change. Phase 2 adds chrX.

## Decisions (2026-10-08)

1. Phase 1 covers autosomes only. chrX, chrY and MT are excluded.
2. No new per-sample reference or callability storage in this spec.
3. chrX is designed here as phase 2 and implemented separately.

## Evidence

- `geneSamples` counts 2 called alleles for a sample without a row
  (`src/main/statistics/contingency.ts:141-143`) and dosage 0 (`:156`).
- `carrierCounts` counts every sample without positive dosage as a non-carrier (`:98-121`), so
  the Fisher table has the same assumption.
- Duplicate rows of one case resolve to the highest dosage, without regard to quality (`:86`).
- `computeWeight` uses the alternate allele frequency as given (`src/main/statistics/weights.ts:7-13`).
- Both builders apply every row filter in the query that also collects genotypes
  (`AssociationDataBuilder.ts:36-83`, `PostgresAssociationDataBuilder.ts:87-117`). A per-sample
  column filter such as depth removes a carrier's row, and that carrier is then read as reference.
- Both builders pass `acmg_classifications` and `max_internal_af`; `buildBaseWhere` drops them in
  the `cohort-burden` scope (#510).
- The association `variant_key` is `chr:pos:ref:alt`, without build.
- `carriedAltAlleles` writes no row for `.`, `./.` and all-reference calls
  (`src/main/import/vcf/VcfMapper.ts:253-273`).

## What other tools do

- SKAT mean-imputes missing genotypes by default and warns that this inflates type I error when
  variants are very rare and missingness differs between cases and controls; it drops variants
  above 15% missing. PLINK 2 `--glm` excludes missing rows.
- PLINK sets discordant duplicate calls to missing.
- SKAT defines the Beta(1,25) weight on minor allele frequency.
- TRAPD and CoCoRV (Chen 2022, PMID 35545612) restrict the test to sites with depth of at least
  10 in at least 90% of samples in both groups; Povysil 2019 (PMID 31605095) gives the same
  guidance. This is the standard VarLens cannot meet without stored callability.
- PLINK 2, regenie and SKAT code a male chrX carrier as 2 by default.

## Phase 1 design

1. **Eligible sites.** Autosomes 1-22 only. All selected cases must have one genome build; a run
   with mixed builds is rejected with a clear message.
2. **Select, then collect.** Step one selects qualifying variants (gene, frequency, impact,
   ClinVar, column filters). Step two reads every stored row of the selected cases at those
   variants, without row filters. A filter can no longer turn a carrier into a reference call.
3. **Missing dosage.** A sample's dosage at a site is 0, 1, 2 or missing. It is missing when the
   stored call is unknown or partial, or when duplicate rows of the case disagree in dosage.
   Phased and unphased forms of the same call agree. There is no quality-based rescue.
4. **Complete-site rule.** A site with a missing dosage in any analysed sample is excluded from
   both groups, from the burden score and from the Fisher table. Nothing is imputed.
5. **Weight.** The Beta weight uses `min(p, 1 - p)` with `p` from the analysed samples. Dosage
   stays on the alternate allele, so it stays aligned with CADD and ClinVar. A site with no
   called alleles is excluded.
6. **Covariates.** The complete-covariate sample set is chosen before frequencies and weights
   are computed, so weights describe the samples that are tested.
7. **Reporting.** Each gene result carries the number of sites used and the number excluded per
   reason. The result view and the export state: "Samples without a stored call are treated as
   reference. Use data called and filtered the same way for both groups." No checkbox; a
   declaration VarLens cannot verify adds nothing.
8. **Cleanup.** Remove `acmg_classifications` and `max_internal_af` from both builders' calls.

Both `AssociationDataBuilder`s produce the same matrix and the same exclusions.

## Phase 2 design: chrX (not implemented by this spec)

- Requires `case_metadata.sex` for every analysed sample; a sample without it is excluded from
  chrX genes and reported.
- Pseudoautosomal regions are treated as autosomal, using `src/shared/utils/par-regions.ts`.
  That file has no production user today; #500 must keep it.
- Male non-PAR genotypes are normalised to one rule (`1`, `1/1` and `0/1` are carriers) and
  coded 0 / 2, the default of PLINK 2, regenie and SKAT. The coding is stated in the result.
- Sex is added as a covariate for chrX genes.
- Allele counts for the frequency use one allele per male outside PAR.
- Needs a null simulation showing calibrated p-values before release.

## Out of scope

- A callable-region mask (BED or gVCF reference blocks) per sample or per dataset. It is the
  real fix for callability and a separate spec.
- chrY and MT.
- Relatedness and ancestry adjustment.
- Changing the genotype resolver used outside the association test.

## Files

`src/main/statistics/{contingency,weights,burden,types}.ts`,
`src/main/database/AssociationDataBuilder.ts`,
`src/main/storage/postgres/PostgresAssociationDataBuilder.ts`,
`src/shared/sql/genotype-dosage.ts`, `src/shared/utils/genotype.ts`, the association result
table and export in the renderer, `.planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md` ("Known limits").

## Tests

- A column filter on depth does not turn a carrier into a reference sample.
- An unknown call in either group excludes the site from the burden score and the Fisher table;
  swapping the group labels excludes the same sites.
- `0/1` with `1/1` for one case is missing; `0/1` with `0|1` is het; the GQ 99 / GQ 2 example
  from the issue does not select the homozygote.
- `p = 0.75` gives a weight at 0.25.
- chrX, chrY and MT variants do not enter a result; a mixed-build selection is rejected.
- Both builders return identical matrices and exclusion counts on the same data.
- Results on an eligible complete dataset still match the golden references in
  `tests/fixtures/golden/`.

Gate: `make rebuild-node && make test`, `VARLENS_WEB=1 make test`.
