/**
 * Tests for RecentDatabasesService - persistence, ordering, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileSync, readFileSync, mkdirSync, rmSync, unlinkSync } from 'fs'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'
import { mainLogger } from '../../../src/main/services/MainLogger'

function tempSettingsPath(): string {
  return join(
    tmpdir(),
    `varlens-test-recent-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  )
}

describe('RecentDatabasesService', () => {
  let settingsPath: string
  let service: RecentDatabasesService

  beforeEach(() => {
    settingsPath = tempSettingsPath()
    service = new RecentDatabasesService(settingsPath)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(settingsPath, { recursive: true, force: true })
  })

  describe('addRecent()', () => {
    it('adds a database to the recent list', () => {
      service.addRecent('/path/to/test.db')
      const recent = service.getRecent()
      expect(recent).toHaveLength(1)
      expect(recent[0].path).toBe('/path/to/test.db')
      expect(recent[0].name).toBe('test.db')
      expect(recent[0].lastOpened).toBeGreaterThan(0)
    })

    it('puts newest entry first', () => {
      service.addRecent('/path/to/first.db')
      service.addRecent('/path/to/second.db')
      const recent = service.getRecent()
      expect(recent).toHaveLength(2)
      expect(recent[0].path).toBe('/path/to/second.db')
      expect(recent[1].path).toBe('/path/to/first.db')
    })

    it('removes duplicate paths and re-adds to front', () => {
      service.addRecent('/path/to/a.db')
      service.addRecent('/path/to/b.db')
      service.addRecent('/path/to/a.db') // Re-add a.db
      const recent = service.getRecent()
      expect(recent).toHaveLength(2)
      expect(recent[0].path).toBe('/path/to/a.db')
      expect(recent[1].path).toBe('/path/to/b.db')
    })

    it('trims list to max size (5)', () => {
      for (let i = 0; i < 7; i++) {
        service.addRecent(`/path/to/db-${i}.db`)
      }
      const recent = service.getRecent()
      expect(recent).toHaveLength(5)
      // Most recent should be last added
      expect(recent[0].path).toBe('/path/to/db-6.db')
    })

    it('persists to disk', () => {
      service.addRecent('/path/to/test.db')

      // Read with a new service instance
      const service2 = new RecentDatabasesService(settingsPath)
      const recent = service2.getRecent()
      expect(recent).toHaveLength(1)
      expect(recent[0].path).toBe('/path/to/test.db')
    })
  })

  describe('getRecent()', () => {
    it('returns empty array when no file exists', () => {
      const recent = service.getRecent()
      expect(recent).toEqual([])
    })

    it('returns empty array when file is invalid JSON', () => {
      writeFileSync(settingsPath, 'not valid json!!!')
      const recent = service.getRecent()
      expect(recent).toEqual([])
    })

    it('returns empty array when file has wrong structure', () => {
      writeFileSync(settingsPath, JSON.stringify({ somethingElse: true }))
      const recent = service.getRecent()
      expect(recent).toEqual([])
    })
  })

  describe('removeRecent()', () => {
    it('removes a specific database from the list', () => {
      service.addRecent('/path/to/a.db')
      service.addRecent('/path/to/b.db')
      service.addRecent('/path/to/c.db')

      service.removeRecent('/path/to/b.db')
      const recent = service.getRecent()
      expect(recent).toHaveLength(2)
      expect(recent.map((r) => r.path)).not.toContain('/path/to/b.db')
    })

    it('does nothing when removing non-existent path', () => {
      service.addRecent('/path/to/a.db')
      service.removeRecent('/path/to/nonexistent.db')
      const recent = service.getRecent()
      expect(recent).toHaveLength(1)
    })
  })

  describe('persistence edge cases', () => {
    it('handles settings file being deleted between operations', () => {
      service.addRecent('/path/to/test.db')
      unlinkSync(settingsPath) // Delete the file
      const recent = service.getRecent()
      expect(recent).toEqual([]) // Should gracefully return empty
    })

    it('writes valid JSON to disk', () => {
      service.addRecent('/path/to/test.db')
      const raw = readFileSync(settingsPath, 'utf-8')
      const data = JSON.parse(raw)
      expect(data.recentDatabases).toBeInstanceOf(Array)
      expect(data.recentDatabases[0]).toHaveProperty('path')
      expect(data.recentDatabases[0]).toHaveProperty('name')
      expect(data.recentDatabases[0]).toHaveProperty('lastOpened')
    })

    it('handles save failure gracefully (does not throw)', () => {
      // A directory cannot be replaced with the settings JSON file on any
      // supported platform, unlike chmod-based tests when running as root.
      mkdirSync(settingsPath)

      // Should not throw even though save will fail
      expect(() => {
        service.addRecent('/path/to/test.db')
      }).not.toThrow()
    })

    it('redacts a sensitive logger error in the non-recursive console fallback', () => {
      mkdirSync(settingsPath)
      vi.spyOn(mainLogger, 'warn').mockImplementation((message) => {
        if (message.startsWith('Failed to save recent databases:')) {
          throw new Error('password: hunter2 for PATIENT-12345')
        }
      })
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      expect(() => service.addRecent('/path/to/test.db')).not.toThrow()

      const fallbackOutput = consoleWarn.mock.calls.flat().map(String).join(' ')
      expect(fallbackOutput).toContain('[REDACTED:KEY]')
      expect(fallbackOutput).toContain('[REDACTED:ID]')
      expect(fallbackOutput).not.toContain('hunter2')
      expect(fallbackOutput).not.toContain('PATIENT-12345')
    })
  })
})
