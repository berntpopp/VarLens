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
are not stored — so no trio filter proves absence in a parent.

## Consequences users will see

- Cohort table: `het_count` rises by the assumed-het carriers; hemizygous and unknown carriers show
  as "other" = carriers − het − hom. Exports are unchanged.
- Association / burden: assumed-het samples carry dosage 1 instead of counting as non-carriers.
- Filters: heterozygous, candidate compound het and de novo include assumed het and `1/0`; the
  candidate needs two different variants, not two rows; compound het and de novo are stricter (above).
- Carrier list: `assumed het (1/.)`, `hemi`, or the stored text of an unknown call (all were `het`).
- Existing databases: SQLite migration **v42** / PostgreSQL **0026** flag a populated summary stale.
  SQLite rebuilds it at app start (automatic or interactive open); PostgreSQL in the background,
  leaving it unpatched by imports and deletions until then. Dosage and filters are read-time.
