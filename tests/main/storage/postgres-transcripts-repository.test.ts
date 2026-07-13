import { describe, expect, it, vi } from 'vitest'

import { PostgresTranscriptsRepository } from '../../../src/main/storage/postgres/PostgresTranscriptsRepository'

describe('PostgresTranscriptsRepository', () => {
  it('maps integer transcript flags to desktop boolean fields', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '1',
            variant_id: '9',
            transcript_id: 'NM_000059.4',
            gene_symbol: 'BRCA2',
            consequence: 'HIGH',
            func: 'stop_gained',
            cdna: null,
            aa_change: null,
            hpo_sim_score: null,
            moi: null,
            is_selected: 1,
            is_mane_select: 0,
            is_canonical: null
          }
        ]
      })
    }
    const repository = new PostgresTranscriptsRepository(pool as never, 'case_schema')

    await expect(repository.list(9)).resolves.toEqual([
      {
        id: 1,
        variant_id: 9,
        transcript_id: 'NM_000059.4',
        gene_symbol: 'BRCA2',
        consequence: 'HIGH',
        func: 'stop_gained',
        cdna: null,
        aa_change: null,
        hpo_sim_score: null,
        moi: null,
        is_selected: true,
        is_mane_select: false,
        is_canonical: null
      }
    ])
  })

  it('maps pg-style string transcript flags to desktop boolean fields', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '2',
            variant_id: '9',
            transcript_id: 'NM_007294.4',
            gene_symbol: 'BRCA1',
            consequence: 'MODERATE',
            func: 'missense_variant',
            cdna: null,
            aa_change: null,
            hpo_sim_score: null,
            moi: null,
            is_selected: 't',
            is_mane_select: '1',
            is_canonical: 'false'
          }
        ]
      })
    }
    const repository = new PostgresTranscriptsRepository(pool as never, 'case_schema')

    await expect(repository.list(9)).resolves.toEqual([
      {
        id: 2,
        variant_id: 9,
        transcript_id: 'NM_007294.4',
        gene_symbol: 'BRCA1',
        consequence: 'MODERATE',
        func: 'missense_variant',
        cdna: null,
        aa_change: null,
        hpo_sim_score: null,
        moi: null,
        is_selected: true,
        is_mane_select: true,
        is_canonical: false
      }
    ])
  })

  it('updates the parent variant when switching the selected transcript', async () => {
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            transcript_id: 'NM_000059.4',
            gene_symbol: 'BRCA2',
            consequence: 'HIGH',
            func: 'stop_gained',
            cdna: 'c.1A>G',
            aa_change: 'p.M1V',
            hpo_sim_score: 0.8,
            moi: 'AD'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const pool = {
      connect: vi.fn(async () => ({ query, release }))
    }
    const repository = new PostgresTranscriptsRepository(pool as never, 'case_schema')

    await expect(repository.switchSelectedTranscript(9, 'NM_000059.4')).resolves.toEqual({
      success: true
    })

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('RETURNING'), [
      9,
      'NM_000059.4'
    ])
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('UPDATE "case_schema".variants'),
      [9, 'NM_000059.4', 'BRCA2', 'HIGH', 'stop_gained', 'c.1A>G', 'p.M1V', 0.8, 'AD']
    )
    expect(query).toHaveBeenNthCalledWith(5, 'COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })

  it('clears the parent impact when the selected transcript impact is unavailable', async () => {
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            transcript_id: 'NM_LEGACY.1',
            gene_symbol: 'LEGACY',
            consequence: null,
            func: 'stop_gained',
            cdna: null,
            aa_change: null,
            hpo_sim_score: null,
            moi: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const pool = { connect: vi.fn(async () => ({ query, release })) }
    const repository = new PostgresTranscriptsRepository(pool as never, 'case_schema')

    await repository.switchSelectedTranscript(9, 'NM_LEGACY.1')

    const updateSql = query.mock.calls[3][0] as string
    expect(updateSql).toContain('consequence = $4')
    expect(updateSql).not.toContain('COALESCE($4, consequence)')
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('UPDATE "case_schema".variants'),
      [9, 'NM_LEGACY.1', 'LEGACY', null, 'stop_gained', null, null, null, null]
    )
  })

  it('inserts missing transcripts without overwriting existing rows and then switches selection', async () => {
    const transcript = {
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
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            transcript_id: 'NM_000059.4',
            gene_symbol: 'BRCA2',
            consequence: 'HIGH',
            func: 'missense_variant',
            cdna: 'c.1A>G',
            aa_change: 'p.M1V',
            hpo_sim_score: 0.8,
            moi: 'AD'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const pool = {
      connect: vi.fn(async () => ({ query, release }))
    }
    const repository = new PostgresTranscriptsRepository(pool as never, 'case_schema')

    await expect(repository.insertTranscriptAndSwitch(9, transcript)).resolves.toEqual({
      success: true
    })

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ON CONFLICT (variant_id, transcript_id)\n         DO NOTHING'),
      [9, 'NM_000059.4', 'BRCA2', 'HIGH', 'missense_variant', 'c.1A>G', 'p.M1V', 0.8, 'AD']
    )
    expect(query).toHaveBeenNthCalledWith(
      3,
      'UPDATE "case_schema".variant_transcripts SET is_selected = 0 WHERE variant_id = $1',
      [9]
    )
    expect(query).toHaveBeenNthCalledWith(4, expect.stringContaining('RETURNING'), [
      9,
      'NM_000059.4'
    ])
    expect(query).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('UPDATE "case_schema".variants'),
      [9, 'NM_000059.4', 'BRCA2', 'HIGH', 'missense_variant', 'c.1A>G', 'p.M1V', 0.8, 'AD']
    )
    expect(query).toHaveBeenNthCalledWith(6, 'COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })
})
