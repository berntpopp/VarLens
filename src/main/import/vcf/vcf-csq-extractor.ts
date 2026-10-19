import { VEP_CSQ_VALUE_ESCAPES } from '../../../shared/config/vep.config'
import {
  MAX_VCF_ANNOTATION_FIELDS,
  splitBounded,
  VcfResourceLimitError
} from './vcf-resource-limits'

const CSQ_ESCAPE_PATTERN = /%(?:3B|3D|2C|7C|20|25)/gi

/** Undo VEP's CSQ escapes after splitting on `,` and `|`; unknown `%xx` and `&` stay as written. */
export function decodeCsqValue(value: string): string {
  if (!value.includes('%')) return value
  return value.replace(CSQ_ESCAPE_PATTERN, (escape) => VEP_CSQ_VALUE_ESCAPES[escape.toUpperCase()])
}

export function parseFiniteFloat(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  if (raw === '' || raw === '.') return null
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

export function parseCsqEntry(
  annOrParts: string | string[],
  csqFieldNames: string[]
): Map<string, string> {
  const parts = Array.isArray(annOrParts)
    ? annOrParts
    : splitBounded(annOrParts, '|', MAX_VCF_ANNOTATION_FIELDS)
  if (parts === null) {
    throw new VcfResourceLimitError(
      `CSQ annotation has more than ${MAX_VCF_ANNOTATION_FIELDS} fields`
    )
  }
  const fields = new Map<string, string>()
  for (let i = 0; i < csqFieldNames.length && i < parts.length; i++) {
    const val = parts[i]
    if (val !== '' && val !== '.') {
      fields.set(csqFieldNames[i], decodeCsqValue(val))
    }
  }
  return fields
}

export function extractFromCsq(
  source:
    | Map<string, string>
    | Record<string, unknown>
    | { fields?: Map<string, string> }
    | null
    | undefined
): {
  gnomadAf: number | null
  cadd: number | null
  clinvar: string | null
  vepClinSig: string | null
} {
  const getField = (key: string): string | null => {
    if (!source) return null
    let raw: unknown
    if ('fields' in source && source.fields instanceof Map) {
      raw = source.fields.get(key)
    } else if (source instanceof Map) {
      raw = (source as Map<string, string>).get(key)
    } else {
      raw = (source as Record<string, unknown>)[key]
    }
    if (raw == null) return null
    const str = String(raw).trim()
    return str === '' || str === '.' ? null : str
  }

  const afE = parseFiniteFloat(getField('gnomADe_AF') ?? getField('gnomad_af_exomes'))
  const afG = parseFiniteFloat(getField('gnomADg_AF') ?? getField('gnomad_af_genomes'))
  const afAny = parseFiniteFloat(
    getField('gnomAD_AF') ?? getField('gnomad_af') ?? getField('MAX_AF')
  )
  const gnomadAf = afE ?? afG ?? afAny ?? null
  const cadd = parseFiniteFloat(getField('CADD_PHRED') ?? getField('cadd'))
  const clinvar = getField('ClinVar_CLNSIG') ?? getField('clinvar') ?? null
  const vepClinSig = getField('CLIN_SIG') ?? null

  return {
    gnomadAf,
    cadd,
    clinvar,
    vepClinSig
  }
}
