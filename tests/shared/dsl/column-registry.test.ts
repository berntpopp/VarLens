import { describe, it, expect } from 'vitest'
import {
  FILTER_COLUMNS,
  HPO_DERIVED_COLUMNS,
  SHORTLIST_DERIVED_COLUMNS,
  findColumn,
  getColumnSuggestions,
  getOperatorsForColumn,
  getCommonValues
} from '../../../src/shared/dsl/column-registry'

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

    it('resolves impact to the impact-level column, not the SO term', () => {
      expect(findColumn('impact')?.key).toBe('consequence')
      expect(findColumn('consequence')?.key).toBe('consequence')
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

describe('CNV/STR locus fields (spec 2026-10-14-hpo-cnv-str-scoring §6.1)', () => {
  const keys = ['hpo_best_locus', 'cnv_gene_count', 'str_band']

  it('are case-only, shortlist-only derived fields, absent from the cohort and case views', () => {
    for (const key of keys) {
      expect(findColumn(key)).toMatchObject({ caseOnly: true, shortlistOnly: true })
      expect(SHORTLIST_DERIVED_COLUMNS).toContain(key)
      for (const scope of ['cohort', 'case'] as const) {
        expect(getColumnSuggestions('', scope).map((c) => c.key)).not.toContain(key)
      }
      expect(getColumnSuggestions('', 'shortlist').map((c) => c.key)).toContain(key)
    }
  })

  it('only hpo_best_locus loads the HPO scorer', () => {
    expect(HPO_DERIVED_COLUMNS).toContain('hpo_best_locus')
    expect(HPO_DERIVED_COLUMNS).not.toContain('cnv_gene_count')
    expect(HPO_DERIVED_COLUMNS).not.toContain('str_band')
  })
})
