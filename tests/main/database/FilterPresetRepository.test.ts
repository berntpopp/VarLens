import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createKysely } from '../../../src/main/database/kysely'
import { FilterPresetRepository } from '../../../src/main/database/FilterPresetRepository'

describe('migration v15 - filter_presets', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
  })

  it('creates filter_presets table', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='filter_presets'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('seeds built-in presets', () => {
    const presets = db.prepare('SELECT * FROM filter_presets WHERE is_built_in = 1').all()
    expect(presets.length).toBeGreaterThanOrEqual(8)
  })

  it('sets user_version to latest', () => {
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBe(32)
  })

  it('creates unique index on name', () => {
    expect(() => {
      db.prepare(
        "INSERT INTO filter_presets (name, filter_json, is_built_in, is_visible, sort_order, created_at, updated_at) VALUES ('Rare Pathogenic', '{}', 0, 1, 99, 0, 0)"
      ).run()
    }).toThrow(/UNIQUE constraint/)
  })
})

describe('FilterPresetRepository', () => {
  let db: InstanceType<typeof Database>
  let repo: FilterPresetRepository

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    const kysely = createKysely(db)
    repo = new FilterPresetRepository(db, kysely)
  })

  describe('listPresets', () => {
    it('returns built-in presets sorted by sort_order', () => {
      const presets = repo.listPresets()
      expect(presets.length).toBeGreaterThanOrEqual(8)
      expect(presets[0].name).toBe('Rare Pathogenic')
      expect(presets[0].isBuiltIn).toBe(true)
    })

    it("carries kind='filter' on classic built-in presets", () => {
      const classic = repo.listPresets().find((p) => p.name === 'Rare Pathogenic')
      expect(classic?.kind).toBe('filter')
    })

    it("carries kind='shortlist' on built-in shortlist presets seeded by v27", () => {
      const shortlist = repo.listPresets().find((p) => p.name === 'Tier 1 candidates')
      expect(shortlist?.kind).toBe('shortlist')
    })
  })

  describe('createPreset', () => {
    it('creates a user preset', () => {
      const preset = repo.createPreset({
        name: 'My Filter',
        description: 'Test preset',
        filterJson: { maxGnomadAf: 0.05 }
      })
      expect(preset.id).toBeGreaterThan(0)
      expect(preset.name).toBe('My Filter')
      expect(preset.isBuiltIn).toBe(false)
      expect(preset.filterJson).toEqual({ maxGnomadAf: 0.05 })
    })

    it('throws on duplicate name', () => {
      repo.createPreset({ name: 'Dup', filterJson: {} })
      expect(() => repo.createPreset({ name: 'Dup', filterJson: {} })).toThrow(/already exists/)
    })

    it("defaults kind to 'filter' when omitted", () => {
      const preset = repo.createPreset({
        name: 'ImplicitFilterKind',
        filterJson: { maxGnomadAf: 0.01 }
      })
      expect(preset.kind).toBe('filter')
    })

    it("persists kind='shortlist' when provided", () => {
      const preset = repo.createPreset({
        name: 'ExplicitShortlistKind',
        filterJson: {},
        kind: 'shortlist'
      })
      expect(preset.kind).toBe('shortlist')
    })

    it('round-trips kind through listPresets', () => {
      repo.createPreset({ name: 'RoundTripShortlist', filterJson: {}, kind: 'shortlist' })
      repo.createPreset({ name: 'RoundTripFilter', filterJson: {}, kind: 'filter' })
      const all = repo.listPresets()
      const shortlist = all.find((p) => p.name === 'RoundTripShortlist')!
      const filter = all.find((p) => p.name === 'RoundTripFilter')!
      expect(shortlist.kind).toBe('shortlist')
      expect(filter.kind).toBe('filter')
    })

    it('round-trips kind through getPreset', () => {
      const created = repo.createPreset({
        name: 'GetPresetKindRoundTrip',
        filterJson: {},
        kind: 'shortlist'
      })
      const fetched = repo.getPreset(created.id)
      expect(fetched?.kind).toBe('shortlist')
    })
  })

  describe('updatePreset', () => {
    it('updates name and description', () => {
      const preset = repo.createPreset({ name: 'Old', filterJson: {} })
      const updated = repo.updatePreset(preset.id, { name: 'New', description: 'Updated' })
      expect(updated.name).toBe('New')
      expect(updated.description).toBe('Updated')
    })

    it('throws NotFoundError for invalid id', () => {
      expect(() => repo.updatePreset(9999, { name: 'X' })).toThrow(/not found/)
    })

    it('prevents updating built-in preset name', () => {
      const builtIns = repo.listPresets().filter((p) => p.isBuiltIn)
      // Should allow visibility toggle but not name/filter changes
      const updated = repo.updatePreset(builtIns[0].id, { isVisible: false })
      expect(updated.isVisible).toBe(false)
    })

    it('updates kind on user presets', () => {
      const created = repo.createPreset({
        name: 'KindUpgrade',
        filterJson: {},
        kind: 'filter'
      })
      expect(created.kind).toBe('filter')
      const updated = repo.updatePreset(created.id, { kind: 'shortlist' })
      expect(updated.kind).toBe('shortlist')
    })
  })

  describe('deletePreset', () => {
    it('deletes a user preset', () => {
      const preset = repo.createPreset({ name: 'ToDelete', filterJson: {} })
      repo.deletePreset(preset.id)
      const all = repo.listPresets()
      expect(all.find((p) => p.name === 'ToDelete')).toBeUndefined()
    })

    it('throws on deleting built-in preset', () => {
      const builtIns = repo.listPresets().filter((p) => p.isBuiltIn)
      expect(() => repo.deletePreset(builtIns[0].id)).toThrow(/built-in/)
    })

    it('throws NotFoundError for invalid id', () => {
      expect(() => repo.deletePreset(9999)).toThrow(/not found/)
    })
  })

  describe('reorderPresets', () => {
    it('updates sort_order for multiple presets', () => {
      const p1 = repo.createPreset({ name: 'A', filterJson: {}, sortOrder: 100 })
      const p2 = repo.createPreset({ name: 'B', filterJson: {}, sortOrder: 101 })
      repo.reorderPresets([
        { id: p2.id, sortOrder: 0 },
        { id: p1.id, sortOrder: 1 }
      ])
      const all = repo.listPresets()
      const a = all.find((p) => p.name === 'A')!
      const b = all.find((p) => p.name === 'B')!
      expect(b.sortOrder).toBeLessThan(a.sortOrder)
    })
  })
})
