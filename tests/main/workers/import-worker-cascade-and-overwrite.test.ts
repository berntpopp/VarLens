// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { openWorkerDatabase } from '../../../src/main/workers/worker-db'
import { prepareStatements } from '../../../src/main/workers/import-pipeline'
import { runImportSession, type ImportWorkerPort } from '../../../src/main/workers/import-worker'
import type { WorkerMessage } from '../../../src/shared/types/import-worker'

describe('import worker cascade cleanup & overwrite file check (F01 & F02)', () => {
  let dbPath: string
  let db: DatabaseType

  beforeEach(() => {
    dbPath = join(tmpdir(), `varlens-test-${randomUUID()}.db`)
    db = new Database(dbPath)
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      // already closed
    }
    try {
      unlinkSync(dbPath)
      unlinkSync(dbPath + '-wal')
      unlinkSync(dbPath + '-shm')
    } catch {
      // best effort
    }
  })

  describe('F01: foreign-key cascade & rollback orphan cleanup', () => {
    it('cleans up all child records atomically when foreign_keys is OFF', () => {
      const workerDb = openWorkerDatabase(dbPath)
      const fkSetting = workerDb.pragma('foreign_keys', { simple: true })
      expect(fkSetting).toBe(0) // Verify foreign_keys is OFF

      const stmts = prepareStatements(workerDb)

      // Create two cases to ensure deletion of case 1 does not affect case 2
      const case1Result = stmts.insertCase.run('case-1', '/path/1', 100, Date.now(), 'GRCh38')
      const case1Id = Number(case1Result.lastInsertRowid)

      const case2Result = stmts.insertCase.run('case-2', '/path/2', 100, Date.now(), 'GRCh38')
      const case2Id = Number(case2Result.lastInsertRowid)

      // Insert variants and transcripts for case 1
      stmts.insertBatch(case1Id, [
        {
          chr: 'chr1',
          pos: 100,
          ref: 'A',
          alt: 'T',
          _transcripts: [
            { transcript_id: 'NM_001.1', gene_symbol: 'GENE1', is_selected: 1 },
            { transcript_id: 'NM_001.2', gene_symbol: 'GENE1', is_selected: 0 }
          ],
          _sv: {
            sv_is_precise: 1,
            cipos_left: -10,
            cipos_right: 10,
            ciend_left: -10,
            ciend_right: 10,
            support: 20,
            coverage: 40,
            strand: '+-',
            stdev_len: 2,
            stdev_pos: 2,
            vaf: 0.5,
            dr: 10,
            dv: 10,
            pe_support: 5,
            sr_support: 5,
            event_id: 'EV01',
            mate_id: 'M01'
          }
        },
        {
          chr: 'chr1',
          pos: 200,
          ref: 'C',
          alt: 'G',
          _transcripts: [{ transcript_id: 'NM_002.1', gene_symbol: 'GENE2', is_selected: 1 }]
        }
      ])

      // Insert variant for case 2
      stmts.insertBatch(case2Id, [
        {
          chr: 'chr2',
          pos: 500,
          ref: 'G',
          alt: 'A',
          _transcripts: [{ transcript_id: 'NM_003.1', gene_symbol: 'GENE3', is_selected: 1 }]
        }
      ])

      // Insert case_data_info for both
      stmts.insertDataInfo.run(case1Id, 'file1.json', 'json')
      stmts.insertDataInfo.run(case2Id, 'file2.json', 'json')

      // Insert case_variant_annotations if table exists
      try {
        const v1 = workerDb.prepare('SELECT id FROM variants WHERE case_id = ?').all(case1Id) as {
          id: number
        }[]
        for (const row of v1) {
          workerDb
            .prepare(
              `
            INSERT INTO case_variant_annotations (case_id, variant_id, created_at, updated_at)
            VALUES (?, ?, ?, ?)
          `
            )
            .run(case1Id, row.id, Date.now(), Date.now())
        }
      } catch {
        // table might not exist in all test contexts
      }

      // Assert records exist before delete
      const case1CountBefore = workerDb
        .prepare('SELECT COUNT(*) as c FROM cases WHERE id = ?')
        .get(case1Id) as { c: number }
      const var1CountBefore = workerDb
        .prepare('SELECT COUNT(*) as c FROM variants WHERE case_id = ?')
        .get(case1Id) as { c: number }
      const tx1CountBefore = workerDb
        .prepare(
          `
        SELECT COUNT(*) as c FROM variant_transcripts
        WHERE variant_id IN (SELECT id FROM variants WHERE case_id = ?)
      `
        )
        .get(case1Id) as { c: number }
      const sv1CountBefore = workerDb
        .prepare(
          `
        SELECT COUNT(*) as c FROM variant_sv
        WHERE variant_id IN (SELECT id FROM variants WHERE case_id = ?)
      `
        )
        .get(case1Id) as { c: number }
      const dataInfo1Before = workerDb
        .prepare('SELECT COUNT(*) as c FROM case_data_info WHERE case_id = ?')
        .get(case1Id) as { c: number }

      expect(case1CountBefore.c).toBe(1)
      expect(var1CountBefore.c).toBe(2)
      expect(tx1CountBefore.c).toBe(3)
      expect(sv1CountBefore.c).toBe(1)
      expect(dataInfo1Before.c).toBe(1)

      // Delete case 1 using deleteCase (simulating rollback or overwrite)
      stmts.deleteCase.run(case1Id)

      // Assert case 1 and all child records are deleted
      const case1CountAfter = workerDb
        .prepare('SELECT COUNT(*) as c FROM cases WHERE id = ?')
        .get(case1Id) as { c: number }
      const var1CountAfter = workerDb
        .prepare('SELECT COUNT(*) as c FROM variants WHERE case_id = ?')
        .get(case1Id) as { c: number }
      const tx1CountAfter = workerDb
        .prepare(
          `
        SELECT COUNT(*) as c FROM variant_transcripts
        WHERE variant_id IN (SELECT id FROM variants WHERE case_id = ?)
      `
        )
        .get(case1Id) as { c: number }
      const sv1CountAfter = workerDb
        .prepare(
          `
        SELECT COUNT(*) as c FROM variant_sv
        WHERE variant_id IN (SELECT id FROM variants WHERE case_id = ?)
      `
        )
        .get(case1Id) as { c: number }
      const dataInfo1After = workerDb
        .prepare('SELECT COUNT(*) as c FROM case_data_info WHERE case_id = ?')
        .get(case1Id) as { c: number }

      expect(case1CountAfter.c).toBe(0)
      expect(var1CountAfter.c).toBe(0)
      expect(tx1CountAfter.c).toBe(0)
      expect(sv1CountAfter.c).toBe(0)
      expect(dataInfo1After.c).toBe(0)

      // Assert case 2 and its children remain intact
      const case2CountAfter = workerDb
        .prepare('SELECT COUNT(*) as c FROM cases WHERE id = ?')
        .get(case2Id) as { c: number }
      const var2CountAfter = workerDb
        .prepare('SELECT COUNT(*) as c FROM variants WHERE case_id = ?')
        .get(case2Id) as { c: number }
      const tx2CountAfter = workerDb
        .prepare(
          `
        SELECT COUNT(*) as c FROM variant_transcripts
        WHERE variant_id IN (SELECT id FROM variants WHERE case_id = ?)
      `
        )
        .get(case2Id) as { c: number }
      const dataInfo2After = workerDb
        .prepare('SELECT COUNT(*) as c FROM case_data_info WHERE case_id = ?')
        .get(case2Id) as { c: number }

      expect(case2CountAfter.c).toBe(1)
      expect(var2CountAfter.c).toBe(1)
      expect(tx2CountAfter.c).toBe(1)
      expect(dataInfo2After.c).toBe(1)

      workerDb.close()
    })
  })

  describe('F02: file-existence check before case overwrite', () => {
    it('validates file existence before deleting existing case when duplicateStrategy is overwrite', async () => {
      // 1. Pre-populate a case in the database
      const workerDb = openWorkerDatabase(dbPath)
      const stmts = prepareStatements(workerDb)
      const existingCase = stmts.insertCase.run(
        'existing-sample',
        '/path/to/old.json',
        1024,
        Date.now(),
        'GRCh38'
      )
      const caseId = Number(existingCase.lastInsertRowid)

      stmts.insertBatch(caseId, [
        {
          chr: 'chr1',
          pos: 100,
          ref: 'A',
          alt: 'C',
          gene_symbol: 'TEST_GENE',
          consequence: 'MODERATE'
        }
      ])
      // A published case: a provisional one would be an interrupted import.
      workerDb.prepare("UPDATE cases SET import_status = 'ready' WHERE id = ?").run(caseId)
      workerDb.close()

      // 2. Attempt to import with duplicateStrategy: 'overwrite' but with a non-existent file
      const nonExistentPath = join(tmpdir(), `non-existent-${randomUUID()}.json`)
      const messages: WorkerMessage[] = []
      const port: ImportWorkerPort = {
        postMessage: (m) => messages.push(m)
      }

      await runImportSession(
        {
          type: 'start',
          dbPath,
          files: [
            {
              filePath: nonExistentPath,
              caseName: 'existing-sample',
              duplicateStrategy: 'overwrite'
            }
          ]
        },
        port
      )

      // 3. Verify the existing case and variants were NOT deleted
      const verifyDb = openWorkerDatabase(dbPath)
      const caseRow = verifyDb
        .prepare('SELECT id, name FROM cases WHERE name = ?')
        .get('existing-sample') as { id: number; name: string } | undefined
      expect(caseRow).toBeDefined()
      expect(caseRow?.id).toBe(caseId)

      const variantCount = verifyDb
        .prepare('SELECT COUNT(*) as c FROM variants WHERE case_id = ?')
        .get(caseId) as { c: number }
      expect(variantCount.c).toBe(1)
      verifyDb.close()

      // Verify the session recorded a failure
      const completeMsg = messages.find((m) => m.type === 'complete')
      expect(completeMsg).toBeDefined()
      if (completeMsg && completeMsg.type === 'complete') {
        expect(completeMsg.results.failed).toBe(1)
        expect(completeMsg.results.succeeded).toBe(0)
      }
    })

    it('successfully overwrites existing case when the new file exists and is valid', async () => {
      // 1. Pre-populate an existing case
      const workerDb = openWorkerDatabase(dbPath)
      const stmts = prepareStatements(workerDb)
      const existingCase = stmts.insertCase.run(
        'existing-sample',
        '/path/to/old.json',
        1024,
        Date.now(),
        'GRCh38'
      )
      const caseId = Number(existingCase.lastInsertRowid)

      stmts.insertBatch(caseId, [
        {
          chr: 'chr1',
          pos: 100,
          ref: 'A',
          alt: 'C',
          gene_symbol: 'OLD_GENE',
          consequence: 'LOW'
        }
      ])
      workerDb.close()

      // 2. Create a valid temporary JSON file
      const validPath = join(tmpdir(), `valid-${randomUUID()}.json`)
      writeFileSync(
        validPath,
        JSON.stringify({
          variants: [
            {
              chr: 'chr2',
              pos: 200,
              ref: 'G',
              alt: 'T',
              gene_symbol: 'NEW_GENE',
              consequence: 'HIGH'
            }
          ]
        })
      )

      const messages: WorkerMessage[] = []
      const port: ImportWorkerPort = {
        postMessage: (m) => messages.push(m)
      }

      try {
        await runImportSession(
          {
            type: 'start',
            dbPath,
            files: [
              {
                filePath: validPath,
                caseName: 'existing-sample',
                duplicateStrategy: 'overwrite'
              }
            ]
          },
          port
        )

        // 3. Verify the old case was replaced with the new one
        const verifyDb = openWorkerDatabase(dbPath)
        const cases = verifyDb
          .prepare('SELECT id, name FROM cases WHERE name = ?')
          .all('existing-sample') as { id: number; name: string }[]
        expect(cases.length).toBe(1)
        const newCaseId = cases[0].id

        const variants = verifyDb
          .prepare('SELECT chr, pos, gene_symbol FROM variants WHERE case_id = ?')
          .all(newCaseId) as { chr: string; pos: number; gene_symbol: string }[]
        expect(variants.length).toBe(1)
        expect(variants[0].chr).toBe('chr2')
        expect(variants[0].gene_symbol).toBe('NEW_GENE')

        // Ensure old variant row is gone
        const oldVariants = verifyDb
          .prepare('SELECT COUNT(*) as c FROM variants WHERE case_id = ?')
          .get(caseId) as { c: number }
        if (caseId !== newCaseId) {
          expect(oldVariants.c).toBe(0)
        }

        verifyDb.close()
      } finally {
        try {
          unlinkSync(validPath)
        } catch {
          // ignore
        }
      }
    })
  })
})
