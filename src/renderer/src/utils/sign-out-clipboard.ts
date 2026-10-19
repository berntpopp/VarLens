import { genotypeZygosity } from '../../../shared/utils/genotype'
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

function sanitizeCell(val: unknown, format: 'markdown' | 'tsv'): string {
  if (val === null || val === undefined || val === '') return '-'
  const str = String(val)
    .replace(/[\t\r\n]+/g, ' ')
    .trim()
  if (str === '') return '-'
  if (format === 'markdown') {
    return str.replace(/\|/g, '\\|')
  }
  return escapeDelimitedCell(str, '\t')
}

export function formatSignOutTable(rows: SignOutRow[], format: 'markdown' | 'tsv'): string {
  if (rows.length === 0) return ''

  if (format === 'tsv') {
    const header = SIGN_OUT_COLUMNS.join('\t')
    const lines = rows.map((r) =>
      [
        sanitizeCell(r.gene, 'tsv'),
        sanitizeCell(r.transcript, 'tsv'),
        sanitizeCell(r.hgvs_c, 'tsv'),
        sanitizeCell(r.hgvs_p, 'tsv'),
        sanitizeCell(r.chr_pos_ref_alt, 'tsv'),
        sanitizeCell(r.zygosity, 'tsv'),
        sanitizeCell(r.gnomad_af, 'tsv'),
        sanitizeCell(r.cadd, 'tsv'),
        sanitizeCell(r.acmg, 'tsv'),
        sanitizeCell(r.comment, 'tsv')
      ].join('\t')
    )
    return [header, ...lines].join('\n')
  }

  const header = `| ${SIGN_OUT_COLUMNS.join(' | ')} |`
  const separator = `| ${SIGN_OUT_COLUMNS.map(() => '---').join(' | ')} |`
  const lines = rows.map((r) => {
    const cells = [
      sanitizeCell(r.gene, 'markdown'),
      sanitizeCell(r.transcript, 'markdown'),
      sanitizeCell(r.hgvs_c, 'markdown'),
      sanitizeCell(r.hgvs_p, 'markdown'),
      sanitizeCell(r.chr_pos_ref_alt, 'markdown'),
      sanitizeCell(r.zygosity, 'markdown'),
      sanitizeCell(r.gnomad_af, 'markdown'),
      sanitizeCell(r.cadd, 'markdown'),
      sanitizeCell(r.acmg, 'markdown'),
      sanitizeCell(r.comment, 'markdown')
    ]
    return `| ${cells.join(' | ')} |`
  })
  return [header, separator, ...lines].join('\n')
}

export function extractAcmgCriteria(evidenceJson: string | null | undefined): string[] {
  if (evidenceJson == null || evidenceJson === '') return []
  try {
    const parsed: unknown = JSON.parse(evidenceJson)
    if (parsed == null || typeof parsed !== 'object') return []
    const record = parsed as Record<string, unknown>

    const list: unknown[] = []
    if (Array.isArray(record.pathogenic)) list.push(...record.pathogenic)
    if (Array.isArray(record.benign)) list.push(...record.benign)
    if (Array.isArray(record.codes)) list.push(...record.codes)
    if (Array.isArray(record.items)) list.push(...record.items)

    const criteria: string[] = []
    for (const item of list) {
      if (typeof item === 'string') {
        criteria.push(item)
      } else if (item !== null && typeof item === 'object') {
        const entry = item as { code?: unknown; confirmed?: unknown }
        if (entry.confirmed !== false && typeof entry.code === 'string') {
          criteria.push(entry.code)
        }
      }
    }
    return criteria
  } catch {
    return []
  }
}

export function variantToSignOutRow(
  variant: Variant,
  annotation?: VariantAnnotationsResult | null
): SignOutRow {
  const variantRecord = variant as Variant & {
    acmg_classification?: string | null
    comment?: string | null
  }
  const perCase = annotation?.perCase
  const global = annotation?.global
  const usePerCase = perCase?.acmg_classification != null || perCase?.acmg_evidence != null
  const acmgSource = usePerCase ? perCase : global

  const classification =
    acmgSource?.acmg_classification ?? variantRecord.acmg_classification ?? null
  const evidenceJson = acmgSource?.acmg_evidence ?? null
  const criteria = extractAcmgCriteria(evidenceJson)

  let acmg: string | null = null
  if (classification !== null && criteria.length > 0) {
    acmg = `${classification} (${criteria.join(', ')})`
  } else if (classification !== null) {
    acmg = classification
  } else if (criteria.length > 0) {
    acmg = `(${criteria.join(', ')})`
  }

  const perCaseComment = annotation?.perCase?.per_case_comment?.trim()
  const globalComment = annotation?.global?.global_comment?.trim()
  const commentCandidate =
    perCaseComment !== undefined && perCaseComment !== ''
      ? perCaseComment
      : globalComment !== undefined && globalComment !== ''
        ? globalComment
        : variantRecord.comment
  const comment = commentCandidate ?? ''

  const zygosity = genotypeZygosity(variant.gt_num) ?? variant.gt_num ?? null

  return {
    gene: variant.gene_symbol ?? null,
    transcript: variant.transcript ?? null,
    hgvs_c: variant.cdna ?? null,
    hgvs_p: variant.aa_change ?? null,
    chr_pos_ref_alt: `${variant.chr}:${variant.pos} ${variant.ref}>${variant.alt}`,
    zygosity,
    gnomad_af: variant.gnomad_af ?? null,
    cadd: variant.cadd ?? null,
    acmg,
    comment
  }
}
