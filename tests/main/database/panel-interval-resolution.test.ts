import { describe, it, expect, vi } from 'vitest'
import {
  resolvePanelIntervalsInPlace,
  type PanelAwareFilter,
  type PanelResolutionRepositories
} from '../../../src/main/database/panel-interval-resolution'
import { NotFoundError } from '../../../src/main/database/errors'
import type { GeneReferenceDb } from '../../../src/main/database/GeneReferenceDb'

describe('resolvePanelIntervalsInPlace (#674)', () => {
  const dummyGeneRefDb = {} as GeneReferenceDb

  it('swallows NotFoundError from getCase and falls back to GRCh38', () => {
    const computeIntervals = vi.fn().mockReturnValue([{ chr: '1', start: 100, end: 200 }])
    const getCase = vi.fn().mockImplementation(() => {
      throw new NotFoundError('Case', 999)
    })
    const repos: PanelResolutionRepositories = {
      panels: { computeIntervals },
      cases: { getCase }
    }
    const filter: PanelAwareFilter = {
      active_panel_ids: [1]
    }

    resolvePanelIntervalsInPlace(filter, repos, dummyGeneRefDb, 999)

    expect(getCase).toHaveBeenCalledWith(999)
    expect(computeIntervals).toHaveBeenCalledWith([1], 'GRCh38', 5000, dummyGeneRefDb)
    expect(filter.panel_intervals).toEqual([{ chr: '1', start: 100, end: 200 }])
  })

  it('rethrows unexpected database errors from getCase', () => {
    const computeIntervals = vi.fn()
    const getCase = vi.fn().mockImplementation(() => {
      throw new Error('Database disk image is malformed')
    })
    const repos: PanelResolutionRepositories = {
      panels: { computeIntervals },
      cases: { getCase }
    }
    const filter: PanelAwareFilter = {
      active_panel_ids: [1]
    }

    expect(() => resolvePanelIntervalsInPlace(filter, repos, dummyGeneRefDb, 999)).toThrow(
      'Database disk image is malformed'
    )
    expect(computeIntervals).not.toHaveBeenCalled()
  })
})
