import { describe, it, expect } from 'vitest'
import {
  detectFilterMode,
  DEFAULT_CATEGORICAL_THRESHOLD,
  COLUMN_FILTER_OVERRIDES
} from '../../../src/renderer/src/config/columnFilterConfig'
import type { ColumnFilterMeta } from '../../../src/shared/types/column-filters'

describe('columnFilterConfig', () => {
  describe('DEFAULT_CATEGORICAL_THRESHOLD', () => {
    it('is 25', () => {
      expect(DEFAULT_CATEGORICAL_THRESHOLD).toBe(25)
    })
  })

  describe('COLUMN_FILTER_OVERRIDES', () => {
    it('forces gene_symbol to text-suggest', () => {
      expect(COLUMN_FILTER_OVERRIDES.gene_symbol?.forceMode).toBe('text-suggest')
    })

    it('forces chr to categorical', () => {
      expect(COLUMN_FILTER_OVERRIDES.chr?.forceMode).toBe('categorical')
    })
  })

  describe('detectFilterMode', () => {
    it('returns forced mode from config override', () => {
      const meta: ColumnFilterMeta = {
        key: 'gene_symbol',
        dataType: 'text',
        distinctCount: 3,
        distinctValues: ['BRCA1', 'TP53', 'EGFR']
      }
      expect(detectFilterMode(meta)).toBe('text-suggest')
    })

    it('returns categorical for forced chr even with many values', () => {
      const meta: ColumnFilterMeta = {
        key: 'chr',
        dataType: 'text',
        distinctCount: 24
      }
      expect(detectFilterMode(meta)).toBe('categorical')
    })

    it('returns numeric for numeric type with many distinct values', () => {
      const meta: ColumnFilterMeta = {
        key: 'cadd',
        dataType: 'numeric',
        distinctCount: 500,
        min: 0,
        max: 42
      }
      expect(detectFilterMode(meta)).toBe('numeric')
    })

    it('returns categorical when distinct count is at threshold', () => {
      const meta: ColumnFilterMeta = {
        key: 'func',
        dataType: 'text',
        distinctCount: 25,
        distinctValues: Array.from({ length: 25 }, (_, i) => `val_${i}`)
      }
      expect(detectFilterMode(meta)).toBe('categorical')
    })

    it('returns categorical when distinct count is below threshold', () => {
      const meta: ColumnFilterMeta = {
        key: 'consequence',
        dataType: 'text',
        distinctCount: 8,
        distinctValues: [
          'missense',
          'stop_gained',
          'frameshift',
          'splice',
          'syn',
          'utr3',
          'utr5',
          'intron'
        ]
      }
      expect(detectFilterMode(meta)).toBe('categorical')
    })

    it('returns text-suggest for text with many distinct values', () => {
      const meta: ColumnFilterMeta = {
        key: 'transcript',
        dataType: 'text',
        distinctCount: 200
      }
      expect(detectFilterMode(meta)).toBe('text-suggest')
    })

    it('returns numeric for numeric type even with few distinct values', () => {
      const meta: ColumnFilterMeta = {
        key: 'some_numeric',
        dataType: 'numeric',
        distinctCount: 5,
        distinctValues: ['10', '20', '30', '40', '50'],
        min: 10,
        max: 50
      }
      expect(detectFilterMode(meta)).toBe('numeric')
    })

    it('respects per-column threshold override', () => {
      const meta: ColumnFilterMeta = {
        key: 'gt_num',
        dataType: 'text',
        distinctCount: 30,
        distinctValues: Array.from({ length: 30 }, (_, i) => `${i}/${i}`)
      }
      // gt_num has threshold override of 50
      expect(detectFilterMode(meta)).toBe('categorical')
    })
  })
})
