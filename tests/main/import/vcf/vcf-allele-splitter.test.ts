import { describe, it, expect } from 'vitest'
import { splitMultiAllelic } from '../../../../src/main/import/vcf/vcf-allele-splitter'
import type {
  VcfRawRecord,
  InfoFieldDef,
  FormatFieldDef
} from '../../../../src/main/import/vcf/types'

function makeInfoDefs(defs: Partial<InfoFieldDef>[]): Map<string, InfoFieldDef> {
  const map = new Map<string, InfoFieldDef>()
  for (const d of defs) {
    const full: InfoFieldDef = {
      id: d.id || '',
      number: d.number || '.',
      type: d.type || 'String',
      description: d.description || ''
    }
    map.set(full.id, full)
  }
  return map
}

function makeFormatDefs(defs: Partial<FormatFieldDef>[]): Map<string, FormatFieldDef> {
  const map = new Map<string, FormatFieldDef>()
  for (const d of defs) {
    const full: FormatFieldDef = {
      id: d.id || '',
      number: d.number || '.',
      type: d.type || 'String',
      description: d.description || ''
    }
    map.set(full.id, full)
  }
  return map
}

describe('vcf-allele-splitter', () => {
  const infoDefs = makeInfoDefs([
    { id: 'CSQ', number: '.', type: 'String' },
    { id: 'AF', number: 'A', type: 'Float' },
    { id: 'AC', number: 'A', type: 'Integer' },
    { id: 'DB', number: '0', type: 'Flag' },
    { id: 'DP_INFO', number: '1', type: 'Integer' }
  ])

  const formatDefs = makeFormatDefs([
    { id: 'GT', number: '1', type: 'String' },
    { id: 'GQ', number: '1', type: 'Integer' },
    { id: 'DP', number: '1', type: 'Integer' },
    { id: 'AD', number: 'R', type: 'Integer' }
  ])

  it('passes through single-allelic records unchanged', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 100,
      id: null,
      ref: 'A',
      alt: ['G'],
      qual: 99,
      filter: 'PASS',
      info: new Map([['DP_INFO', '50']]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([['S1', ['0/1', '99', '45', '22,23']]])
    }

    const results = splitMultiAllelic(record, infoDefs, formatDefs)
    expect(results).toHaveLength(1)
    expect(results[0].alt).toEqual(['G'])
    expect(results[0].samples.get('S1')).toEqual(['0/1', '99', '45', '22,23'])
  })

  it('splits biallelic from multi-allelic record', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 200,
      id: 'rs1',
      ref: 'A',
      alt: ['G', 'T'],
      qual: 95,
      filter: 'PASS',
      info: new Map([
        ['AF', '0.1,0.2'],
        ['AC', '5,10'],
        ['DB', ''],
        ['DP_INFO', '50'],
        ['CSQ', 'G|missense,T|stop_gained']
      ]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['S1', ['0/1', '95', '50', '25,20,5']],
        ['S2', ['0/2', '90', '48', '24,0,24']]
      ])
    }

    const results = splitMultiAllelic(record, infoDefs, formatDefs)
    expect(results).toHaveLength(2)

    // First split: ALT=G (allele index 1)
    const r1 = results[0]
    expect(r1.alt).toEqual(['G'])
    expect(r1.info.get('AF')).toBe('0.1') // Number=A: select index 0
    expect(r1.info.get('AC')).toBe('5') // Number=A: select index 0
    expect(r1.info.get('DB')).toBe('') // Number=0 (flag): copy
    expect(r1.info.get('DP_INFO')).toBe('50') // Number=1: copy
    expect(r1.info.get('CSQ')).toBe('G|missense,T|stop_gained') // Number=.: copy as-is

    // Second split: ALT=T (allele index 2)
    const r2 = results[1]
    expect(r2.alt).toEqual(['T'])
    expect(r2.info.get('AF')).toBe('0.2') // Number=A: select index 1
    expect(r2.info.get('AC')).toBe('10') // Number=A: select index 1
  })

  it('remaps GT for multi-allelic splits', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 200,
      id: null,
      ref: 'A',
      alt: ['G', 'T'],
      qual: 95,
      filter: 'PASS',
      info: new Map(),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['S1', ['0/1', '95', '50', '25,20,5']],
        ['S2', ['0/2', '90', '48', '24,0,24']],
        ['S3', ['1/2', '85', '40', '10,15,15']]
      ])
    }

    const results = splitMultiAllelic(record, infoDefs, formatDefs)

    // Split for ALT=G (original allele 1 -> new allele 1)
    expect(results[0].samples.get('S1')![0]).toBe('0/1') // 0/1 stays 0/1
    expect(results[0].samples.get('S2')![0]).toBe('0/.') // 0/2 -> 0/. (allele 2 not relevant)
    expect(results[0].samples.get('S3')![0]).toBe('1/.') // 1/2 -> 1/.

    // Split for ALT=T (original allele 2 -> new allele 1)
    expect(results[1].samples.get('S1')![0]).toBe('0/.') // 0/1 -> 0/. (allele 1 not relevant)
    expect(results[1].samples.get('S2')![0]).toBe('0/1') // 0/2 -> 0/1
    expect(results[1].samples.get('S3')![0]).toBe('./1') // 1/2 -> ./1
  })

  it('splits AD for multi-allelic records (Number=R)', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 200,
      id: null,
      ref: 'A',
      alt: ['G', 'T'],
      qual: 95,
      filter: 'PASS',
      info: new Map(),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([['S1', ['0/1', '95', '50', '25,20,5']]])
    }

    const results = splitMultiAllelic(record, infoDefs, formatDefs)

    // Split for ALT=G: AD should be ref,alt1 = 25,20
    expect(results[0].samples.get('S1')![3]).toBe('25,20')

    // Split for ALT=T: AD should be ref,alt2 = 25,5
    expect(results[1].samples.get('S1')![3]).toBe('25,5')
  })

  it('handles triallelic with three ALT alleles', () => {
    const record: VcfRawRecord = {
      chrom: 'chr1',
      pos: 500,
      id: null,
      ref: 'A',
      alt: ['G', 'T', 'C'],
      qual: 80,
      filter: 'PASS',
      info: new Map([['AF', '0.1,0.2,0.05']]),
      format: ['GT'],
      samples: new Map([['S1', ['1/3']]])
    }

    const results = splitMultiAllelic(record, infoDefs, formatDefs)
    expect(results).toHaveLength(3)
    expect(results[0].alt).toEqual(['G'])
    expect(results[1].alt).toEqual(['T'])
    expect(results[2].alt).toEqual(['C'])
    expect(results[0].info.get('AF')).toBe('0.1')
    expect(results[2].info.get('AF')).toBe('0.05')

    // GT 1/3: for ALT=G (allele 1) -> 1/., for ALT=C (allele 3) -> ./1
    expect(results[0].samples.get('S1')![0]).toBe('1/.')
    expect(results[2].samples.get('S1')![0]).toBe('./1')
  })
})
