/**
 * Panels logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect, vi } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/panels-logic'

describe('panels-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.listPanels).toBe('function')
    expect(typeof logic.getPanelWithGenes).toBe('function')
    expect(typeof logic.createPanel).toBe('function')
    expect(typeof logic.updatePanel).toBe('function')
    expect(typeof logic.deletePanel).toBe('function')
    expect(typeof logic.duplicatePanel).toBe('function')
    expect(typeof logic.setGenes).toBe('function')
    expect(typeof logic.getGenes).toBe('function')
    expect(typeof logic.activatePanel).toBe('function')
    expect(typeof logic.deactivatePanel).toBe('function')
    expect(typeof logic.getActivePanelsForCase).toBe('function')
    expect(typeof logic.validateSymbols).toBe('function')
    expect(typeof logic.autocomplete).toBe('function')
    expect(typeof logic.searchPanelApp).toBe('function')
    expect(typeof logic.importPanelApp).toBe('function')
    expect(typeof logic.generateStringDb).toBe('function')
    expect(typeof logic.generateBedContent).toBe('function')
  })

  it('routes listPanels through session read executor', async () => {
    const execute = vi.fn().mockResolvedValue([{ id: 1, name: 'Cardio' }])
    const getSession = () => ({ getReadExecutor: () => ({ execute }) }) as never

    await expect(logic.listPanels(getSession)).resolves.toEqual([{ id: 1, name: 'Cardio' }])
    expect(execute).toHaveBeenCalledWith({ type: 'panels:list', params: [] })
  })

  it('routes getGenes through session read executor', async () => {
    const execute = vi.fn().mockResolvedValue([{ hgncId: 'HGNC:1', symbol: 'TTN' }])
    const getSession = () => ({ getReadExecutor: () => ({ execute }) }) as never

    await expect(logic.getGenes(1, getSession)).resolves.toEqual([
      { hgncId: 'HGNC:1', symbol: 'TTN' }
    ])
    expect(execute).toHaveBeenCalledWith({ type: 'panels:getGenes', params: [1] })
  })

  it('routes getActivePanelsForCase through session read executor', async () => {
    const execute = vi.fn().mockResolvedValue([{ panel_id: 1, padding_bp: 50 }])
    const getSession = () => ({ getReadExecutor: () => ({ execute }) }) as never

    await expect(logic.getActivePanelsForCase(42, getSession)).resolves.toEqual([
      { panel_id: 1, padding_bp: 50 }
    ])
    expect(execute).toHaveBeenCalledWith({ type: 'panels:activeForCase', params: [42] })
  })
})
