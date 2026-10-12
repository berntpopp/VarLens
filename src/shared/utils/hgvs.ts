import { VEP_CSQ_ESCAPES } from '../config/vep.config'

/** Undo the percent-escapes VEP writes into HGVS values (see VEP_CSQ_ESCAPES). */
export function decodeVepHgvs(value: string): string
export function decodeVepHgvs(value: string | null): string | null
export function decodeVepHgvs(value: string | null): string | null {
  if (value === null) return null
  return VEP_CSQ_ESCAPES.reduce(
    (text, { encoded, decoded }) => text.replace(encoded, decoded),
    value
  )
}
