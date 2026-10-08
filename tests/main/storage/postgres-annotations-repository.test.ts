import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InvalidParametersError } from '../../../src/main/ipc/errors'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresAnnotationsRepository } from '../../../src/main/storage/postgres/PostgresAnnotationsRepository'

const makePool = () => ({
  query: vi.fn()
})

/**
 * The summary write lock an annotation write takes right after BEGIN (#503) is
 * free in these tests; answering it here keeps it out of the scripted replies.
 */
const summaryLockFree =
  (query: (...args: unknown[]) => unknown) =>
  (...args: unknown[]): unknown =>
    String(args[0]).includes('pg_try_advisory_xact_lock')
      ? Promise.resolve({ rows: [{ locked: true }] })
      : query(...args)

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe('PostgresAnnotationsRepository', () => {
  it('gets global annotations by coordinates and normalizes returned values', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: '7',
          chr: '1',
          pos: '12345',
          ref: 'A',
          alt: 'G',
          global_comment: 'reviewed',
          starred: true,
          acmg_classification: 'Pathogenic',
          acmg_evidence: null,
          created_at: '1714060800000',
          updated_at: '1714060801000'
        }
      ]
    })
    const repository = new PostgresAnnotationsRepository(pool, 'tenant"schema')

    await expect(repository.getGlobalAnnotation('1', 12345, 'A', 'G')).resolves.toStrictEqual({
      id: 7,
      chr: '1',
      pos: 12345,
      ref: 'A',
      alt: 'G',
      global_comment: 'reviewed',
      starred: 1,
      acmg_classification: 'Pathogenic',
      acmg_evidence: null,
      created_at: 1714060800000,
      updated_at: 1714060801000
    })
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('"tenant""schema"."variant_annotations"'),
      ['1', 12345, 'A', 'G']
    )
  })

  it('upserts global annotations with only supported fields', async () => {
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 8,
            chr: '1',
            pos: 12345,
            ref: 'A',
            alt: 'G',
            global_comment: null,
            starred: 1,
            acmg_classification: 'Likely benign',
            acmg_evidence: 'PM2',
            created_at: 1714060800000,
            updated_at: 1714060801000
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // flag write-hook
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const pool = {
      connect: vi.fn(async () => ({ query: summaryLockFree(query), release }))
    }
    const repository = new PostgresAnnotationsRepository(pool as never, 'public')

    await repository.upsertGlobalAnnotation('1', 12345, 'A', 'G', {
      global_comment: null,
      starred: 1,
      acmg_classification: 'Likely benign',
      acmg_evidence: 'PM2',
      unsupported_field: 'ignored'
    } as never)

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN')
    const spec = query.mock.calls[1][0] as { text: string; values: unknown[] }
    const sql = spec.text
    const params = spec.values
    expect(sql).toContain('ON CONFLICT (chr, pos, ref, alt) DO UPDATE')
    expect(sql).toContain('"public"."variant_annotations"')
    expect(sql).not.toContain('unsupported_field')
    expect(params).toStrictEqual([
      '1',
      12345,
      'A',
      'G',
      null,
      1,
      'Likely benign',
      'PM2',
      true,
      true,
      true,
      true
    ])
    // The global annotation-flag write-hook runs in the same transaction.
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        name: expect.stringContaining('cohort_summary:annotation_flags_global:v1'),
        values: ['1', 12345, 'A', 'G']
      })
    )
    expect(query).toHaveBeenNthCalledWith(4, 'COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })

  it('upserts global annotations and audit entries in one transaction', async () => {
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 8,
            chr: '1',
            pos: 12345,
            ref: 'A',
            alt: 'G',
            global_comment: null,
            starred: 0,
            acmg_classification: 'VUS',
            acmg_evidence: null,
            created_at: 1714060800000,
            updated_at: 1714060801000
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 8,
            chr: '1',
            pos: 12345,
            ref: 'A',
            alt: 'G',
            global_comment: null,
            starred: 1,
            acmg_classification: 'Pathogenic',
            acmg_evidence: null,
            created_at: 1714060800000,
            updated_at: 1714060802000
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
    const pool = {
      connect: vi.fn(async () => ({ query: summaryLockFree(query), release }))
    }
    const repository = new PostgresAnnotationsRepository(pool as never, 'public')

    await expect(
      repository.upsertGlobalAnnotationWithAudit('1', 12345, 'A', 'G', {
        starred: 1,
        acmg_classification: 'Pathogenic',
        user_name: 'analyst'
      })
    ).resolves.toMatchObject({ starred: 1, acmg_classification: 'Pathogenic' })

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('INSERT INTO varlens_audit."audit_log"'),
      [
        'public',
        'acmg_classify',
        'variant_annotation',
        '1:12345:A:G',
        JSON.stringify({ acmg_classification: 'VUS' }),
        JSON.stringify({ acmg_classification: 'Pathogenic' }),
        'analyst',
        null
      ]
    )
    // The annotation-flag write-hook runs inside the same transaction, just
    // before COMMIT (C5a).
    expect(query).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({
        name: expect.stringContaining('cohort_summary:annotation_flags_global:v1'),
        values: ['1', 12345, 'A', 'G']
      })
    )
    expect(query).toHaveBeenNthCalledWith(7, 'COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })

  it('rolls back audited global annotation writes when audit append fails', async () => {
    const release = vi.fn()
    const failure = new Error('audit append failed')
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 8,
            chr: '1',
            pos: 12345,
            ref: 'A',
            alt: 'G',
            global_comment: null,
            starred: 1,
            acmg_classification: null,
            acmg_evidence: null,
            created_at: 1714060800000,
            updated_at: 1714060802000
          }
        ]
      })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ rows: [] })
    const pool = {
      connect: vi.fn(async () => ({ query: summaryLockFree(query), release }))
    }
    const repository = new PostgresAnnotationsRepository(pool as never, 'public')

    await expect(
      repository.upsertGlobalAnnotationWithAudit('1', 12345, 'A', 'G', {
        starred: true,
        user_name: 'analyst'
      })
    ).rejects.toThrow('audit append failed')

    expect(query).toHaveBeenNthCalledWith(5, 'ROLLBACK')
    expect(release).toHaveBeenCalledOnce()
  })

  it('preserves the original audited global annotation failure when rollback fails', async () => {
    const release = vi.fn()
    const failure = new Error('audit append failed')
    const rollbackFailure = new Error('rollback failed')
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 8,
            chr: '1',
            pos: 12345,
            ref: 'A',
            alt: 'G',
            global_comment: null,
            starred: 1,
            acmg_classification: null,
            acmg_evidence: null,
            created_at: 1714060800000,
            updated_at: 1714060802000
          }
        ]
      })
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(rollbackFailure)
    const pool = {
      connect: vi.fn(async () => ({ query: summaryLockFree(query), release }))
    }
    const repository = new PostgresAnnotationsRepository(pool as never, 'public')

    await expect(
      repository.upsertGlobalAnnotationWithAudit('1', 12345, 'A', 'G', {
        starred: true,
        user_name: 'analyst'
      })
    ).rejects.toThrow('audit append failed')

    expect(query).toHaveBeenNthCalledWith(5, 'ROLLBACK')
    expect(release).toHaveBeenCalledOnce()
  })

  it.each([
    ['upsertGlobalAnnotation', (r) => r.upsertGlobalAnnotation('1', 5, 'A', 'G', { starred: 1 })],
    [
      'upsertGlobalAnnotationWithAudit',
      (r) => r.upsertGlobalAnnotationWithAudit('1', 5, 'A', 'G', { starred: 1 })
    ],
    ['deleteGlobalAnnotation', (r) => r.deleteGlobalAnnotation('1', 5, 'A', 'G')],
    ['upsertPerCaseAnnotation', (r) => r.upsertPerCaseAnnotation(1, 2, { starred: 1 })],
    [
      'upsertPerCaseAnnotationWithAudit',
      (r) => r.upsertPerCaseAnnotationWithAudit(1, 2, { starred: 1 })
    ],
    ['deletePerCaseAnnotation', (r) => r.deletePerCaseAnnotation(1, 2)]
  ] as [string, (repository: PostgresAnnotationsRepository) => Promise<unknown>][])(
    '%s: a failed rollback destroys the connection, which still holds the summary lock',
    async (_name, write) => {
      const release = vi.fn()
      const rollbackFailure = new Error('rollback failed')
      const query = vi.fn(async (sql: unknown) => {
        if (sql === 'BEGIN') return { rows: [] }
        if (sql === 'ROLLBACK') throw rollbackFailure
        throw new Error('write failed')
      })
      const pool = { connect: vi.fn(async () => ({ query: summaryLockFree(query), release })) }

      await expect(
        write(new PostgresAnnotationsRepository(pool as never, 'public'))
      ).rejects.toThrow('write failed')

      expect(release).toHaveBeenCalledExactlyOnceWith(rollbackFailure)
    }
  )

  it('deletes global annotations by coordinates', async () => {
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // DELETE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // flag write-hook
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const pool = {
      connect: vi.fn(async () => ({ query: summaryLockFree(query), release }))
    }
    const repository = new PostgresAnnotationsRepository(pool as never, 'public')

    await repository.deleteGlobalAnnotation('1', 12345, 'A', 'G')

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: expect.stringContaining('DELETE FROM "public"."variant_annotations"'),
        values: ['1', 12345, 'A', 'G']
      })
    )
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        name: expect.stringContaining('cohort_summary:annotation_flags_global:v1')
      })
    )
    expect(query).toHaveBeenNthCalledWith(4, 'COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })

  it('gets per-case annotations by case and variant id', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: '9',
          case_id: '2',
          variant_id: '3',
          per_case_comment: 'case note',
          starred: '0',
          acmg_classification: null,
          acmg_evidence: '{"notes":"case"}',
          created_at: '1714060800000',
          updated_at: '1714060801000'
        }
      ]
    })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await expect(repository.getPerCaseAnnotation(2, 3)).resolves.toMatchObject({
      id: 9,
      case_id: 2,
      variant_id: 3,
      per_case_comment: 'case note',
      starred: 0,
      acmg_evidence: '{"notes":"case"}'
    })
  })

  it('upserts per-case annotations inside a transaction with the flag write-hook', async () => {
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: '10',
            case_id: '2',
            variant_id: '3',
            per_case_comment: 'updated',
            starred: false,
            acmg_classification: null,
            acmg_evidence: null,
            created_at: '1714060800000',
            updated_at: '1714060802000'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ target_resolved: 1 }] }) // flag write-hook
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const pool = {
      connect: vi.fn(async () => ({ query: summaryLockFree(query), release }))
    }
    const repository = new PostgresAnnotationsRepository(pool as never, 'public')

    await expect(
      repository.upsertPerCaseAnnotation(2, 3, { per_case_comment: 'updated', starred: 0 })
    ).resolves.toMatchObject({
      id: 10,
      case_id: 2,
      variant_id: 3,
      per_case_comment: 'updated',
      starred: 0
    })

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN')
    const upsertSpec = query.mock.calls[1][0] as { text: string; values: unknown[] }
    expect(upsertSpec.text).toContain('ON CONFLICT (case_id, variant_id) DO UPDATE')
    expect(upsertSpec.text).toContain('"public"."case_variant_annotations"')
    expect(upsertSpec.values).toStrictEqual([
      2,
      3,
      'updated',
      0,
      null,
      null,
      true,
      true,
      false,
      false
    ])
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        name: expect.stringContaining('cohort_summary:annotation_flags_per_case:v2'),
        values: [2, 3]
      })
    )
    expect(query).toHaveBeenNthCalledWith(4, 'COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })

  it('upserts per-case annotations and audit entries in one transaction', async () => {
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 9,
            case_id: 2,
            variant_id: 3,
            per_case_comment: null,
            starred: 0,
            acmg_classification: 'Benign',
            acmg_evidence: null,
            created_at: 1714060800000,
            updated_at: 1714060801000
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 9,
            case_id: 2,
            variant_id: 3,
            per_case_comment: null,
            starred: 0,
            acmg_classification: 'Likely pathogenic',
            acmg_evidence: null,
            created_at: 1714060800000,
            updated_at: 1714060802000
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ target_resolved: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
    const pool = {
      connect: vi.fn(async () => ({ query: summaryLockFree(query), release }))
    }
    const repository = new PostgresAnnotationsRepository(pool as never, 'public')

    await expect(
      repository.upsertPerCaseAnnotationWithAudit(2, 3, {
        acmg_classification: 'Likely pathogenic',
        user_name: 'reviewer'
      })
    ).resolves.toMatchObject({ acmg_classification: 'Likely pathogenic' })

    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('INSERT INTO varlens_audit."audit_log"'),
      [
        'public',
        'acmg_classify',
        'case_variant_annotation',
        'case:2:variant:3',
        JSON.stringify({ acmg_classification: 'Benign' }),
        JSON.stringify({ acmg_classification: 'Likely pathogenic' }),
        'reviewer',
        null
      ]
    )
    // The per-case annotation-flag write-hook runs just before COMMIT (C5a).
    expect(query).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        name: expect.stringContaining('cohort_summary:annotation_flags_per_case:v2'),
        values: [2, 3]
      })
    )
    expect(query).toHaveBeenNthCalledWith(6, 'COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })

  it('preserves the original audited per-case annotation failure when rollback fails', async () => {
    const release = vi.fn()
    const failure = new Error('audit append failed')
    const rollbackFailure = new Error('rollback failed')
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 9,
            case_id: 2,
            variant_id: 3,
            per_case_comment: null,
            starred: 1,
            acmg_classification: null,
            acmg_evidence: null,
            created_at: 1714060800000,
            updated_at: 1714060802000
          }
        ]
      })
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(rollbackFailure)
    const pool = {
      connect: vi.fn(async () => ({ query: summaryLockFree(query), release }))
    }
    const repository = new PostgresAnnotationsRepository(pool as never, 'public')

    await expect(
      repository.upsertPerCaseAnnotationWithAudit(2, 3, {
        starred: true,
        user_name: 'reviewer'
      })
    ).rejects.toThrow('audit append failed')

    expect(query).toHaveBeenNthCalledWith(5, 'ROLLBACK')
    expect(release).toHaveBeenCalledOnce()
  })

  it('deletes per-case annotations by case and variant id', async () => {
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // DELETE
      .mockResolvedValueOnce({ rows: [{ target_resolved: 1 }] }) // flag write-hook
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const pool = {
      connect: vi.fn(async () => ({ query: summaryLockFree(query), release }))
    }
    const repository = new PostgresAnnotationsRepository(pool as never, 'public')

    await repository.deletePerCaseAnnotation(2, 3)

    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: expect.stringContaining('DELETE FROM "public"."case_variant_annotations"'),
        values: [2, 3]
      })
    )
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        name: expect.stringContaining('cohort_summary:annotation_flags_per_case:v2'),
        values: [2, 3]
      })
    )
    expect(query).toHaveBeenNthCalledWith(4, 'COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })

  it('gets global and per-case annotations for a case variant', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '3' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '4',
            chr: '1',
            pos: '12345',
            ref: 'A',
            alt: 'G',
            global_comment: 'global',
            starred: '1',
            acmg_classification: null,
            acmg_evidence: null,
            created_at: '1714060800000',
            updated_at: '1714060801000'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '5',
            case_id: '2',
            variant_id: '3',
            per_case_comment: 'case',
            starred: '0',
            acmg_classification: null,
            acmg_evidence: null,
            created_at: '1714060800000',
            updated_at: '1714060801000'
          }
        ]
      })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await expect(repository.getAnnotationsForVariant(2, '1', 12345, 'A', 'G')).resolves.toEqual({
      global: expect.objectContaining({ id: 4, starred: 1 }),
      perCase: expect.objectContaining({ id: 5, variant_id: 3, starred: 0 })
    })
    expect(pool.query.mock.calls[0]).toEqual([
      expect.stringContaining('FROM "public"."variants"'),
      [2, '1', 12345, 'A', 'G']
    ])
  })

  it('batch gets annotations keyed by variant coordinate', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: '4',
            chr: '1',
            pos: '12345',
            ref: 'A',
            alt: 'G',
            global_comment: 'global',
            starred: '1',
            acmg_classification: null,
            acmg_evidence: null,
            created_at: '1714060800000',
            updated_at: '1714060801000'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            key_chr: '1',
            key_pos: '12345',
            key_ref: 'A',
            key_alt: 'G',
            id: '5',
            case_id: '2',
            variant_id: '3',
            per_case_comment: 'case',
            starred: false,
            acmg_classification: null,
            acmg_evidence: null,
            created_at: '1714060800000',
            updated_at: '1714060801000'
          }
        ]
      })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await expect(
      repository.getBatch(2, [
        { chr: '1', pos: 12345, ref: 'A', alt: 'G' },
        { chr: '2', pos: 23456, ref: 'C', alt: 'T' }
      ])
    ).resolves.toStrictEqual({
      '1:12345:A:G': {
        global: expect.objectContaining({ id: 4, starred: 1 }),
        perCase: expect.objectContaining({ id: 5, starred: 0 })
      },
      '2:23456:C:T': {
        global: null,
        perCase: null
      }
    })
    expect(pool.query).toHaveBeenCalledTimes(2)
  })

  it('returns null batch per-case annotations when case id is null', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await expect(
      repository.getBatch(null, [{ chr: '1', pos: 12345, ref: 'A', alt: 'G' }])
    ).resolves.toStrictEqual({
      '1:12345:A:G': { global: null, perCase: null }
    })
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('rolls back the annotation mutation when the flag write-hook fails (Pass-5 MED #3)', async () => {
    const release = vi.fn()
    const hookFailure = new Error('flag write-hook exploded')
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 8,
            chr: '1',
            pos: 12345,
            ref: 'A',
            alt: 'G',
            global_comment: null,
            starred: 1,
            acmg_classification: null,
            acmg_evidence: null,
            created_at: 1714060800000,
            updated_at: 1714060801000
          }
        ]
      }) // upsert RETURNING
      .mockRejectedValueOnce(hookFailure) // flag write-hook throws
      .mockResolvedValueOnce({ rows: [] }) // ROLLBACK
    const pool = {
      connect: vi.fn(async () => ({ query: summaryLockFree(query), release }))
    }
    const repository = new PostgresAnnotationsRepository(pool as never, 'public')

    await expect(
      repository.upsertGlobalAnnotation('1', 12345, 'A', 'G', { starred: 1 })
    ).rejects.toThrow('flag write-hook exploded')

    // The mutation never COMMITs — the transaction is rolled back instead.
    expect(query).toHaveBeenNthCalledWith(4, 'ROLLBACK')
    expect(query).not.toHaveBeenCalledWith('COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })
})

interface SeedVariant {
  caseId: number
  chr: string
  pos: number
  ref: string
  alt: string
  variantType?: string
  gtNum?: string | null
}

describe.skipIf(!RUN)('annotation-flag write-hooks — Sprint A C5a', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const now = Date.now()

  beforeEach(async () => {
    schema = `varlens_test_anno_flags_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function seedCase(name: string, genomeBuild = 'GRCh38'): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [name, `/tmp/${name}.json`, now, genomeBuild]
    )
    return res.rows[0].id
  }

  async function seedVariant(v: SeedVariant): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gt_num)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [v.caseId, v.chr, v.pos, v.ref, v.alt, v.variantType ?? 'snv', v.gtNum ?? null]
    )
    return res.rows[0].id
  }

  async function seedSummaryRow(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    genomeBuild = 'GRCh38'
  ): Promise<void> {
    await probe.query(
      `INSERT INTO "${schema}".cohort_variant_summary
         (chr, pos, ref, alt, variant_type, genome_build, carrier_count)
         VALUES ($1, $2, $3, $4, 'snv', $5, 1)`,
      [chr, pos, ref, alt, genomeBuild]
    )
  }

  it('global upsert flips has_star on every matching cohort_variant_summary row', async () => {
    // Two summary rows at the same coordinate but different genome_build — a
    // global star annotation has no build scope, so both must flip.
    await seedSummaryRow('1', 100, 'A', 'T', 'GRCh38')
    await seedSummaryRow('1', 100, 'A', 'T', 'GRCh37')

    const repo = new PostgresAnnotationsRepository(pool, schema)
    await repo.upsertGlobalAnnotation('1', 100, 'A', 'T', { starred: 1 })

    const rows = await probe.query<{ genome_build: string; has_star: boolean }>(
      `SELECT genome_build, has_star FROM "${schema}".cohort_variant_summary
         WHERE chr = '1' AND pos = 100 AND ref = 'A' AND alt = 'T'`
    )
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.every((r) => r.has_star === true)).toBe(true)
  }, 60_000)

  it('per-case upsert with mismatched (caseId, variantId) throws InvalidParametersError (Pass-7 LOW #6)', async () => {
    const caseA = await seedCase('case-a')
    const caseB = await seedCase('case-b')
    // variantOfB belongs to caseB; calling with caseA must reject the spoof.
    const variantOfB = await seedVariant({
      caseId: caseB,
      chr: '2',
      pos: 200,
      ref: 'C',
      alt: 'G',
      gtNum: '0/1'
    })
    await seedSummaryRow('2', 200, 'C', 'G')

    const repo = new PostgresAnnotationsRepository(pool, schema)
    await expect(
      repo.upsertPerCaseAnnotation(caseA, variantOfB, { starred: 1 })
    ).rejects.toBeInstanceOf(InvalidParametersError)

    // The spoofed pair must not have touched the summary row.
    const after = await probe.query<{ has_star: boolean }>(
      `SELECT has_star FROM "${schema}".cohort_variant_summary
         WHERE chr = '2' AND pos = 200 AND ref = 'C' AND alt = 'G'`
    )
    expect(after.rows[0].has_star).toBe(false)
  }, 60_000)

  it('per-case upsert for a valid variant with no summary row yet is a benign no-op (PR3-7 MAJOR #3)', async () => {
    // Valid (caseId, variantId): the variant belongs to caseA. There is NO
    // cohort_variant_summary row at its coordinate (summary unbuilt/stale).
    // The hook must resolve the target, update zero summary rows, and NOT throw
    // InvalidParametersError — that error is reserved for an unresolved variant.
    const caseA = await seedCase('case-a')
    const variantOfA = await seedVariant({
      caseId: caseA,
      chr: '4',
      pos: 400,
      ref: 'T',
      alt: 'C',
      gtNum: '0/1'
    })
    // Deliberately do NOT seed a cohort_variant_summary row at (4, 400, T, C).

    const repo = new PostgresAnnotationsRepository(pool, schema)
    await expect(
      repo.upsertPerCaseAnnotation(caseA, variantOfA, { starred: 1 })
    ).resolves.toBeDefined()

    // The annotation itself persisted (the write-hook did not roll it back).
    const annotation = await probe.query<{ starred: number }>(
      `SELECT starred FROM "${schema}".case_variant_annotations
         WHERE case_id = $1 AND variant_id = $2`,
      [caseA, variantOfA]
    )
    expect(annotation.rows).toHaveLength(1)
    expect(Number(annotation.rows[0].starred)).toBe(1)

    // No summary row was conjured into existence.
    const summary = await probe.query(
      `SELECT 1 FROM "${schema}".cohort_variant_summary
         WHERE chr = '4' AND pos = 400 AND ref = 'T' AND alt = 'C'`
    )
    expect(summary.rows).toHaveLength(0)
  }, 60_000)

  it('on-delete variant excludes the deleted case from EXISTS subquery (Pass-5 HIGH #1)', async () => {
    const caseA = await seedCase('case-a')
    const caseB = await seedCase('case-b')
    // Both cases carry the same coordinate. Only caseA stars it.
    const vA = await seedVariant({
      caseId: caseA,
      chr: '3',
      pos: 300,
      ref: 'G',
      alt: 'A',
      gtNum: '0/1'
    })
    await seedVariant({ caseId: caseB, chr: '3', pos: 300, ref: 'G', alt: 'A', gtNum: '0/1' })
    await probe.query(
      `INSERT INTO "${schema}".case_variant_annotations
         (case_id, variant_id, starred, created_at, updated_at)
         VALUES ($1, $2, 1, $3, $3)`,
      [caseA, vA, now]
    )
    // Summary row currently reflects the star.
    await probe.query(
      `INSERT INTO "${schema}".cohort_variant_summary
         (chr, pos, ref, alt, variant_type, genome_build, carrier_count, has_star)
         VALUES ('3', 300, 'G', 'A', 'snv', 'GRCh38', 2, true)`
    )

    // The on-case-delete hook is invoked by C3 across the class boundary; call
    // it directly here to verify its exclusion semantics.
    const repo = new PostgresAnnotationsRepository(pool, schema)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await repo._applyAnnotationFlagsOnCaseDelete(client, { schema, deletedCaseId: caseA })
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    // caseA is the only star source; excluding it clears has_star.
    const after = await probe.query<{ has_star: boolean }>(
      `SELECT has_star FROM "${schema}".cohort_variant_summary
         WHERE chr = '3' AND pos = 300 AND ref = 'G' AND alt = 'A'`
    )
    expect(after.rows[0].has_star).toBe(false)
  }, 60_000)
})
