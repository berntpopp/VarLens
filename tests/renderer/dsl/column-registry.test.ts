import { describe, it, expect } from 'vitest'
import {
  FILTER_COLUMNS,
  findColumn,
  getOperatorsForColumn,
  getCommonValues
} from '../../../src/renderer/src/dsl/column-registry'

describe('column-registry', () => {
  describe('FILTER_COLUMNS', () => {
    it('has entries for all sortable database columns', () => {
      // Must match all keys from SORTABLE_COLUMNS in VariantRepository.ts
      const requiredKeys = [
        'gnomad_af',
        'cadd',
        'gene_symbol',
        'consequence',
        'clinvar',
        'func',
        'qual',
        'hpo_sim_score',
        'pos',
        'chr',
        'gt_num',
        'moi',
        'transcript',
        'cdna',
        'aa_change',
        'omim_mim_number'
      ]
      for (const key of requiredKeys) {
        expect(FILTER_COLUMNS.find((c) => c.key === key)).toBeDefined()
      }
    })

    it('each column has a non-empty label', () => {
      for (const col of FILTER_COLUMNS) {
        expect(col.label.length).toBeGreaterThan(0)
      }
    })

    it('each column has at least one operator', () => {
      for (const col of FILTER_COLUMNS) {
        expect(col.operators.length).toBeGreaterThan(0)
      }
    })

    it('numeric columns have numeric operators', () => {
      const numeric = FILTER_COLUMNS.filter((c) => c.type === 'numeric')
      for (const col of numeric) {
        expect(col.operators).toContain('<')
        expect(col.operators).toContain('>')
      }
    })

    it('all columns have at least = and != operators', () => {
      for (const col of FILTER_COLUMNS) {
        expect(col.operators).toContain('=')
        expect(col.operators).toContain('!=')
      }
    })
  })

  describe('findColumn', () => {
    it('finds by exact key', () => {
      expect(findColumn('gnomad_af')?.key).toBe('gnomad_af')
    })

    it('finds by alias', () => {
      expect(findColumn('af')?.key).toBe('gnomad_af')
      expect(findColumn('gene')?.key).toBe('gene_symbol')
    })

    it('is case-insensitive', () => {
      expect(findColumn('CADD')?.key).toBe('cadd')
      expect(findColumn('Gene')?.key).toBe('gene_symbol')
    })

    it('returns undefined for unknown column', () => {
      expect(findColumn('nonexistent')).toBeUndefined()
    })
  })

  describe('getOperatorsForColumn', () => {
    it('returns numeric operators for gnomad_af', () => {
      const ops = getOperatorsForColumn('gnomad_af')
      expect(ops).toContain('<')
      expect(ops).toContain('>=')
      expect(ops).not.toContain('~')
    })

    it('returns text operators for gene_symbol', () => {
      const ops = getOperatorsForColumn('gene_symbol')
      expect(ops).toContain('~')
      expect(ops).toContain('=')
    })

    it('returns empty array for unknown column', () => {
      expect(getOperatorsForColumn('unknown')).toEqual([])
    })
  })

  describe('getCommonValues', () => {
    it('returns AF thresholds for gnomad_af', () => {
      const vals = getCommonValues('gnomad_af')
      expect(vals.length).toBeGreaterThan(0)
      expect(vals.some((v) => v.value === 0.01)).toBe(true)
    })

    it('returns CADD thresholds for cadd', () => {
      const vals = getCommonValues('cadd')
      expect(vals.some((v) => v.value === 15)).toBe(true)
    })

    it('returns empty for columns without common values', () => {
      expect(getCommonValues('chr')).toEqual([])
    })
  })
})
