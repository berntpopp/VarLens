/**
 * Panel intervals must come from the database they are computed for (#546).
 * Panel ids restart at 1 in every database, so an export run against DB B
 * after DB A must never see A's panel genes (or A's empty panel).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const COORDS: Record<string, { chromosome: string; start_pos: number; end_pos: number }> = {
  'HGNC:A': { chromosome: '1', start_pos: 1000, end_pos: 2000 },
  'HGNC:B': { chromosome: '2', start_pos: 5000, end_pos: 6000 }
}

vi.mock('../../../../src/main/database/geneReferenceLoader', () => ({
  getGeneReferenceDb: () => ({
    getCoordinatesForGenes: (ids: string[], assembly: string) =>
      new Map(
        ids
          .filter((id) => COORDS[id])
          .map((id) => [id, { hgncId: id, assembly, strand: '+', ...COORDS[id] }])
      )
  })
}))

import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import { resolveCohortPanelOnCallingThread } from '../../../../src/main/ipc/handlers/panelIntervalHelper'

function dbWithPanel(genes: Array<{ hgncId: string; symbol: string }>): DatabaseService {
  const db = new DatabaseService(':memory:')
  const panel = db.panels.createPanel({ name: 'P', source: 'manual' })
  expect(panel.id).toBe(1)
  db.panels.setGenes(panel.id, genes)
  return db
}

const exportPrep = (db: DatabaseService) =>
  resolveCohortPanelOnCallingThread(
    db,
    { active_panel_ids: [1], panel_padding_bp: 0, genome_build: 'GRCh38' },
    'export'
  ).panel_intervals

describe('panel intervals are scoped to the database (#546)', () => {
  const opened: DatabaseService[] = []
  const open = (genes: Array<{ hgncId: string; symbol: string }>) => {
    const db = dbWithPanel(genes)
    opened.push(db)
    return db
  }

  beforeEach(() => {
    opened.length = 0
  })
  afterEach(() => {
    for (const db of opened) db.close()
  })

  it('uses B panel 1 genes after exporting from A panel 1', () => {
    const a = open([{ hgncId: 'HGNC:A', symbol: 'GENEA' }])
    const b = open([{ hgncId: 'HGNC:B', symbol: 'GENEB' }])

    expect(exportPrep(a)).toEqual([{ chr: 'chr1', start: 1000, end: 2000 }])
    expect(exportPrep(b)).toEqual([{ chr: 'chr2', start: 5000, end: 6000 }])
  })

  it("an empty panel 1 in A does not drop B's panel restriction", () => {
    const a = open([])
    const b = open([{ hgncId: 'HGNC:B', symbol: 'GENEB' }])

    expect(exportPrep(a)).toEqual([])
    expect(exportPrep(b)).toEqual([{ chr: 'chr2', start: 5000, end: 6000 }])
  })
})
