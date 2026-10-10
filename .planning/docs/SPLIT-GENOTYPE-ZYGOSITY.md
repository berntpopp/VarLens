# Zygosity of split multi-allelic genotypes (`1/.`) — decision record (2026-10-08)

Code: `src/shared/utils/genotype.ts`, `src/shared/sql/genotype-dosage.ts`, `inheritance-sql.ts`.

VCF import splits a multi-allelic record into one row per carried ALT; `remapGenotype` writes `.`
for every allele that is neither REF nor the row's ALT. A `1/2` sample is stored as `1/.` and `./1`
(`0/2`: no row for ALT 1; `2/2`: `1/1` on ALT 2; haploid `1` stays `1`). Those rows counted as
carriers but as neither het nor hom, had a NULL association dosage (= non-carrier), and were skipped
by the het, compound-het and de novo filters. A half-call already in the source (`./1`, other allele
unknown) is stored byte-identically, and a sibling row does not tell them apart (`*` ALTs get no
row; import filters drop rows). JSON imports store the file's `gt_num` text unchanged.

## Sources

- VCF 4.3 §1.6.2 (<https://samtools.github.io/hts-specs/VCFv4.3.pdf>): `.` "must be specified for
  each missing allele"; a partly missing genotype is given no meaning. PLINK `--vcf-half-call`
  (<https://www.cog-genomics.org/plink/1.9/input>): "The current VCF standard does not specify how
  '0/.' and similar GT values should be interpreted"; modes error (default), haploid, missing,
  reference ("Treat the missing part as reference").
- bcftools `norm -m-` (<https://samtools.github.io/bcftools/bcftools.html>, `vcfnorm.c`):
  `--multi-overlaps 0|.`, default `0` — a split `1/2` becomes `1/0` and `0/1`. Hail
  `split_multi_hts`, used by gnomAD (<https://hail.is/docs/0.2/methods/genetics.html>): "The genotype
  1/2 maps to 0/1 and 0/1." GATK `BEST_MATCH_TO_ORIGINAL` (source): "het-alt genotypes when split
  into 2 bi-allelic variants will be het in each". These support **het** for a split `1/2`.
- bcftools `+fill-tags` (`plugins/fill-tags.c`) counts one allele for `./1` whether or not `-d` is
  given; `-d` only stops calling it hemizygous. This supports the **allele count of 1**, not a het
  class. vt decompose (<https://genome.sph.umich.edu/wiki/Vt>) writes `1/.`: "partial genotypes".

## Decision — one definition for every consumer, both backends and the renderer

| Class | Stored genotypes | Dosage |
| --- | --- | --- |
| het | `0/1 1/0 0\|1 1\|0`, and assumed het `1/. ./1 1\|. .\|1` | 1 |
| hom / hemizygous | `1/1 1\|1` / `1` (haploid) | 2 / 1 |
| reference | `0/0 0\|0 0` | 0 |
| unknown | everything else (`./.`, `0/.`, NULL, other text, other partial strings) | NULL |

A genotype with one called ALT and a missing allele is **assumed het, dosage 1**: exact for a split
`1/2`, and a lower bound for a source half-call, which may be homozygous. No standard settles that
case; VarLens cannot tell the two apart and never counts either as homozygous. Every view that
shows or counts such a call says "assumed het" and explains both origins (`ASSUMED_HET_HELP`; user
docs: "Partly missing genotypes"). Telling them apart needs the importer to keep the original call.

Trio filters use the same classes. A parent's row blocks de novo unless it is a reference call: an
uncalled parent never establishes one. Trio compound het returns only het variants with one
carrying parent and a reference (or absent) other parent, in genes that have one from each parent.
A parent **without a row** is read as a non-carrier on every path — reference and uncovered sites
are not stored — so no trio filter proves absence in a parent. Autosomal recessive (chrX, chrY and
chrM left out) reads each parent once, by its resolved call (below): het or only uncalled passes;
reference, homozygous, haploid or no row withholds.

## Conflicting duplicate calls, and called alleles (#516, #517)

Several rows of one case for one variant with different genotypes resolve to **one call, the
highest dosage**: hom > het (incl. assumed) > hemizygous > reference > unknown, ties by the
bytewise greatest text. A called ALT is evidence; a reference or missing call on another row is
not evidence against it. Defined once — `genotypeCallKey` (TS) / `gtCallKeySql`, `resolvedGtSql`
(SQL) — and used by the cohort summary (rebuild and every incremental path) and the carrier list.
It replaced a text `MAX(gt_num)` (summary). SQLite **v43** / PostgreSQL **0027** flag a populated
summary stale again. **The association test departs from this shared rule (#520):** there, rows of
one case that disagree in dosage are a missing call and the site is excluded (below). The cohort
summary and the carrier list keep "highest dosage".

## Burden test (#520, phase 1)

Spec: `.planning/specs/2026-10-08-burden-test-eligible-sites.md`. Code:
`src/main/statistics/contingency.ts` and both `AssociationDataBuilder`s.

- **Sites:** autosomes 1-22 (`autosomeSql`), cases of one genome build
  (`assertSingleGenomeBuild`). The filters select sites; every stored row of the selected cases at
  a selected site is then read without a filter.
- **Dosage** per sample and site: 0, 1 or 2, or missing. The classes of the table above stay: an
  assumed het (`1/.`, `./1`) is one copy, and a reference half-call (`0/.`, `./0`) is no copy with
  two called alleles (`gtDosageSql` gives NULL for it; `rowDosage` in `contingency.ts` reads it as
  0 through `calledAlleleCount`). Missing is only the unknown class (`./.`, NULL, other text), or
  rows of one case that differ in dosage (`0/1` + `1/1`, `0/1` + `./.`). `0/1` + `0|1` agree.
  Genotype quality is not consulted.
- **Complete sites only:** a site with a missing dosage in any selected sample is used for no
  sample, in the burden score and in the Fisher table. Nothing is imputed. Each gene reports the
  sites used (`n_variants`) and `sites_excluded` by `missing_call`, `conflicting_calls` and
  `no_called_alleles`. The run reports `non_autosomal_variants`: qualifying variants on chrX,
  chrY, MT or another contig, so a chrX gene list is not empty without a reason.
- **Frequency** p = ALT copies / called alleles (`calledAlleleCount`: haploid 1, diploid 2, no
  row 2) among the samples with complete covariates (or all samples when no sample has complete
  covariates). **Weight** = Beta(min(p, 1 − p); 1, 25).

## Known limits

- Burden test: a sample with no row is counted as two reference alleles, also at uncovered
  sites. VarLens stores no callability; every result and export says so. A callable-region mask
  is a separate spec.
- Burden test: autosomes only. chrX (phase 2 of the spec: sex, pseudoautosomal regions, male
  coding), chrY and MT are not tested.
- Burden test: chromosome names must match exactly across cohorts; 'chr1' and '1' are treated as
  two different sites.
- Burden test: `1` and `0/1` rows of one case agree in dosage and count as one copy; the ploidy
  disagreement is not detected.
- Cohort summary and carrier list: conflicting duplicate calls resolve to the highest dosage
  without looking at genotype quality, which biases toward ALT. The burden test excludes the same
  site, so a cohort row can show a homozygous carrier that the burden test does not count.
  `1` and `0/1` duplicates on chrX resolve to het by rank: a ploidy disagreement, not a dosage one.
- The SQL and TypeScript duplicate-call keys agree for the stored ASCII genotype grammar only.
- Overwriting a case does not carry its per-case annotations (ACMG classifications, stars,
  comments, tags) over to the replacement; the batch-import dialog says so.

## Consequences users will see

- Cohort table: `het_count` rises by the assumed-het carriers; hemizygous and unknown carriers show
  as "other" = carriers − het − hom. Exports are unchanged.
- Association / burden: assumed-het samples carry dosage 1. Sites with an unknown or conflicting
  call in any selected sample are left out and counted per gene. Variants on chrX, chrY and MT are
  left out and counted per run.
- Filters: heterozygous, candidate compound het and de novo include assumed het and `1/0`; the
  candidate needs two different variants, not two rows; compound het and de novo are stricter (above).
- Carrier list: `assumed het (1/.)`, `hemi`, or the stored text of an unknown call (all were `het`).
- Existing databases: SQLite migrations **v42**, **v43** / PostgreSQL **0026**, **0027** flag a populated summary stale.
  SQLite rebuilds it at app start (automatic or interactive open); PostgreSQL in the background,
  leaving it unpatched by imports and deletions until then. Dosage and filters are read-time.
