/**
 * Zygosity classes of a stored genotype — the one definition every consumer
 * uses (cohort het/hom counts, dosage, inheritance filters, carrier chips).
 * See .planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md.
 *
 * A stored `gt_num` describes ONE ALT allele: multi-allelic records are split
 * on import, and another ALT on the other chromosome becomes `.` (`1/2` is
 * stored as `1/.` and `./1`). Such a genotype has exactly one called copy of
 * this allele: heterozygous, dosage 1 — as bcftools, Hail/gnomAD and GATK
 * treat a split `1/2`. A half-call that was already in the source file is
 * stored identically and is read the same way; that is its lower bound.
 */
export const HET_GENOTYPES = ['0/1', '1/0', '0|1', '1|0', '1/.', './1', '1|.', '.|1'] as const
export const HOM_GENOTYPES = ['1/1', '1|1'] as const
/** A haploid ALT call (male chrX/chrY, chrM): one copy, neither het nor hom. */
export const HEMI_GENOTYPES = ['1'] as const

/**
 * An explicit reference call. A carrier genotype is one of the three classes
 * above; anything that is neither (no-call, partly missing without an ALT,
 * NULL, other text) says nothing about the allele: unknown.
 */
export const REF_GENOTYPES = ['0/0', '0|0', '0'] as const

export type Zygosity = 'het' | 'hom' | 'hemi'

const includes = (list: readonly string[], gt: string): boolean => list.includes(gt)

/** The zygosity class of a carrier genotype; null when it names none (ref, no-call, other text). */
export function genotypeZygosity(gt: string | null | undefined): Zygosity | null {
  if (gt == null) return null
  if (includes(HET_GENOTYPES, gt)) return 'het'
  if (includes(HOM_GENOTYPES, gt)) return 'hom'
  if (includes(HEMI_GENOTYPES, gt)) return 'hemi'
  return null
}

/**
 * Carriers of a cohort row that are neither het nor hom: hemizygous, or a
 * genotype that names no zygosity (no-call SV, missing). Never negative.
 */
export function otherZygosityCount(row: {
  carrier_count: number
  het_count: number
  hom_count: number
}): number {
  return Math.max(0, row.carrier_count - row.het_count - row.hom_count)
}

/**
 * Convert a VCF GT string to allele dosage (count of non-reference alleles).
 *
 * Standard mapping per VCF v4.3 spec + PLINK/Hail conventions:
 * - 0/0, 0|0 → 0 (homozygous reference)
 * - 0/1, 1/0, 0|1, 1|0 → 1 (heterozygous)
 * - 1/1, 1|1 → 2 (homozygous alt)
 * - ./., .|., . → null (missing)
 * - Haploid: 0 → 0, 1 → 1
 * - Multi-allelic: counts non-zero alleles (e.g., 0/2 → 1, 2/2 → 2)
 * - Partly missing: 1 for the four het spellings (1/. ./1 1|. .|1), null for any other
 */
export function gtToDosage(gt: string | null | undefined): number | null {
  if (gt == null) return null
  switch (gt) {
    case '0/0':
    case '0|0':
      return 0
    case '0/1':
    case '1/0':
    case '0|1':
    case '1|0':
      return 1
    case '1/1':
    case '1|1':
      return 2
    case '0':
      return 0
    case '1':
      return 1
    case './.':
    case '.|.':
    case '.':
      return null
    default: {
      // The partial spellings of the het class, and no other partial string.
      if (genotypeZygosity(gt) === 'het') return 1
      const alleles = gt.split(/[/|]/)
      if (alleles.some((a) => a === '.')) return null
      return alleles.filter((a) => a !== '0').length
    }
  }
}
