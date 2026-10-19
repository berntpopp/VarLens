import type { ShortlistRow } from '../../../../shared/types/shortlist'
import { formatHgvs } from '../../utils/formatters'
import { UNKNOWN_VALUE_GLYPH } from '../../config/displayConfig'
import { formatBpLength } from '../../utils/variant-interval'

export interface VariantCell {
  primary: string
  cdna: string | null
  protein: string | null
}

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
