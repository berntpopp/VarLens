export interface SvExtensionRow {
  sv_is_precise: number
  cipos_left: number | null
  cipos_right: number | null
  ciend_left: number | null
  ciend_right: number | null
  support: number | null
  coverage: string | null
  strand: string | null
  stdev_len: number | null
  stdev_pos: number | null
  vaf: number | null
  dr: number | null
  dv: number | null
  pe_support: number | null
  sr_support: number | null
  event_id: string | null
  mate_id: string | null
}

export interface CnvExtensionRow {
  copy_number: number | null
  copy_number_quality: number | null
  homozygosity_ref: number | null
  homozygosity_alt: number | null
  sm: number | null
  bin_count: number | null
}

export interface StrExtensionRow {
  repeat_id: string | null
  variant_catalog_id: string | null
  repeat_unit: string | null
  display_repeat_unit: string | null
  ref_copies: number | null
  alt_copies: string | null
  repeat_length: number | null
  str_status: string | null
  normal_max: number | null
  pathologic_min: number | null
  disease: string | null
  inheritance_mode: string | null
  source_display: string | null
  rank_score: string | null
  locus_coverage: number | null
  support_type: string | null
  confidence_interval: string | null
}

function parseIntOrNull(val: string | undefined): number | null {
  if (val === undefined || val === '' || val === '.') return null
  const n = parseInt(val, 10)
  return Number.isNaN(n) ? null : n
}

function parseFloatOrNull(val: string | undefined): number | null {
  if (val === undefined || val === '' || val === '.') return null
  const n = parseFloat(val)
  return Number.isNaN(n) ? null : n
}

function parseCiInterval(val: string | undefined): [number | null, number | null] {
  if (val === undefined || val === '') return [null, null]
  const parts = val.split(',')
  if (parts.length !== 2) return [null, null]
  return [parseIntOrNull(parts[0]), parseIntOrNull(parts[1])]
}

export function extractSvFields(
  info: Map<string, string>,
  formatRaw: Map<string, string>
): SvExtensionRow {
  const [ciposL, ciposR] = parseCiInterval(info.get('CIPOS'))
  const [ciendL, ciendR] = parseCiInterval(info.get('CIEND'))

  const prParts = formatRaw.get('PR')?.split(',')
  const srParts = formatRaw.get('SR')?.split(',')

  return {
    sv_is_precise: info.has('PRECISE') ? 1 : 0,
    cipos_left: ciposL,
    cipos_right: ciposR,
    ciend_left: ciendL,
    ciend_right: ciendR,
    support: parseIntOrNull(info.get('SUPPORT')),
    coverage: info.get('COVERAGE') ?? null,
    strand: info.get('STRAND') ?? null,
    stdev_len: parseFloatOrNull(info.get('STDEV_LEN')),
    stdev_pos: parseFloatOrNull(info.get('STDEV_POS')),
    vaf: parseFloatOrNull(info.get('VAF')),
    dr: parseIntOrNull(formatRaw.get('DR')),
    dv: parseIntOrNull(formatRaw.get('DV')),
    pe_support: prParts !== undefined && prParts.length >= 2 ? parseIntOrNull(prParts[1]) : null,
    sr_support: srParts !== undefined && srParts.length >= 2 ? parseIntOrNull(srParts[1]) : null,
    event_id: info.get('EVENT') ?? null,
    mate_id: info.get('MATEID') ?? null
  }
}

export function extractCnvFields(
  info: Map<string, string>,
  formatRaw: Map<string, string>
): CnvExtensionRow {
  const cn = parseIntOrNull(formatRaw.get('CN')) ?? parseIntOrNull(info.get('CN'))

  let hoRef: number | null = null
  let hoAlt: number | null = null
  const hoVal = formatRaw.get('HO')
  if (hoVal !== undefined) {
    const parts = hoVal.split(',')
    if (parts.length >= 2) {
      hoRef = parseFloatOrNull(parts[0])
      hoAlt = parseFloatOrNull(parts[1])
    }
  }

  return {
    copy_number: cn,
    copy_number_quality: parseIntOrNull(formatRaw.get('GQ')),
    homozygosity_ref: hoRef,
    homozygosity_alt: hoAlt,
    sm: parseFloatOrNull(formatRaw.get('SM')),
    bin_count: parseIntOrNull(formatRaw.get('BC'))
  }
}

export function extractStrFields(
  info: Map<string, string>,
  formatRaw: Map<string, string>
): StrExtensionRow {
  return {
    repeat_id: info.get('REPID') ?? null,
    variant_catalog_id: info.get('VARID') ?? null,
    repeat_unit: info.get('RU') ?? null,
    display_repeat_unit: info.get('DisplayRU') ?? null,
    ref_copies: parseFloatOrNull(info.get('REF')),
    alt_copies: formatRaw.get('REPCN') ?? null,
    repeat_length: parseIntOrNull(info.get('RL')),
    str_status: info.get('STR_STATUS') ?? null,
    normal_max: parseIntOrNull(info.get('STR_NORMAL_MAX')),
    pathologic_min: parseIntOrNull(info.get('STR_PATHOLOGIC_MIN')),
    disease: info.get('Disease') ?? null,
    inheritance_mode: info.get('InheritanceMode') ?? null,
    source_display: info.get('SourceDisplay') ?? null,
    rank_score: info.get('RankScore') ?? null,
    locus_coverage: parseFloatOrNull(formatRaw.get('LC')),
    support_type: formatRaw.get('SO') ?? null,
    confidence_interval: formatRaw.get('REPCI') ?? null
  }
}
