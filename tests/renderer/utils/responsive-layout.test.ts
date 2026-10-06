import { describe, it, expect } from 'vitest'
import {
  clampDetailPanelWidth,
  computeAutoHiddenColumns,
  getMaxAutoVisibleColumns,
  isColumnVisible,
  isDetailPanelDocked
} from '../../../src/renderer/src/utils/responsive-layout'

describe('isDetailPanelDocked', () => {
  it('docks at 1440 px and wider, overlays below', () => {
    expect(isDetailPanelDocked(1439)).toBe(false)
    expect(isDetailPanelDocked(1440)).toBe(true)
    expect(isDetailPanelDocked(2560)).toBe(true)
  })
})

describe('clampDetailPanelWidth', () => {
  it('caps the panel at 45vw on mid-size viewports', () => {
    // 45% of 1024 = 460
    expect(clampDetailPanelWidth(800, 1024)).toBe(460)
    expect(clampDetailPanelWidth(400, 1024)).toBe(400)
  })

  it('caps at 800 px on very wide viewports', () => {
    expect(clampDetailPanelWidth(1200, 2560)).toBe(800)
  })

  it('never goes below the 300 px minimum', () => {
    expect(clampDetailPanelWidth(100, 1920)).toBe(300)
    // 45% of 600 = 270 < min → min wins
    expect(clampDetailPanelWidth(500, 600)).toBe(300)
  })
})

describe('getMaxAutoVisibleColumns', () => {
  it('scales the default column budget with the viewport', () => {
    expect(getMaxAutoVisibleColumns(390)).toBe(5)
    expect(getMaxAutoVisibleColumns(1024)).toBe(10)
    expect(getMaxAutoVisibleColumns(1366)).toBe(14)
    expect(getMaxAutoVisibleColumns(1920)).toBe(Infinity)
  })
})

describe('computeAutoHiddenColumns', () => {
  const caseKeys = [
    'annotations',
    'chr',
    'pos',
    'ref',
    'alt',
    'gt_num',
    'gene_symbol',
    'omim_mim_number',
    'func',
    'consequence',
    'transcript',
    'cdna',
    'aa_change',
    'gnomad_af',
    'cadd',
    'qual',
    'clinvar',
    'hpo_sim_score',
    'moi',
    '_link_varsome',
    '_link_franklin'
  ]

  it('hides nothing when the budget is unlimited', () => {
    expect(computeAutoHiddenColumns(caseKeys, Infinity).size).toBe(0)
  })

  it('keeps clinically critical columns and hides link-outs first', () => {
    const hidden = computeAutoHiddenColumns(caseKeys, 14)
    expect(hidden.has('_link_varsome')).toBe(true)
    expect(hidden.has('_link_franklin')).toBe(true)
    expect(hidden.has('moi')).toBe(true)
    expect(hidden.has('qual')).toBe(true)
    for (const key of ['gene_symbol', 'consequence', 'clinvar', 'gnomad_af', 'cdna', 'aa_change']) {
      expect(hidden.has(key)).toBe(false)
    }
  })

  it('never auto-hides structural columns', () => {
    const hidden = computeAutoHiddenColumns(
      ['data-table-expand', 'annotations', 'chr', 'gene_symbol'],
      1
    )
    expect(hidden.has('annotations')).toBe(false)
    expect(hidden.has('data-table-expand')).toBe(false)
    expect([...hidden]).toEqual(['chr'])
  })

  it('leaves explicit user choices out of the ranking', () => {
    const keys = ['moi', 'gene_symbol', 'clinvar', 'qual', 'cadd']
    const hidden = computeAutoHiddenColumns(keys, 2, { moi: true, clinvar: false })
    // explicit keys are never in the auto-hidden set
    expect(hidden.has('moi')).toBe(false)
    expect(hidden.has('clinvar')).toBe(false)
    // remaining budget of 2 goes to gene_symbol + cadd; qual is auto-hidden
    expect([...hidden]).toEqual(['qual'])
  })

  it('does not hide another column when the user shows one explicitly', () => {
    const keys = ['gene_symbol', 'cadd', 'qual', 'moi']
    const before = computeAutoHiddenColumns(keys, 2)
    const after = computeAutoHiddenColumns(keys, 2, { moi: true })
    expect([...before].sort()).toEqual(['moi', 'qual'])
    expect([...after]).toEqual(['qual'])
  })

  it('maps cohort-only keys onto the same priorities', () => {
    const cohortKeys = [
      'data-table-expand',
      'annotations',
      'chr',
      'pos',
      'gene_symbol',
      'cadd_phred',
      'carrier_count',
      'het_count'
    ]
    const hidden = computeAutoHiddenColumns(cohortKeys, 4)
    expect([...hidden].sort()).toEqual(['carrier_count', 'het_count'])
  })
})

describe('isColumnVisible', () => {
  it('prefers explicit user visibility over the responsive default', () => {
    const autoHidden = new Set(['moi'])
    expect(isColumnVisible('moi', {}, autoHidden)).toBe(false)
    expect(isColumnVisible('moi', { moi: true }, autoHidden)).toBe(true)
    expect(isColumnVisible('gene_symbol', { gene_symbol: false }, autoHidden)).toBe(false)
    expect(isColumnVisible('gene_symbol', {}, autoHidden)).toBe(true)
  })
})
