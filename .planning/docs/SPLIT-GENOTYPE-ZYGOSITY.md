# Zygosity of split multi-allelic genotypes (`1/.`) — decision record (2026-10-08)

Code: `src/shared/utils/genotype.ts` (classes), `src/shared/sql/genotype-dosage.ts` (SQL).

VCF import splits a multi-allelic record into one row per carried ALT. A sample with a different
ALT on its other chromosome (`1/2`) is stored as `1/.` and `./1` (`1|.`, `.|1` when phased). Those
rows counted in `carrier_count` but in neither `het_count` nor `hom_count`, had a NULL association
dosage (= non-carrier), and were skipped by the heterozygous, compound-het and de novo filters.

`remapGenotype` writes `.` for every allele that is neither REF nor the row's ALT; only carried ALTs
get a row (`0/2`: none for ALT 1; `2/2`: `1/1` on ALT 2; haploid `1` stays `1`). A half-call already
in the source (`./1`, other allele unknown) is stored byte-identically to a split `1/2`, and a
sibling row does not tell them apart (`*` ALTs get no row; import filters drop rows). JSON imports
store the file's `gt_num` text unchanged.

## Sources

- VCF 4.3 §1.6.2 (<https://samtools.github.io/hts-specs/VCFv4.3.pdf>): `.` "must be specified for
  each missing allele"; a partly missing genotype is given no meaning. PLINK `--vcf-half-call`
  (<https://www.cog-genomics.org/plink/1.9/input>): "The current VCF standard does not specify how
  '0/.' and similar GT values should be interpreted"; modes error (default), haploid, missing,
  reference ("Treat the missing part as reference").
- bcftools (<https://samtools.github.io/bcftools/bcftools.html>, `vcfnorm.c`, `plugins/fill-tags.c`):
  `norm -m- --multi-overlaps 0|.`, default `0` — a split `1/2` becomes `1/0` and `0/1`;
  `+fill-tags` counts one allele for `./1` (as hemizygous) unless `-d`.
- Hail `split_multi_hts`, used by gnomAD (<https://hail.is/docs/0.2/methods/genetics.html>): "The
  genotype 1/2 maps to 0/1 and 0/1."
- GATK `GenotypeAssignmentMethod.BEST_MATCH_TO_ORIGINAL` (source): "het-alt genotypes when split
  into 2 bi-allelic variants will be het in each". vt decompose
  (<https://genome.sph.umich.edu/wiki/Vt>) writes `1/.`, `./1`: "partial genotypes".

## Decision — one definition for every consumer, both backends and the renderer

| Class | Stored genotypes | Dosage |
| --- | --- | --- |
| het | `0/1 1/0 0\|1 1\|0 1/. ./1 1\|. .\|1` | 1 |
| hom | `1/1 1\|1` | 2 |
| hemizygous | `1` (haploid) | 1 |
| none | everything else (no-call SV `./.`, NULL, other text) | NULL |

A partly missing genotype with one called ALT is **heterozygous for the allele of its row, dosage
1**: exact for a split `1/2` (bcftools, Hail/gnomAD and GATK agree), and the number of called
copies — a lower bound — for a source half-call. Never homozygous. The importer is unchanged.

**Open choice, settled by no standard:** a true source half-call may be homozygous. VarLens cannot
tell it from a split site and reads it as het / dosage 1 (PLINK `reference` mode, bcftools' allele
count); the carrier list shows the stored call (`het (1/.)`). Telling them apart needs the importer
to keep the original genotype.

## Consequences users will see

- Cohort table: `het_count` rises by the split and half-called carriers. Carriers that are neither
  (hemizygous, no-call SV, missing GT) show as "other" = carriers − het − hom; exports are unchanged.
- Association / burden: such samples carry dosage 1 instead of counting as non-carriers.
- Inheritance filters: heterozygous, compound het (solo and trio) and de novo include them, and
  `1/0`. A `1/2` site alone makes its gene a compound-het candidate.
- Carrier list: a haploid call reads `hemi`, a genotype without a class shows its text (were `het`).
- Existing databases: SQLite migration **v42** / PostgreSQL **0026** flag a populated summary stale;
  SQLite rebuilds it at the next app start (`needsStartupRebuild` now honours the flag), PostgreSQL
  in the background. Dosage and filters are read-time, correct at once.
