import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  readVcfHeaderLines,
  readVcfHeaderLinesSync
} from '../../../../src/main/import/vcf/read-vcf-header'

describe('readVcfHeaderLines(Sync)', () => {
  let dir: string
  const vcf = [
    '##fileformat=VCFv4.2',
    '##contig=<ID=chr1,length=248956422>',
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
    'chr1\t100\t.\tA\tG\t.\tPASS\t.',
    ''
  ].join('\n')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vcf-head-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads the ## lines of a plain and of a gzipped file', () => {
    writeFileSync(join(dir, 'a.vcf'), vcf)
    writeFileSync(join(dir, 'a.vcf.gz'), gzipSync(vcf))
    for (const name of ['a.vcf', 'a.vcf.gz']) {
      expect(readVcfHeaderLinesSync(join(dir, name))).toEqual([
        '##fileformat=VCFv4.2',
        '##contig=<ID=chr1,length=248956422>'
      ])
    }
  })

  it('reads the head of a gzipped file larger than the read limit', () => {
    const body = Array.from({ length: 50_000 }, (_, i) => `chr1\t${i + 1}\t.\tA\tG\t.\tPASS\t.`)
    writeFileSync(join(dir, 'big.vcf.gz'), gzipSync([vcf, ...body].join('\n')))
    expect(readVcfHeaderLinesSync(join(dir, 'big.vcf.gz'), 4096)).toHaveLength(2)
  })

  it('drops a header line cut off by the read limit', () => {
    writeFileSync(join(dir, 'cut.vcf'), vcf)
    expect(readVcfHeaderLinesSync(join(dir, 'cut.vcf'), 40)).toEqual(['##fileformat=VCFv4.2'])
  })

  it('the async reader gives the same lines (PostgreSQL job)', async () => {
    writeFileSync(join(dir, 'a.vcf.gz'), gzipSync(vcf))
    expect(await readVcfHeaderLines(join(dir, 'a.vcf.gz'))).toEqual(
      readVcfHeaderLinesSync(join(dir, 'a.vcf.gz'))
    )
    expect(await readVcfHeaderLines(join(dir, 'gone.vcf'))).toEqual([])
  })

  it('a missing or empty path gives no evidence', () => {
    expect(readVcfHeaderLinesSync(join(dir, 'gone.vcf'))).toEqual([])
    expect(readVcfHeaderLinesSync(null)).toEqual([])
    expect(readVcfHeaderLinesSync('')).toEqual([])
  })
})
