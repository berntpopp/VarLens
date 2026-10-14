/**
 * Disease sets STRchive lumps or omits (CNV/STR spec §5.1), keyed by STRchive
 * locus id. Reviewed like code; an id missing from a catalogue fails the build.
 * `full` replaces the catalogue's full set, `addFull` extends it.
 */
import type { StrDiseaseSets, StrLocus } from '../types/locus-reference'

export type StrOverride = Partial<StrDiseaseSets> & {
  addFull?: string[]
  /** replaces the catalogue's thresholds */
  thresholds?: Partial<Pick<StrLocus, 'intermediateMin' | 'intermediateMax' | 'pathogenicMin'>>
}

export const STR_OVERRIDES: Readonly<Record<string, StrOverride>> = {
  // FXS only for full mutations; FXTAS and FXPOI (female only) for premutations.
  // STRchive lumps 45-200 as intermediate: intermediate 45-54, premutation 55-199, full ≥ 200.
  FXS_FMR1: {
    thresholds: { intermediateMin: 45, intermediateMax: 54, pathogenicMin: 200 },
    full: ['OMIM:300624', 'ORPHA:908'],
    premutation: ['OMIM:300623', 'ORPHA:93256', 'OMIM:311360'],
    femaleOnly: ['OMIM:311360']
  },
  // Intermediate ATXN2 alleles are an ALS risk factor.
  SCA2_ATXN2: { intermediate: ['ORPHA:803'] },
  HD_HTT: { addFull: ['ORPHA:248111'] },
  DM1_DMPK: { addFull: ['ORPHA:273'] },
  SCA3_ATXN3: { addFull: ['ORPHA:276238', 'ORPHA:276241', 'ORPHA:276244'] },
  // C9orf72 HD-like syndrome is not gene-linked in HPO (spec §1, STR-4).
  FTDALS1_C9orf72: { addFull: ['ORPHA:401901'] }
}

/** The locus with its override applied (disease ids deduplicated). */
export function applyStrOverride(locus: StrLocus, override: StrOverride | undefined): StrLocus {
  if (override === undefined) return locus
  const { addFull = [], full = locus.diseases.full, thresholds, ...sets } = override
  const diseases = { ...locus.diseases, ...sets, full: [...new Set([...full, ...addFull])] }
  return { ...locus, ...thresholds, diseases }
}
