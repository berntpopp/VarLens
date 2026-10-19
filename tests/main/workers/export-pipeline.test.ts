// @vitest-environment node
/**
 * Tests for the extracted export pipeline module.
 *
 * Tests the core export orchestration (CSV streaming, XLSX worksheet building,
 * progress reporting, metadata sheet generation) using a real in-memory SQLite
 * database, without any worker_threads dependencies.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readFileSync,
  existsSync,
  rmSync,
  mkdtempSync,
  writeFileSync,
  chmodSync,
  statSync,
  symlinkSync,
  accessSync,
  constants
} from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import * as XLSX from 'xlsx'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import {
  runExportPipeline,
  buildMetadataSheet,
  defaultExportTempFilePath,
  iterateAnnotatedRows,
  EXPORT_COLUMNS,
  isDevicePath,
  prepareExportFilePath
} from '../../../src/main/workers/export-pipeline'
import { COHORT_EXPORT_COLUMNS } from '../../../src/main/workers/cohort-export'
import type { ExportPipelineParams } from '../../../src/main/workers/export-pipeline'
import * as xlsxStreamModule from '../../../src/web/server/downloads/xlsx-stream'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

function createTestDb(): DatabaseType {
  // Use a file-based DB since the export pipeline uses iterate() which needs
  // the DB to remain open and accessible
  const dbPath = join(tmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const db = new Database(dbPath)
  initializeSchema(db)
  runMigrations(db)
  return db
}

function insertVariant(
  db: DatabaseType,
  caseId: number,
  overrides: Partial<{
    chr: string
    pos: number
    ref: string
    alt: string
    gene_symbol: string | null
    consequence: string | null
    func: string | null
    clinvar: string | null
    gnomad_af: number | null
    cadd: number | null
    gt_num: string | null
    transcript: string | null
    cdna: string | null
    aa_change: string | null
    qual: number | null
    hpo_sim_score: number | null
    moi: string | null
  }> = {}
): void {
  const v = {
    chr: '1',
    pos: 100,
    ref: 'A',
    alt: 'G',
    gene_symbol: null,
    consequence: null,
    func: null,
    clinvar: null,
    gnomad_af: null,
    cadd: null,
    gt_num: '0/1',
    transcript: null,
    cdna: null,
    aa_change: null,
    qual: null,
    hpo_sim_score: null,
    moi: null,
    ...overrides
  }
  db.prepare(
    `INSERT INTO variants
      (case_id, chr, pos, ref, alt, gene_symbol, consequence, func, clinvar,
       gnomad_af, cadd, gt_num, transcript, cdna, aa_change, qual, hpo_sim_score, moi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    caseId,
    v.chr,
    v.pos,
    v.ref,
    v.alt,
    v.gene_symbol,
    v.consequence,
    v.func,
    v.clinvar,
    v.gnomad_af,
    v.cadd,
    v.gt_num,
    v.transcript,
    v.cdna,
    v.aa_change,
    v.qual,
    v.hpo_sim_score,
    v.moi
  )
}

function createCase(db: DatabaseType, name: string): number {
  const result = db
    .prepare(
      `INSERT INTO cases (name, file_path, file_size, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(name, '/test/path.vcf', 0, Date.now())
  return Number(result.lastInsertRowid)
}

function buildExportSql(caseId: number): { sql: string; params: readonly unknown[] } {
  // Like the compiled filter query: whole variant rows; the annotation cells are looked up.
  const sql = `SELECT * FROM variants WHERE case_id = ? ORDER BY chr, pos`
  return { sql, params: [caseId] }
}

function makeOutputPath(ext: string): string {
  return join(tmpDir, `export-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
}

function readXlsxFile(filePath: string): XLSX.WorkBook {
  const buf = readFileSync(filePath)
  return XLSX.read(buf, { type: 'buffer' })
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'varlens-export-pipeline-'))
})

afterEach(() => {
  // maxRetries needed on Windows where file handles may not be released immediately
  rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

// ---------------------------------------------------------------------------
// Impact / Consequence vocabulary (case and cohort export must agree, #477)
// ---------------------------------------------------------------------------

describe('impact / consequence export headers', () => {
  it.each([
    ['case export', EXPORT_COLUMNS],
    ['cohort export', COHORT_EXPORT_COLUMNS]
  ])('%s heads the impact level "Impact" and the SO term "Consequence"', (_name, columns) => {
    expect(columns.find((c) => c.key === 'consequence')?.header).toBe('Impact')
    expect(columns.find((c) => c.key === 'func')?.header).toBe('Consequence')
  })
})

// ---------------------------------------------------------------------------
// buildMetadataSheet (unit)
// ---------------------------------------------------------------------------

describe('buildMetadataSheet', () => {
  it('includes case name and total variants', () => {
    const sheet = buildMetadataSheet('My Case', 42, {})
    const flat = sheet.flat()
    expect(flat).toContain('My Case')
    expect(flat).toContain(42)
  })

  it('includes gene filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { gene_symbol: 'BRCA1' })
    const flat = sheet.flat()
    expect(flat).toContain('Gene')
    expect(flat).toContain('BRCA1')
  })

  it('includes consequences filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { consequences: ['HIGH', 'MODERATE'] })
    const flat = sheet.flat()
    expect(flat).toContain('Impact Levels')
    expect(flat).not.toContain('Consequences')
    expect(flat).toContain('HIGH, MODERATE')
  })

  it('includes funcs filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { funcs: ['missense_variant'] })
    const flat = sheet.flat()
    expect(flat).toContain('Consequences')
    expect(flat).toContain('missense_variant')
  })

  it('includes clinvars filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { clinvars: ['Pathogenic'] })
    const flat = sheet.flat()
    expect(flat).toContain('ClinVar')
    expect(flat).toContain('Pathogenic')
  })

  it('includes gnomad_af_max filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { gnomad_af_max: 0.01 })
    const flat = sheet.flat()
    expect(flat).toContain('Max gnomAD AF')
    expect(flat).toContain(0.01)
  })

  it('includes cadd_min filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { cadd_min: 20 })
    const flat = sheet.flat()
    expect(flat).toContain('Min CADD')
    expect(flat).toContain(20)
  })

  it('includes carrier_count_max filter when provided', () => {
    const sheet = buildMetadataSheet('Case', 0, { carrier_count_max: 3 })
    const flat = sheet.flat()
    expect(flat).toContain('Max Carrier Cases')
    expect(flat).toContain(3)
  })

  it('omits filter rows when summary is empty', () => {
    const sheet = buildMetadataSheet('Case', 0, {})
    const flat = sheet.flat()
    expect(flat).not.toContain('Gene')
    expect(flat).not.toContain('Impact Levels')
    expect(flat).not.toContain('Consequences')
    expect(flat).not.toContain('Max gnomAD AF')
  })

  it('omits gene filter when gene_symbol is empty string', () => {
    const sheet = buildMetadataSheet('Case', 0, { gene_symbol: '' })
    const flat = sheet.flat()
    expect(flat).not.toContain('Gene')
  })
})

// ---------------------------------------------------------------------------
// CSV export pipeline
// ---------------------------------------------------------------------------

describe('runExportPipeline — CSV', () => {
  let db: DatabaseType
  let caseId: number

  beforeEach(() => {
    db = createTestDb()
    caseId = createCase(db, 'Test Case')
  })

  afterEach(() => {
    db.close()
  })

  function makeCsvParams(overrides?: Partial<ExportPipelineParams>): ExportPipelineParams {
    const { sql, params } = buildExportSql(caseId)
    return {
      db,
      compiledSql: sql,
      compiledParams: params,
      outputFilePath: makeOutputPath('csv'),
      format: 'csv',
      caseName: 'Test Case',
      filterSummary: {},
      ...overrides
    }
  }

  it('produces a valid CSV file with correct header row', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, ref: 'A', alt: 'G' })
    const params = makeCsvParams()
    await runExportPipeline(params)

    const content = readFileSync(params.outputFilePath, 'utf8')
    const lines = content.split('\r\n').filter((l) => l.length > 0)
    const expectedHeader = EXPORT_COLUMNS.map((c) => c.header).join(',')
    expect(lines[0]).toBe(expectedHeader)
  })

  it('exports the case ACMG class, points, override reason and both comments (#574)', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, ref: 'A', alt: 'G' })
    insertVariant(db, caseId, { chr: '1', pos: 200, ref: 'A', alt: 'G' })
    const variantId = (
      db.prepare('SELECT id FROM variants WHERE pos = 100').get() as { id: number }
    ).id
    const evidence = JSON.stringify({
      pathogenic: [{ code: 'PVS1', strength: 'very_strong', confirmed: true }],
      benign: [],
      is_override: true,
      override_reason: 'Segregation'
    })
    db.prepare(
      `INSERT INTO case_variant_annotations (case_id, variant_id, acmg_classification,
         acmg_evidence, per_case_comment, created_at, updated_at)
       VALUES (?, ?, 'Benign', ?, 'case note', 0, 1)`
    ).run(caseId, variantId, evidence)
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, genome_build, acmg_classification,
         global_comment, created_at, updated_at)
       VALUES ('1', 100, 'A', 'G', 'GRCh38', 'Pathogenic', 'newer global note', 0, 2)`
    ).run()
    const params = makeCsvParams()
    await runExportPipeline(params)

    const lines = readFileSync(params.outputFilePath, 'utf8').split('\r\n')
    expect(
      lines[0].endsWith('ACMG Class,ACMG Points,ACMG Override Reason,Case Comment,Global Comment')
    ).toBe(true)
    expect(lines[1].endsWith('Benign,8,Segregation,case note,newer global note')).toBe(true)
    expect(lines[2].endsWith(',,,,')).toBe(true)
  })

  it('produces one data row per variant', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    insertVariant(db, caseId, { chr: '2', pos: 200 })
    insertVariant(db, caseId, { chr: '3', pos: 300 })

    const params = makeCsvParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(3)

    const content = readFileSync(params.outputFilePath, 'utf8')
    const lines = content.split('\r\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(4) // header + 3 data rows
  })

  it('returns correct result shape', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeCsvParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(1)
    expect(result.filePath).toBe(params.outputFilePath)
  })

  it('writes gnomad_af as a plain number', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, gnomad_af: 0.0001 })
    const params = makeCsvParams()
    await runExportPipeline(params)

    const content = readFileSync(params.outputFilePath, 'utf8')
    expect(content).toContain(',0.0001,')
  })

  it('correctly formats cadd with 2 decimal places', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, cadd: 25.123 })
    const params = makeCsvParams()
    await runExportPipeline(params)

    const content = readFileSync(params.outputFilePath, 'utf8')
    expect(content).toContain('25.12')
  })

  it('CSV-escapes values that contain commas', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, aa_change: 'p.Arg,Gly' })
    const params = makeCsvParams()
    await runExportPipeline(params)

    const content = readFileSync(params.outputFilePath, 'utf8')
    expect(content).toContain('"p.Arg,Gly"')
  })

  it('produces header-only CSV when no variants exist', async () => {
    const params = makeCsvParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(0)

    const content = readFileSync(params.outputFilePath, 'utf8')
    const lines = content.split('\r\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1) // header only
  })

  it('calls onProgress callback', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const onProgress = vi.fn()
    const params = makeCsvParams({ onProgress })
    await runExportPipeline(params)

    // At minimum, the initial progress(0, 0) is called
    expect(onProgress).toHaveBeenCalledWith(0, 0)
  })

  describe('failures (#558): reject promptly, never leave a partial file', () => {
    // Root ignores file modes; /dev/full is Linux-only.
    const linuxUser = process.platform === 'linux' && process.getuid?.() !== 0

    it('rejects when the output path cannot be opened', async () => {
      const params = makeCsvParams({ outputFilePath: join(tmpDir, 'missing-dir', 'out.csv') })
      await expect(runExportPipeline(params)).rejects.toThrow(/ENOENT/)
      expect(existsSync(params.outputFilePath)).toBe(false)
    })

    it.runIf(linuxUser)('leaves an existing file it cannot open untouched', async () => {
      const existing = join(tmpDir, 'readonly.csv')
      writeFileSync(existing, 'keep me')
      chmodSync(existing, 0o444)
      await expect(runExportPipeline(makeCsvParams({ outputFilePath: existing }))).rejects.toThrow(
        /EACCES/
      )
      expect(readFileSync(existing, 'utf8')).toBe('keep me')
    })

    it.runIf(linuxUser)('rejects when writes fail under backpressure', async () => {
      for (let i = 0; i < 20000; i++) insertVariant(db, caseId, { chr: '1', pos: 100 + i })
      // /dev/full opens but every write fails with ENOSPC.
      await expect(
        runExportPipeline(makeCsvParams({ outputFilePath: '/dev/full' }))
      ).rejects.toThrow(/ENOSPC/)
    })

    it('rejects and removes the partial file when the export fails mid-stream', async () => {
      // Enough rows to fill the stream buffer, so the file is open and partly written at the failure.
      for (let i = 0; i < 5000; i++) insertVariant(db, caseId, { chr: '1', pos: 100 + i })
      const params = makeCsvParams({
        onProgress: (rows) => {
          if (rows === 4000) throw new Error('source failed')
        }
      })
      await expect(runExportPipeline(params)).rejects.toThrow('source failed')
      expect(existsSync(params.outputFilePath)).toBe(false)
    })

    it('preserves an existing file at outputFilePath untouched if pipeline throws mid-export, leaving no .part file', async () => {
      for (let i = 0; i < 5000; i++) insertVariant(db, caseId, { chr: '1', pos: 100 + i })
      const existing = join(tmpDir, 'existing-to-preserve.csv')
      writeFileSync(existing, 'original content must not be overwritten')
      const params = makeCsvParams({
        outputFilePath: existing,
        onProgress: (rows) => {
          if (rows === 4000) throw new Error('mid-export failure')
        }
      })
      await expect(runExportPipeline(params)).rejects.toThrow('mid-export failure')
      expect(readFileSync(existing, 'utf8')).toBe('original content must not be overwritten')
      expect(existsSync(`${existing}.part`)).toBe(false)
    })

    it('preserves an existing <outputFilePath>.part file untouched when export succeeds', async () => {
      const output = join(tmpDir, 'export-success.csv')
      const existingPart = `${output}.part`
      writeFileSync(existingPart, 'pre-existing part content must not be touched')
      const params = makeCsvParams({ outputFilePath: output })
      await runExportPipeline(params)
      expect(existsSync(output)).toBe(true)
      expect(existsSync(existingPart)).toBe(true)
      expect(readFileSync(existingPart, 'utf8')).toBe(
        'pre-existing part content must not be touched'
      )
    })

    it('preserves an existing <outputFilePath>.part file untouched when export fails', async () => {
      for (let i = 0; i < 5000; i++) insertVariant(db, caseId, { chr: '1', pos: 100 + i })
      const output = join(tmpDir, 'export-fail.csv')
      const existingPart = `${output}.part`
      writeFileSync(existingPart, 'pre-existing part content must not be touched')
      const params = makeCsvParams({
        outputFilePath: output,
        onProgress: (rows) => {
          if (rows === 4000) throw new Error('mid-export failure')
        }
      })
      await expect(runExportPipeline(params)).rejects.toThrow('mid-export failure')
      expect(existsSync(output)).toBe(false)
      expect(existsSync(existingPart)).toBe(true)
      expect(readFileSync(existingPart, 'utf8')).toBe(
        'pre-existing part content must not be touched'
      )
    })

    it('rejects with EEXIST when customTempFilePath already exists and preserves it', async () => {
      const output = join(tmpDir, 'export-eexist.csv')
      const existingTemp = join(tmpDir, 'existing-temp.part')
      writeFileSync(existingTemp, 'do not overwrite me')
      const params = makeCsvParams({
        outputFilePath: output,
        tempFilePath: existingTemp
      })
      await expect(runExportPipeline(params)).rejects.toThrow()
      expect(existsSync(existingTemp)).toBe(true)
      expect(readFileSync(existingTemp, 'utf8')).toBe('do not overwrite me')
    })

    it('creates new export file with 0o600 permissions and preserves existing 0o600 permissions', async () => {
      const output = join(tmpDir, 'perms-test.csv')
      const params = makeCsvParams({ outputFilePath: output })
      await runExportPipeline(params)
      expect(existsSync(output)).toBe(true)
      const stat1 = statSync(output)
      if (process.platform !== 'win32') {
        expect(stat1.mode & 0o777).toBe(0o600)
      }

      // Overwrite existing file
      await runExportPipeline(params)
      const stat2 = statSync(output)
      if (process.platform !== 'win32') {
        expect(stat2.mode & 0o777).toBe(0o600)
      }
    })

    it('closes db cleanly without busy query error after runExportPipeline rejects with EEXIST (CSV and XLSX)', async () => {
      const dbPath = join(tmpDir, 'test-busy.db')
      const separateDb = new Database(dbPath)
      try {
        separateDb.exec(
          'CREATE TABLE variants (id INTEGER PRIMARY KEY, case_id INTEGER, chr TEXT, pos INTEGER, ref TEXT, alt TEXT)'
        )
        separateDb
          .prepare(
            "INSERT INTO variants (case_id, chr, pos, ref, alt) VALUES (1, '1', 100, 'A', 'T')"
          )
          .run()

        // CSV test
        const csvOutput = join(tmpDir, 'test-busy.csv')
        const csvTemp = join(tmpDir, 'busy-temp.csv.part')
        writeFileSync(csvTemp, 'already exists')

        await expect(
          runExportPipeline({
            db: separateDb,
            compiledSql: 'SELECT * FROM variants WHERE case_id = ?',
            compiledParams: [1],
            outputFilePath: csvOutput,
            tempFilePath: csvTemp,
            format: 'csv',
            caseName: 'case1',
            filterSummary: {}
          })
        ).rejects.toThrow()

        // XLSX test
        const xlsxOutput = join(tmpDir, 'test-busy.xlsx')
        const xlsxTemp = join(tmpDir, 'busy-temp.xlsx.part')
        writeFileSync(xlsxTemp, 'already exists')

        await expect(
          runExportPipeline({
            db: separateDb,
            compiledSql: 'SELECT * FROM variants WHERE case_id = ?',
            compiledParams: [1],
            outputFilePath: xlsxOutput,
            tempFilePath: xlsxTemp,
            format: 'xlsx',
            caseName: 'case1',
            filterSummary: {}
          })
        ).rejects.toThrow()

        // db.close() must succeed immediately without throwing
        expect(() => separateDb.close()).not.toThrow()
      } finally {
        if (separateDb.open) separateDb.close()
      }
    })

    it('rejects without modifying or deleting target if precreated tempFilePath is replaced with a symlink', async () => {
      const symlinkTarget = join(tmpDir, 'symlink-secret.txt')
      writeFileSync(symlinkTarget, 'secret untouched content')

      const tempFilePath = join(tmpDir, 'symlink-temp.part')
      symlinkSync(symlinkTarget, tempFilePath)

      const output = join(tmpDir, 'symlink-out.csv')
      const stat = statSync(tempFilePath)
      const params = makeCsvParams({
        outputFilePath: output,
        tempFilePath,
        tempFilePrecreated: { dev: stat.dev, ino: stat.ino }
      })

      await expect(runExportPipeline(params)).rejects.toThrow(
        /Refusing to write to unexpected or replaced temporary export file/
      )
      expect(existsSync(symlinkTarget)).toBe(true)
      expect(readFileSync(symlinkTarget, 'utf8')).toBe('secret untouched content')
    })

    it('rejects without modifying or deleting target if precreated tempFilePath has an inode/device mismatch', async () => {
      const differentFile = join(tmpDir, 'different-file.part')
      writeFileSync(differentFile, 'original file content')

      const output = join(tmpDir, 'mismatch-out.csv')
      const params = makeCsvParams({
        outputFilePath: output,
        tempFilePath: differentFile,
        tempFilePrecreated: { dev: 999999, ino: 888888 }
      })

      await expect(runExportPipeline(params)).rejects.toThrow(
        /Refusing to write to unexpected or replaced temporary export file/
      )
      expect(existsSync(differentFile)).toBe(true)
      expect(readFileSync(differentFile, 'utf8')).toBe('original file content')
    })

    it('holds read transaction across entire iterateAnnotatedRows so trailing partial chunk is not polluted by mid-export commits', () => {
      const walDbPath = join(tmpDir, 'wal-isolation.db')
      const readerDb = new Database(walDbPath)
      initializeSchema(readerDb)
      runMigrations(readerDb)
      readerDb.pragma('journal_mode = WAL')
      try {
        const testCaseId = createCase(readerDb, 'WAL Case')
        readerDb.prepare("UPDATE cases SET genome_build = 'GRCh38' WHERE id = ?").run(testCaseId)

        const insertStmt = readerDb.prepare(
          `INSERT INTO variants
            (case_id, chr, pos, ref, alt, gt_num)
           VALUES (?, '1', ?, 'A', 'T', '0/1')`
        )
        for (let i = 1; i <= 250; i++) {
          insertStmt.run(testCaseId, 1000 + i)
        }

        const writerDb = new Database(walDbPath)
        try {
          const iteratedRows: Record<string, unknown>[] = []
          for (const row of iterateAnnotatedRows(
            readerDb,
            'SELECT * FROM variants WHERE case_id = ? ORDER BY id',
            [testCaseId]
          )) {
            if (row.id === 1) {
              // Commit annotation for variant 220 (in the final partial chunk of 50 rows) from a second connection
              writerDb
                .prepare(
                  `INSERT INTO case_variant_annotations
                    (case_id, variant_id, acmg_classification, per_case_comment, created_at, updated_at)
                   VALUES (?, 220, 'Pathogenic', 'Committed mid-export', ?, ?)`
                )
                .run(testCaseId, Date.now(), Date.now())
            }
            iteratedRows.push(row)
          }

          expect(iteratedRows.length).toBe(250)
          // The annotation for variant 220 was committed while reading was underway.
          // Because readerDb holds a read transaction across iterateAnnotatedRows,
          // the trailing batch lookup (rows 201-250) reads from the original read snapshot.
          const row220 = iteratedRows.find((r) => r.id === 220)
          expect(row220).toBeDefined()
          expect(row220?.acmg_classification).toBeNull()

          // After iteration finishes, readerDb released its transaction
          expect(readerDb.inTransaction).toBe(false)

          // A new query on readerDb now sees the committed annotation
          const postRow = readerDb
            .prepare(
              'SELECT acmg_classification FROM case_variant_annotations WHERE variant_id = 220'
            )
            .get() as { acmg_classification: string } | undefined
          expect(postRow?.acmg_classification).toBe('Pathogenic')
        } finally {
          if (writerDb.open) writerDb.close()
        }
      } finally {
        if (readerDb.open) readerDb.close()
      }
    })

    it('rejects and leaves db.inTransaction === false when compiledSql has invalid SQL syntax', async () => {
      const params = makeCsvParams({
        compiledSql: 'SELECT THIS IS INVALID SQL FROM'
      })
      await expect(runExportPipeline(params)).rejects.toThrow()
      expect(db.inTransaction).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// XLSX export pipeline
// ---------------------------------------------------------------------------

describe('runExportPipeline — XLSX', () => {
  let db: DatabaseType
  let caseId: number

  beforeEach(() => {
    db = createTestDb()
    caseId = createCase(db, 'Test Case')
  })

  afterEach(() => {
    db.close()
  })

  function makeXlsxParams(overrides?: Partial<ExportPipelineParams>): ExportPipelineParams {
    const { sql, params } = buildExportSql(caseId)
    return {
      db,
      compiledSql: sql,
      compiledParams: params,
      outputFilePath: makeOutputPath('xlsx'),
      format: 'xlsx',
      caseName: 'Test Case',
      filterSummary: {},
      ...overrides
    }
  }

  it('produces a valid XLSX file with Variants sheet', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, gene_symbol: 'BRCA1' })
    const params = makeXlsxParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(1)
    expect(existsSync(params.outputFilePath)).toBe(true)

    const wb = readXlsxFile(params.outputFilePath)
    expect(wb.SheetNames).toContain('Variants')
  })

  it('Variants sheet has correct headers in first row', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeXlsxParams()
    await runExportPipeline(params)

    const wb = readXlsxFile(params.outputFilePath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][]
    expect(data[0]).toEqual(EXPORT_COLUMNS.map((c) => c.header))
  })

  it('includes all data rows', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, gene_symbol: 'BRCA1' })
    insertVariant(db, caseId, { chr: '2', pos: 200, gene_symbol: 'TP53' })
    const params = makeXlsxParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(2)

    const wb = readXlsxFile(params.outputFilePath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][]
    expect(data).toHaveLength(3) // header + 2 data rows
  })

  it('includes Export Info metadata sheet', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeXlsxParams({ caseName: 'My Case' })
    await runExportPipeline(params)

    const wb = readXlsxFile(params.outputFilePath)
    expect(wb.SheetNames).toContain('Export Info')

    const metaWs = wb.Sheets['Export Info']
    const metaData = XLSX.utils.sheet_to_json<string[]>(metaWs, { header: 1 }) as string[][]
    const hasCase = metaData.some((row) => row.includes('My Case'))
    expect(hasCase).toBe(true)
  })

  it('metadata sheet includes active filter summary', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeXlsxParams({
      filterSummary: {
        gene_symbol: 'BRCA1',
        consequences: ['HIGH'],
        gnomad_af_max: 0.01
      }
    })
    await runExportPipeline(params)

    const wb = readXlsxFile(params.outputFilePath)
    const metaWs = wb.Sheets['Export Info']
    const metaData = XLSX.utils.sheet_to_json<string[]>(metaWs, { header: 1 }) as string[][]
    const flat = metaData.flat()
    expect(flat).toContain('BRCA1')
    expect(flat).toContain('HIGH')
    expect(flat).toContain(0.01)
  })

  it('keeps gnomad_af a numeric XLSX cell', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100, gnomad_af: 0.00015 })
    const params = makeXlsxParams()
    await runExportPipeline(params)

    const wb = readXlsxFile(params.outputFilePath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws) as Record<string, unknown>[]
    expect(data[0]['gnomAD AF']).toBe(0.00015)
  })

  it('produces a valid XLSX with no variants (header only)', async () => {
    const params = makeXlsxParams({ caseName: 'Empty Case' })
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(0)

    const wb = readXlsxFile(params.outputFilePath)
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][]
    expect(data).toHaveLength(1) // header only
  })

  it('calls onProgress callback', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const onProgress = vi.fn()
    const params = makeXlsxParams({ onProgress })
    await runExportPipeline(params)

    expect(onProgress).toHaveBeenCalledWith(0, 0)
  })

  it('returns correct result shape', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeXlsxParams()
    const result = await runExportPipeline(params)

    expect(result.rowCount).toBe(1)
    expect(result.filePath).toBe(params.outputFilePath)
  })

  it('surfaces truncation note on Export Info sheet and returns truncated: true when row limit is reached', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const params = makeXlsxParams()

    const originalXlsxStream = xlsxStreamModule.xlsxStream
    const spy = vi
      .spyOn(xlsxStreamModule, 'xlsxStream')
      .mockImplementation((sheet, result, info) => {
        result.truncated = true
        return originalXlsxStream(sheet, result, info)
      })

    try {
      const result = await runExportPipeline(params)
      expect(result.truncated).toBe(true)

      const wb = readXlsxFile(params.outputFilePath)
      const metaWs = wb.Sheets['Export Info']
      const metaData = XLSX.utils.sheet_to_json<string[]>(metaWs, { header: 1 }) as string[][]
      expect(metaData).toContainEqual([
        'Truncated',
        'Excel row limit reached; use CSV for all rows'
      ])
    } finally {
      spy.mockRestore()
    }
  })

  it('successfully exports when destination filename has a 230-byte basename', async () => {
    insertVariant(db, caseId, { chr: '1', pos: 100 })
    const longBasename = 'a'.repeat(225) + '.xlsx'
    const output = join(tmpDir, longBasename)
    const params = makeXlsxParams({ outputFilePath: output })
    const result = await runExportPipeline(params)
    expect(result.filePath).toBe(output)
    expect(existsSync(output)).toBe(true)
    expect(statSync(output).size).toBeGreaterThan(0)
  })

  it('defaultExportTempFilePath keeps the basename short regardless of output filename length', () => {
    const longOutput = join(tmpDir, 'a'.repeat(230) + '.xlsx')
    const tempPath = defaultExportTempFilePath(longOutput)
    const tempBasename = tempPath.slice(tempPath.lastIndexOf('/') + 1)
    expect(tempBasename.length).toBeLessThan(70)
    expect(tempBasename.startsWith('.varlens-export-')).toBe(true)
  })

  describe('isDevicePath and device export handling', () => {
    it('returns false for regular files and non-existent files', () => {
      const regularFile = join(tmpDir, 'regular.csv')
      writeFileSync(regularFile, 'data')
      expect(isDevicePath(regularFile)).toBe(false)
      expect(isDevicePath(join(tmpDir, 'does-not-exist.csv'))).toBe(false)
    })

    it('does not classify /dev/shm files as device paths', () => {
      expect(isDevicePath('/dev/shm/results.csv')).toBe(false)
    })

    if (process.platform !== 'win32') {
      it('returns true for POSIX device paths like /dev/null', () => {
        expect(isDevicePath('/dev/null')).toBe(true)
      })
    } else {
      it('returns true for Windows device paths like NUL and pipe paths', () => {
        expect(isDevicePath('NUL')).toBe(true)
        expect(isDevicePath('\\\\.\\pipe\\test')).toBe(true)
      })
    }

    it('prepareExportFilePath does not treat /dev/shm paths as devices and uses a .part temp file', () => {
      const prep = prepareExportFilePath('/dev/shm/results.csv')
      expect(prep.isDevice).toBe(false)
      expect(prep.tempFilePath.startsWith('/dev/shm/.varlens-export-')).toBe(true)
      expect(prep.tempFilePath.endsWith('.part')).toBe(true)
    })

    if (process.platform === 'linux' && existsSync('/dev/shm')) {
      it('cleans up .part file on failed export under /dev/shm', async () => {
        try {
          accessSync('/dev/shm', constants.W_OK)
        } catch {
          return // /dev/shm not writeable in this test environment
        }
        const shmOutput = `/dev/shm/varlens-test-shm-${Date.now()}.xlsx`
        const prep = prepareExportFilePath(shmOutput)
        expect(prep.isDevice).toBe(false)

        const params = makeXlsxParams({
          outputFilePath: shmOutput,
          tempFilePath: prep.tempFilePath,
          compiledSql: 'SELECT invalid sql syntax'
        })

        await expect(runExportPipeline(params)).rejects.toThrow()
        expect(existsSync(prep.tempFilePath)).toBe(false)
        expect(existsSync(shmOutput)).toBe(false)
      })
    }
  })
})
