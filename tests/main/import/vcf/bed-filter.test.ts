import { describe, it, expect } from 'vitest'
import { BedFilter } from '../../../../src/main/import/vcf/bed-filter'
import path from 'path'

const BED_PATH = path.join(__dirname, '../../../test-data/vcf/test-regions.bed')

describe('BedFilter', () => {
  describe('loadFromFile', () => {
    it('loads intervals from a BED file', () => {
      const filter = BedFilter.fromFile(BED_PATH, 0)
      expect(filter.intervalCount()).toBe(4)
    })

    it('applies padding to intervals', () => {
      const filter = BedFilter.fromFile(BED_PATH, 100)
      // chr1:999000-1010000 with +/-100 -> chr1:998901-1010100 (1-based inclusive)
      expect(filter.contains('chr1', 998950)).toBe(true)
      expect(filter.contains('chr1', 998850)).toBe(false)
    })
  })

  describe('contains (point query)', () => {
    const filter = BedFilter.fromFile(BED_PATH, 0)

    it('returns true for position inside interval', () => {
      expect(filter.contains('chr1', 1000000)).toBe(true)
    })

    it('returns false for position outside all intervals', () => {
      expect(filter.contains('chr1', 2000000)).toBe(false)
    })

    it('returns true at interval start (1-based inclusive)', () => {
      // BED is 0-based half-open [999000, 1010000)
      // 1-based inclusive: [999001, 1010000]
      expect(filter.contains('chr1', 999001)).toBe(true)
    })

    it('returns true at interval end (1-based inclusive)', () => {
      expect(filter.contains('chr1', 1010000)).toBe(true)
    })

    it('returns false for unknown chromosome', () => {
      expect(filter.contains('chr99', 1000000)).toBe(false)
    })
  })

  describe('containsRange (interval overlap query for SV/CNV)', () => {
    const filter = BedFilter.fromFile(BED_PATH, 0)

    it('returns true when range overlaps a BED region', () => {
      // Range chr1:990000-1005000 overlaps BED chr1:999001-1010000
      expect(filter.containsRange('chr1', 990000, 1005000)).toBe(true)
    })

    it('returns false when range is entirely outside', () => {
      expect(filter.containsRange('chr1', 2000000, 2100000)).toBe(false)
    })

    it('returns true when range fully contains a BED region', () => {
      expect(filter.containsRange('chr1', 900000, 1100000)).toBe(true)
    })
  })

  describe('empty filter', () => {
    it('contains() always returns true when no BED loaded', () => {
      const filter = BedFilter.empty()
      expect(filter.contains('chr1', 12345)).toBe(true)
      expect(filter.containsRange('chr1', 100, 200)).toBe(true)
    })
  })
})
