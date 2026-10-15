import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  formatIgvLocus,
  IGV_BATCH_ORIGIN,
  igvGotoUrl,
  igvLoadUrl,
  igvLocus,
  loadInIgv,
  normalizeIgvGenomeBuild,
  sendToIgv
} from '../../../src/renderer/src/utils/igv-desktop'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('igv-desktop (#93)', () => {
  describe('formatIgvLocus & igvLocus', () => {
    it('formats point variants and SV/CNV intervals', () => {
      expect(formatIgvLocus('chr1', 12345)).toBe('chr1:12345-12345')
      expect(formatIgvLocus('chr1', 12345, 12500)).toBe('chr1:12345-12500')
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
        formatIgvLocus({
          chr: 'chr7',
          pos: 1000,
          ref: 'N',
          alt: '<DEL>',
          variant_type: 'sv',
          end_pos: 5000
        })
      ).toBe('chr7:1000-5000')
    })
  })

  describe('normalizeIgvGenomeBuild', () => {
    it.each([
      ['GRCh38', 'hg38'],
      ['hg38', 'hg38'],
      ['GRCh38.p14', 'hg38'],
      ['GRCh37', 'hg19'],
      ['hg19', 'hg19'],
      ['hs37d5', 'hg19'],
      ['T2T-CHM13', 'hs1'],
      ['hs1', 'hs1'],
      ['mm10', 'mm10']
    ])('normalizes %s to %s', (input, expected) => {
      expect(normalizeIgvGenomeBuild(input)).toBe(expected)
    })

    it('returns null for empty, whitespace, null, or undefined builds', () => {
      expect(normalizeIgvGenomeBuild(null)).toBeNull()
      expect(normalizeIgvGenomeBuild(undefined)).toBeNull()
      expect(normalizeIgvGenomeBuild('')).toBeNull()
      expect(normalizeIgvGenomeBuild('   ')).toBeNull()
    })
  })

  describe('igvGotoUrl', () => {
    it('builds goto URL without genome parameter when genomeBuild is omitted', () => {
      expect(igvGotoUrl('chr1:100-100')).toBe(`${IGV_BATCH_ORIGIN}/goto?locus=chr1%3A100-100`)
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
