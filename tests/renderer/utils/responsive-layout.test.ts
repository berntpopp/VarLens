import { describe, it, expect } from 'vitest'
import {
  clampDetailPanelWidth,
  computeAutoHiddenColumns,
  filterDrawerWidth,
  isColumnVisible,
  isDetailPanelDocked
} from '../../../src/renderer/src/utils/responsive-layout'
import { columnWidthRem } from '../../../src/renderer/src/components/variant-table/column-widths'
import {
  COLUMN_PRIORITY,
  MIN_AUTO_VISIBLE_COLUMNS
} from '../../../src/renderer/src/config/columnPriority'

/** Every column 1 rem wide, so a width budget reads as a column count. */
const oneRem = (): number => 1

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

describe('filterDrawerWidth', () => {
  it('goes full width when 40vw is under the 250 px minimum', () => {
    expect(filterDrawerWidth(300, 390)).toBe(390)
    expect(filterDrawerWidth(500, 512)).toBe(512)
  })

  it('caps the preferred width at 40vw, never below 250 px', () => {
    // 40% of 768 = 307, of 1024 = 409
    expect(filterDrawerWidth(500, 768)).toBe(307)
    expect(filterDrawerWidth(260, 768)).toBe(260)
    expect(filterDrawerWidth(500, 1024)).toBe(409)
    expect(filterDrawerWidth(300, 1024)).toBe(300)
    expect(filterDrawerWidth(100, 1024)).toBe(250)
  })

  it('returns the preferred width again once the viewport is wide enough', () => {
    expect(filterDrawerWidth(450, 390)).toBe(390)
    expect(filterDrawerWidth(450, 1920)).toBe(450)
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
    '_links',
    'sv.support'
  ]

  it('hides nothing when the budget is unlimited', () => {
    expect(computeAutoHiddenColumns(caseKeys, Infinity, oneRem).size).toBe(0)
  })

  it('keeps clinically critical columns and hides link-outs first', () => {
    const hidden = computeAutoHiddenColumns(caseKeys, 15, oneRem)
    expect(hidden.has('_links')).toBe(true)
    expect(hidden.has('sv.support')).toBe(true)
    expect(hidden.has('moi')).toBe(true)
    expect(hidden.has('qual')).toBe(true)
    for (const key of ['gene_symbol', 'consequence', 'clinvar', 'gnomad_af', 'cdna', 'aa_change']) {
      expect(hidden.has(key)).toBe(false)
    }
  })

  it('keeps the top-priority locus and triage columns even on a phone', () => {
    const hidden = computeAutoHiddenColumns(caseKeys, 390 / 16, columnWidthRem)
    const shown = caseKeys.filter((key) => key !== 'annotations' && !hidden.has(key))
    expect(shown).toHaveLength(MIN_AUTO_VISIBLE_COLUMNS)
    expect(shown.sort()).toEqual([
      'alt',
      'chr',
      'clinvar',
      'consequence',
      'gene_symbol',
      'pos',
      'ref'
    ])
  })

  it.each([1160, 1440 - 280 - 600, 1920 - 280, 2560])(
    'shown columns always fit a %i px table once past the phone minimum',
    (tablePx) => {
      const availableRem = tablePx / 16
      const hidden = computeAutoHiddenColumns(caseKeys, availableRem, columnWidthRem)
      const shown = caseKeys.filter((key) => !hidden.has(key))
      const usedRem = shown.reduce((sum, key) => sum + columnWidthRem(key), 0)
      // only the phone minimum may overflow; any column beyond it fits whole
      if (usedRem > availableRem) expect(shown.length - 1).toBe(MIN_AUTO_VISIBLE_COLUMNS)
      // nothing hidden outranks something shown (priority order is kept)
      const worstShown = Math.max(
        ...shown.filter((key) => key !== 'annotations').map((key) => COLUMN_PRIORITY[key] ?? 0)
      )
      for (const key of hidden)
        expect(COLUMN_PRIORITY[key] ?? 100).toBeGreaterThanOrEqual(worstShown)
    }
  )

  it('shows gnomAD AF fully at 1440 x 900 next to the sidebar (1160 px table)', () => {
    const hidden = computeAutoHiddenColumns(caseKeys, 1160 / 16, columnWidthRem)
    expect(hidden.has('gnomad_af')).toBe(false)
  })

  it('never auto-hides structural columns', () => {
    const hidden = computeAutoHiddenColumns(['data-table-expand', ...caseKeys], 0, oneRem)
    expect(hidden.has('annotations')).toBe(false)
    expect(hidden.has('data-table-expand')).toBe(false)
  })

  it('leaves explicit user choices out of the ranking', () => {
    // 1 structural + 8 data columns fit; moi and clinvar are explicit
    const hidden = computeAutoHiddenColumns(caseKeys, 9, oneRem, { moi: true, clinvar: false })
    expect(hidden.has('moi')).toBe(false)
    expect(hidden.has('clinvar')).toBe(false)
    // clinvar's slot goes to the next column: gnomad_af and cadd stay, func is hidden
    expect(hidden.has('gnomad_af')).toBe(false)
    expect(hidden.has('cadd')).toBe(false)
    expect(hidden.has('func')).toBe(true)
  })

  it('does not hide another column when the user shows one explicitly', () => {
    const before = computeAutoHiddenColumns(caseKeys, 9, oneRem)
    const after = computeAutoHiddenColumns(caseKeys, 9, oneRem, { moi: true })
    expect([...after].sort()).toEqual([...before].filter((key) => key !== 'moi').sort())
  })

  it('maps cohort-only keys onto the same priorities', () => {
    const cohortKeys = ['data-table-expand', ...caseKeys, 'carrier_count', 'het_count']
    const hidden = computeAutoHiddenColumns(cohortKeys, 14, oneRem)
    // 2 structural + 12 data columns: carriers (priority 12) fits right after gt_num
    expect(hidden.has('carrier_count')).toBe(false)
    expect(hidden.has('aa_change')).toBe(true)
    expect(hidden.has('het_count')).toBe(true)
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
