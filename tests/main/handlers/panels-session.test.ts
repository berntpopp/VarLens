import { describe, expect, it, vi } from 'vitest'

import {
  generateBedContentForSession,
  generateStringDbForSession,
  importPanelAppForSession
} from '../../../src/main/ipc/handlers/panels-session'
import type { GeneReferenceDb } from '../../../src/main/database/GeneReferenceDb'
import type { StorageSession } from '../../../src/main/storage/session'
import type { PanelAppClient } from '../../../src/main/services/api/PanelAppClient'
import type { StringDbClient } from '../../../src/main/services/api/StringDbClient'

function createSession(writeExecute = vi.fn(), readExecute = vi.fn()): StorageSession {
  return {
    getWriteExecutor: () => ({ execute: writeExecute }),
    getReadExecutor: () => ({ execute: readExecute })
  } as unknown as StorageSession
}

describe('panels session helpers', () => {
  it('imports a PanelApp panel through storage session executors', async () => {
    const writeExecute = vi
      .fn()
      .mockResolvedValueOnce({ id: 7, name: 'Inherited cancer' })
      .mockResolvedValueOnce(undefined)
    const readExecute = vi.fn().mockResolvedValueOnce([{ hgnc_id: 'HGNC:1100', symbol: 'BRCA1' }])
    const geneRef = {
      validateSymbols: vi.fn().mockReturnValue([
        {
          status: 'approved',
          hgncId: 'HGNC:1100',
          symbol: 'BRCA1'
        }
      ])
    } as unknown as GeneReferenceDb
    const client = {
      getPanel: vi.fn().mockResolvedValue({
        name: 'Inherited cancer',
        version: '1.2',
        genes: [
          { confidence_level: '3', gene_data: { gene_symbol: 'BRCA1' } },
          { confidence_level: '1', gene_data: { gene_symbol: 'LOWCONF' } }
        ]
      })
    } as unknown as PanelAppClient
    const callbacks = { clearPanelIntervalCache: vi.fn() }

    const result = await importPanelAppForSession(
      createSession(writeExecute, readExecute),
      { panelId: 42, region: 'uk', confidenceThreshold: 'green' },
      geneRef,
      client,
      callbacks
    )

    expect(client.getPanel).toHaveBeenCalledWith(42, 'uk')
    expect(geneRef.validateSymbols).toHaveBeenCalledWith(['BRCA1'])
    expect(writeExecute).toHaveBeenNthCalledWith(1, {
      type: 'panels:create',
      params: [
        expect.objectContaining({
          name: 'Inherited cancer (PanelApp UK)',
          version: '1.2',
          source: 'panelapp_uk',
          sourceId: '42',
          sourceMetadata: expect.objectContaining({
            total_genes: 2,
            filtered_genes: 1,
            resolved_genes: 1
          })
        })
      ]
    })
    expect(writeExecute).toHaveBeenNthCalledWith(2, {
      type: 'panels:setGenes',
      params: [7, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }]]
    })
    expect(readExecute).toHaveBeenCalledWith({ type: 'panels:getGenes', params: [7] })
    expect(callbacks.clearPanelIntervalCache).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      id: 7,
      name: 'Inherited cancer',
      genes: [{ hgnc_id: 'HGNC:1100', symbol: 'BRCA1' }]
    })
  })

  it('generates a StringDB panel through storage session executors', async () => {
    const writeExecute = vi
      .fn()
      .mockResolvedValueOnce({ id: 9, name: 'Custom network' })
      .mockResolvedValueOnce(undefined)
    const readExecute = vi.fn().mockResolvedValueOnce([
      { hgnc_id: 'HGNC:1100', symbol: 'BRCA1' },
      { hgnc_id: 'HGNC:1101', symbol: 'BRCA2' }
    ])
    const geneRef = {
      validateSymbols: vi.fn().mockReturnValue([
        { status: 'approved', hgncId: 'HGNC:1100', symbol: 'BRCA1' },
        { status: 'alias', hgncId: 'HGNC:1101', currentSymbol: 'BRCA2' },
        { status: 'approved', hgncId: 'HGNC:1100', symbol: 'BRCA1' }
      ])
    } as unknown as GeneReferenceDb
    const client = {
      getInteractionPartners: vi.fn().mockResolvedValue([{ symbol: 'BRCA2' }])
    } as unknown as StringDbClient
    const callbacks = { clearPanelIntervalCache: vi.fn() }

    const result = await generateStringDbForSession(
      createSession(writeExecute, readExecute),
      {
        seedGenes: ['BRCA1'],
        requiredScore: 700,
        networkType: 'physical',
        name: 'Custom network'
      },
      geneRef,
      client,
      callbacks
    )

    expect(client.getInteractionPartners).toHaveBeenCalledWith(['BRCA1'], {
      requiredScore: 700,
      networkType: 'physical'
    })
    expect(geneRef.validateSymbols).toHaveBeenCalledWith(['BRCA1', 'BRCA2'])
    expect(writeExecute).toHaveBeenNthCalledWith(1, {
      type: 'panels:create',
      params: [
        expect.objectContaining({
          name: 'Custom network',
          source: 'stringdb',
          sourceMetadata: expect.objectContaining({
            seed_genes: ['BRCA1'],
            score_threshold: 700,
            network_type: 'physical',
            partners_found: 1
          })
        })
      ]
    })
    expect(writeExecute).toHaveBeenNthCalledWith(2, {
      type: 'panels:setGenes',
      params: [
        9,
        [
          { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
          { hgncId: 'HGNC:1101', symbol: 'BRCA2' }
        ]
      ]
    })
    expect(readExecute).toHaveBeenCalledWith({ type: 'panels:getGenes', params: [9] })
    expect(callbacks.clearPanelIntervalCache).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      id: 9,
      name: 'Custom network',
      genes: [
        { hgnc_id: 'HGNC:1100', symbol: 'BRCA1' },
        { hgnc_id: 'HGNC:1101', symbol: 'BRCA2' }
      ]
    })
  })

  it('generates BED content from storage session reads', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ id: 1, name: 'Cancer Panel' })
      .mockResolvedValueOnce([{ hgnc_id: 'HGNC:1100', symbol: 'BRCA1' }])

    const geneRef = {
      getCoordinatesForGenes: vi.fn().mockReturnValue(
        new Map([
          [
            'HGNC:1100',
            {
              chromosome: '17',
              start_pos: 43044295,
              end_pos: 43125483
            }
          ]
        ])
      )
    } as unknown as GeneReferenceDb

    const result = await generateBedContentForSession(
      createSession(vi.fn(), execute),
      1,
      'GRCh38',
      100,
      geneRef
    )

    expect(execute).toHaveBeenNthCalledWith(1, { type: 'panels:get', params: [1] })
    expect(execute).toHaveBeenNthCalledWith(2, { type: 'panels:getGenes', params: [1] })
    expect(geneRef.getCoordinatesForGenes).toHaveBeenCalledWith(['HGNC:1100'], 'GRCh38')
    expect(result).toEqual({
      lines: [
        'track name="Cancer Panel" description="Gene panel: Cancer Panel"',
        'chr17\t43044194\t43125583\tBRCA1'
      ],
      panelName: 'Cancer Panel',
      geneCount: 1
    })
  })
})
