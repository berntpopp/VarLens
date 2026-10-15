// @vitest-environment node
import { copyFileSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadGeneIntervals } from '../../../../src/main/services/reference/gene-intervals'

const GENE_REF = resolve(__dirname, '../../../../resources/gene_reference.db')

describe('gene intervals', () => {
  const ix = loadGeneIntervals(GENE_REF, 'GRCh38')

  it('resolves a span by symbol or HGNC id, per chromosome', () => {
    const tbx6 = ix.span('tbx6', 'chr16')!
    expect(tbx6).toMatchObject({ chr: '16', symbol: 'TBX6', coding: true })
    expect(ix.span(tbx6.hgncId, '16')).toBe(tbx6)
    expect(ix.span('TBX6', 'chr1')).toBeUndefined()
    expect(ix.span('NOT_A_GENE', 'chr16')).toBeUndefined()
  })

  it('returns every span overlapping an interval, ordered by start', () => {
    const tbx6 = ix.span('TBX6', '16')!
    const hits = ix.overlapping('chr16', 29_638_676, 30_188_531)
    expect(hits).toContain(tbx6)
    expect(hits.filter((s) => s.coding).length).toBeGreaterThan(20)
    expect(hits.map((s) => s.start)).toEqual([...hits.map((s) => s.start)].sort((a, b) => a - b))
    expect(ix.overlapping('chr16', tbx6.start, tbx6.start)).toContain(tbx6)
  })

  it('handles huge upstream spans (maxEnds binary search) both inside and downstream', () => {
    // RBFOX1 on chr16 spans ~2.47 Mb (5.24–7.71 Mb) and contains nested shorter genes/ncRNAs.
    const rbfox1 = ix.span('RBFOX1', 'chr16')!
    expect(rbfox1.end - rbfox1.start).toBeGreaterThan(2_000_000)
    const inside = ix.overlapping('chr16', rbfox1.end - 1_000, rbfox1.end)
    expect(inside).toContain(rbfox1)
    const downstream = ix.overlapping('chr16', rbfox1.end + 1, rbfox1.end + 10_000)
    expect(downstream).not.toContain(rbfox1)
  })

  it('reloads after the file changes (in-app gene reference update)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gene-intervals-'))
    try {
      const copy = join(dir, 'gene_reference.db')
      copyFileSync(GENE_REF, copy)
      const first = loadGeneIntervals(copy, 'GRCh38')
      expect(loadGeneIntervals(copy, 'GRCh38')).toBe(first)
      utimesSync(copy, new Date(), new Date(Date.now() + 60_000))
      expect(loadGeneIntervals(copy, 'GRCh38')).not.toBe(first)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
