import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LocalVepRecord } from '../../../../scripts/shortlist-sim/annotate/local-vep'
import { computeConcordance } from '../../../../scripts/shortlist-sim/concordance/concordance'
import { loadBackground } from '../../../../scripts/shortlist-sim/concordance/load-backgrounds'
import {
  afStat,
  chooseAfField,
  median,
  pearson,
  verdict
} from '../../../../scripts/shortlist-sim/concordance/metrics'

// Fabricated rows (no patient data), varvis JSON shape.
const SYNTHETIC = resolve(process.cwd(), 'tests/test-data/shortlist-sim/synthetic-background.json')

const VEP_TERM: Record<string, string> = {
  missense_variant: 'missense_variant',
  synonymous_variant: 'synonymous_variant',
  coding_transcript_intron_variant: 'intron_variant',
  stop_gained: 'stop_gained',
  frameshift_truncation: 'frameshift_variant',
  inframe_indel: 'inframe_deletion',
  mnv: 'missense_variant',
  '3_prime_UTR_exon_variant': '3_prime_UTR_variant',
  splice_region_variant: 'splice_region_variant'
}

function fakeLocal(
  key: string,
  func: string | null,
  af: number | null,
  cadd: number | null
): LocalVepRecord {
  const term = func === null ? 'intergenic_variant' : VEP_TERM[func]
  return {
    key,
    mostSevere: term,
    impact: 'X',
    terms: [term],
    transcript: 'ENST1',
    isMane: true,
    gene: null,
    caddPhred: cadd,
    gnomadJointAf: af === null ? null : af * 10, // deliberately off by one log unit
    gnomadExomeAf: af, // exact
    gnomadGenomeAf: af === null ? null : af * 2,
    popmaxAf: null,
    exomePopmaxAf: null,
    genomePopmaxAf: null,
    inGnomadCache: af !== null,
    selection: 'gene'
  }
}

describe('loadBackground', () => {
  it('maps varvis JSON through the production ObjectFormatMapper with a bgN label', async () => {
    const bg = await loadBackground(SYNTHETIC, 'bg1')
    expect(bg.caseLabel).toBe('bg1')
    expect(bg.rows).toHaveLength(200)
    expect(bg.rows[5].func).toBeNull() // `[]` imported as null
    expect(bg.rows[0]).not.toHaveProperty('_transcripts')
    expect(bg.rows.find((r) => r.gene_symbol === 'BRCA1')?.moi).toBe('AD')
  })
})

describe('computeConcordance (synthetic background, fabricated local VEP)', () => {
  it('builds the mapping tables, picks the closest AF field and evaluates acceptance', async () => {
    const bg = await loadBackground(SYNTHETIC, 'bg1')
    const sites = bg.rows.map((r, i) => ({
      varvis: r,
      local:
        i % 50 === 49
          ? null
          : fakeLocal(`${i}`, r.func, r.gnomad_af, r.cadd === null ? null : r.cadd + 0.1)
    }))
    const report = computeConcordance([{ bg, sites }], { ok: 200 }, null)
    expect(report.sites).toBe(200)
    expect(report.matched).toBe(196)
    expect(report.acceptance.afField).toBe('exome')
    // 200 synthetic rows: fewer compared sites than MIN_EVAL → not evaluable, never a fail.
    expect(report.acceptance.afPass).toBeNull()
    expect(report.acceptance.caddPass).toBeNull()
    expect(report.acceptance.reasons.cadd).toMatch(/^not evaluable: n = \d+ < 200$/)
    expect(report.acceptance.poolCaddPass).toBeNull()
    expect(report.afField.find((s) => s.field === 'joint')?.medianAbsLog10Err).toBeCloseTo(1)
    expect(report.cadd.medianAbsErr).toBeCloseTo(0.1)
    const mnv = report.funcMapping.find((m) => m.alleleClass === 'mnv')
    expect(mnv).toMatchObject({ vepTerm: 'missense_variant', varvisFunc: 'mnv' })
    expect(report.impactByFunc.find((r) => r.varvisFunc === 'mnv')?.impact).toBe('HIGH')
    expect(report.funcAgreement.projectedEqual).toBe(report.funcAgreement.n)
    expect(report.transcriptSelection).toEqual({ gene: 196 })
  })

  it('leaves unmapped_gene sites out of the mapping and the agreement', async () => {
    const bg = await loadBackground(SYNTHETIC, 'bg1')
    const sites = bg.rows.map((r, i) => ({
      varvis: r,
      local: {
        ...fakeLocal(`${i}`, r.func, r.gnomad_af, r.cadd),
        selection: i < 10 ? ('unmapped_gene' as const) : ('gene' as const)
      }
    }))
    const all = computeConcordance(
      [
        {
          bg,
          sites: sites.map((x) => ({ ...x, local: { ...x.local, selection: 'gene' as const } }))
        }
      ],
      {},
      null
    )
    const report = computeConcordance([{ bg, sites }], {}, null)
    expect(report.transcriptSelection).toEqual({ gene: 190, unmapped_gene: 10 })
    expect(all.funcAgreement.n - report.funcAgreement.n).toBe(
      sites.slice(0, 10).filter((x) => x.varvis.func !== null).length
    )
    expect(report.geneConstancy.every((g) => g.inconsistentGenes === 0)).toBe(true)
    // Aggregate only: no coordinates or gene symbols anywhere in the report.
    const text = JSON.stringify(report)
    expect(text).not.toMatch(/BRCA1|CFTR|43044295/)
  })
})

describe('metric helpers', () => {
  it('verdict separates not evaluable from fail', () => {
    expect(verdict(199, true)).toEqual({ pass: null, reason: 'not evaluable: n = 199 < 200' })
    expect(verdict(200, false)).toEqual({ pass: false, reason: 'fail (n = 200)' })
    expect(verdict(500, true).pass).toBe(true)
  })

  it('median, pearson and AF error', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([])).toBeNull()
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1)
    const s = afStat('exome', [
      [0.01, 0.001],
      [null, 0.1],
      [0.5, null],
      [null, null]
    ])
    expect(s).toMatchObject({
      n: 1,
      medianAbsLog10Err: 1,
      onlyLocal: 1,
      onlyVarvis: 1,
      bothMissing: 1
    })
    expect(chooseAfField([s])).toBeNull() // too few sites
  })
})
