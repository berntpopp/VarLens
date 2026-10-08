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
(SQL) — and used by the cohort summary (rebuild and every incremental path), the carrier list and
the association rows on both backends. It replaced a text `MAX(gt_num)` (summary) and "last row
wins" (association). SQLite **v43** / PostgreSQL **0027** flag a populated summary stale again.

Burden allele frequency = ALT copies / **called alleles** (`calledAlleleCount`): a haploid call
(`1`, `0`) is 1 allele, a diploid one 2, an assumed het (`1/.`) 2 — it is read as a het
everywhere, so its frequency is the same lower bound as its dosage — a reference half-call (`0/.`,
`./0`) 2 with no copy of this ALT, under the same assumption (the missing allele is a different
ALT; its class, dosage and duplicate-call rank stay unknown), and an unknown call (`./.`, NULL) 0. A sample without a row is a diploid `0/0`, as on every other path; for a male on
chrX that overstates the denominator by one allele, which the stored data cannot show.

## Known limits

- Conflicting duplicate calls resolve to the highest dosage without looking at genotype quality,
  which biases toward ALT (PLINK sets such conflicts to missing); the burden test has no "missing"
  dosage yet.
- `1` and `0/1` duplicates on chrX resolve to het by rank: a ploidy disagreement, not a dosage one.
- A sample with no row is counted as two reference alleles, also on male chrX and at uncovered
  sites; an explicit unknown call is dosage 0.
- The burden weight uses the ALT allele frequency, not the minor allele frequency.
- The SQL and TypeScript duplicate-call keys agree for the stored ASCII genotype grammar only.
- Overwriting a case does not carry its per-case annotations (ACMG classifications, stars,
  comments, tags) over to the replacement; the batch-import dialog says so.

## Consequences users will see

- Cohort table: `het_count` rises by the assumed-het carriers; hemizygous and unknown carriers show
  as "other" = carriers − het − hom. Exports are unchanged.
- Association / burden: assumed-het samples carry dosage 1 instead of counting as non-carriers.
- Filters: heterozygous, candidate compound het and de novo include assumed het and `1/0`; the
  candidate needs two different variants, not two rows; compound het and de novo are stricter (above).
- Carrier list: `assumed het (1/.)`, `hemi`, or the stored text of an unknown call (all were `het`).
- Existing databases: SQLite migrations **v42**, **v43** / PostgreSQL **0026**, **0027** flag a populated summary stale.
  SQLite rebuilds it at app start (automatic or interactive open); PostgreSQL in the background,
  leaving it unpatched by imports and deletions until then. Dosage and filters are read-time.
