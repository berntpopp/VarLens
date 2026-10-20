import { VEP_CSQ_VALUE_ESCAPES } from '../../../shared/config/vep.config'

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
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '.') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export function parseCsqEntry(parts: string[], csqFieldNames: string[]): Map<string, string> {
  const fields = new Map<string, string>()
  for (let i = 0; i < csqFieldNames.length && i < parts.length; i++) {
    const val = parts[i]
    if (val !== '' && val !== '.') {
      fields.set(csqFieldNames[i], decodeCsqValue(val))
    }
  }
  return fields
}

export function extractFromCsq(source: { fields?: Map<string, string> } | null | undefined): {
  gnomadAf: number | null
  cadd: number | null
  clinvar: string | null
  vepClinSig: string | null
} {
  const getField = (key: string): string | null => {
    const raw = source?.fields?.get(key)?.trim()
    return raw === undefined || raw === '' || raw === '.' ? null : raw
  }

  const afE = parseFiniteFloat(getField('gnomADe_AF'))
  const afG = parseFiniteFloat(getField('gnomADg_AF'))
  const afAny = parseFiniteFloat(getField('gnomAD_AF'))
  const gnomadAf = afE ?? afG ?? afAny ?? null
  const cadd = parseFiniteFloat(getField('CADD_PHRED'))
  const clinvar = getField('ClinVar_CLNSIG')
  const vepClinSig = getField('CLIN_SIG')

  return {
    gnomadAf,
    cadd,
    clinvar,
    vepClinSig
  }
}
