import type { EvidenceStrength } from '../../../../shared/acmg/acmg-calculator'
export {
  type EvidenceStrength,
  DEFAULT_STRENGTHS,
  CODE_STRENGTH_OVERRIDES,
  getDefaultStrength,
  EVIDENCE_POINTS
} from '../../../../shared/acmg/acmg-calculator'

/**
 * ACMG evidence direction
 */
export type EvidenceDirection = 'pathogenic' | 'benign'

/**
 * All standard ACMG pathogenic evidence codes
 */
export const PATHOGENIC_CODES = [
  'PVS1',
  'PS1',
  'PS2',
  'PS3',
  'PS4',
  'PM1',
  'PM2',
  'PM3',
  'PM4',
  'PM5',
  'PM6',
  'PP1',
  'PP2',
  'PP3',
  'PP4',
  'PP5'
] as const

/**
 * All standard ACMG benign evidence codes
 */
export const BENIGN_CODES = [
  'BA1',
  'BS1',
  'BS2',
  'BS3',
  'BS4',
  'BP1',
  'BP2',
  'BP3',
  'BP4',
  'BP5',
  'BP6',
  'BP7'
] as const

export type PathogenicCode = (typeof PATHOGENIC_CODES)[number]
export type BenignCode = (typeof BENIGN_CODES)[number]
export type AcmgCode = PathogenicCode | BenignCode

/**
 * Human-readable descriptions for each ACMG evidence code (shown in tooltips)
 */
export const CODE_DESCRIPTIONS: Record<AcmgCode, string> = {
  PVS1: 'Null variant in a gene where LOF is a known mechanism of disease',
  PS1: 'Same amino acid change as established pathogenic variant',
  PS2: 'De novo (confirmed) in a patient with disease, no family history',
  PS3: 'Well-established functional studies show damaging effect',
  PS4: 'Prevalence in affected significantly increased vs. controls',
  PM1: 'Located in a mutational hot spot or well-established functional domain',
  PM2: 'Absent or extremely low frequency in population databases (ClinGen SVI: use as supporting)',
  PM3: 'Detected in trans with a pathogenic variant (recessive disorders)',
  PM4: 'Protein length change due to in-frame indel or stop-loss',
  PM5: 'Novel missense at same position as established pathogenic missense',
  PM6: 'Assumed de novo (without paternity/maternity confirmation)',
  PP1: 'Co-segregation with disease in multiple affected family members',
  PP2: 'Missense in a gene with low rate of benign missense and pathogenic missenses common',
  PP3: 'Multiple lines of computational evidence support a deleterious effect',
  PP4: 'Patient phenotype or family history highly specific for the gene',
  PP5: 'Reputable source reports variant as pathogenic (NOT RECOMMENDED — ClinGen 2020)',
  BA1: 'Allele frequency > 5% in population databases',
  BS1: 'Allele frequency greater than expected for disorder',
  BS2: 'Observed in healthy adults with full penetrance expected at early age',
  BS3: 'Well-established functional studies show no damaging effect',
  BS4: 'Lack of segregation in affected family members',
  BP1: 'Missense in a gene where only truncating variants cause disease',
  BP2: 'Observed in trans with a pathogenic variant (dominant) or in cis with pathogenic variant',
  BP3: 'In-frame indels in a repetitive region without known function',
  BP4: 'Multiple lines of computational evidence suggest no impact on gene',
  BP5: 'Variant found in a case with an alternate molecular basis for disease',
  BP6: 'Reputable source reports variant as benign (NOT RECOMMENDED — ClinGen 2020)',
  BP7: 'Synonymous variant with no predicted splice impact'
}

/**
 * Strength level display labels and colors (for dropdown UI)
 */
export const STRENGTH_OPTIONS: Array<{
  value: EvidenceStrength
  label: string
  abbreviation: string
  points: number
}> = [
  { value: 'very_strong', label: 'Very Strong', abbreviation: 'VStr', points: 8 },
  { value: 'strong', label: 'Strong', abbreviation: 'Str', points: 4 },
  { value: 'moderate', label: 'Moderate', abbreviation: 'Mod', points: 2 },
  { value: 'supporting', label: 'Supporting', abbreviation: 'Sup', points: 1 },
  { value: 'stand_alone', label: 'Stand-Alone', abbreviation: 'SA', points: 8 }
]

/** Strengths a criterion can be set to: Stand-Alone exists for BA1 only. */
export function strengthOptionsFor(code: AcmgCode): typeof STRENGTH_OPTIONS {
  return STRENGTH_OPTIONS.filter((o) => o.value !== 'stand_alone' || code === 'BA1')
}

/**
 * A single selected evidence code with its metadata
 */
export interface AcmgEvidenceCode {
  /** Code name (e.g., 'PVS1', 'PM2') */
  code: AcmgCode
  /** Applied strength (may differ from default) */
  strength: EvidenceStrength
  /** Whether this was auto-suggested from annotations */
  auto_suggested: boolean
  /** Whether user has confirmed this code */
  confirmed: boolean
  /** Annotation source if auto-suggested (e.g., 'gnomad_af', 'cadd') */
  source?: string
}

/**
 * Classification thresholds based on net point total
 */
export const CLASSIFICATION_THRESHOLDS = {
  pathogenic: 10,
  likely_pathogenic: 6,
  likely_benign: -1,
  benign: -7
} as const

/**
 * Full ACMG evidence state for a variant
 */
export interface AcmgEvidenceState {
  /** All selected pathogenic evidence codes */
  pathogenic: AcmgEvidenceCode[]
  /** All selected benign evidence codes */
  benign: AcmgEvidenceCode[]
  /** Free-text notes */
  notes: string
  /** Classification timestamp */
  classification_date: number
  /** Calculated classification (null if no codes selected) */
  calculated_classification: AcmgClassification | null
  /** Whether the user has overridden the calculated result */
  is_override: boolean
  /** Why the class overrides the evidence; required with an override (#567) */
  override_reason: string
}

/**
 * Codes no longer recommended by ClinGen (2020 update).
 * PP5 and BP6 relied on reputable source assertions without primary data.
 */
export const DEPRECATED_CODES: ReadonlySet<AcmgCode> = new Set(['PP5', 'BP6'])

// Re-export for convenience — canonical type from shared domain config
import type { AcmgClassification } from '../../../../shared/config/domain.config'
export type { AcmgClassification }
