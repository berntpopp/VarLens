import { DEFAULT_STRENGTHS, type EvidenceStrength } from '../../../shared/acmg/acmg-calculator'
import { parseAcmgEvidence } from '../../../shared/acmg/acmg-evidence'
import { genotypeZygosity, isAssumedHetGenotype } from '../../../shared/utils/genotype'
import { escapeDelimitedCell } from '../../../shared/utils/delimited-text'
import type { Variant, VariantAnnotationsResult } from '../../../shared/types/api'

export interface SignOutRow {
  gene: string | null
  transcript: string | null
  hgvs_c: string | null
  hgvs_p: string | null
  chr_pos_ref_alt: string | null
  zygosity: string | null
  gnomad_af: number | string | null
  cadd: number | string | null
  acmg: string | null
  comment: string | null
}

export const SIGN_OUT_COLUMNS = [
  'Gene',
  'Transcript',
  'HGVS c.',
  'HGVS p.',
  'Chr:Pos Ref>Alt',
  'Zygosity',
  'gnomAD AF',
  'CADD',
  'ACMG Classification (Criteria)',
  'Comment'
] as const

const STRENGTH_SUFFIX: Record<EvidenceStrength, string> = {
  very_strong: 'Very_Strong',
  strong: 'Strong',
  moderate: 'Moderate',
  supporting: 'Supporting',
  stand_alone: 'Stand_Alone'
}

function sanitizeCell(val: unknown, format: 'markdown' | 'tsv'): string {
  if (val === null || val === undefined || val === '') return '-'
  const str = String(val)
    .replace(/[\t\r\n]+/g, ' ')
    .trim()
  if (str === '') return '-'
  if (format === 'markdown') {
    return str.replace(/[|<]/g, '\\$&')
  }
  return escapeDelimitedCell(str, '\t')
}

export function formatZygosity(gt: string | null | undefined): string | null {
  if (gt == null || gt === '') return null
  const trimmed = gt.trim()
  if (isAssumedHetGenotype(trimmed)) {
    return `assumed het (${trimmed})`
  }
  return genotypeZygosity(trimmed) ?? trimmed
}

export function formatSignOutTable(rows: SignOutRow[], format: 'markdown' | 'tsv'): string {
  if (rows.length === 0) return ''

  const cells = (r: SignOutRow): string[] =>
    [
      r.gene,
      r.transcript,
      r.hgvs_c,
      r.hgvs_p,
      r.chr_pos_ref_alt,
      r.zygosity,
      r.gnomad_af,
      r.cadd,
      r.acmg,
      r.comment
    ].map((val) => sanitizeCell(val, format))

  if (format === 'tsv') {
    return [SIGN_OUT_COLUMNS.join('\t'), ...rows.map((r) => cells(r).join('\t'))].join('\n')
  }

  const header = `| ${SIGN_OUT_COLUMNS.join(' | ')} |`
  const separator = `| ${SIGN_OUT_COLUMNS.map(() => '---').join(' | ')} |`
  return [header, separator, ...rows.map((r) => `| ${cells(r).join(' | ')} |`)].join('\n')
}

export function extractAcmgCriteria(evidenceJson: string | null | undefined): string[] {
  const evidence = parseAcmgEvidence(evidenceJson)
  if (evidence === null) return []
  return [...evidence.pathogenic, ...evidence.benign]
    .filter((c) => c.confirmed === true && typeof c.code === 'string')
    .map((c) => {
      const baseCode = c.code.replace(/\d+$/, '')
      const norm = c.strength?.toLowerCase() as EvidenceStrength | undefined
      return norm && norm !== DEFAULT_STRENGTHS[baseCode]
        ? `${c.code}_${STRENGTH_SUFFIX[norm] ?? c.strength}`
        : c.code
    })
}

export function variantToSignOutRow(
  variant: Variant,
  annotation?: VariantAnnotationsResult | null
): SignOutRow {
  const perCase = annotation?.perCase
  const global = annotation?.global
  const usePerCase = perCase?.acmg_classification != null || perCase?.acmg_evidence != null
  const acmgSource = usePerCase ? perCase : global

  const classification = acmgSource?.acmg_classification ?? null
  const criteria = extractAcmgCriteria(acmgSource?.acmg_evidence)

  let acmg: string | null = null
  if (classification !== null && criteria.length > 0) {
    acmg = `${classification} (${criteria.join(', ')})`
  } else if (classification !== null) {
    acmg = classification
  } else if (criteria.length > 0) {
    acmg = `(${criteria.join(', ')})`
  }

  const perCaseComment = perCase?.per_case_comment?.trim()
  const globalComment = global?.global_comment?.trim()
  const comment =
    perCaseComment !== undefined && perCaseComment !== ''
      ? perCaseComment
      : globalComment !== undefined && globalComment !== ''
        ? globalComment
        : ''

  return {
    gene: variant.gene_symbol ?? null,
    transcript: variant.transcript ?? null,
    hgvs_c: variant.cdna ?? null,
    hgvs_p: variant.aa_change ?? null,
    chr_pos_ref_alt: `${variant.chr}:${variant.pos} ${variant.ref}>${variant.alt}`,
    zygosity: formatZygosity(variant.gt_num),
    gnomad_af: variant.gnomad_af ?? null,
    cadd: variant.cadd ?? null,
    acmg,
    comment
  }
}
