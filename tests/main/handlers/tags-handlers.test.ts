/**
 * Tags IPC handler integration tests
 *
 * Tests tag repository methods with real SQLite backend.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'

describe('tag IPC handlers', () => {
  let db: DatabaseService
  let caseId: number
  let variantId: number

  // Helper to insert a case
  const insertCase = (name: string): number => {
    const result = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/path/${name}.json`, 1000, 0, Date.now())
    return result.lastInsertRowid as number
  }

  // Helper to insert a variant and return its id
  const insertVariant = (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): number => {
    const result = db.database
      .prepare(
        `INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(caseId, chr, pos, ref, alt, '0/1')
    return result.lastInsertRowid as number
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = insertCase('Test Case')
    variantId = insertVariant(caseId, '1', 12345, 'A', 'G')
  })

  afterEach(() => {
    db.close()
  })

  describe('createTag (tags:create)', () => {
    it('creates a tag and returns it', () => {
      const tag = db.tags.createTag('Candidate', '#ff0000')

      expect(tag).toHaveProperty('id')
      expect(tag.name).toBe('Candidate')
      expect(tag.color).toBe('#ff0000')
      expect(tag.created_at).toBeGreaterThan(0)
    })

    it('rejects duplicate tag names', () => {
      db.tags.createTag('Candidate', '#ff0000')

      expect(() => db.tags.createTag('Candidate', '#00ff00')).toThrow()
    })
  })

  describe('listTags (tags:list)', () => {
    it('lists tags for the database (ordered by name)', () => {
      db.tags.createTag('Zebra', '#000000')
      db.tags.createTag('Alpha', '#ffffff')
      db.tags.createTag('Middle', '#888888')

      const tags = db.tags.listTags()

      expect(tags.length).toBe(3)
      expect(tags[0].name).toBe('Alpha')
      expect(tags[1].name).toBe('Middle')
      expect(tags[2].name).toBe('Zebra')
    })

    it('returns empty array when no tags exist', () => {
      const tags = db.tags.listTags()
      expect(tags).toEqual([])
    })
  })

  describe('assignVariantTag (tags:assignVariantTag)', () => {
    it('adds a tag to a variant', () => {
      const tag = db.tags.createTag('Important', '#ff0000')

      db.tags.assignVariantTag(caseId, variantId, tag.id)

      const variantTags = db.tags.getVariantTags(caseId, variantId)
      expect(variantTags.length).toBe(1)
      expect(variantTags[0].name).toBe('Important')
      expect(variantTags[0].id).toBe(tag.id)
    })

    it('does not duplicate when assigning same tag twice', () => {
      const tag = db.tags.createTag('Important', '#ff0000')

      db.tags.assignVariantTag(caseId, variantId, tag.id)
      db.tags.assignVariantTag(caseId, variantId, tag.id)

      const variantTags = db.tags.getVariantTags(caseId, variantId)
      expect(variantTags.length).toBe(1)
    })
  })

  describe('removeVariantTag (tags:removeVariantTag)', () => {
    it('removes a tag from a variant', () => {
      const tag = db.tags.createTag('ToRemove', '#ff0000')
      db.tags.assignVariantTag(caseId, variantId, tag.id)

      // Verify assigned
      expect(db.tags.getVariantTags(caseId, variantId).length).toBe(1)

      db.tags.removeVariantTag(caseId, variantId, tag.id)

      const variantTags = db.tags.getVariantTags(caseId, variantId)
      expect(variantTags.length).toBe(0)
    })

    it('does not error when removing a tag that was not assigned', () => {
      const tag = db.tags.createTag('Unassigned', '#ff0000')

      // Should not throw
      expect(() => db.tags.removeVariantTag(caseId, variantId, tag.id)).not.toThrow()
    })
  })

  describe('getVariantTags (tags:getVariantTags)', () => {
    it('returns all tags assigned to a variant', () => {
      const tag1 = db.tags.createTag('Alpha', '#ff0000')
      db.tags.createTag('Beta', '#00ff00')
      const tag3 = db.tags.createTag('Gamma', '#0000ff')

      db.tags.assignVariantTag(caseId, variantId, tag1.id)
      db.tags.assignVariantTag(caseId, variantId, tag3.id)

      const variantTags = db.tags.getVariantTags(caseId, variantId)
      expect(variantTags.length).toBe(2)

      const names = variantTags.map((t) => t.name)
      expect(names).toContain('Alpha')
      expect(names).toContain('Gamma')
      expect(names).not.toContain('Beta')
    })

    it('returns empty array when no tags assigned', () => {
      const variantTags = db.tags.getVariantTags(caseId, variantId)
      expect(variantTags).toEqual([])
    })
  })

  describe('setVariantTags (tags:setVariantTags)', () => {
    it('replaces all tags for a variant', () => {
      const tag1 = db.tags.createTag('Old', '#ff0000')
      const tag2 = db.tags.createTag('New1', '#00ff00')
      const tag3 = db.tags.createTag('New2', '#0000ff')

      db.tags.assignVariantTag(caseId, variantId, tag1.id)

      // Replace with new set
      db.tags.setVariantTags(caseId, variantId, [tag2.id, tag3.id])

      const variantTags = db.tags.getVariantTags(caseId, variantId)
      expect(variantTags.length).toBe(2)

      const names = variantTags.map((t) => t.name)
      expect(names).toContain('New1')
      expect(names).toContain('New2')
      expect(names).not.toContain('Old')
    })
  })
})
