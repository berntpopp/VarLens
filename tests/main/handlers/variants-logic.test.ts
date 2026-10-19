/**
 * Variants logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect, vi } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/variants-logic'
import {
  buildVariantFilter,
  getVariantTypeCounts,
  queryVariants,
  searchVariants
} from '../../../src/main/ipc/handlers/variants-logic'

describe('variants-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.buildVariantFilter).toBe('function')
    expect(typeof logic.queryVariants).toBe('function')
    expect(typeof logic.getFilterOptions).toBe('function')
    expect(typeof logic.searchVariants).toBe('function')
    expect(typeof logic.getGeneSymbols).toBe('function')
  })

  it('routes typeCounts through the active storage session read executor', async () => {
    const execute = vi.fn().mockResolvedValue({ snv: 2 })
    const getSession = () => ({ getReadExecutor: () => ({ execute }) }) as never

    await expect(getVariantTypeCounts(1, getSession)).resolves.toStrictEqual({ snv: 2 })
    expect(execute).toHaveBeenCalledWith({ type: 'variants:typeCounts', params: [1] })
  })

  it('routes query through the active storage session read executor', async () => {
    const execute = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
    const getSession = () => ({ getReadExecutor: () => ({ execute }) }) as never

    await queryVariants({ case_id: 1 }, 25, 0, undefined, false, false, getSession)

    expect(execute).toHaveBeenCalledWith({
      type: 'variants:query',
      params: [{ case_id: 1 }, 25, 0, undefined, false, false]
    })
  })

  it('does not call getDb while preparing postgres active panel filters', () => {
    const getDb = vi.fn(() => {
      throw new Error('getDb should not be called for postgres panel rejection')
    })
    const getSession = () =>
      ({
        capabilities: { backend: 'postgres' }
      }) as never

    expect(
      buildVariantFilter(
        1,
        { active_panel_ids: [1], panel_padding_bp: 50 },
        getDb,
        undefined,
        getSession
      )
    ).toMatchObject({
      case_id: 1,
      active_panel_ids: [1],
      panel_padding_bp: 50
    })
    expect(getDb).not.toHaveBeenCalled()
  })

  it('does not call getDb while preparing active panel filters when genome_build is provided', () => {
    const getDb = vi.fn(() => {
      throw new Error('getDb should not be called when genome_build is provided')
    })
    const getDbPool = () => ({}) as never

    expect(
      buildVariantFilter(
        1,
        { active_panel_ids: [1], panel_padding_bp: 50, genome_build: 'GRCh38' },
        getDb,
        getDbPool
      )
    ).toMatchObject({
      case_id: 1,
      active_panel_ids: [1],
      panel_padding_bp: 50,
      genome_build: 'GRCh38'
    })
    expect(getDb).not.toHaveBeenCalled()
  })

  it('does not call getDb while preparing active panel filters when genome_build is omitted and pool is present (#674)', () => {
    const getDb = vi.fn(() => {
      throw new Error('getDb should not be called when pool is present')
    })
    const getDbPool = () => ({}) as never

    const res = buildVariantFilter(
      1,
      { active_panel_ids: [1], panel_padding_bp: 50 },
      getDb,
      getDbPool
    )
    expect(res).toMatchObject({
      case_id: 1,
      active_panel_ids: [1],
      panel_padding_bp: 50
    })
    expect((res as { genome_build?: string }).genome_build).toBeUndefined()
    expect(getDb).not.toHaveBeenCalled()
  })

  it('routes variants:search through the postgres read executor without calling getDb', async () => {
    const execute = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
    const getDb = vi.fn(() => {
      throw new Error('getDb should not be called for postgres search')
    })
    const getSession = () =>
      ({
        capabilities: { backend: 'postgres' },
        getReadExecutor: () => ({ execute })
      }) as never

    await expect(searchVariants(1, 'BRCA1', 20, getSession, getDb)).resolves.toEqual([])
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:search',
      params: [1, 'BRCA1', 20]
    })
    expect(getDb).not.toHaveBeenCalled()
  })
})
