// Fabricated background and pool for the simulation tests (no patient data).
import type { NormalizedAllele } from '../../../../scripts/shortlist-sim/annotate/normalize'
import type {
  Background,
  MappedVariant
} from '../../../../scripts/shortlist-sim/concordance/load-backgrounds'
import type { PoolVariant } from '../../../../scripts/shortlist-sim/pool/select-pool'
import {
  mapVarvisObject,
  type SpikeOptions,
  type SpikeSource
} from '../../../../scripts/shortlist-sim/sim/spikes'

export const GENES = Array.from({ length: 30 }, (_, i) => `GENE${i}`)
export const moiOf = (i: number): string => (i % 3 === 0 ? 'AR' : 'AD')
const BASES = ['A', 'C', 'G', 'T']

/** 40 rows per gene: hets (`0/1`, every 10th `./1` or `1/.`), some homs, mixed AF and func. */
export function syntheticBackground(label = 'bg1'): Background {
  const rows: MappedVariant[] = []
  GENES.forEach((gene, gi) => {
    for (let j = 0; j < 40; j++) {
      const pos = 1_000_000 * (gi + 1) + j * 100
      const gt = j % 10 === 3 ? './1' : j % 10 === 7 ? '1/.' : j % 13 === 0 ? '1/1' : '0/1'
      const mapped = mapVarvisObject({
        chr: '1',
        pos,
        ref: BASES[j % 4],
        alt: j % 9 === 0 ? `${BASES[j % 4]}T` : BASES[(j + 1) % 4],
        gene_symbol: gene,
        omim_mim_number: gi % 5 === 0 ? null : String(100000 + gi),
        consequence: j % 2 === 0 ? 'MODERATE' : 'LOW',
        gnomad_af: j % 7 === 0 ? null : (j % 5) * 0.002,
        cadd: j % 11 === 0 ? null : 5 + (j % 25),
        clinvar: j % 8 === 0 ? 'Benign' : null,
        gt_num: gt,
        func: j % 2 === 0 ? 'missense_variant' : 'synonymous_variant',
        qual: 30 + j,
        hpo_sim_score: gi % 4 === 0 ? null : gi / 100,
        transcript: 'NM_SYN.1',
        cdna: null,
        aa_change: null,
        moi: [{ abbreviation: moiOf(gi) }]
      } as never)
      rows.push(mapped)
    }
  })
  return { caseLabel: label, rows, skipped: 0 }
}

export const SPIKE_OPTIONS: SpikeOptions = {
  afField: 'joint',
  funcMapping: [
    { vepTerm: 'missense_variant', alleleClass: 'snv', varvisFunc: 'missense_variant', count: 50 },
    { vepTerm: 'stop_gained', alleleClass: 'snv', varvisFunc: 'stop_gained', count: 50 },
    {
      vepTerm: 'synonymous_variant',
      alleleClass: 'snv',
      varvisFunc: 'synonymous_variant',
      count: 50
    }
  ],
  impactByFunc: [
    { varvisFunc: 'missense_variant', impact: 'MODERATE', count: 50 },
    { varvisFunc: 'stop_gained', impact: 'HIGH', count: 50 },
    { varvisFunc: 'synonymous_variant', impact: 'LOW', count: 50 }
  ],
  caddImpute: true,
  imputeSeed: 11
}

let next = 0
/** A pool variant at a fresh position of `gene` plus its local annotation. */
export function poolSpike(
  gene: string,
  over: Partial<PoolVariant> = {},
  term = 'stop_gained',
  af: number | null = null
): SpikeSource {
  next += 1
  const gi = Number(gene.replace('GENE', ''))
  const pos = 1_000_000 * (gi + 1) + 50 + next
  const key = `1:${pos}:C:G`
  const pv: PoolVariant = {
    key,
    chr: '1',
    pos,
    ref: 'C',
    alt: 'G',
    gene,
    clinvarId: String(next),
    clnsig: over.label === 'benign' ? 'Benign' : 'Pathogenic',
    revstat: 'reviewed_by_expert_panel',
    label: 'plp',
    moi: 'AD',
    diseaseIds: ['OMIM:1'],
    newSince2024: false,
    ...over
  }
  const norm: NormalizedAllele = {
    input: key,
    chr: '1',
    pos,
    ref: 'C',
    alt: 'G',
    key,
    status: 'ok'
  }
  const ann: SpikeSource['ann'] = {
    key,
    poolKey: key,
    vep: {
      mostSevere: term,
      consequenceTerms: [term],
      impact: 'HIGH',
      transcript: 'ENST1',
      isMane: true,
      hgvsc: null,
      hgvsp: null,
      gene,
      caddPhred: 33
    },
    gnomad: {
      found: af !== null,
      exomeAf: af,
      genomeAf: null,
      jointAf: af,
      popmaxAf: af,
      exomePopmaxAf: null,
      genomePopmaxAf: null,
      dataset: 'test'
    },
    fetchedAt: '',
    errors: []
  }
  return { pv: { ...pv, key }, norm, ann, caddApi: 31 }
}
