// @vitest-environment node
/**
 * #551: the 2nd..Nth file of a multi-file case is appended by the import
 * worker. One file is one transaction (rows, variant_count, summary flag), so
 * cancel, failure and a crash leave nothing of a file half in, and search
 * finds the appended rows — base and SV — whether the session kept its row
 * triggers or rebuilt the index.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import { ftsTriggersComplete } from '../../../src/main/database/fts-trigger-management'
import { repairInterruptedImportSession } from '../../../src/main/workers/import-finalization'
import { sessionIndexesMissing } from '../../../src/main/workers/import-index-sql'
import type { MainMessage, WorkerMessage } from '../../../src/shared/types/import-worker'
import { bundleWorker } from '../../utils/bundle-worker'
import { referenceSummary, snapshotSummary, summaryMeta } from './support/summary-reference'
import {
  openSummarySessionHarness,
  sessionStatuses,
  variantAt,
  type SessionFile,
  type SummarySessionHarness
} from './support/summary-session-harness'

/** Rows of the case that carry SV details (variant_sv). */
const svRows = (db: InstanceType<typeof Database>, caseId: number): number =>
  (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM variant_sv s JOIN variants v ON v.id = s.variant_id WHERE v.case_id = ?'
      )
      .get(caseId) as { c: number }
  ).c

describe('import worker: multi-file append (#551)', () => {
  let h: SummarySessionHarness
  let workerPath: string

  beforeAll(async () => {
    workerPath = await bundleWorker('src/main/workers/import-worker.ts')
  })

  beforeEach(() => {
    h = openSummarySessionHarness()
  })

  afterEach(() => {
    h.close()
  })

  const caseId = (name: string): number =>
    (h.db.prepare('SELECT id FROM cases WHERE name = ?').get(name) as { id: number }).id
  const counts = (id: number): { stored: number; counted: number } =>
    h.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM variants WHERE case_id = $id) AS stored,
                (SELECT variant_count FROM cases WHERE id = $id) AS counted`
      )
      .get({ id }) as { stored: number; counted: number }
  /** Index hits joined to stored rows of the case. */
  const found = (table: 'variants_fts' | 'variant_sv_fts', term: string, id: number): number =>
    (
      h.db
        .prepare(
          `SELECT COUNT(*) AS c FROM ${table} f JOIN variants v ON v.id = f.rowid
            WHERE ${table} MATCH ? AND v.case_id = ?`
        )
        .get(term, id) as { c: number }
    ).c
  const hasTrigger = (name: string): boolean =>
    h.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name) !==
    undefined
  const appendFile = (filePath: string, id: number): SessionFile =>
    ({
      filePath,
      caseName: 'A',
      isDuplicate: false,
      duplicateStrategy: 'skip',
      appendToCaseId: id
    }) as SessionFile

  /**
   * A Sniffles-style VCF of `n` deletions on `chr`, each with an EVENT (the
   * SV search field) and an ANN gene (the base search field).
   */
  function svFile(name: string, n: number, chr: string, gene: string): string {
    const header = [
      '##fileformat=VCFv4.2',
      '##source=Sniffles2_2.6.3',
      '##INFO=<ID=SVTYPE,Number=1,Type=String,Description="t">',
      '##INFO=<ID=SVLEN,Number=1,Type=Integer,Description="l">',
      '##INFO=<ID=END,Number=1,Type=Integer,Description="e">',
      '##INFO=<ID=EVENT,Number=1,Type=String,Description="event">',
      `##INFO=<ID=ANN,Number=.,Type=String,Description="Functional annotations: 'Allele | Annotation | Annotation_Impact | Gene_Name | Gene_ID | Feature_Type | Feature_ID | Transcript_BioType | Rank | HGVS.c | HGVS.p | cDNA.pos / cDNA.length | CDS.pos / CDS.length | AA.pos / AA.length | Distance | ERRORS / WARNINGS / INFO' ">`,
      '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE1'
    ]
    const rows = Array.from({ length: n }, (_, i) => {
      const pos = 1000 + i * 100
      const info = `SVTYPE=DEL;SVLEN=-50;END=${pos + 50};EVENT=${name}ev${i};ANN=<DEL>|exon_loss_variant|HIGH|${gene}|${gene}|transcript|NM_1.1|protein_coding|1/2|c.1del||||||`
      return `${chr}\t${pos}\t${name}.${i}\tN\t<DEL>\t60\tPASS\t${info}\tGT\t0/1`
    })
    const path = join(h.dbPath, '..', `${name}.vcf`)
    writeFileSync(path, [...header, ...rows].join('\n') + '\n')
    return path
  }

  it('appends base and SV rows in one transaction and keeps search and counts exact', async () => {
    await h.run([h.file('A', [variantAt(100, 'BASEGENE')])])
    const id = caseId('A')

    const messages = await h.run([appendFile(svFile('sv', 5, 'chr1', 'SVGENE'), id)])

    expect(sessionStatuses(messages)).toEqual(['A:success'])
    expect(svRows(h.db, id)).toBeGreaterThan(0)
    const { stored, counted } = counts(id)
    expect(counted).toBe(stored)
    expect(found('variants_fts', 'BASEGENE', id)).toBe(1)
    expect(found('variants_fts', 'SVGENE', id)).toBe(5)
    expect(found('variant_sv_fts', 'svev3', id)).toBe(1)
    expect(svRows(h.db, id)).toBe(5)
    expect(hasTrigger('variant_sv_fts_ai')).toBe(true)
    expect(hasTrigger('variants_fts_ai')).toBe(true)
    // The worker rebuilt the summary it flagged stale with the append.
    expect(summaryMeta(h.db, 'is_stale')).toBe('0')
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
  })

  it('rolls a cancelled file back completely', async () => {
    await h.run([h.file('A', [variantAt(100, 'BASEGENE')])])
    const id = caseId('A')
    const before = counts(id)

    const messages = await h.run([appendFile(svFile('big', 2_000, 'chr2', 'BIGGENE'), id)], {
      batchSize: 100,
      isCancelled: (() => {
        let polls = 0
        return () => ++polls > 300
      })()
    })

    expect(sessionStatuses(messages)).toEqual(['A:skipped'])
    expect(counts(id)).toEqual(before)
    expect(found('variants_fts', 'BASEGENE', id)).toBe(1)
  })

  it('rolls a failed file back and imports the next one', async () => {
    await h.run([h.file('A', [variantAt(100, 'BASEGENE')])])
    const id = caseId('A')
    const broken = join(h.dbPath, '..', 'broken.vcf')
    writeFileSync(broken, '##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\n')

    const messages = await h.run([
      appendFile(broken, id),
      appendFile(svFile('sv', 5, 'chr1', 'SVGENE'), id)
    ])

    expect(sessionStatuses(messages)).toEqual(['A:failed', 'A:success'])
    const { stored, counted } = counts(id)
    expect(counted).toBe(stored)
    expect(stored).toBe(6)
  })

  it('names the case it appends to as a replacement, so a crash recovery never deletes it', async () => {
    await h.run([h.file('A', [variantAt(100, 'BASEGENE')])])
    const id = caseId('A')

    const messages = await h.run([appendFile(svFile('sv', 5, 'chr1', 'SVGENE'), id)])

    // ImportWorkerClient runs a recovery session after a crash and passes
    // discardCaseIds [] for a replacement (import-worker-heap-limit.test.ts).
    const started = messages.filter((m) => m.type === 'case-started')
    expect(started).toEqual([{ type: 'case-started', fileIndex: 0, caseId: id, replacement: true }])
    expect(messages.indexOf(started[0])).toBeLessThan(
      messages.findIndex((m) => m.type === 'file-complete')
    )
  })

  it('keeps the field dictionary of a case that has no provenance row yet', async () => {
    await h.run([h.file('A', [variantAt(100, 'BASEGENE')])])
    const id = caseId('A')
    h.db.prepare('DELETE FROM case_data_info WHERE case_id = ?').run(id)

    await h.run([appendFile(svFile('sv', 5, 'chr1', 'SVGENE'), id)])

    const row = h.db
      .prepare('SELECT field_dictionary FROM case_data_info WHERE case_id = ?')
      .get(id) as { field_dictionary: string | null } | undefined
    expect(row?.field_dictionary).not.toBeNull()
    expect(Object.keys(JSON.parse(row?.field_dictionary ?? '{}')).length).toBeGreaterThan(0)
  })

  it('merges the field dictionary into an existing provenance row, keeping its file name', async () => {
    await h.run([h.file('A', [variantAt(100, 'BASEGENE')])])
    const id = caseId('A')
    const before = h.db
      .prepare('SELECT import_file_name FROM case_data_info WHERE case_id = ?')
      .get(id) as { import_file_name: string }

    await h.run([appendFile(svFile('sv', 5, 'chr1', 'SVGENE'), id)])

    const row = h.db
      .prepare('SELECT import_file_name, field_dictionary FROM case_data_info WHERE case_id = ?')
      .get(id) as { import_file_name: string; field_dictionary: string | null }
    expect(row.import_file_name).toBe(before.import_file_name)
    expect(Object.keys(JSON.parse(row.field_dictionary ?? '{}')).length).toBeGreaterThan(0)
  })

  it('refuses a case that is not published', async () => {
    const messages = await h.run([appendFile(svFile('sv', 5, 'chr1', 'SVGENE'), 999)])
    expect(sessionStatuses(messages)).toEqual(['A:failed'])
  })

  it('a crash after file 2 commits leaves files 1-2 searchable and counted after reopen', async () => {
    await h.run([h.file('A', [variantAt(100, 'BASEGENE')])])
    const id = caseId('A')
    const files = [
      appendFile(svFile('one', 5, 'chr1', 'ONEGENE'), id),
      appendFile(svFile('two', 5, 'chr3', 'TWOGENE'), id),
      appendFile(svFile('big', 20_000, 'chr2', 'BIGGENE'), id)
    ]

    // The real worker, killed as soon as the second append is reported.
    await new Promise<void>((done, fail) => {
      const worker = new Worker(workerPath)
      worker.on('error', fail)
      worker.on('message', (msg: WorkerMessage) => {
        if (msg.type === 'file-complete' && msg.fileIndex === 1) {
          void worker.terminate().then(() => done())
        } else if (msg.type === 'complete') {
          fail(new Error('the session finished before it was killed'))
        }
      })
      worker.postMessage({
        type: 'start',
        files,
        dbPath: h.dbPath,
        throttleMs: 0,
        batchSize: 500
      } satisfies MainMessage)
    })

    // The recovery session ImportWorkerClient starts for a crashed
    // replacement (discardCaseIds []): the case stays, FTS and indexes return.
    await h.run([], { discardCaseIds: [] })
    expect(h.db.prepare('SELECT import_status FROM cases WHERE id = ?').get(id)).toEqual({
      import_status: 'ready'
    })
    expect(ftsTriggersComplete(h.db)).toBe(true)
    expect(sessionIndexesMissing(h.db)).toBe(false)

    // Reopen as the app does: startup repair has nothing left to do.
    const reopened = new Database(h.dbPath)
    try {
      expect(repairInterruptedImportSession(reopened)).toBe(false)
      const sv = svRows(reopened, id)
      const row = reopened
        .prepare(
          `SELECT (SELECT COUNT(*) FROM variants WHERE case_id = $id) AS stored,
                  (SELECT variant_count FROM cases WHERE id = $id) AS counted`
        )
        .get({ id }) as { stored: number; counted: number }
      expect(row.counted).toBe(row.stored)
      // Base row + the two committed files; nothing of the killed third.
      expect(sv).toBe(10)
      expect(row.stored).toBe(11)
      const match = (sql: string, term: string): number =>
        (reopened.prepare(sql).get(term, id) as { c: number }).c
      expect(
        match(
          `SELECT COUNT(*) AS c FROM variants_fts f JOIN variants v ON v.id = f.rowid
            WHERE variants_fts MATCH ? AND v.case_id = ?`,
          'TWOGENE'
        )
      ).toBe(5)
      expect(
        match(
          `SELECT COUNT(*) AS c FROM variant_sv_fts f JOIN variants v ON v.id = f.rowid
            WHERE variant_sv_fts MATCH ? AND v.case_id = ?`,
          'twoev4'
        )
      ).toBe(1)
      expect(
        reopened
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get('variant_sv_fts_ai')
      ).toBeDefined()
    } finally {
      reopened.close()
    }
  }, 60_000)
})
