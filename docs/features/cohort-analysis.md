# Cohort Analysis

VarLens supports aggregating variants across multiple cases for cohort-level analysis.

![Cohort view showing aggregated variant data across cases](/screenshots/cohort-view.png)

## Switching to Cohort Mode

Use the mode toggle in the toolbar to switch between Case and Cohort views. Cohort mode aggregates all imported cases into a single table view.

## Cohort Table

The cohort table shows:

- **Carrier count** — Number of cases carrying each variant
- **Het / Hom** — Carriers that are heterozygous (`0/1`) and homozygous (`1/1`) for the variant. Het includes [assumed het](#partly-missing-genotypes) calls (`1/.`, `./1`). Carriers that are neither — a hemizygous call (`1`) or a genotype without a called zygosity — are shown as "other".
- **Affected carriers** — Carriers with affected status
- All standard variant columns (gene, consequence, scores, etc.)

### Partly missing genotypes

A genotype such as `1/.` or `./1` has one called copy of the variant and a missing other allele. VarLens shows it as **assumed het**, because the stored call can have two origins that it cannot tell apart:

- **A multi-allelic site.** VarLens stores one row per alternate allele. A sample with two different alternate alleles at one position (`1/2` in the VCF) gets one row per allele, each with the other allele written as missing. Here the sample has exactly one copy of each allele.
- **A half-call in the source file.** The variant caller, or a tool that split or merged the VCF, wrote `./1` itself. The other allele is unknown; it could be the reference, another allele, or the same variant.

In both cases VarLens counts the sample as a heterozygous carrier with **one copy**: in the Het column, in the heterozygous, compound-het and de novo filters, and in gene burden tests. For a genuine half-call, one copy is a **lower bound** — the sample may be homozygous. The carrier list shows the stored call next to the label (`assumed het (1/.)`) so you can check the source VCF where it matters.

## Gene Burden Analysis

VarLens includes gene burden testing to identify genes with statistically significant variant enrichment:

- **Fisher's exact test** — p-value, odds ratio, and 95% confidence interval
- **Logistic burden test** — p-value and beta coefficient
- **FDR-adjusted q-values** for multiple testing correction
- **Volcano plot and Manhattan plot** visualizations of results


The burden test uses variants on chromosomes 1-22. All selected cases must have the same genome build. Your filters choose the variants; VarLens then reads every stored call of the selected cases at those variants, so a filter cannot hide a carrier.

A variant is left out for a gene when a selected sample has no usable call there: a no-call (`./.`), or two stored calls that disagree (`0/1` and `1/1`). The result table shows how many variants were used and how many were left out, with the reason. Variants on chrX, chrY and MT are not tested; the result says how many of your qualifying variants that concerns. Variants are weighted by their minor allele frequency among the tested samples.

Samples without a stored call are treated as reference. Use data called and filtered the same way for both groups.

## Filtering

Cohort view supports the same filtering capabilities as case view, plus additional cohort-specific filters for carrier count thresholds.
