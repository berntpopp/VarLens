/**
 * Transcripts logic tests — verifies pure business logic, input validation,
 * and transport-neutral handler factory.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  createTranscriptsHandlers,
  insertAndSwitchTranscript,
  listTranscripts,
  switchTranscript
} from '../../../src/main/ipc/handlers/transcripts-logic'
import { InvalidParametersError } from '../../../src/main/ipc/errors'
import type { TranscriptInsertRow } from '../../../src/shared/types/transcript'
import type { StorageSession } from '../../../src/main/storage/session'

describe('transcripts-logic', () => {
  const sampleTranscript: TranscriptInsertRow = {
    transcript_id: 'NM_000059.4',
    gene_symbol: 'BRCA2',
    consequence: 'HIGH',
    func: 'missense_variant',
    cdna: 'c.1A>G',
    aa_change: 'p.M1V',
    hpo_sim_score: 0.8,
    moi: 'AD',
    is_selected: 0
  }

  describe('listTranscripts', () => {
    it('executes transcripts:list task on storage read executor for valid variantId', async () => {
      const execute = vi.fn().mockResolvedValue([{ transcript_id: 'NM_000059.4' }])
      const session = {
        getReadExecutor: () => ({ execute })
      } as unknown as StorageSession

      const result = await listTranscripts(42, () => session)

      expect(result).toEqual([{ transcript_id: 'NM_000059.4' }])
      expect(execute).toHaveBeenCalledWith({
        type: 'transcripts:list',
        params: [42]
      })
    })

    it('rejects non-numeric or non-positive variantId without touching session', async () => {
      const getSession = vi.fn()

      await expect(listTranscripts('not-a-number', getSession)).rejects.toThrow(
        InvalidParametersError
      )
      await expect(listTranscripts(0, getSession)).rejects.toThrow(InvalidParametersError)
      await expect(listTranscripts(-5, getSession)).rejects.toThrow(InvalidParametersError)
      expect(getSession).not.toHaveBeenCalled()
    })
  })

  describe('switchTranscript', () => {
    it('executes transcripts:switch task on storage write executor for valid inputs', async () => {
      const execute = vi.fn().mockResolvedValue({ success: true })
      const session = {
        getWriteExecutor: () => ({ execute })
      } as unknown as StorageSession

      const result = await switchTranscript(42, 'NM_000059.4', () => session)

      expect(result).toEqual({ success: true })
      expect(execute).toHaveBeenCalledWith({
        type: 'transcripts:switch',
        params: [42, 'NM_000059.4']
      })
    })

    it('rejects invalid inputs without touching session', async () => {
      const getSession = vi.fn()

      await expect(switchTranscript(0, 'NM_000059.4', getSession)).rejects.toThrow(
        InvalidParametersError
      )
      await expect(switchTranscript(42, '', getSession)).rejects.toThrow(InvalidParametersError)
      await expect(switchTranscript(42, null, getSession)).rejects.toThrow(InvalidParametersError)
      expect(getSession).not.toHaveBeenCalled()
    })
  })

  describe('insertAndSwitchTranscript', () => {
    it('executes transcripts:insertAndSwitch task on storage write executor for valid inputs', async () => {
      const execute = vi.fn().mockResolvedValue({ success: true })
      const session = {
        getWriteExecutor: () => ({ execute })
      } as unknown as StorageSession

      const result = await insertAndSwitchTranscript(42, sampleTranscript, () => session)

      expect(result).toEqual({ success: true })
      expect(execute).toHaveBeenCalledWith({
        type: 'transcripts:insertAndSwitch',
        params: [42, sampleTranscript]
      })
    })

    it('rejects invalid consequence or invalid variantId without touching session', async () => {
      const getSession = vi.fn()

      // Invalid consequence (not HIGH / MODERATE / LOW / MODIFIER)
      await expect(
        insertAndSwitchTranscript(
          42,
          { ...sampleTranscript, consequence: 'stop_gained' },
          getSession
        )
      ).rejects.toThrow(InvalidParametersError)

      // Invalid variantId
      await expect(insertAndSwitchTranscript(-1, sampleTranscript, getSession)).rejects.toThrow(
        InvalidParametersError
      )

      // Missing transcript_id
      await expect(
        insertAndSwitchTranscript(42, { ...sampleTranscript, transcript_id: '' }, getSession)
      ).rejects.toThrow(InvalidParametersError)

      expect(getSession).not.toHaveBeenCalled()
    })
  })

  describe('createTranscriptsHandlers factory', () => {
    it('returns domain handlers that dispatch through session', async () => {
      const readExecute = vi.fn().mockResolvedValue([{ transcript_id: 'NM_000059.4' }])
      const writeExecute = vi.fn().mockResolvedValue({ success: true })
      const session = {
        getReadExecutor: () => ({ execute: readExecute }),
        getWriteExecutor: () => ({ execute: writeExecute })
      } as unknown as StorageSession

      const handlers = createTranscriptsHandlers({
        getSession: () => session
      })

      const listResult = await handlers.list(10)
      expect(listResult).toEqual([{ transcript_id: 'NM_000059.4' }])
      expect(readExecute).toHaveBeenCalledWith({
        type: 'transcripts:list',
        params: [10]
      })

      const switchResult = await handlers.switch(10, 'NM_000059.4')
      expect(switchResult).toEqual({ success: true })
      expect(writeExecute).toHaveBeenCalledWith({
        type: 'transcripts:switch',
        params: [10, 'NM_000059.4']
      })

      const insertResult = await handlers.insertAndSwitch(10, sampleTranscript)
      expect(insertResult).toEqual({ success: true })
      expect(writeExecute).toHaveBeenCalledWith({
        type: 'transcripts:insertAndSwitch',
        params: [10, sampleTranscript]
      })
    })
  })
})
