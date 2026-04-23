import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir !== null) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('DatabaseManager storage-session compatibility', () => {
  it('exposes the current storage session while preserving DatabaseService compatibility', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-manager-'))
    const settingsPath = join(tempDir, 'settings.json')
    const dbPath = join(tempDir, 'test.db')
    const manager = new DatabaseManager(new RecentDatabasesService(settingsPath))

    await manager.open(dbPath)

    const session = manager.getCurrentSession()
    expect(session.workspace.kind).toBe('sqlite')
    expect(session.workspace.path).toBe(dbPath)

    const current = manager.getCurrent()
    expect(current.getPath()).toBe(dbPath)

    await manager.close()
  })
})
