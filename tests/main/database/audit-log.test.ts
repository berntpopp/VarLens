import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import { AuditLogRepository } from '../../../src/main/database/AuditLogRepository'
import { createKysely } from '../../../src/main/database/kysely'

describe('AuditLogRepository', () => {
  let service: DatabaseService
  let repo: AuditLogRepository

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    repo = new AuditLogRepository(service.database, createKysely(service.database))
  })

  afterEach(() => {
    service.close()
  })

  describe('appendEntry', () => {
    it('inserts an audit log entry', () => {
      const entry = repo.appendEntry({
        action_type: 'acmg_classify',
        entity_type: 'variant_annotation',
        entity_key: 'chr1:12345:A:T',
        old_value: null,
        new_value: JSON.stringify({ acmg_classification: 'Pathogenic' }),
        user_name: 'test_user'
      })

      expect(entry.id).toBeGreaterThan(0)
      expect(entry.action_type).toBe('acmg_classify')
      expect(entry.entity_key).toBe('chr1:12345:A:T')
      expect(entry.timestamp).toBeGreaterThan(0)
    })
  })

  describe('getByEntityKey', () => {
    it('returns entries for a specific entity key in chronological order', () => {
      repo.appendEntry({
        action_type: 'star',
        entity_type: 'variant_annotation',
        entity_key: 'chr1:100:A:T',
        old_value: null,
        new_value: JSON.stringify({ starred: 1 }),
        user_name: null
      })
      repo.appendEntry({
        action_type: 'acmg_classify',
        entity_type: 'variant_annotation',
        entity_key: 'chr1:100:A:T',
        old_value: null,
        new_value: JSON.stringify({ acmg_classification: 'VUS' }),
        user_name: null
      })
      // Different entity
      repo.appendEntry({
        action_type: 'star',
        entity_type: 'variant_annotation',
        entity_key: 'chr2:200:G:C',
        old_value: null,
        new_value: JSON.stringify({ starred: 1 }),
        user_name: null
      })

      const entries = repo.getByEntityKey('chr1:100:A:T')
      expect(entries).toHaveLength(2)
      expect(entries[0].action_type).toBe('star')
      expect(entries[1].action_type).toBe('acmg_classify')
    })

    it('returns empty array for unknown entity', () => {
      expect(repo.getByEntityKey('unknown')).toEqual([])
    })
  })

  describe('query', () => {
    beforeEach(() => {
      repo.appendEntry({
        action_type: 'acmg_classify',
        entity_type: 'variant_annotation',
        entity_key: 'chr1:100:A:T',
        old_value: null,
        new_value: '{}',
        user_name: 'user1'
      })
      repo.appendEntry({
        action_type: 'star',
        entity_type: 'case_variant_annotation',
        entity_key: 'case:1:variant:42',
        old_value: null,
        new_value: '{}',
        user_name: 'user2'
      })
    })

    it('returns all entries with no filters', () => {
      const result = repo.query({})
      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
    })

    it('filters by action_type', () => {
      const result = repo.query({ action_type: 'star' })
      expect(result.data).toHaveLength(1)
      expect(result.data[0].action_type).toBe('star')
    })

    it('supports pagination with limit and offset', () => {
      const result = repo.query({ limit: 1, offset: 0 })
      expect(result.data).toHaveLength(1)
      expect(result.total_count).toBe(2)
    })
  })
})
