import type { BedFilter } from './bed-filter'

/** Variant type discriminator */
export type VariantType = 'snv' | 'indel' | 'sv' | 'cnv' | 'str'

/** Import-time filters applied during VCF streaming */
export interface ImportFilters {
  bedFilter?: BedFilter
  bedPadding: number
  passOnly: boolean
  minQual: number | null
  minGq: number | null
  minDp: number | null
}

/** Default import filters — no filtering */
export const DEFAULT_IMPORT_FILTERS: ImportFilters = {
  bedPadding: 50,
  passOnly: false,
  minQual: null,
  minGq: null,
  minDp: null
}
