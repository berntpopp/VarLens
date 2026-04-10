/**
 * Tests for the shared filter helpers in `import-filters.ts`
 * (`passesPreMappingFilters` + `passesPostMappingFilters`).
 *
 * These exercise the semantics per variant type that the single-file
 * (`VcfStrategy.ts`) and multi-file append (`import-logic-append.ts`)
 * paths both delegate to. Extracting the logic into a single helper
 * meant ONE test suite covers both paths.
 */

import { describe, it, expect } from 'vitest'
import {
  passesPreMappingFilters,
  passesPostMappingFilters,
  DEFAULT_IMPORT_FILTERS,
  type ImportFilters
} from '../../../../src/main/import/vcf/import-filters'
import type { VcfRawRecord, VcfMappedVariant } from '../../../../src/main/import/vcf/types'
import { BedFilter } from '../../../../src/main/import/vcf/bed-filter'

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function rawRecord(overrides: Partial<VcfRawRecord> = {}): VcfRawRecord {
  return {
    chrom: 'chr1',
    pos: 1000,
    id: null,
    ref: 'A',
    alt: ['T'],
    qual: null,
    filter: 'PASS',
    info: new Map<string, string>(),
    format: ['GT'],
    samples: new Map([['SAMPLE1', ['0/1']]]),
    ...overrides
  }
}

function mapped(overrides: Partial<VcfMappedVariant> = {}): VcfMappedVariant {
  return {
    chr: 'chr1',
    pos: 1000,
    ref: 'A',
    alt: 'T',
    gene_symbol: null,
    omim_mim_number: null,
    consequence: null,
    gnomad_af: null,
    cadd: null,
    clinvar: null,
    gt_num: '0/1',
    func: null,
    qual: null,
    hpo_sim_score: null,
    transcript: null,
    cdna: null,
    aa_change: null,
    hpo_match: null,
    moi: null,
    gq: null,
    dp: null,
    ad_ref: null,
    ad_alt: null,
    ab: null,
    filter: 'PASS',
    info_json: null,
    source_format: 'vcf',
    variant_type: 'snv',
    end_pos: null,
    sv_type: null,
    sv_length: null,
    caller: null,
    ...overrides
  }
}

function buildBed(intervals: Array<[string, number, number]>): BedFilter {
  const content = intervals.map(([chr, s, e]) => `${chr}\t${s}\t${e}`).join('\n')
  const tmp = `/tmp/varlens-test-${Date.now()}-${Math.random().toString(36).slice(2)}.bed`
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:fs').writeFileSync(tmp, content)
  const bed = BedFilter.fromFile(tmp, 0)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:fs').unlinkSync(tmp)
  return bed
}

// ---------------------------------------------------------------------------
// Pre-mapping tests
// ---------------------------------------------------------------------------

describe('passesPreMappingFilters', () => {
  it('returns true when filters are undefined', () => {
    expect(passesPreMappingFilters(rawRecord(), undefined)).toBe(true)
  })

  it('returns true for default (no-op) filters', () => {
    expect(passesPreMappingFilters(rawRecord(), DEFAULT_IMPORT_FILTERS)).toBe(true)
  })

  describe('passOnly', () => {
    const passOnly: ImportFilters = { ...DEFAULT_IMPORT_FILTERS, passOnly: true }

    it('keeps PASS records', () => {
      expect(passesPreMappingFilters(rawRecord({ filter: 'PASS' }), passOnly)).toBe(true)
    })

    it('keeps records with missing FILTER (.)', () => {
      expect(passesPreMappingFilters(rawRecord({ filter: '.' }), passOnly)).toBe(true)
    })

    it('keeps records with empty FILTER (defensive)', () => {
      expect(passesPreMappingFilters(rawRecord({ filter: '' }), passOnly)).toBe(true)
    })

    it('rejects records with a single failed filter', () => {
      expect(passesPreMappingFilters(rawRecord({ filter: 'LowQual' }), passOnly)).toBe(false)
    })

    it('rejects records with multiple failed filters (semicolon list)', () => {
      expect(passesPreMappingFilters(rawRecord({ filter: 'LowQual;HighStrand' }), passOnly)).toBe(
        false
      )
    })

    it('trims whitespace before comparing', () => {
      expect(passesPreMappingFilters(rawRecord({ filter: '  PASS  ' }), passOnly)).toBe(true)
    })

    it('is disabled when passOnly=false — keeps failing records', () => {
      expect(
        passesPreMappingFilters(rawRecord({ filter: 'LowQual' }), DEFAULT_IMPORT_FILTERS)
      ).toBe(true)
    })
  })

  describe('minQual', () => {
    const minQual20: ImportFilters = { ...DEFAULT_IMPORT_FILTERS, minQual: 20 }

    it('rejects records with QUAL below threshold', () => {
      expect(passesPreMappingFilters(rawRecord({ qual: 10 }), minQual20)).toBe(false)
    })

    it('keeps records with QUAL exactly at threshold', () => {
      expect(passesPreMappingFilters(rawRecord({ qual: 20 }), minQual20)).toBe(true)
    })

    it('keeps records with QUAL above threshold', () => {
      expect(passesPreMappingFilters(rawRecord({ qual: 100 }), minQual20)).toBe(true)
    })

    it('keeps records with null QUAL (SV/CNV behavior — see ImportFilters docstring)', () => {
      // Critical per-type semantic: Sniffles/Spectre/Straglr routinely leave
      // QUAL as "." and would be wiped by a strict comparison.
      expect(passesPreMappingFilters(rawRecord({ qual: null }), minQual20)).toBe(true)
    })
  })

  describe('bedFilter — point queries (SNV / indel)', () => {
    const bed = buildBed([['chr1', 999, 2000]]) // 1-based inclusive [1000, 2000]
    const withBed: ImportFilters = { ...DEFAULT_IMPORT_FILTERS, bedFilter: bed }

    it('keeps SNV inside the BED interval', () => {
      expect(passesPreMappingFilters(rawRecord({ chrom: 'chr1', pos: 1500 }), withBed)).toBe(true)
    })

    it('keeps SNV at the interval left edge', () => {
      expect(passesPreMappingFilters(rawRecord({ chrom: 'chr1', pos: 1000 }), withBed)).toBe(true)
    })

    it('rejects SNV before the interval', () => {
      expect(passesPreMappingFilters(rawRecord({ chrom: 'chr1', pos: 500 }), withBed)).toBe(false)
    })

    it('rejects SNV after the interval', () => {
      expect(passesPreMappingFilters(rawRecord({ chrom: 'chr1', pos: 3000 }), withBed)).toBe(false)
    })

    it('rejects variant on a chromosome that has no BED regions', () => {
      expect(passesPreMappingFilters(rawRecord({ chrom: 'chr22', pos: 1500 }), withBed)).toBe(false)
    })
  })

  describe('bedFilter — range queries (SV / CNV / STR)', () => {
    // BED: chr1:[1000-2000]  AND  chr22:[5_000_000-6_000_000]
    const bed = buildBed([
      ['chr1', 999, 2000],
      ['chr22', 4_999_999, 6_000_000]
    ])
    const withBed: ImportFilters = { ...DEFAULT_IMPORT_FILTERS, bedFilter: bed }

    it('keeps SV that overlaps a BED interval (DEL spanning interval)', () => {
      const del = rawRecord({
        chrom: 'chr1',
        pos: 1200,
        alt: ['<DEL>'],
        info: new Map([
          ['END', '1800'],
          ['SVTYPE', 'DEL']
        ])
      })
      expect(passesPreMappingFilters(del, withBed)).toBe(true)
    })

    it('keeps SV that partially overlaps (start outside, end inside)', () => {
      const del = rawRecord({
        chrom: 'chr1',
        pos: 500,
        alt: ['<DEL>'],
        info: new Map([
          ['END', '1200'],
          ['SVTYPE', 'DEL']
        ])
      })
      expect(passesPreMappingFilters(del, withBed)).toBe(true)
    })

    it('rejects SV that falls entirely outside the BED region', () => {
      const del = rawRecord({
        chrom: 'chr1',
        pos: 3000,
        alt: ['<DEL>'],
        info: new Map([
          ['END', '4000'],
          ['SVTYPE', 'DEL']
        ])
      })
      expect(passesPreMappingFilters(del, withBed)).toBe(false)
    })

    it('keeps CNV that fully contains the BED interval', () => {
      const cnv = rawRecord({
        chrom: 'chr22',
        pos: 4_000_000,
        alt: ['<CNV>'],
        info: new Map([
          ['END', '7_000_000'.replace('_', '')],
          ['SVTYPE', 'CNV']
        ])
      })
      cnv.info.set('END', '7000000')
      expect(passesPreMappingFilters(cnv, withBed)).toBe(true)
    })

    it('keeps STR locus with a valid END that overlaps the BED interval', () => {
      const str = rawRecord({
        chrom: 'chr1',
        pos: 1400,
        alt: ['<STR50>'],
        info: new Map([
          ['END', '1500'],
          ['SVTYPE', 'STR']
        ])
      })
      expect(passesPreMappingFilters(str, withBed)).toBe(true)
    })

    it('BND (breakend) without END uses point check on POS', () => {
      const bnd = rawRecord({
        chrom: 'chr1',
        pos: 1500,
        alt: ['N[chr2:5000['],
        info: new Map([['SVTYPE', 'BND']])
      })
      expect(passesPreMappingFilters(bnd, withBed)).toBe(true) // inside chr1 [1000-2000]
    })

    it('BND without END rejects when POS is outside', () => {
      const bnd = rawRecord({
        chrom: 'chr1',
        pos: 5000,
        alt: ['N[chr2:5000['],
        info: new Map([['SVTYPE', 'BND']])
      })
      expect(passesPreMappingFilters(bnd, withBed)).toBe(false)
    })

    it('malformed END falls back to point check on POS (defensive)', () => {
      const del = rawRecord({
        chrom: 'chr1',
        pos: 1500,
        alt: ['<DEL>'],
        info: new Map([
          ['END', 'not-a-number'],
          ['SVTYPE', 'DEL']
        ])
      })
      // Should fall back to point check on POS=1500, which IS inside [1000, 2000]
      expect(passesPreMappingFilters(del, withBed)).toBe(true)
    })

    it('END < POS (malformed) falls back to point check on POS', () => {
      const del = rawRecord({
        chrom: 'chr1',
        pos: 1500,
        alt: ['<DEL>'],
        info: new Map([
          ['END', '900'],
          ['SVTYPE', 'DEL']
        ])
      })
      expect(passesPreMappingFilters(del, withBed)).toBe(true)
    })
  })

  describe('combined filters — all three must pass', () => {
    const bed = buildBed([['chr1', 999, 2000]])
    const strict: ImportFilters = {
      ...DEFAULT_IMPORT_FILTERS,
      passOnly: true,
      minQual: 30,
      bedFilter: bed
    }

    it('passes when everything is satisfied', () => {
      expect(
        passesPreMappingFilters(
          rawRecord({ chrom: 'chr1', pos: 1500, qual: 50, filter: 'PASS' }),
          strict
        )
      ).toBe(true)
    })

    it('rejects when FILTER fails', () => {
      expect(
        passesPreMappingFilters(
          rawRecord({ chrom: 'chr1', pos: 1500, qual: 50, filter: 'LowQual' }),
          strict
        )
      ).toBe(false)
    })

    it('rejects when QUAL fails', () => {
      expect(
        passesPreMappingFilters(
          rawRecord({ chrom: 'chr1', pos: 1500, qual: 10, filter: 'PASS' }),
          strict
        )
      ).toBe(false)
    })

    it('rejects when BED fails', () => {
      expect(
        passesPreMappingFilters(
          rawRecord({ chrom: 'chr1', pos: 5000, qual: 50, filter: 'PASS' }),
          strict
        )
      ).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Post-mapping tests
// ---------------------------------------------------------------------------

describe('passesPostMappingFilters', () => {
  it('returns true when filters are undefined', () => {
    expect(passesPostMappingFilters(mapped(), undefined)).toBe(true)
  })

  it('returns true for default (no-op) filters', () => {
    expect(passesPostMappingFilters(mapped(), DEFAULT_IMPORT_FILTERS)).toBe(true)
  })

  describe('minGq', () => {
    const minGq20: ImportFilters = { ...DEFAULT_IMPORT_FILTERS, minGq: 20 }

    it('rejects SNV with GQ below threshold', () => {
      expect(passesPostMappingFilters(mapped({ gq: 10 }), minGq20)).toBe(false)
    })

    it('keeps SNV with GQ above threshold', () => {
      expect(passesPostMappingFilters(mapped({ gq: 30 }), minGq20)).toBe(true)
    })

    it('keeps variants with null GQ (SV/CNV/STR pass through — see docstring)', () => {
      // Critical per-type semantic: SVs don't populate FORMAT/GQ, must not
      // be wiped.
      expect(passesPostMappingFilters(mapped({ variant_type: 'sv', gq: null }), minGq20)).toBe(true)
      expect(passesPostMappingFilters(mapped({ variant_type: 'cnv', gq: null }), minGq20)).toBe(
        true
      )
      expect(passesPostMappingFilters(mapped({ variant_type: 'str', gq: null }), minGq20)).toBe(
        true
      )
    })
  })

  describe('minDp', () => {
    const minDp10: ImportFilters = { ...DEFAULT_IMPORT_FILTERS, minDp: 10 }

    it('rejects SNV with DP below threshold', () => {
      expect(passesPostMappingFilters(mapped({ dp: 5 }), minDp10)).toBe(false)
    })

    it('keeps SNV with DP at threshold', () => {
      expect(passesPostMappingFilters(mapped({ dp: 10 }), minDp10)).toBe(true)
    })

    it('keeps variants with null DP (SV/CNV/STR pass through)', () => {
      expect(passesPostMappingFilters(mapped({ variant_type: 'sv', dp: null }), minDp10)).toBe(true)
    })
  })

  describe('combined minGq + minDp', () => {
    const both: ImportFilters = { ...DEFAULT_IMPORT_FILTERS, minGq: 20, minDp: 10 }

    it('rejects when GQ fails', () => {
      expect(passesPostMappingFilters(mapped({ gq: 10, dp: 15 }), both)).toBe(false)
    })

    it('rejects when DP fails', () => {
      expect(passesPostMappingFilters(mapped({ gq: 30, dp: 5 }), both)).toBe(false)
    })

    it('keeps when both pass', () => {
      expect(passesPostMappingFilters(mapped({ gq: 30, dp: 15 }), both)).toBe(true)
    })
  })
})
