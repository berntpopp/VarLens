import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createKysely } from '../../../src/main/database/kysely'
import { GeneListRepository } from '../../../src/main/database/GeneListRepository'
import { DecompressedSizeExceededError } from '../../../src/main/import/stream-utils'

describe('GeneListRepository BED streaming', () => {
  let db: InstanceType<typeof Database>
  let repo: GeneListRepository
  let tempDir: string

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    repo = new GeneListRepository(db, createKysely(db))
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-sqlite-bed-'))
  })

  afterEach(() => {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('streams BED entries into one atomic replacement with exact metadata', async () => {
    const regionFile = repo.createRegionFile('Capture', null)
    const bedPath = join(tempDir, 'capture.bed')
    writeFileSync(bedPath, 'chr1\t0\t10\tA\nchr2\t5\t9\n')

    await expect(repo.importBedFile(regionFile.id, bedPath)).resolves.toMatchObject({
      region_count: 2,
      total_bases: 14
    })
    expect(
      db
        .prepare(
          'SELECT chr, start_pos, end_pos, label FROM region_file_entries WHERE region_file_id = ? ORDER BY id'
        )
        .all(regionFile.id)
    ).toEqual([
      { chr: 'chr1', start_pos: 0, end_pos: 10, label: 'A' },
      { chr: 'chr2', start_pos: 5, end_pos: 9, label: null }
    ])
  })

  it('rolls back deletion and inserts when a strict stream encounters a malformed row', async () => {
    const regionFile = repo.createRegionFile('Capture', null)
    const originalPath = join(tempDir, 'original.bed')
    writeFileSync(originalPath, 'chr1\t0\t10\toriginal\n')
    await repo.importBedFile(regionFile.id, originalPath)

    const malformedPath = join(tempDir, 'malformed.bed')
    writeFileSync(malformedPath, 'chr2\t20\t30\tnew\nchr2\tbad\t40\n')
    await expect(
      repo.importBedFile(regionFile.id, malformedPath, { rejectMalformedRows: true })
    ).rejects.toThrow(/invalid bed row/i)

    expect(
      db
        .prepare(
          'SELECT chr, start_pos, end_pos, label FROM region_file_entries WHERE region_file_id = ?'
        )
        .all(regionFile.id)
    ).toEqual([{ chr: 'chr1', start_pos: 0, end_pos: 10, label: 'original' }])
    expect(repo.listRegionFiles()).toEqual([
      expect.objectContaining({ id: regionFile.id, region_count: 1, total_bases: 10 })
    ])
  })

  it('preserves prior rows when the streamed file exceeds the decompressed-byte cap', async () => {
    const regionFile = repo.createRegionFile('Capture', null)
    const originalPath = join(tempDir, 'original.bed')
    writeFileSync(originalPath, 'chr1\t0\t10\toriginal\n')
    await repo.importBedFile(regionFile.id, originalPath)

    const bombPath = join(tempDir, 'bomb.bed.gz')
    writeFileSync(bombPath, gzipSync(Buffer.from('chr2\t0\t10\n'.repeat(1_000))))
    const previousMaxBytes = process.env.VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES
    process.env.VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES = '100'
    try {
      await expect(repo.importBedFile(regionFile.id, bombPath)).rejects.toThrow(
        DecompressedSizeExceededError
      )
    } finally {
      if (previousMaxBytes === undefined) delete process.env.VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES
      else process.env.VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES = previousMaxBytes
    }

    expect(
      db
        .prepare(
          'SELECT chr, start_pos, end_pos, label FROM region_file_entries WHERE region_file_id = ?'
        )
        .all(regionFile.id)
    ).toEqual([{ chr: 'chr1', start_pos: 0, end_pos: 10, label: 'original' }])
  })

  it('allows concurrent streams while keeping each final replacement atomic', async () => {
    const first = repo.createRegionFile('First', null)
    const second = repo.createRegionFile('Second', null)
    const firstPath = join(tempDir, 'first.bed')
    const secondPath = join(tempDir, 'second.bed')
    writeFileSync(firstPath, 'chr1\t0\t10\nchr1\t20\t30\n')
    writeFileSync(secondPath, 'chr2\t5\t9\n')

    await expect(
      Promise.all([
        repo.importBedFile(first.id, firstPath),
        repo.importBedFile(second.id, secondPath)
      ])
    ).resolves.toEqual([
      expect.objectContaining({ id: first.id, region_count: 2, total_bases: 20 }),
      expect.objectContaining({ id: second.id, region_count: 1, total_bases: 4 })
    ])
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'region_file_import_%'"
        )
        .all()
    ).toEqual([])
  })
})
