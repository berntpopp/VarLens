import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createKysely } from '../../../src/main/database/kysely'
import { PanelRepository } from '../../../src/main/database/PanelRepository'

describe('PanelRepository', () => {
  let db: InstanceType<typeof Database>
  let repo: PanelRepository

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    const kysely = createKysely(db)
    repo = new PanelRepository(db, kysely)
  })

  afterEach(() => {
    db.close()
  })

  // ── Migration ──────────────────────────────────────────────

  describe('migration v19', () => {
    it('creates panels table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='panels'")
        .all()
      expect(tables).toHaveLength(1)
    })

    it('creates panel_genes table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='panel_genes'")
        .all()
      expect(tables).toHaveLength(1)
    })

    it('creates case_active_panels table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='case_active_panels'")
        .all()
      expect(tables).toHaveLength(1)
    })

    it('adds genome_build column to cases', () => {
      const cols = db.prepare("PRAGMA table_info('cases')").all() as Array<{ name: string }>
      expect(cols.some((c) => c.name === 'genome_build')).toBe(true)
    })

    it('sets user_version to 22', () => {
      const version = db.pragma('user_version', { simple: true })
      expect(version).toBe(22)
    })
  })

  // ── CRUD ───────────────────────────────────────────────────

  describe('createPanel', () => {
    it('creates a panel with required fields', () => {
      const panel = repo.createPanel({ name: 'Test Panel', source: 'manual' })
      expect(panel.id).toBeGreaterThan(0)
      expect(panel.name).toBe('Test Panel')
      expect(panel.source).toBe('manual')
      expect(panel.description).toBeNull()
      expect(panel.version).toBeNull()
      expect(panel.source_id).toBeNull()
      expect(panel.source_metadata).toBeNull()
    })

    it('creates a panel with all fields', () => {
      const panel = repo.createPanel({
        name: 'PanelApp Panel',
        source: 'panelapp_uk',
        description: 'A test panel',
        version: '4.2',
        sourceId: '396',
        sourceMetadata: { confidence: 'green' }
      })
      expect(panel.description).toBe('A test panel')
      expect(panel.version).toBe('4.2')
      expect(panel.source_id).toBe('396')
      expect(JSON.parse(panel.source_metadata!)).toEqual({ confidence: 'green' })
    })
  })

  describe('listPanels', () => {
    it('returns empty array when no panels exist', () => {
      expect(repo.listPanels()).toEqual([])
    })

    it('returns panels with gene count', () => {
      const panel = repo.createPanel({ name: 'Panel A', source: 'manual' })
      repo.setGenes(panel.id, [
        { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
        { hgncId: 'HGNC:1101', symbol: 'BRCA2' }
      ])

      const list = repo.listPanels()
      expect(list).toHaveLength(1)
      expect(list[0].gene_count).toBe(2)
    })

    it('returns panels ordered by name', () => {
      repo.createPanel({ name: 'Zebra', source: 'manual' })
      repo.createPanel({ name: 'Alpha', source: 'manual' })
      const list = repo.listPanels()
      expect(list[0].name).toBe('Alpha')
      expect(list[1].name).toBe('Zebra')
    })
  })

  describe('getPanel', () => {
    it('returns panel by id', () => {
      const created = repo.createPanel({ name: 'Get Me', source: 'manual' })
      const panel = repo.getPanel(created.id)
      expect(panel).not.toBeNull()
      expect(panel!.name).toBe('Get Me')
    })

    it('returns null for non-existent id', () => {
      expect(repo.getPanel(9999)).toBeNull()
    })
  })

  describe('updatePanel', () => {
    it('updates name and description', () => {
      const panel = repo.createPanel({ name: 'Old', source: 'manual' })
      const updated = repo.updatePanel(panel.id, { name: 'New', description: 'Updated' })
      expect(updated.name).toBe('New')
      expect(updated.description).toBe('Updated')
      expect(updated.updated_at).toBeGreaterThanOrEqual(panel.updated_at)
    })

    it('updates version', () => {
      const panel = repo.createPanel({ name: 'Versioned', source: 'manual' })
      const updated = repo.updatePanel(panel.id, { version: '2.0' })
      expect(updated.version).toBe('2.0')
    })
  })

  describe('deletePanel', () => {
    it('removes the panel', () => {
      const panel = repo.createPanel({ name: 'Delete Me', source: 'manual' })
      repo.deletePanel(panel.id)
      expect(repo.getPanel(panel.id)).toBeNull()
    })

    it('cascades to panel_genes', () => {
      const panel = repo.createPanel({ name: 'Cascade', source: 'manual' })
      repo.setGenes(panel.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])
      repo.deletePanel(panel.id)
      const genes = db.prepare('SELECT * FROM panel_genes WHERE panel_id = ?').all(panel.id)
      expect(genes).toHaveLength(0)
    })
  })

  // ── Gene management ────────────────────────────────────────

  describe('setGenes / getGenes', () => {
    it('sets and retrieves genes', () => {
      const panel = repo.createPanel({ name: 'Genes', source: 'manual' })
      repo.setGenes(panel.id, [
        { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
        { hgncId: 'HGNC:1101', symbol: 'BRCA2' }
      ])
      const genes = repo.getGenes(panel.id)
      expect(genes).toHaveLength(2)
      expect(genes[0].symbol).toBe('BRCA1')
      expect(genes[1].symbol).toBe('BRCA2')
    })

    it('replaces existing genes', () => {
      const panel = repo.createPanel({ name: 'Replace', source: 'manual' })
      repo.setGenes(panel.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])
      repo.setGenes(panel.id, [{ hgncId: 'HGNC:2000', symbol: 'TP53' }])
      const genes = repo.getGenes(panel.id)
      expect(genes).toHaveLength(1)
      expect(genes[0].symbol).toBe('TP53')
    })

    it('handles empty gene list', () => {
      const panel = repo.createPanel({ name: 'Empty', source: 'manual' })
      repo.setGenes(panel.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])
      repo.setGenes(panel.id, [])
      expect(repo.getGenes(panel.id)).toHaveLength(0)
    })

    it('ignores duplicate hgnc_id in same call', () => {
      const panel = repo.createPanel({ name: 'Dups', source: 'manual' })
      repo.setGenes(panel.id, [
        { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
        { hgncId: 'HGNC:1100', symbol: 'BRCA1' }
      ])
      expect(repo.getGenes(panel.id)).toHaveLength(1)
    })
  })

  // ── Duplication ────────────────────────────────────────────

  describe('duplicatePanel', () => {
    it('creates a copy with genes', () => {
      const original = repo.createPanel({
        name: 'Original',
        source: 'panelapp_uk',
        description: 'Desc',
        version: '1.0'
      })
      repo.setGenes(original.id, [
        { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
        { hgncId: 'HGNC:1101', symbol: 'BRCA2' }
      ])

      const copy = repo.duplicatePanel(original.id, 'Copy')
      expect(copy.name).toBe('Copy')
      expect(copy.description).toBe('Desc')
      expect(copy.version).toBe('1.0')
      expect(copy.id).not.toBe(original.id)

      const copyGenes = repo.getGenes(copy.id)
      expect(copyGenes).toHaveLength(2)
    })

    it('throws for non-existent panel', () => {
      expect(() => repo.duplicatePanel(9999, 'Nope')).toThrow(/Transaction failed/)
    })
  })

  // ── Activation / Deactivation ──────────────────────────────

  describe('activatePanel / deactivatePanel / getActivePanelsForCase', () => {
    let caseId: number
    let panelId: number

    beforeEach(() => {
      // Insert a case directly
      const result = db
        .prepare(
          'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run('Test Case', '/tmp/test.tsv', 1000, 10, Date.now())
      caseId = Number(result.lastInsertRowid)

      const panel = repo.createPanel({ name: 'Active Panel', source: 'manual' })
      panelId = panel.id
      repo.setGenes(panelId, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])
    })

    it('activates a panel for a case', () => {
      repo.activatePanel(caseId, panelId)
      const active = repo.getActivePanelsForCase(caseId)
      expect(active).toHaveLength(1)
      expect(active[0].panel_name).toBe('Active Panel')
      expect(active[0].gene_count).toBe(1)
      expect(active[0].padding_bp).toBe(5000)
    })

    it('activates with custom padding', () => {
      repo.activatePanel(caseId, panelId, 10000)
      const active = repo.getActivePanelsForCase(caseId)
      expect(active[0].padding_bp).toBe(10000)
    })

    it('replaces padding on re-activation', () => {
      repo.activatePanel(caseId, panelId, 5000)
      repo.activatePanel(caseId, panelId, 3000)
      const active = repo.getActivePanelsForCase(caseId)
      expect(active).toHaveLength(1)
      expect(active[0].padding_bp).toBe(3000)
    })

    it('deactivates a panel', () => {
      repo.activatePanel(caseId, panelId)
      repo.deactivatePanel(caseId, panelId)
      expect(repo.getActivePanelsForCase(caseId)).toHaveLength(0)
    })

    it('returns empty array when no panels active', () => {
      expect(repo.getActivePanelsForCase(caseId)).toHaveLength(0)
    })
  })
})
