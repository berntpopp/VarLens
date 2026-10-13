/**
 * "varvis full" rule template (spec §16 Ranking, issue #597): the varvis
 * template plus groups on canonical `info.<KEY>` evidence fields that every
 * source fills the same way (`CANONICAL_EVIDENCE_FIELDS`). Same contract as
 * the varvis template: each group is a complete partition — exclusive bins,
 * then a catch-all `_ref` rule — and the simulation tunes points only.
 * Fields that cannot be simulated (Pangolin, in-house frequencies, Aion) are
 * deliberately not used.
 */
import type { EvidenceGroup, EvidenceRuleset } from '../../types/evidence-ruleset'
import { VARVIS_EVIDENCE_TEMPLATE } from './varvis-template'

const PLP =
  'clinvar:=:Pathogenic OR clinvar:=:Likely_pathogenic OR clinvar:=:Pathogenic/Likely_pathogenic'
/** ≥ 2 ClinVar stars: multiple submitters without conflicts, expert panel, practice guideline. */
const TWO_STARS =
  'info.CLINVAR_REVSTAT:~:multiple OR info.CLINVAR_REVSTAT:~:expert OR info.CLINVAR_REVSTAT:~:guideline'
/** < 2 stars or unknown, written out so the two P/LP bins stay exclusive (no NOT in the DSL). */
const BELOW_TWO_STARS =
  'info.CLINVAR_REVSTAT:is:null OR info.CLINVAR_REVSTAT:~:single OR info.CLINVAR_REVSTAT:~:assertion OR info.CLINVAR_REVSTAT:~:classification'

const clinvar: EvidenceGroup = {
  id: 'clinvar',
  label: 'ClinVar',
  scope: 'global',
  rules: [
    {
      id: 'clinvar_plp_2star',
      label: 'ClinVar P/LP, ≥ 2 stars',
      when: `(${PLP}) AND (${TWO_STARS})`,
      points: 7
    },
    {
      id: 'clinvar_plp',
      label: 'ClinVar P/LP, < 2 stars or no status',
      when: `(${PLP}) AND (${BELOW_TWO_STARS})`,
      points: 5
    },
    ...VARVIS_EVIDENCE_TEMPLATE.groups
      .find((g) => g.id === 'clinvar')!
      .rules.filter((r) => r.id !== 'clinvar_plp')
  ]
}

const extra: EvidenceGroup[] = [
  {
    id: 'missense_pred',
    label: 'Missense predictors',
    scope: 'global',
    rules: [
      { id: 'revel_high', label: 'REVEL ≥ 0.75', when: 'info.REVEL:>=:0.75', points: 3 },
      {
        id: 'revel_mid',
        label: 'REVEL 0.5–0.75',
        when: 'info.REVEL:>=:0.5 AND info.REVEL:<:0.75',
        points: 1.5
      },
      { id: 'revel_low', label: 'REVEL < 0.25', when: 'info.REVEL:<:0.25', points: -2 },
      {
        id: 'metarnn_high',
        label: 'No REVEL, MetaRNN rank ≥ 0.9',
        when: 'info.REVEL:is:null AND info.METARNN:>=:0.9',
        points: 2
      },
      {
        id: 'missense_pred_ref',
        label: 'Other or no predictor score (reference)',
        when: 'info.REVEL:is:null OR info.REVEL:is:notnull',
        points: 0
      }
    ]
  },
  {
    id: 'splicing',
    label: 'Splicing (SpliceAI)',
    scope: 'global',
    rules: [
      { id: 'spliceai_high', label: 'SpliceAI ≥ 0.5', when: 'info.SPLICEAI_MAX:>=:0.5', points: 4 },
      {
        id: 'spliceai_mid',
        label: 'SpliceAI 0.2–0.5',
        when: 'info.SPLICEAI_MAX:>=:0.2 AND info.SPLICEAI_MAX:<:0.5',
        points: 2
      },
      {
        id: 'splicing_ref',
        label: 'SpliceAI < 0.2 or missing (reference)',
        when: 'info.SPLICEAI_MAX:<:0.2 OR info.SPLICEAI_MAX:is:null',
        points: 0
      }
    ]
  },
  {
    id: 'constraint',
    label: 'LoF constraint for dominant',
    scope: 'ad',
    rules: [
      { id: 'loeuf_strong', label: 'LOEUF ≤ 0.35', when: 'info.LOEUF:<=:0.35', points: 2 },
      {
        id: 'loeuf_mod',
        label: 'LOEUF 0.35–0.6',
        when: 'info.LOEUF:>:0.35 AND info.LOEUF:<=:0.6',
        points: 1
      },
      {
        id: 'constraint_ref',
        label: 'LOEUF > 0.6 or missing (reference)',
        when: 'info.LOEUF:>:0.6 OR info.LOEUF:is:null',
        points: 0
      }
    ]
  },
  {
    id: 'hom_ad',
    label: 'gnomAD homozygotes for dominant',
    scope: 'ad',
    rules: [
      {
        id: 'ad_hom_seen',
        label: 'Homozygotes in gnomAD',
        when: 'info.GNOMAD_HOM:>:0',
        points: -4
      },
      {
        id: 'hom_ad_ref',
        label: 'No gnomAD homozygotes or unknown (reference)',
        when: 'info.GNOMAD_HOM:<=:0 OR info.GNOMAD_HOM:is:null',
        points: 0
      }
    ]
  },
  {
    id: 'hom_ar',
    label: 'gnomAD homozygotes for recessive homozygous',
    scope: 'ar_hom',
    rules: [
      {
        id: 'ar_hom_seen',
        label: 'Homozygotes in gnomAD',
        when: 'info.GNOMAD_HOM:>:0',
        points: -4
      },
      {
        id: 'hom_ar_ref',
        label: 'No gnomAD homozygotes or unknown (reference)',
        when: 'info.GNOMAD_HOM:<=:0 OR info.GNOMAD_HOM:is:null',
        points: 0
      }
    ]
  }
]

/** Hand-set starting points; the simulation replaces them (spec §11.1, §15). */
export const FULL_EVIDENCE_TEMPLATE: EvidenceRuleset = {
  version: 1,
  id: 'varvis-full-template-v1',
  modes: VARVIS_EVIDENCE_TEMPLATE.modes,
  groups: [
    ...VARVIS_EVIDENCE_TEMPLATE.groups.map((g) => (g.id === 'clinvar' ? clinvar : g)),
    ...extra
  ]
}
