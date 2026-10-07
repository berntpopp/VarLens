import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import { join } from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createKysely } from '../../../src/main/database/kysely'
import {
  PanelRepository,
  mergeOverlappingIntervals
} from '../../../src/main/database/PanelRepository'
import { GeneReferenceDb } from '../../../src/main/database/GeneReferenceDb'
import { PanelRegionsUnavailableError } from '../../../src/shared/filters/panel-intervals'

describe('PanelRepository.computeIntervals', () => {
  let caseDb: InstanceType<typeof Database>
  let repo: PanelRepository
  let geneRefRawDb: InstanceType<typeof Database>
  let geneRefDb: GeneReferenceDb

  beforeAll(() => {
    // Open the real gene reference DB (read-only)
    const refDbPath = join(__dirname, '..', '..', '..', 'resources', 'gene_reference.db')
    geneRefRawDb = new Database(refDbPath, { readonly: true })
    geneRefDb = new GeneReferenceDb(geneRefRawDb)
  })

  afterAll(() => {
    geneRefRawDb.close()
  })

  beforeEach(() => {
    // In-memory case DB with full schema
    caseDb = new Database(':memory:')
    caseDb.pragma('journal_mode = WAL')
    caseDb.pragma('foreign_keys = ON')
    initializeSchema(caseDb)
    runMigrations(caseDb)
    const kysely = createKysely(caseDb)
    repo = new PanelRepository(caseDb, kysely)
  })

  afterEach(() => {
    caseDb.close()
  })

  // ── Basic interval computation ──────────────────────────────

  it('computes intervals for a panel with known genes', () => {
    const panel = repo.createPanel({ name: 'Test', source: 'manual' })
    // BRCA1 is on chr17, TP53 is also on chr17
    repo.setGenes(panel.id, [
      { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
      { hgncId: 'HGNC:11998', symbol: 'TP53' }
    ])

    const intervals = repo.computeIntervals([panel.id], 'GRCh38', 0, geneRefDb)

    expect(intervals.length).toBeGreaterThan(0)
    // All intervals should have valid chromosome, start < end
    for (const iv of intervals) {
      expect(iv.chr).toBeTruthy()
      expect(iv.start).toBeGreaterThanOrEqual(0)
      expect(iv.end).toBeGreaterThan(iv.start)
    }
  })

  // ── Padding ────────────────────────────────────────────────

  it('applies zero padding correctly', () => {
    const panel = repo.createPanel({ name: 'NoPad', source: 'manual' })
    repo.setGenes(panel.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])

    const noPad = repo.computeIntervals([panel.id], 'GRCh38', 0, geneRefDb)
    const withPad = repo.computeIntervals([panel.id], 'GRCh38', 5000, geneRefDb)

    expect(noPad).toHaveLength(1)
    expect(withPad).toHaveLength(1)
    // Padded interval should be wider
    expect(withPad[0].start).toBeLessThanOrEqual(noPad[0].start)
    expect(withPad[0].end).toBeGreaterThanOrEqual(noPad[0].end)
    // Specifically, the difference should be paddingBp on each side
    expect(noPad[0].start - withPad[0].start).toBe(5000)
    expect(withPad[0].end - noPad[0].end).toBe(5000)
  })

  it('clamps start to 1 when padding exceeds gene start (1-based coordinates)', () => {
    // Use a gene near chromosome start — if gene starts at e.g. 100, padding of 5000 should clamp to 1
    // Genomic coordinates are 1-based, so the minimum valid position is 1
    const panel = repo.createPanel({ name: 'BigPad', source: 'manual' })
    repo.setGenes(panel.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])

    const intervals = repo.computeIntervals([panel.id], 'GRCh38', 999999999, geneRefDb)
    expect(intervals).toHaveLength(1)
    expect(intervals[0].start).toBe(1)
  })

  // ── chrPrefix ──────────────────────────────────────────────

  it('adds chr prefix when chrPrefix is true', () => {
    const panel = repo.createPanel({ name: 'ChrPrefix', source: 'manual' })
    repo.setGenes(panel.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])

    const withoutPrefix = repo.computeIntervals([panel.id], 'GRCh38', 0, geneRefDb, false)
    const withPrefix = repo.computeIntervals([panel.id], 'GRCh38', 0, geneRefDb, true)

    expect(withoutPrefix).toHaveLength(1)
    expect(withPrefix).toHaveLength(1)
    // Without prefix: bare chromosome number
    expect(withoutPrefix[0].chr).not.toMatch(/^chr/)
    // With prefix: "chr" prepended
    expect(withPrefix[0].chr).toMatch(/^chr/)
  })

  // ── Overlapping merge ──────────────────────────────────────

  it('merges overlapping genes on the same chromosome', () => {
    // BRCA1 and TP53 are both on chr17; with enough padding they may overlap
    const panel = repo.createPanel({ name: 'Overlap', source: 'manual' })
    repo.setGenes(panel.id, [
      { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
      { hgncId: 'HGNC:11998', symbol: 'TP53' }
    ])

    // With no padding, should be 2 separate intervals (genes are far apart)
    const noPad = repo.computeIntervals([panel.id], 'GRCh38', 0, geneRefDb)
    expect(noPad.length).toBe(2)

    // With enormous padding, they should merge into 1
    const bigPad = repo.computeIntervals([panel.id], 'GRCh38', 50000000, geneRefDb)
    const chr17Intervals = bigPad.filter((iv) => iv.chr === '17')
    expect(chr17Intervals.length).toBe(1)
  })

  // ── Empty / edge cases ────────────────────────────────────

  it('returns empty array for empty panel', () => {
    const panel = repo.createPanel({ name: 'Empty', source: 'manual' })
    const intervals = repo.computeIntervals([panel.id], 'GRCh38', 0, geneRefDb)
    expect(intervals).toEqual([])
  })

  it('returns empty array for empty panelIds array', () => {
    const intervals = repo.computeIntervals([], 'GRCh38', 0, geneRefDb)
    expect(intervals).toEqual([])
  })

  it('silently skips genes missing from reference DB', () => {
    const panel = repo.createPanel({ name: 'Missing', source: 'manual' })
    repo.setGenes(panel.id, [
      { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
      { hgncId: 'HGNC:9999999', symbol: 'FAKEGENE' }
    ])

    const intervals = repo.computeIntervals([panel.id], 'GRCh38', 0, geneRefDb)
    // Only BRCA1 should produce an interval
    expect(intervals).toHaveLength(1)
  })

  it('throws instead of returning "no restriction" when no gene has coordinates for the assembly', () => {
    const panel = repo.createPanel({ name: 'WrongAssembly', source: 'manual' })
    repo.setGenes(panel.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])

    // An empty result means "no restriction" to every caller, so a panel WITH
    // genes that resolves to nothing must not be reported as empty.
    expect(() => repo.computeIntervals([panel.id], 'FAKE_ASSEMBLY', 0, geneRefDb)).toThrow(
      PanelRegionsUnavailableError
    )
  })

  // ── Multiple panels (union) ─────────────────────────────────

  it('merges genes from multiple panels', () => {
    const panel1 = repo.createPanel({ name: 'Panel1', source: 'manual' })
    const panel2 = repo.createPanel({ name: 'Panel2', source: 'manual' })
    repo.setGenes(panel1.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])
    repo.setGenes(panel2.id, [{ hgncId: 'HGNC:11998', symbol: 'TP53' }])

    const intervals = repo.computeIntervals([panel1.id, panel2.id], 'GRCh38', 0, geneRefDb)
    // Should have intervals for both genes
    expect(intervals.length).toBe(2)
  })

  it('deduplicates genes shared between panels', () => {
    const panel1 = repo.createPanel({ name: 'P1', source: 'manual' })
    const panel2 = repo.createPanel({ name: 'P2', source: 'manual' })
    // Same gene in both panels
    repo.setGenes(panel1.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])
    repo.setGenes(panel2.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])

    const intervals = repo.computeIntervals([panel1.id, panel2.id], 'GRCh38', 0, geneRefDb)
    // Should still be just 1 interval (DISTINCT hgnc_id in SQL)
    expect(intervals).toHaveLength(1)
  })

  // ── Resolution status (which genes computeIntervals leaves out) ──────────

  describe('getResolutionStatus', () => {
    const UNKNOWN_Z = { hgncId: 'HGNC:99999902', symbol: 'ZZFAKE2' }
    const UNKNOWN_A = { hgncId: 'HGNC:99999901', symbol: 'AAFAKE1' }

    it('names the panel genes without coordinates, sorted by symbol', () => {
      const panel = repo.createPanel({ name: 'Partial', source: 'manual' })
      repo.setGenes(panel.id, [UNKNOWN_Z, { hgncId: 'HGNC:1100', symbol: 'BRCA1' }, UNKNOWN_A])

      expect(repo.getResolutionStatus([panel.id], 'GRCh38', geneRefDb)).toEqual({
        genomeBuild: 'GRCh38',
        totalGenes: 3,
        unmappedCount: 2,
        unmappedGenes: [UNKNOWN_A, UNKNOWN_Z]
      })
      // The mapped gene still restricts the query: partial coverage is not an error.
      expect(repo.computeIntervals([panel.id], 'GRCh38', 0, geneRefDb)).toHaveLength(1)
    })

    it('counts a gene shared by two panels once and reports nothing for mapped panels', () => {
      const first = repo.createPanel({ name: 'First', source: 'manual' })
      const second = repo.createPanel({ name: 'Second', source: 'manual' })
      repo.setGenes(first.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])
      repo.setGenes(second.id, [
        { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
        { hgncId: 'HGNC:11998', symbol: 'TP53' }
      ])

      expect(repo.getResolutionStatus([first.id, second.id], 'GRCh38', geneRefDb)).toEqual({
        genomeBuild: 'GRCh38',
        totalGenes: 2,
        unmappedCount: 0,
        unmappedGenes: []
      })
    })

    it('reports every gene as unmapped for a build the reference does not know', () => {
      const panel = repo.createPanel({ name: 'Unknown build', source: 'manual' })
      repo.setGenes(panel.id, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])

      const status = repo.getResolutionStatus([panel.id], 'NoSuchBuild', geneRefDb)
      expect(status.unmappedGenes).toEqual([{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])
      expect(status.totalGenes).toBe(1)
    })

    it('answers without touching the gene reference when no panel is requested', () => {
      const lookup = { getCoordinatesForGenes: vi.fn() }
      expect(repo.getResolutionStatus([], 'GRCh38', lookup).totalGenes).toBe(0)
      expect(lookup.getCoordinatesForGenes).not.toHaveBeenCalled()
    })
  })
})

// ── mergeOverlappingIntervals unit tests ─────────────────────

describe('mergeOverlappingIntervals', () => {
  it('returns empty array for empty input', () => {
    expect(mergeOverlappingIntervals([])).toEqual([])
  })

  it('returns single interval unchanged', () => {
    const result = mergeOverlappingIntervals([{ chr: '1', start: 100, end: 200 }])
    expect(result).toEqual([{ chr: '1', start: 100, end: 200 }])
  })

  it('merges overlapping intervals', () => {
    const result = mergeOverlappingIntervals([
      { chr: '1', start: 100, end: 300 },
      { chr: '1', start: 200, end: 400 }
    ])
    expect(result).toEqual([{ chr: '1', start: 100, end: 400 }])
  })

  it('merges adjacent intervals (touching)', () => {
    const result = mergeOverlappingIntervals([
      { chr: '1', start: 100, end: 200 },
      { chr: '1', start: 201, end: 300 }
    ])
    expect(result).toEqual([{ chr: '1', start: 100, end: 300 }])
  })

  it('does not merge non-overlapping intervals', () => {
    const result = mergeOverlappingIntervals([
      { chr: '1', start: 100, end: 200 },
      { chr: '1', start: 300, end: 400 }
    ])
    expect(result).toEqual([
      { chr: '1', start: 100, end: 200 },
      { chr: '1', start: 300, end: 400 }
    ])
  })

  it('does not merge intervals on different chromosomes', () => {
    const result = mergeOverlappingIntervals([
      { chr: '1', start: 100, end: 200 },
      { chr: '2', start: 100, end: 200 }
    ])
    expect(result).toEqual([
      { chr: '1', start: 100, end: 200 },
      { chr: '2', start: 100, end: 200 }
    ])
  })

  it('sorts by chromosome with natural sort', () => {
    const result = mergeOverlappingIntervals([
      { chr: '2', start: 100, end: 200 },
      { chr: '10', start: 100, end: 200 },
      { chr: '1', start: 100, end: 200 }
    ])
    expect(result.map((i) => i.chr)).toEqual(['1', '2', '10'])
  })

  it('handles contained intervals', () => {
    const result = mergeOverlappingIntervals([
      { chr: '1', start: 100, end: 500 },
      { chr: '1', start: 200, end: 300 }
    ])
    expect(result).toEqual([{ chr: '1', start: 100, end: 500 }])
  })

  it('merges multiple overlapping into one', () => {
    const result = mergeOverlappingIntervals([
      { chr: '1', start: 100, end: 200 },
      { chr: '1', start: 150, end: 300 },
      { chr: '1', start: 250, end: 400 }
    ])
    expect(result).toEqual([{ chr: '1', start: 100, end: 400 }])
  })
})
