/**
 * SQL forms of the genotype classes in ../utils/genotype.ts: the zygosity
 * lists for `gt_num IN (...)` and the GT-to-dosage CASE expression. Every
 * SQL consumer on both backends takes them from here.
 */
import { HEMI_GENOTYPES, HET_GENOTYPES, HOM_GENOTYPES } from '../utils/genotype'

const sqlList = (genotypes: readonly string[]): string =>
  `(${genotypes.map((gt) => `'${gt}'`).join(',')})`

export const HET_GT_SQL = sqlList(HET_GENOTYPES)
export const HOM_GT_SQL = sqlList(HOM_GENOTYPES)
export const HEMI_GT_SQL = sqlList(HEMI_GENOTYPES)
/** X-linked hemizygous filter: a haploid call, or a caller that wrote it diploid. */
export const HOM_OR_HEMI_GT_SQL = sqlList([...HOM_GENOTYPES, ...HEMI_GENOTYPES])

/**
 * Copies of the ALT allele in genotype column `column`: 2 hom, 1 het or
 * hemizygous, 0 reference, NULL when the genotype names no dosage.
 */
export function gtDosageSql(column = 'gt_num'): string {
  return `CASE
    WHEN ${column} IN ${HOM_GT_SQL} THEN 2
    WHEN ${column} IN ${HET_GT_SQL} THEN 1
    WHEN ${column} IN ${HEMI_GT_SQL} THEN 1
    WHEN ${column} IN ('0/0','0|0','0') THEN 0
    ELSE NULL
  END`
}

/** {@link gtDosageSql} on the unqualified `gt_num` column. */
export const GT_DOSAGE_SQL = gtDosageSql()
