import type { ShortlistRow } from '../../../../shared/types/shortlist'
import { formatHgvs } from '../../utils/formatters'
import { UNKNOWN_VALUE_GLYPH } from '../../config/displayConfig'
import { formatBpLength } from '../../utils/variant-interval'

export interface VariantCell {
  primary: string
  cdna: string | null
  protein: string | null
}

// Widths in rem so headers grow with the text size (no clipping at 200 %)
export const baseHeaders = [
  { title: '#', key: 'rank', width: '3.75rem', sortable: false },
  { title: 'Score', key: 'rank_score', width: '5.625rem', sortable: false },
  { title: 'Type', key: 'variant_type', width: '5rem', sortable: false },
  { title: 'Gene', key: 'gene_symbol', width: '8.75rem' },
  { title: 'Variant', key: 'variant_notation', width: '17.5rem', sortable: false },
  { title: 'Impact', key: 'consequence', width: '6.875rem' },
  { title: 'AF', key: 'gnomad_af', width: '5.625rem' },
  { title: 'ClinVar', key: 'clinvar', width: '8.125rem' },
  { title: '★', key: 'is_starred', width: '6.5rem', sortable: false },
  { title: 'Actions', key: 'actions', width: '5rem', sortable: false }
] as const

export function ensureHgvsPrefix(value: string, prefix: 'c.' | 'p.'): string {
  const text = formatHgvs(value) ?? value
  return text.includes(':') || text.startsWith(prefix) ? text : `${prefix}${text}`
}

export function variantCell(row: ShortlistRow): VariantCell {
  if (row.variant_type === 'sv') {
    return {
      primary: `${row.chr}:${row.pos} ${row.sv_type ?? ''} ${formatBpLength(row.sv_length)}`.trim(),
      cdna: null,
      protein: null
    }
  }
  if (row.variant_type === 'cnv') {
    return {
      primary: `${row.chr}:${row.pos} CNV CN=${row.cnv_copy_number ?? UNKNOWN_VALUE_GLYPH}`,
      cdna: null,
      protein: null
    }
  }
  if (row.variant_type === 'str') {
    return {
      primary: `${row.chr}:${row.pos} STR ${row.str_alt_copies ?? UNKNOWN_VALUE_GLYPH} copies`,
      cdna: null,
      protein: null
    }
  }
  return {
    primary: `${row.chr}:${row.pos} ${row.ref}>${row.alt}`,
    cdna: row.cdna != null && row.cdna !== '' ? ensureHgvsPrefix(row.cdna, 'c.') : null,
    protein:
      row.aa_change != null && row.aa_change !== '' ? ensureHgvsPrefix(row.aa_change, 'p.') : null
  }
}

export function pinFor(row: ShortlistRow): 'starred' | 'clinvar' | null {
  if (row.rank_starred_pinned) return 'starred'
  if (row.rank_clinvar_pinned) return 'clinvar'
  return null
}

export function typeChipColor(t: ShortlistRow['variant_type']): string {
  switch (t) {
    case 'snv':
    case 'indel':
      return 'primary'
    case 'sv':
      return 'deep-purple'
    case 'cnv':
      return 'teal-darken-2'
    case 'str':
      return 'orange-darken-2'
    default:
      return 'primary'
  }
}

export function targetTabFor(t: ShortlistRow['variant_type']): 'snv' | 'sv' | 'cnv' | 'str' {
  if (t === 'sv' || t === 'cnv' || t === 'str') return t
  return 'snv'
}

export function displayVariantType(t: ShortlistRow['variant_type']): string {
  return (t ?? 'snv').toUpperCase()
}

export function hasCommentFor(
  item: ShortlistRow,
  cache: {
    get(key: string):
      | {
          perCase?: { per_case_comment?: string | null } | null
          global?: { global_comment?: string | null } | null
        }
      | undefined
  }
): boolean {
  const key = `${item.chr}:${item.pos}:${item.ref}:${item.alt}`
  const cached = cache.get(key)
  const perCase = cached?.perCase?.per_case_comment
  const global = cached?.global?.global_comment
  return (
    (perCase !== undefined && perCase !== null && perCase !== '') ||
    (global !== undefined && global !== null && global !== '')
  )
}
