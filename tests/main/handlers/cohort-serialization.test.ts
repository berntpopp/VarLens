/**
 * Tests for cohort response serialization via convertBigInts.
 *
 * Verifies that the utility correctly handles the cohort variant result shape,
 * including BigInt conversion, null pass-through, and recursive object handling.
 */

import { describe, it, expect } from 'vitest'
import { convertBigInts } from '../../../src/main/utils/convertBigInts'

describe('convertBigInts — cohort variant result shape', () => {
  it('converts BigInt fields to Number', () => {
    const input = {
      data: [
        {
          chr: '1',
          pos: BigInt(12345),
          ref: 'A',
          alt: 'G',
          carrier_count: BigInt(3),
          total_cases: BigInt(10),
          cohort_frequency: 0.3,
          het_count: BigInt(2),
          hom_count: BigInt(1),
          variant_key: '1-12345-A-G',
          gene_symbol: 'BRCA1',
          consequence: 'HIGH',
          func: 'missense_variant',
          clinvar: 'Pathogenic',
          gnomad_af: 0.0001,
          cadd_phred: 25.5,
          cdna: 'c.123G>A',
          aa_change: 'p.Arg41His',
          transcript: 'ENST00000357654',
          omim_id: '113705'
        }
      ],
      total_count: BigInt(1)
    }

    const result = convertBigInts(input)

    expect(typeof result.total_count).toBe('number')
    expect(result.total_count).toBe(1)

    const row = result.data[0]
    expect(typeof row.pos).toBe('number')
    expect(row.pos).toBe(12345)
    expect(typeof row.carrier_count).toBe('number')
    expect(row.carrier_count).toBe(3)
    expect(typeof row.total_cases).toBe('number')
    expect(row.total_cases).toBe(10)
    expect(typeof row.het_count).toBe('number')
    expect(row.het_count).toBe(2)
    expect(typeof row.hom_count).toBe('number')
    expect(row.hom_count).toBe(1)
  })

  it('passes null values through unchanged', () => {
    const input = {
      data: [
        {
          chr: '1',
          pos: 100,
          ref: 'A',
          alt: 'G',
          carrier_count: 1,
          total_cases: 5,
          cohort_frequency: 0.2,
          het_count: 1,
          hom_count: 0,
          variant_key: '1-100-A-G',
          gene_symbol: null,
          consequence: null,
          func: null,
          clinvar: null,
          gnomad_af: null,
          cadd_phred: null,
          cdna: null,
          aa_change: null,
          transcript: null,
          omim_id: null
        }
      ],
      total_count: 1
    }

    const result = convertBigInts(input)

    const row = result.data[0]
    expect(row.gene_symbol).toBeNull()
    expect(row.consequence).toBeNull()
    expect(row.func).toBeNull()
    expect(row.clinvar).toBeNull()
    expect(row.gnomad_af).toBeNull()
    expect(row.cadd_phred).toBeNull()
    expect(row.cdna).toBeNull()
    expect(row.aa_change).toBeNull()
    expect(row.transcript).toBeNull()
    expect(row.omim_id).toBeNull()
  })

  it('passes string and number values through unchanged', () => {
    const input = {
      data: [
        {
          chr: '1',
          pos: 100,
          ref: 'A',
          alt: 'G',
          carrier_count: 2,
          total_cases: 4,
          cohort_frequency: 0.5,
          het_count: 1,
          hom_count: 1,
          variant_key: '1-100-A-G',
          gene_symbol: 'TP53',
          gnomad_af: 0.0005,
          cadd_phred: 30.1
        }
      ],
      total_count: 1
    }

    const result = convertBigInts(input)

    const row = result.data[0]
    expect(row.chr).toBe('1')
    expect(row.ref).toBe('A')
    expect(row.alt).toBe('G')
    expect(row.variant_key).toBe('1-100-A-G')
    expect(row.gene_symbol).toBe('TP53')
    expect(row.pos).toBe(100)
    expect(row.cohort_frequency).toBe(0.5)
    expect(row.gnomad_af).toBe(0.0005)
    expect(row.cadd_phred).toBe(30.1)
  })

  it('handles empty data array', () => {
    const input = { data: [], total_count: 0 }
    const result = convertBigInts(input)
    expect(result.data).toEqual([])
    expect(result.total_count).toBe(0)
  })

  it('handles nested objects recursively', () => {
    const input = {
      outer: {
        inner: {
          value: BigInt(999)
        },
        count: BigInt(42)
      }
    }

    const result = convertBigInts(input)

    expect(typeof result.outer.inner.value).toBe('number')
    expect(result.outer.inner.value).toBe(999)
    expect(typeof result.outer.count).toBe('number')
    expect(result.outer.count).toBe(42)
  })

  it('handles array of BigInts directly', () => {
    const input = [BigInt(1), BigInt(2), BigInt(3)]
    const result = convertBigInts(input)
    expect(result).toEqual([1, 2, 3])
    result.forEach((v) => expect(typeof v).toBe('number'))
  })

  it('returns primitives unchanged', () => {
    expect(convertBigInts('hello')).toBe('hello')
    expect(convertBigInts(42)).toBe(42)
    expect(convertBigInts(true)).toBe(true)
    expect(convertBigInts(null)).toBeNull()
    expect(convertBigInts(undefined)).toBeUndefined()
  })
})
