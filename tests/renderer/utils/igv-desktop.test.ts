import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  IGV_BATCH_ORIGIN,
  igvGenomeId,
  igvGotoUrl,
  igvLoadUrl,
  igvLocus,
  loadInIgv,
  sendToIgv
} from '../../../src/renderer/src/utils/igv-desktop'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('igv-desktop (#93)', () => {
  describe('igvLocus & igvGenomeId', () => {
    it('formats point variants and SV/CNV intervals', () => {
      expect(
        igvLocus({
          chr: 'chr7',
          pos: 140753336,
          ref: 'A',
          alt: 'T',
          variant_type: 'snv',
          end_pos: null
        })
      ).toBe('chr7:140753336-140753336')
      expect(
        igvLocus({
          chr: 'chr7',
          pos: 1000,
          ref: 'N',
          alt: '<DEL>',
          variant_type: 'sv',
          end_pos: 5000
        })
      ).toBe('chr7:1000-5000')
    })

    it.each([
      ['GRCh38', 'hg38'],
      ['hg38', 'hg38'],
      ['GRCh37', 'hg19'],
      ['hg19', 'hg19']
    ])('maps %s to %s', (input, expected) => {
      expect(igvGenomeId(input)).toBe(expected)
    })

    it('returns null for unknown, empty, or null builds', () => {
      expect(igvGenomeId(null)).toBeNull()
      expect(igvGenomeId(undefined)).toBeNull()
      expect(igvGenomeId('')).toBeNull()
      expect(igvGenomeId('mm10')).toBeNull()
    })
  })

  describe('igvGotoUrl', () => {
    it('builds goto URL without genome parameter when genomeBuild is omitted or unknown', () => {
      expect(igvGotoUrl('chr1:100-100')).toBe(`${IGV_BATCH_ORIGIN}/goto?locus=chr1%3A100-100`)
      expect(igvGotoUrl('chr1:100-100', 'unknown')).toBe(
        `${IGV_BATCH_ORIGIN}/goto?locus=chr1%3A100-100`
      )
    })

    it('appends normalized genome parameter when genomeBuild is provided', () => {
      expect(igvGotoUrl('chr1:100-100', 'GRCh38')).toBe(
        `${IGV_BATCH_ORIGIN}/goto?locus=chr1%3A100-100&genome=hg38`
      )
      expect(igvGotoUrl('chr1:100-100', 'GRCh37')).toBe(
        `${IGV_BATCH_ORIGIN}/goto?locus=chr1%3A100-100&genome=hg19`
      )
    })
  })

  describe('igvLoadUrl', () => {
    it('builds load URL for local BAM path with optional locus and genome build', () => {
      expect(igvLoadUrl('/data/sample.bam')).toBe(
        `${IGV_BATCH_ORIGIN}/load?file=%2Fdata%2Fsample.bam`
      )
      expect(igvLoadUrl('/data/sample.bam', 'chr1:100-200', 'GRCh38')).toBe(
        `${IGV_BATCH_ORIGIN}/load?file=%2Fdata%2Fsample.bam&locus=chr1%3A100-200&genome=hg38`
      )
    })
  })

  describe('sendToIgv & loadInIgv', () => {
    it('sends goto request with genome build and resolves true when IGV responds', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())

      const ok = await sendToIgv('chr1:100-100', 'GRCh38')

      expect(ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        `${IGV_BATCH_ORIGIN}/goto?locus=chr1%3A100-100&genome=hg38`,
        expect.objectContaining({ mode: 'no-cors' })
      )
    })

    it('loads BAM track in IGV and resolves false when connection is refused', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response())
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))

      await expect(loadInIgv('/data/sample.bam', 'chr1:100-200', 'GRCh37')).resolves.toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        `${IGV_BATCH_ORIGIN}/load?file=%2Fdata%2Fsample.bam&locus=chr1%3A100-200&genome=hg19`,
        expect.objectContaining({ mode: 'no-cors' })
      )

      await expect(loadInIgv('/data/sample.bam')).resolves.toBe(false)
    })
  })
})
