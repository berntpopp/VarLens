/**
 * SQL forms of the genotype classes in ../utils/genotype.ts: the zygosity
 * lists for `gt_num IN (...)` and the GT-to-dosage CASE expression. Every
 * SQL consumer on both backends takes them from here.
 */
import type { SqlDialect } from './chromosome-order'
import { HEMI_GENOTYPES, HET_GENOTYPES, HOM_GENOTYPES, REF_GENOTYPES } from '../utils/genotype'

const sqlList = (genotypes: readonly string[]): string =>
  `(${genotypes.map((gt) => `'${gt}'`).join(',')})`

export const HET_GT_SQL = sqlList(HET_GENOTYPES)
export const HOM_GT_SQL = sqlList(HOM_GENOTYPES)
export const HEMI_GT_SQL = sqlList(HEMI_GENOTYPES)
/** De novo proband: one copy, diploid or haploid (male chrX). */
export const HET_OR_HEMI_GT_SQL = sqlList([...HET_GENOTYPES, ...HEMI_GENOTYPES])
/** A hom or haploid call: X-linked hemizygous, and a parent who is no het carrier. */
export const HOM_OR_HEMI_GT_SQL = sqlList([...HOM_GENOTYPES, ...HEMI_GENOTYPES])

export const REF_GT_SQL = sqlList(REF_GENOTYPES)
/** A carrier of the row's allele, whatever the zygosity. */
export const ALT_GT_SQL = sqlList([...HET_GENOTYPES, ...HOM_GENOTYPES, ...HEMI_GENOTYPES])

/**
 * Genotype column `column` is not an explicit reference call: the sample
 * carries the allele, or its call says nothing (no-call, NULL, other text).
 */
export function notReferenceGtSql(column: string): string {
  return `(${column} IS NULL OR ${column} NOT IN ${REF_GT_SQL})`
}

/**
 * Copies of the ALT allele in genotype column `column`: 2 hom, 1 het or
 * hemizygous, 0 reference, NULL when the genotype names no dosage.
 */
export function gtDosageSql(column = 'gt_num'): string {
  return `CASE
    WHEN ${column} IN ${HOM_GT_SQL} THEN 2
    WHEN ${column} IN ${HET_GT_SQL} THEN 1
    WHEN ${column} IN ${HEMI_GT_SQL} THEN 1
    WHEN ${column} IN ${REF_GT_SQL} THEN 0
    ELSE NULL
  END`
}

/** SQL form of genotypeCallKey (../utils/genotype.ts): dosage rank character, then the text. */
export function gtCallKeySql(column: string): string {
  return `(CASE
    WHEN ${column} IN ${HOM_GT_SQL} THEN '4'
    WHEN ${column} IN ${HET_GT_SQL} THEN '3'
    WHEN ${column} IN ${HEMI_GT_SQL} THEN '2'
    WHEN ${column} IN ${REF_GT_SQL} THEN '1'
    ELSE '0'
  END || COALESCE(${column}, ''))`
}

/**
 * The one genotype that stands for a group of rows (a case's rows for one
 * variant): the call with the greatest {@link gtCallKeySql}, compared bytewise
 * on both backends. An aggregate; `over` (e.g. ` OVER case_key`) makes it a
 * window function. NULL when no row has a genotype.
 */
export function resolvedGtSql(column: string, dialect: SqlDialect, over = ''): string {
  const key = gtCallKeySql(column)
  return `NULLIF(substr(MAX(${dialect === 'postgres' ? `${key} COLLATE "C"` : key})${over}, 2), '')`
}

/** {@link gtDosageSql} on the unqualified `gt_num` column. */
export const GT_DOSAGE_SQL = gtDosageSql()
