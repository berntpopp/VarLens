// @vitest-environment node
/** Cohort export keeps gnomAD AF and CADD numeric, like the case export (E-12). */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { runCohortExport } from '../../../src/main/workers/cohort-export'

describe('SQLite cohort export number cells', () => {
  let dir: string
  let service: DatabaseService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-cohort-export-numbers-'))
    service = new DatabaseService(join(dir, 'test.db'))
    const caseId = service.cases.createCase('one', '/tmp/one.json', 0, 'GRCh38')
    service.variants.insertVariantsBatch(caseId, [
      {
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'T',
        gt_num: '0/1',
        consequence: 'HIGH',
        gnomad_af: 0.000036312,
        cadd: 25.456
      } as never
    ])
    service.cohortSummary.rebuild()
  })

  afterEach(() => {
    service.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes gnomAD AF and CADD as rounded numbers', () => {
    const file = join(dir, 'cohort.xlsx')
    runCohortExport(service.database, {}, file, () => undefined)
    const wb = XLSX.read(readFileSync(file))
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]])
    expect(rows[0]['gnomAD AF']).toBe(0.0000363)
    expect(rows[0]['CADD Score']).toBe(25.46)
  })
})
