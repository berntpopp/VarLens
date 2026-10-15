/**
 * Single source of truth for the evidence-rule shortlist: inheritance-mode
 * order and copy, validation limits, the points scale, the default candidate
 * gate and editor defaults. The engine, the Zod schemas, the settings editor
 * and the simulation harness all read from here.
 *
 * Spec: .planning/specs/2026-10-12-calibrated-evidence-shortlist-design.md
 */

/** Decision-list order of inheritance modes; `fallback` must stay last. */
export const EVIDENCE_MODE_ORDER = ['ar_hom', 'ar_comphet', 'xl', 'ad', 'fallback'] as const
export type EvidenceModeId = (typeof EVIDENCE_MODE_ORDER)[number]

export interface EvidenceModeCopy {
  label: string
  /** One sentence for the editor and the tooltip. */
  help: string
  /** Condition offered when a user adds this mode to a new ruleset (null = fallback). */
  defaultWhen: string | null
}

export const SHORTLIST_EVIDENCE_CONFIG = {
  modes: {
    ar_hom: {
      label: 'Recessive, homozygous',
      help: 'Homozygous variant in a gene with autosomal recessive inheritance.',
      defaultWhen: 'moi:~:AR AND zygosity:=:hom'
    },
    ar_comphet: {
      label: 'Recessive, possible compound heterozygous',
      help: 'Heterozygous variant in a recessive gene with at least one other candidate allele (phase unknown).',
      defaultWhen: 'moi:~:AR AND zygosity:=:het AND gene_het_hits:>=:2'
    },
    xl: {
      label: 'X-linked',
      help: 'Hemizygous or homozygous chrX variant, or heterozygous in an X-linked dominant gene.',
      // Any X-linked spelling (XR, XLR, XD, XLD, X-linked); hemizygosity already
      // handles chrX/PAR, and dominant credit needs an actual het call.
      defaultWhen:
        'moi:~:X AND (zygosity:=:hemi OR zygosity:=:hom OR ((moi:~:XD OR moi:~:XLD) AND zygosity:=:het))'
    },
    ad: {
      label: 'Dominant, heterozygous',
      help: 'Heterozygous variant in a gene with autosomal dominant inheritance.',
      defaultWhen: 'moi:~:AD AND zygosity:=:het'
    },
    fallback: {
      label: 'No compatible inheritance',
      help: 'Applies when no inheritance mode above matches the variant.',
      defaultWhen: null
    }
  } satisfies Record<EvidenceModeId, EvidenceModeCopy>,

  limits: {
    ruleChars: 500,
    ruleDepth: 8,
    ruleNodes: 64,
    rulesTotal: 200,
    rulesPerGroup: 20,
    groups: 40,
    labelChars: 120,
    idPattern: /^[a-z0-9_.-]{1,64}$/,
    rulesetIdChars: 64
  },

  /** Points are signed half-steps; the marginal tuned ruleset is clipped to ±8, logistic up to 24. */
  points: { min: -20, max: 24, step: 0.5, tunedClip: 8 },

  /** Evidence scores have their own unit, so only these types may be mixed. */
  variantTypes: ['snv', 'indel'] as const,

  /**
   * SV/CNV/STR evidence scoring (#581, #582, #642), one flag per type: an enabled
   * type may be scoped by presets and named by rule groups. All three structural
   * types passed the pre-registered validation criteria.
   */
  structuralTypes: {
    types: ['sv', 'cnv', 'str'] as const,
    enabled: { sv: true, cnv: true, str: true } as Record<'sv' | 'cnv' | 'str', boolean>
  },

  /**
   * Rule ids ending in this suffix are a group's catch-all reference bin
   * (spec §11.1, §14–15): last in the group; its points may be tuned.
   */
  referenceRuleSuffix: '_ref',
  /** Catch-all condition of the reference rule of a group added in the editor. */
  newGroupReferenceWhen: 'func:is:notnull OR func:is:null',

  /** Pre-registered candidate gate (spec §3.4). */
  defaultGate: { maxGnomadAf: 0.01, consequences: ['HIGH', 'MODERATE', 'LOW'] },
  defaultTopN: 100,
  /** Tie-breakers for rows with equal points (nulls sort last in both directions). */
  defaultTieBreakers: [
    { key: 'cadd', order: 'desc' },
    { key: 'chr', order: 'asc' },
    { key: 'pos', order: 'asc' }
  ],

  /** Compiled rulesets kept in memory by the main process. */
  compiledCacheSize: 32
} as const
