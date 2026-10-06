/**
 * Re-key through the real session: a WAL database opened by
 * `createSqliteStorageSession`, the real Piscina `db-worker.ts` and the real
 * `write-worker.ts` (both bundled with esbuild). Issue #439.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseError, WrongPasswordError } from '../../../src/main/database/errors'
import { trackDatabaseWorker } from '../../../src/main/services/jobs/database-activity'
import { jobRunner } from '../../../src/main/services/jobs/runner'
import { createSqliteStorageSession } from '../../../src/main/storage/sqlite/createSqliteStorageSession'
import type { SqliteStorageSession } from '../../../src/main/storage/sqlite/SqliteStorageSession'
import { bundleWorker } from '../../utils/bundle-worker'

const OLD_KEY = 'old-password'
const NEW_KEY = "new'password"

function journalMode(session: SqliteStorageSession): string {
  return session.getDatabaseService().database.pragma('journal_mode', { simple: true }) as string
}

function pending(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('SqliteStorageSession.rekey', () => {
  let dbWorkerPath: string
  let writeWorkerPath: string
  let dir: string
  let dbPath: string
  let session: SqliteStorageSession | null

  beforeAll(async () => {
    dbWorkerPath = await bundleWorker('src/main/workers/db-worker.ts')
    writeWorkerPath = await bundleWorker('src/main/workers/write-worker.ts')
  }, 60_000)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-session-rekey-'))
    dbPath = join(dir, 'rekey.db')
    session = null
  })

  afterEach(async () => {
    await session?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function open(options: { writeWorkerPath?: string } = {}): SqliteStorageSession {
    session = createSqliteStorageSession(dbPath, OLD_KEY, { dbWorkerPath, ...options })
    session.getDatabaseService().cases.createCase('case-a', '/path/a.vcf', 1)
    return session
  }

  async function closeSession(): Promise<void> {
    await session?.close()
    session = null
  }

  it('re-keys a WAL database and hands out the new key afterwards', async () => {
    const current = open()
    expect(journalMode(current)).toBe('wal')

    await current.rekey(NEW_KEY)

    expect(current.getEncryptionKey()).toBe(NEW_KEY)
    expect(journalMode(current)).toBe('wal')
    expect(current.getDatabaseService().cases.getAllCases()).toHaveLength(1)

    await closeSession()
    expect(() => createSqliteStorageSession(dbPath, OLD_KEY, { dbWorkerPath })).toThrow(
      WrongPasswordError
    )
    session = createSqliteStorageSession(dbPath, NEW_KEY, { dbWorkerPath })
    expect(session.getDatabaseService().cases.getAllCases()).toHaveLength(1)
  })

  it('serves pool reads with the new key after a re-key', async () => {
    const current = open()
    // Spawn a pool worker holding a connection keyed with the OLD password.
    expect(await current.listCases()).toHaveLength(1)

    await current.rekey(NEW_KEY)

    expect((await current.listCases()).map((c) => c.name)).toEqual(['case-a'])
  })

  it('holds reads issued during the re-key instead of failing them', async () => {
    const current = open()
    await current.listCases()

    const rekeyed = current.rekey(NEW_KEY)
    const during = current.listCases()

    await rekeyed
    expect(await during).toHaveLength(1)
  })

  it('stops the writer thread for the re-key and respawns it with the new key', async () => {
    const current = open({ writeWorkerPath })
    const writer = current.getWriteExecutor()
    await writer.execute({ type: 'tags:create', params: ['before', '#ff0000'] })

    await current.rekey(NEW_KEY)
    await writer.execute({ type: 'tags:create', params: ['after', '#00ff00'] })

    const names = current
      .getDatabaseService()
      .tags.listTags()
      .map((t) => t.name)
    expect(names.sort()).toEqual(['after', 'before'])
  })

  it('refuses to re-key while a tracked job (delete/import/export) is running', async () => {
    const current = open()
    const gate = pending()
    const job = jobRunner.enqueue('case_delete', {}, () => gate.promise)

    try {
      await expect(current.rekey(NEW_KEY)).rejects.toThrow(DatabaseError)
      await expect(current.rekey(NEW_KEY)).rejects.toThrow(/in progress/i)
      expect(current.getEncryptionKey()).toBe(OLD_KEY)
    } finally {
      gate.release()
      await job.result
    }

    await current.rekey(NEW_KEY)
    expect(current.getEncryptionKey()).toBe(NEW_KEY)
  })

  it('refuses to re-key while a summary rebuild worker is running', async () => {
    const current = open()
    const gate = pending()
    const rebuild = trackDatabaseWorker('cohort summary rebuild', gate.promise)

    try {
      await expect(current.rekey(NEW_KEY)).rejects.toThrow(/cohort summary rebuild/)
      expect(current.getEncryptionKey()).toBe(OLD_KEY)
    } finally {
      gate.release()
      await rebuild
    }
  })

  it('keeps the old key, WAL mode and a working pool when the re-key fails', async () => {
    const current = open()
    await current.listCases()
    // A foreign connection makes leaving WAL mode impossible (SQLITE_BUSY).
    const blocker = new Database(dbPath)
    blocker.pragma(`key='${OLD_KEY}'`)
    blocker.prepare('SELECT count(*) FROM sqlite_master').get()

    try {
      await expect(current.rekey(NEW_KEY)).rejects.toThrow(DatabaseError)
    } finally {
      blocker.close()
    }

    expect(current.getEncryptionKey()).toBe(OLD_KEY)
    expect(journalMode(current)).toBe('wal')
    expect(await current.listCases()).toHaveLength(1)

    await closeSession()
    session = createSqliteStorageSession(dbPath, OLD_KEY, { dbWorkerPath })
    expect(session.getDatabaseService().cases.getAllCases()).toHaveLength(1)
  })

  it('refuses an empty password: re-key never removes encryption', async () => {
    const current = open()

    await expect(current.rekey('')).rejects.toThrow(/password must not be empty/i)

    expect(current.workspace.encrypted).toBe(true)
    expect(current.getEncryptionKey()).toBe(OLD_KEY)
    expect(await current.listCases()).toHaveLength(1)
    await closeSession()
    // Still encrypted with the old key on disk.
    const plain = new Database(dbPath)
    try {
      expect(() => plain.prepare('SELECT count(*) FROM sqlite_master').get()).toThrow()
    } finally {
      plain.close()
    }
    session = createSqliteStorageSession(dbPath, OLD_KEY, { dbWorkerPath })
    expect(session.getDatabaseService().cases.getAllCases()).toHaveLength(1)
  })

  it('reports the workspace as encrypted after a plaintext database is given a password', async () => {
    session = createSqliteStorageSession(dbPath, undefined, { dbWorkerPath })
    session.getDatabaseService().cases.createCase('case-a', '/path/a.vcf', 1)
    expect(session.workspace.encrypted).toBe(false)

    await session.rekey(NEW_KEY)

    expect(session.workspace.encrypted).toBe(true)
    expect(session.getDatabaseService().isEncrypted()).toBe(true)
    await closeSession()
    session = createSqliteStorageSession(dbPath, NEW_KEY, { dbWorkerPath })
    expect(session.workspace.encrypted).toBe(true)
    expect(session.getDatabaseService().cases.getAllCases()).toHaveLength(1)
  })
})
