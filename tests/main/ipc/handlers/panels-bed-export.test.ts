import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import type { GeneReferenceDb } from '../../../../src/main/database/GeneReferenceDb'
import { generateBedContent } from '../../../../src/main/ipc/handlers/panels-logic'

describe('panel BED export — chromosome names', () => {
  let db: DatabaseService
  let panelId: number
  const geneRef = {
    getCoordinatesForGenes: () =>
      new Map([['HGNC:1', { chromosome: '17', start_pos: 100, end_pos: 200 }]])
  } as unknown as GeneReferenceDb

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    panelId = db.panels.createPanel({ name: 'P', source: 'manual' }).id
    db.panels.setGenes(panelId, [{ hgncId: 'HGNC:1', symbol: 'G1' }])
  })
  afterEach(() => db.close())

  it.each([
    ['GRCh38', 'chr17'],
    ['GRCh37', '17']
  ])('%s regions use the build reference names (%s)', (assembly, chr) => {
    const { lines } = generateBedContent(panelId, assembly, 0, () => db, geneRef)
    expect(lines[1]).toBe(`${chr}\t99\t200\tG1`)
  })
})
