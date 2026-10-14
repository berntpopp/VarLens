/**
 * Tags logic unit tests
 *
 * Tests the extracted tags-logic module directly with a real in-memory SQLite backend.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import * as tagsLogic from '../../../src/main/ipc/handlers/tags-logic'

describe('tags-logic', () => {
  let db: DatabaseService
  let getDb: () => DatabaseService
  let caseId: number
  let variantId: number

  const insertCase = (name: string): number => {
    const result = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/path/${name}.json`, 1000, 0, Date.now())
    return result.lastInsertRowid as number
  }

  const insertVariant = (
    cId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): number => {
    const result = db.database
      .prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(cId, chr, pos, ref, alt, '0/1')
    return result.lastInsertRowid as number
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    db.database.exec('DELETE FROM tags') // start without the default tags (v55)
    getDb = () => db
    caseId = insertCase('Test Case')
    variantId = insertVariant(caseId, '1', 12345, 'A', 'G')
  })

  afterEach(() => {
    db.close()
  })

  describe('createTag', () => {
    it('creates a tag via logic layer', () => {
      const tag = tagsLogic.createTag('Candidate', '#ff0000', getDb) as {
        id: number
        name: string
        color: string
      }

      expect(tag.id).toBeGreaterThan(0)
      expect(tag.name).toBe('Candidate')
      expect(tag.color).toBe('#ff0000')
    })

    it('rejects duplicate tag names', () => {
      tagsLogic.createTag('Candidate', '#ff0000', getDb)
      expect(() => tagsLogic.createTag('Candidate', '#00ff00', getDb)).toThrow()
    })
  })

  describe('listTags', () => {
    it('returns all tags ordered by name (no pool)', async () => {
      tagsLogic.createTag('Zebra', '#000000', getDb)
      tagsLogic.createTag('Alpha', '#ffffff', getDb)

      const tags = (await tagsLogic.listTags(getDb)) as Array<{ name: string }>

      expect(tags.length).toBe(2)
      expect(tags[0].name).toBe('Alpha')
      expect(tags[1].name).toBe('Zebra')
    })

    it('returns empty array when no tags exist', async () => {
      const tags = await tagsLogic.listTags(getDb)
      expect(tags).toEqual([])
    })
  })

  describe('updateTag', () => {
    it('updates tag name and color', () => {
      const tag = tagsLogic.createTag('Old', '#000000', getDb) as { id: number }
      tagsLogic.updateTag(tag.id, { name: 'New', color: '#ffffff' }, getDb)

      const tags = db.tags.listTags()
      expect(tags[0].name).toBe('New')
      expect(tags[0].color).toBe('#ffffff')
    })
  })

  describe('deleteTag', () => {
    it('deletes a tag', () => {
      const tag = tagsLogic.createTag('ToDelete', '#ff0000', getDb) as { id: number }
      tagsLogic.deleteTag(tag.id, getDb)

      const tags = db.tags.listTags()
      expect(tags.length).toBe(0)
    })
  })

  describe('getUsageCount', () => {
    it('returns 0 for unused tag (no pool)', async () => {
      const tag = tagsLogic.createTag('Unused', '#ff0000', getDb) as { id: number }
      const count = await tagsLogic.getUsageCount(tag.id, getDb)
      expect(count).toBe(0)
    })

    it('returns correct count after assignment', async () => {
      const tag = tagsLogic.createTag('Used', '#ff0000', getDb) as { id: number }
      tagsLogic.assignVariantTag(caseId, variantId, tag.id, getDb)
      const count = await tagsLogic.getUsageCount(tag.id, getDb)
      expect(count).toBe(1)
    })
  })

  describe('variant tag operations', () => {
    it('assigns and retrieves variant tags (no pool)', async () => {
      const tag = tagsLogic.createTag('Important', '#ff0000', getDb) as { id: number }
      tagsLogic.assignVariantTag(caseId, variantId, tag.id, getDb)

      const tags = (await tagsLogic.getVariantTags(caseId, variantId, getDb)) as Array<{
        name: string
      }>
      expect(tags.length).toBe(1)
      expect(tags[0].name).toBe('Important')
    })

    it('removes a variant tag', async () => {
      const tag = tagsLogic.createTag('ToRemove', '#ff0000', getDb) as { id: number }
      tagsLogic.assignVariantTag(caseId, variantId, tag.id, getDb)
      tagsLogic.removeVariantTag(caseId, variantId, tag.id, getDb)

      const tags = (await tagsLogic.getVariantTags(caseId, variantId, getDb)) as Array<unknown>
      expect(tags.length).toBe(0)
    })

    it('replaces all variant tags via setVariantTags', async () => {
      const tag1 = tagsLogic.createTag('Old', '#ff0000', getDb) as { id: number }
      const tag2 = tagsLogic.createTag('New1', '#00ff00', getDb) as { id: number }
      const tag3 = tagsLogic.createTag('New2', '#0000ff', getDb) as { id: number }

      tagsLogic.assignVariantTag(caseId, variantId, tag1.id, getDb)
      tagsLogic.setVariantTags(caseId, variantId, [tag2.id, tag3.id], getDb)

      const tags = (await tagsLogic.getVariantTags(caseId, variantId, getDb)) as Array<{
        name: string
      }>
      expect(tags.length).toBe(2)
      const names = tags.map((t) => t.name)
      expect(names).toContain('New1')
      expect(names).toContain('New2')
      expect(names).not.toContain('Old')
    })
  })
})
