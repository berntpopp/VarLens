// @vitest-environment node
/**
 * The SQLite import pipeline stores `impact_rank` / `clinvar_rank` next to the
 * raw `consequence` (impact) and `clinvar` strings (#469), for VCF annotated by
 * VEP (CSQ) and SnpEff (ANN) and for JSON, on the worker path and on the
 * main-thread path. The ranks are what the cohort summary picks its
 * representative row by, so a row imported without them would never win.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { VcfStrategy } from '../../../src/main/import/vcf/VcfStrategy'
import { runImportSession } from '../../../src/main/workers/import-worker'
import { clinvarRank, impactRank } from '../../../src/shared/config/severity.config'
import type { MainMessage, WorkerMessage } from '../../../src/shared/types/import-worker'

type StartMessage = Extract<MainMessage, { type: 'start' }>
type FileRequest = StartMessage['files'][number]

const VCF_DIR = resolve(__dirname, '../../test-data/vcf')
const VEP_VCF = join(VCF_DIR, 'single-sample.vep.vcf.gz')
const SNPEFF_VCF = join(VCF_DIR, 'single-sample.snpeff.vcf.gz')
/** CSQ and ANN records with ClinVar significance in CSQ and in INFO. */
const SYNTHETIC_VCF = join(VCF_DIR, 'synthetic-unit-test.vcf')

const JSON_VARIANTS = [
  { consequence: 'HIGH', clinvar: 'Pathogenic' },
  { consequence: 'MODERATE', clinvar: 'Pathogenic/Likely_pathogenic' },
  { consequence: 'LOW', clinvar: 'Conflicting_interpretations_of_pathogenicity' },
  { consequence: 'MODIFIER', clinvar: 'uncertain_significance&likely_benign' },
  { consequence: 'MODERATE', clinvar: 'Benign' },
  { consequence: null, clinvar: null }
].map((annotation, index) => ({
  chr: 'chr1',
  pos: 100 + index,
  ref: 'A',
  alt: 'G',
  gene_symbol: 'GENE',
  gt_num: '0/1',
  func: 'missense_variant',
  ...annotation
}))

interface RankedRow {
  consequence: string | null
  clinvar: string | null
  impact_rank: number
  clinvar_rank: number
}

const rowsOf = (db: DatabaseType, caseName: string): RankedRow[] =>
  db
    .prepare(
      `SELECT v.consequence, v.clinvar, v.impact_rank, v.clinvar_rank
         FROM variants v JOIN cases c ON c.id = v.case_id
        WHERE c.name = ? ORDER BY v.id`
    )
    .all(caseName) as RankedRow[]

/** Every stored rank is the configured rank of the stored string. */
function expectRanksMatchStrings(rows: RankedRow[]): void {
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    expect(row, JSON.stringify(row)).toMatchObject({
      impact_rank: impactRank(row.consequence),
      clinvar_rank: clinvarRank(row.clinvar)
    })
  }
}

const distinct = (rows: RankedRow[], key: 'impact_rank' | 'clinvar_rank'): number[] =>
  [...new Set(rows.map((row) => row[key]))].sort((a, b) => a - b)

describe('SQLite import stores severity ranks (#469)', () => {
  let dir: string
  let dbPath: string
  let db: DatabaseType

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-severity-ranks-'))
    dbPath = join(dir, 'test.db')
    db = new Database(dbPath)
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function importFiles(files: Array<Partial<FileRequest>>): Promise<void> {
    const messages: WorkerMessage[] = []
    await runImportSession(
      { type: 'start', files, dbPath } as StartMessage,
      { postMessage: (message) => messages.push(message) },
      () => false
    )
    const done = messages.find((message) => message.type === 'complete')
    if (done?.type !== 'complete') throw new Error('session did not complete')
    expect(done.results.details.map((detail) => detail.status)).toEqual(files.map(() => 'success'))
  }

  const vcf = (filePath: string, caseName: string): Partial<FileRequest> => ({
    filePath,
    caseName,
    vcfSelectedSamples: ['HG005'],
    vcfGenomeBuild: 'GRCh38'
  })

  it('worker path: VEP CSQ, SnpEff ANN and INFO ClinVar', async () => {
    await importFiles([
      vcf(VEP_VCF, 'vep'),
      vcf(SNPEFF_VCF, 'snpeff'),
      vcf(SYNTHETIC_VCF, 'synthetic')
    ])

    for (const caseName of ['vep', 'snpeff', 'synthetic']) {
      const rows = rowsOf(db, caseName)
      expectRanksMatchStrings(rows)
      // Real annotation: more than one impact level was ranked.
      expect(distinct(rows, 'impact_rank').filter((rank) => rank > 0).length).toBeGreaterThan(1)
    }
    // ClinVar from the CSQ field and from the standalone INFO field.
    expect(distinct(rowsOf(db, 'synthetic'), 'clinvar_rank')).toContain(
      clinvarRank('Likely_pathogenic')
    )
  })

  it('worker path: JSON', async () => {
    const file = join(dir, 'ranks.json')
    writeFileSync(file, JSON.stringify({ variants: JSON_VARIANTS }))
    await importFiles([{ filePath: file, caseName: 'json' }])

    expect(rowsOf(db, 'json')).toEqual([
      { consequence: 'HIGH', clinvar: 'Pathogenic', impact_rank: 4, clinvar_rank: 15 },
      {
        consequence: 'MODERATE',
        clinvar: 'Pathogenic/Likely_pathogenic',
        impact_rank: 3,
        clinvar_rank: 14
      },
      {
        consequence: 'LOW',
        clinvar: 'Conflicting_interpretations_of_pathogenicity',
        impact_rank: 2,
        clinvar_rank: 12
      },
      {
        consequence: 'MODIFIER',
        clinvar: 'uncertain_significance&likely_benign',
        impact_rank: 1,
        clinvar_rank: 11
      },
      { consequence: 'MODERATE', clinvar: 'Benign', impact_rank: 3, clinvar_rank: 2 },
      { consequence: null, clinvar: null, impact_rank: 0, clinvar_rank: 0 }
    ])
  })

  it('main-thread path: VcfStrategy through VariantRepository', async () => {
    db.close()
    const service = new DatabaseService(dbPath)
    try {
      const caseId = service.cases.createCase('main-thread', SYNTHETIC_VCF, 1000)
      await new VcfStrategy().import(
        SYNTHETIC_VCF,
        { caseName: 'main-thread' },
        {
          db: service,
          formatInfo: { format: 'vcf', caseKey: '' },
          caseId,
          startTime: Date.now()
        },
        { selectedSamples: ['HG005'] }
      )
      const rows = rowsOf(service.database, 'main-thread')
      expectRanksMatchStrings(rows)
      expect(distinct(rows, 'impact_rank').filter((rank) => rank > 0).length).toBeGreaterThan(1)
      expect(distinct(rows, 'clinvar_rank').some((rank) => rank > 0)).toBe(true)
    } finally {
      service.close()
      db = new Database(dbPath)
    }
  })
})
