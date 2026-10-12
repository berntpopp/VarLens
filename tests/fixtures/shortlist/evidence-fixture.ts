/**
 * Evidence-shortlist fixture shared by the SQLite and PostgreSQL tests: an AR
 * gene whose two het alleles (an SNV and an indel) sit on different Stage-1
 * pages and types, an AD het LoF, and LOW fillers in between.
 */
import { SHORTLIST_PAGE_SIZE } from '../../../src/main/database/shortlist-query'
import type { EvidenceRuleset } from '../../../src/shared/types/evidence-ruleset'
import type { ShortlistConfig } from '../../../src/shared/types/shortlist'

export interface EvidenceFixtureRow {
  id: number
  variant_type: 'snv' | 'indel'
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string
  moi: string | null
  gt_num: string
  consequence: string
  func: string
  gnomad_af: number | null
}

export const COMPHET_SNV_ID = 1
export const COMPHET_INDEL_ID = SHORTLIST_PAGE_SIZE + 3
export const AD_LOF_ID = SHORTLIST_PAGE_SIZE + 4

export function evidenceFixtureRows(): EvidenceFixtureRow[] {
  const rows: EvidenceFixtureRow[] = [
    {
      id: COMPHET_SNV_ID,
      variant_type: 'snv',
      chr: '2',
      pos: 1000,
      ref: 'A',
      alt: 'G',
      gene_symbol: 'GENEA',
      moi: 'AR',
      gt_num: '0/1',
      consequence: 'MODERATE',
      func: 'missense_variant',
      gnomad_af: 0.0001
    }
  ]
  for (let id = 2; id < COMPHET_INDEL_ID; id++) {
    rows.push({
      id,
      variant_type: 'snv',
      chr: '3',
      pos: 10_000 + id,
      ref: 'C',
      alt: 'T',
      gene_symbol: `FILL${id % 300}`,
      moi: null,
      gt_num: id % 7 === 0 ? '1/1' : '0/1',
      consequence: 'LOW',
      func: 'synonymous_variant',
      // Varied AFs: some fillers fall into the af_low bin, most into none.
      gnomad_af: 0.002 + (id % 50) * 0.0001
    })
  }
  rows.push(
    {
      id: COMPHET_INDEL_ID,
      variant_type: 'indel',
      chr: '2',
      pos: 2000,
      ref: 'AT',
      alt: 'A',
      gene_symbol: 'GENEA',
      moi: 'AR',
      gt_num: '0/1',
      consequence: 'HIGH',
      func: 'frameshift_variant',
      gnomad_af: null
    },
    {
      id: AD_LOF_ID,
      variant_type: 'snv',
      chr: '5',
      pos: 500,
      ref: 'G',
      alt: 'A',
      gene_symbol: 'GENEB',
      moi: 'AD',
      gt_num: '0/1',
      consequence: 'HIGH',
      func: 'stop_gained',
      gnomad_af: null
    }
  )
  return rows
}

export const EVIDENCE_RULESET: EvidenceRuleset = {
  version: 1,
  id: 'test-evidence',
  modes: [
    { id: 'ar_hom', label: 'AR homozygous', when: 'moi:~:AR AND zygosity:=:hom', points: 3 },
    {
      id: 'ar_comphet',
      label: 'AR compound het',
      when: 'moi:~:AR AND zygosity:=:het AND gene_het_hits:>=:2',
      points: 2
    },
    { id: 'ad', label: 'AD het', when: 'moi:~:AD AND zygosity:=:het', points: 1 },
    { id: 'fallback', label: 'No compatible mode', when: null, points: -1 }
  ],
  groups: [
    {
      id: 'freq',
      label: 'Frequency',
      scope: 'global',
      rules: [
        { id: 'af_missing', label: 'Not in gnomAD', when: 'gnomad_af:is:null', points: 3 },
        { id: 'af_1e5', label: 'AF < 1e-5', when: 'gnomad_af:<:0.00001', points: 4 },
        { id: 'af_1e3', label: 'AF < 1e-3', when: 'gnomad_af:<:0.001', points: 2 },
        { id: 'af_low', label: 'AF < 2.5e-3', when: 'gnomad_af:<:0.0025', points: 0.5 }
      ]
    },
    {
      id: 'effect',
      label: 'Effect',
      scope: 'global',
      rules: [
        {
          id: 'lof',
          label: 'Loss of function',
          when: 'func:=:stop_gained OR func:=:frameshift_variant',
          points: 5
        },
        { id: 'synonymous', label: 'Synonymous', when: 'func:=:synonymous_variant', points: -0.5 }
      ]
    }
  ]
}

export const EVIDENCE_CONFIG: ShortlistConfig = {
  variantTypeScope: ['snv', 'indel'],
  baseFilters: { maxGnomadAf: 0.01, consequences: ['HIGH', 'MODERATE', 'LOW'] },
  topN: 50,
  rankConfig: {
    weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 },
    pinStarredTop: true,
    ruleset: EVIDENCE_RULESET
  }
}
