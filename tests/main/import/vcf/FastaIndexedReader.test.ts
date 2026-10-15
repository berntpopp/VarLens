import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { FastaIndexedReader } from '../../../../src/main/import/vcf/FastaIndexedReader'
import { mapVcfRecord } from '../../../../src/main/import/vcf/VcfMapper'
import type { VcfHeader, VcfRawRecord } from '../../../../src/main/import/vcf/types'
import { createObjectFormatMapper } from '../../../../src/main/import/transforms/ObjectFormatMapper'
import { createFieldMapper } from '../../../../src/main/import/transforms/FieldMapper'

const tempDirs: string[] = []

function createTempFasta(
  contigs: ReadonlyArray<{ name: string; lines: string[]; lineEnding?: '\n' | '\r\n' }>
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varlens-fai-'))
  tempDirs.push(dir)
  const fastaPath = path.join(dir, 'ref.fa')
  const faiPath = `${fastaPath}.fai`

  let fastaContent = ''
  const faiLines: string[] = []

  for (const contig of contigs) {
    const eol = contig.lineEnding ?? '\n'
    const header = `>${contig.name}${eol}`
    fastaContent += header
    const offset = Buffer.byteLength(fastaContent, 'ascii')
    const lineBases = contig.lines[0]?.length ?? 1
    const lineWidth = lineBases + eol.length
    const totalLength = contig.lines.reduce((sum, line) => sum + line.length, 0)
    fastaContent += contig.lines.join(eol) + eol
    faiLines.push(`${contig.name}\t${totalLength}\t${offset}\t${lineBases}\t${lineWidth}`)
  }

  fs.writeFileSync(fastaPath, fastaContent, 'ascii')
  fs.writeFileSync(faiPath, faiLines.join('\n') + '\n', 'ascii')
  return fastaPath
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('FastaIndexedReader (#587)', () => {
  it('reads windows across wrapped FASTA lines with both LF and CRLF line endings', () => {
    const fastaPath = createTempFasta([
      {
        name: 'chr1',
        // 18 bases wrapped at 6 bases per line: ACGTTG / CAAATG / GCACAC
        lines: ['acgttg', 'CAAATG', 'GCACAC'],
        lineEnding: '\n'
      },
      {
        name: '2',
        // 12 bases wrapped at 5 bases per line with CRLF: GAAAT / CCGGT / AA
        lines: ['GAAAT', 'ccggt', 'AA'],
        lineEnding: '\r\n'
      }
    ])

    const reader = new FastaIndexedReader(fastaPath)
    try {
      expect(reader.fetch('chr1', 1, 6)).toBe('ACGTTG')
      expect(reader.fetch('chr1', 5, 11)).toBe('TGCAAAT')
      expect(reader.fetch('chr1', 1, 18)).toBe('ACGTTGCAAATGGCACAC')

      // Contig alias resolution: chr1 <-> 1, chr2 <-> 2
      expect(reader.fetch('1', 7, 11)).toBe('CAAAT')
      expect(reader.fetch('CHR1', 7, 11)).toBe('CAAAT')
      expect(reader.fetch('chr2', 4, 8)).toBe('ATCCG')
      expect(reader.fetch('2', 1, 12)).toBe('GAAATCCGGTAA')
    } finally {
      reader.close()
    }
  })

  it('returns null for out-of-bounds coordinates, unknown contigs, or closed reader', () => {
    const fastaPath = createTempFasta([{ name: 'chr1', lines: ['ACGTTG', 'CAAATG'] }])
    const reader = new FastaIndexedReader(fastaPath)

    expect(reader.fetch('chr1', 0, 5)).toBeNull()
    expect(reader.fetch('chr1', 6, 4)).toBeNull()
    expect(reader.fetch('chr1', 1, 13)).toBeNull()
    expect(reader.fetch('chrUn', 1, 3)).toBeNull()
    expect(reader.windowForContig('chrUn')).toBeNull()

    reader.close()
    expect(reader.fetch('chr1', 1, 4)).toBeNull()
    expect(reader.windowForContig('chr1')).toBeNull()
  })

  it('collapses repeat-shifted VCF indel spellings into one left-aligned identity in mapVcfRecord', () => {
    // Positions 1..12: A C G T T G C A A A T G
    // Homopolymer run of A is at 8..10, anchored by C at 7
    const fastaPath = createTempFasta([{ name: 'chr1', lines: ['ACGTTG', 'CAAATG'] }])
    const reader = new FastaIndexedReader(fastaPath)

    const header: VcfHeader = {
      samples: ['SAMPLE1'],
      infoDefs: new Map(),
      formatDefs: new Map([['GT', { id: 'GT', number: '1', type: 'String', description: '' }]]),
      contigs: new Map(),
      annotationType: null,
      csqFields: null,
      genomeBuild: 'GRCh38',
      rawHeaderLines: []
    }

    const leftSpelling: VcfRawRecord = {
      chrom: 'chr1',
      pos: 7,
      id: null,
      ref: 'CA',
      alt: ['C'],
      qual: 50,
      filter: 'PASS',
      info: new Map(),
      format: ['GT'],
      samples: new Map([['SAMPLE1', ['0/1']]])
    }

    const rightSpelling: VcfRawRecord = {
      chrom: '1',
      pos: 9,
      id: null,
      ref: 'AA',
      alt: ['A'],
      qual: 50,
      filter: 'PASS',
      info: new Map(),
      format: ['GT'],
      samples: new Map([['SAMPLE1', ['0/1']]])
    }

    try {
      const lookup = (chr: string) => reader.windowForContig(chr)
      const [mappedLeft] = mapVcfRecord(
        leftSpelling,
        header,
        'SAMPLE1',
        [],
        null,
        undefined,
        lookup
      )
      const [mappedRight] = mapVcfRecord(
        rightSpelling,
        header,
        'SAMPLE1',
        [],
        null,
        undefined,
        lookup
      )

      expect(mappedLeft).toMatchObject({ pos: 7, ref: 'CA', alt: 'C' })
      expect(mappedRight).toMatchObject({ pos: 7, ref: 'CA', alt: 'C' })
    } finally {
      reader.close()
    }
  })

  it('left-aligns indels in ObjectFormatMapper and FieldMapper when referenceLookup is provided', async () => {
    const fastaPath = createTempFasta([{ name: 'chr1', lines: ['ACGTTG', 'CAAATG'] }])
    const reader = new FastaIndexedReader(fastaPath)
    const lookup = (chr: string) => reader.windowForContig(chr)

    try {
      const objMapper = createObjectFormatMapper(undefined, undefined, undefined, lookup)
      const objOutput: Array<{ pos: number; ref: string; alt: string }> = []
      objMapper.on('data', (row) => objOutput.push(row))
      objMapper.write({
        key: 0,
        value: { chr: 'chr1', pos: 9, ref: 'AA', alt: 'A' }
      })
      objMapper.end()

      const fieldMapper = createFieldMapper(
        { gene: {}, impact: {}, transcript: {}, hpoSimScore: {}, moi: {} },
        {
          CHR: 0,
          POS: 1,
          REF: 2,
          ALT: 3,
          SELECTED_TRANSCRIPT: 4,
          IMPACT: 4,
          FUNC: 4,
          GENE: 4,
          OMIM: 4,
          GNOMAD_AF: 4,
          CADD: 4,
          CLINVAR: 4,
          GT_NUM: 4,
          QUAL: 4,
          HPO_SIM_SCORE: 4,
          TRANSCRIPT: 4,
          CDNA: 4,
          AA_CHANGE: 4,
          MOI: 4,
          HPO_MATCH: 4
        },
        undefined,
        undefined,
        undefined,
        undefined,
        lookup
      )
      const fieldOutput: Array<{ pos: number; ref: string; alt: string }> = []
      fieldMapper.on('data', (row) => fieldOutput.push(row))
      fieldMapper.write({ key: 0, value: ['1', 9, 'AA', 'A', null] })
      fieldMapper.end()

      expect(objOutput[0]).toMatchObject({ pos: 7, ref: 'CA', alt: 'C' })
      expect(fieldOutput[0]).toMatchObject({ pos: 7, ref: 'CA', alt: 'C' })
    } finally {
      reader.close()
    }
  })
})
