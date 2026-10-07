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
      .mockResolvedValueOnce({ rows: [] }) // summary write lock: taken
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
      // The row's gene changes: it is moved in the per-gene cohort aggregates.
      .mockResolvedValueOnce({ rows: [{ changes: true }] })
      .mockResolvedValue({ rows: [] })
    const pool = {
      connect: vi.fn(async () => ({ query, release }))
    }
    const repository = new PostgresTranscriptsRepository(pool as never, 'case_schema')

    await expect(repository.switchSelectedTranscript(9, 'NM_000059.4')).resolves.toEqual({
      success: true
    })

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(query).toHaveBeenNthCalledWith(4, expect.stringContaining('RETURNING'), [
      9,
      'NM_000059.4'
    ])
    expect(query).toHaveBeenNthCalledWith(5, expect.stringContaining('IS DISTINCT FROM'), [
      9,
      'BRCA2'
    ])
    expect(query).toHaveBeenNthCalledWith(6, 'SET LOCAL lock_timeout = 0')
    expect(query).toHaveBeenNthCalledWith(7, expect.stringContaining('pg_try_advisory_xact_lock'), [
      'case_schema'
    ])
    // Subtract the row under its old gene, update it, add it under the new one.
    expect(query).toHaveBeenNthCalledWith(
      8,
      expect.stringContaining('UPDATE "case_schema"."cohort_gene_summary"'),
      [9]
    )
    expect(query).toHaveBeenNthCalledWith(
      10,
      expect.stringContaining('UPDATE "case_schema".variants'),
      // … and the impact rank that goes with the stored impact (#469).
      [9, 'NM_000059.4', 'BRCA2', 'HIGH', 'stop_gained', 'c.1A>G', 'p.M1V', 0.8, 'AD', 4]
    )
    expect(query).toHaveBeenNthCalledWith(
      11,
      expect.stringContaining('INSERT INTO "case_schema"."cohort_gene_summary"'),
      [9]
    )
    // The coordinate's cohort summary row takes the new representative annotation.
    expect(query).toHaveBeenNthCalledWith(
      12,
      expect.stringContaining('UPDATE "case_schema"."cohort_variant_summary"'),
      [9]
    )
    expect(query).toHaveBeenNthCalledWith(13, 'COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })

  it('clears the parent impact when the selected transcript impact is unavailable', async () => {
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // summary write lock: taken
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
      .mockResolvedValueOnce({ rows: [{ changes: false }] })
      .mockResolvedValue({ rows: [] })
    const pool = { connect: vi.fn(async () => ({ query, release })) }
    const repository = new PostgresTranscriptsRepository(pool as never, 'case_schema')

    await repository.switchSelectedTranscript(9, 'NM_LEGACY.1')

    const updateSql = query.mock.calls[5][0] as string
    expect(updateSql).toContain('consequence = $4')
    expect(updateSql).not.toContain('COALESCE($4, consequence)')
    expect(query).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining('UPDATE "case_schema".variants'),
      [9, 'NM_LEGACY.1', 'LEGACY', null, 'stop_gained', null, null, null, null, 0]
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
      .mockResolvedValueOnce({ rows: [] }) // summary write lock: taken
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
      .mockResolvedValueOnce({ rows: [{ changes: false }] })
      .mockResolvedValue({ rows: [] })
    const pool = {
      connect: vi.fn(async () => ({ query, release }))
    }
    const repository = new PostgresTranscriptsRepository(pool as never, 'case_schema')

    await expect(repository.insertTranscriptAndSwitch(9, transcript)).resolves.toEqual({
      success: true
    })

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('ON CONFLICT (variant_id, transcript_id)\n         DO NOTHING'),
      [9, 'NM_000059.4', 'BRCA2', 'HIGH', 'missense_variant', 'c.1A>G', 'p.M1V', 0.8, 'AD']
    )
    expect(query).toHaveBeenNthCalledWith(
      4,
      'UPDATE "case_schema".variant_transcripts SET is_selected = 0 WHERE variant_id = $1',
      [9]
    )
    expect(query).toHaveBeenNthCalledWith(5, expect.stringContaining('RETURNING'), [
      9,
      'NM_000059.4'
    ])
    // The gene does not change, so the per-gene aggregates are left alone.
    expect(query).toHaveBeenNthCalledWith(6, expect.stringContaining('IS DISTINCT FROM'), [
      9,
      'BRCA2'
    ])
    // The summary row is still maintained, under the summary write lock taken
    // first, before any row is touched (#461).
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('pg_try_advisory_xact_lock'), [
      'case_schema'
    ])
    expect(query).toHaveBeenNthCalledWith(
      7,
      expect.stringContaining('UPDATE "case_schema".variants'),
      [9, 'NM_000059.4', 'BRCA2', 'HIGH', 'missense_variant', 'c.1A>G', 'p.M1V', 0.8, 'AD', 4]
    )
    expect(query).toHaveBeenNthCalledWith(
      8,
      expect.stringContaining('UPDATE "case_schema"."cohort_variant_summary"'),
      [9]
    )
    expect(query).toHaveBeenNthCalledWith(9, 'COMMIT')
    expect(query.mock.calls.some(([sql]) => String(sql).includes('"cohort_gene_summary"'))).toBe(
      false
    )
    expect(release).toHaveBeenCalledOnce()
  })
  it('commits the switch and requests a rebuild when the summary write lock stays busy', async () => {
    const release = vi.fn()
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: false }] }
      if (sql.includes('RETURNING')) {
        return { rows: [{ transcript_id: 'NM_1.1', gene_symbol: 'GENE2', consequence: 'HIGH' }] }
      }
      return { rows: [] }
    })
    const repository = new PostgresTranscriptsRepository(
      { connect: vi.fn(async () => ({ query, release })) } as never,
      'case_schema',
      { summaryLockWaitMs: 0 }
    )

    await expect(repository.switchSelectedTranscript(9, 'NM_1.1')).resolves.toEqual({
      success: true
    })

    const sql = query.mock.calls.map(([text]) => String(text))
    // The lock is asked for before any row is locked.
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('pg_try_advisory_xact_lock')
    expect(sql.some((text) => text.includes('UPDATE "case_schema".variants'))).toBe(true)
    // No derived table is written without the lock …
    expect(sql.some((text) => text.includes('"cohort_gene_summary"'))).toBe(false)
    expect(sql.some((text) => text.includes('UPDATE "case_schema"."cohort_variant_summary"'))).toBe(
      false
    )
    expect(sql.some((text) => text.includes('"cohort_summary_state"'))).toBe(false)
    // … a rebuild is requested instead, for a visible variant only.
    const request = query.mock.calls.find(([text]) =>
      String(text).includes('INSERT INTO "case_schema"."cohort_summary_rebuild_requests"')
    )
    expect(request?.[1]).toEqual([9, 'transcript_switch_variant_9'])
    expect(String(request?.[0])).toContain('WHERE EXISTS (SELECT 1 FROM "case_schema"."variants"')
    expect(sql.at(-1)).toBe('COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })
})
