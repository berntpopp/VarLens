import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dbnsfpNumber, parseVepLine } from '../../../../scripts/shortlist-sim/annotate/local-vep'
import {
  extractGnomad,
  extractVep
} from '../../../../scripts/shortlist-sim/annotate/spike-annotation'

const lines = readFileSync(
  resolve(process.cwd(), 'tests/test-data/shortlist-sim/vep-line.json'),
  'utf8'
)
  .trim()
  .split('\n')

describe('parseVepLine (canned VEP 115 --json output)', () => {
  it('takes the pick-flagged MANE transcript, dbNSFP fields and cache frequencies', () => {
    const r = parseVepLine(lines[0])
    expect(r).toMatchObject({
      key: '1:11796321:G:A',
      mostSevere: 'missense_variant',
      impact: 'MODERATE',
      terms: ['missense_variant'],
      transcript: 'ENST00000376590',
      isMane: true,
      gene: 'MTHFR',
      caddPhred: 28.3,
      gnomadJointAf: 0.318214,
      popmaxAf: 0.483516,
      gnomadExomeAf: 0.3227,
      gnomadGenomeAf: 0.2752,
      inGnomadCache: true
    })
    expect(r.exomePopmaxAf).toBeCloseTo(0.4893, 4)
  })

  it('handles an indel without dbNSFP values (frequencies keyed by the trimmed allele)', () => {
    const r = parseVepLine(lines[1])
    expect(r.key).toBe('1:55051215:G:GA')
    expect(r.caddPhred).toBeNull()
    expect(r.gnomadJointAf).toBeNull()
    expect(r.gnomadExomeAf).toBeCloseTo(0.0006317, 7)
  })
})

describe('dbnsfpNumber', () => {
  it('treats "." as missing and takes the max of multiple values', () => {
    expect(dbnsfpNumber('.')).toBeNull()
    expect(dbnsfpNumber('12.1,.,30.5')).toBe(30.5)
    expect(dbnsfpNumber('1e-05&2e-05')).toBe(2e-5)
    expect(dbnsfpNumber(undefined)).toBeNull()
  })
})

describe('genefoundry payload extraction', () => {
  it('prefers the MANE Select transcript and reads CADD from position_scores', () => {
    const v = extractVep({
      most_severe_consequence: 'stop_gained',
      position_scores: { cadd_phred: 38 },
      transcript_consequences: [
        { transcript_id: 'T1', consequence_terms: ['stop_gained'], impact: 'HIGH' },
        {
          transcript_id: 'T2',
          consequence_terms: ['missense_variant'],
          impact: 'MODERATE',
          mane_select: 'NM_1.1',
          hgvsc: 'c.1A>T'
        }
      ]
    })
    expect(v).toMatchObject({
      transcript: 'T2',
      isMane: true,
      impact: 'MODERATE',
      caddPhred: 38,
      mostSevere: 'stop_gained'
    })
  })

  it('computes joint AF and popmax without bottlenecked groups', () => {
    const g = extractGnomad({
      dataset: 'gnomad_r4',
      exome: {
        ac: 10,
        an: 1000,
        af: 0.01,
        populations: [
          { id: 'afr', ac: 8, an: 100 },
          { id: 'fin', ac: 2, an: 10 }
        ]
      },
      genome: { ac: 0, an: 1000, af: 0, populations: [{ id: 'afr', ac: 0, an: 100 }] }
    })
    expect(g.jointAf).toBeCloseTo(0.005)
    expect(g.popmaxAf).toBeCloseTo(0.04)
    expect(g.exomeAf).toBe(0.01)
    expect(g.exomePopmaxAf).toBeCloseTo(0.08)
    expect(g.genomePopmaxAf).toBe(0)
  })
})

describe('dbNSFP subset regions', () => {
  it('merges overlapping REF spans and keeps chromosomes whole across parts', async () => {
    const { mergedRegions, splitByChromosome } =
      await import('../../../../scripts/shortlist-sim/annotate/local-vep')
    const a = (chr: string, pos: number, ref = 'A') => ({
      key: `${chr}:${pos}`,
      chr,
      pos,
      ref,
      alt: 'G'
    })
    const regions = mergedRegions([
      a('chr2', 10),
      a('1', 100, 'ACG'),
      a('1', 102),
      a('1', 200),
      a('2', 5)
    ])
    expect(regions).toEqual(['1\t100\t103', '1\t200\t201', '2\t5\t6', '2\t10\t11'])
    const parts = splitByChromosome(regions, 8)
    expect(parts).toHaveLength(2)
    for (const p of parts) expect(new Set(p.map((r) => r.split('\t')[0])).size).toBe(1)
  })
})
