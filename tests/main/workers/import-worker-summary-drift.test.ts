// @vitest-environment node
/**
 * The import worker keeps cohort_variant_summary and gene_burden_summary equal
 * to a full rebuild after EVERY imported file (cohort-summary-case-add.ts),
 * without marking the summary stale for the session.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'

import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { MARK_STALE_SQL } from '../../../src/shared/sql/cohort-summary-rebuild'
import { runImportSession } from '../../../src/main/workers/import-worker'
import type { MainMessage, WorkerMessage } from '../../../src/shared/types/import-worker'
import { referenceSummary, snapshotSummary, summaryMeta } from './support/summary-reference'

type StartMessage = Extract<MainMessage, { type: 'start' }>
type Variant = Record<string, string | number | null>

const v = (pos: number, gene: string | null, extra: Variant = {}): Variant => ({
  chr: 'chr1',
  pos,
  ref: 'A',
  alt: 'G',
  gene_symbol: gene,
  gt_num: '0/1',
  consequence: 'MODERATE',
  func: 'missense_variant',
  ...extra
})

/**
 * Samples share coordinates but disagree on annotation: pos 100 changes gene
 * and CADD between samples (incl. NULL), pos 300 carries two genes inside one
 * case (the summary's MAX gene then differs from a later case's gene), pos 400
 * is duplicated within a case.
 */
const SAMPLES: Record<string, Variant[]> = {
  S0: [
    v(100, 'AAA', { cadd: 10, clinvar: 'Benign', gnomad_af: 0.1 }),
    v(200, 'AAA', { gt_num: '1/1' }),
    v(300, 'AAA'),
    v(300, 'ZZZ'),
    v(500, 'CCC', { cadd: 5 })
  ],
  OLD: [v(100, 'AAA', { cadd: 30 }), v(600, 'DDD', { gt_num: '1|1' }), v(500, 'CCC', { cadd: 9 })],
  S1: [
    v(100, 'BBB', { cadd: 20, clinvar: 'Pathogenic' }),
    v(200, 'AAA'),
    v(300, 'AAA'),
    v(400, 'EEE'),
    v(400, 'EEE', { gt_num: '1/1' }),
    v(700, null)
  ],
  OLD_V2: [v(100, 'AAA', { cadd: null }), v(800, 'DDD'), v(200, '')],
  S2: [
    v(100, 'AAA', { cadd: null, gnomad_af: 0.5 }),
    v(300, 'MMM'),
    v(800, 'DDD', { gt_num: './.' })
  ],
  S37: [v(100, 'AAA', { cadd: 99 }), v(300, 'ZZZ'), v(900, 'FFF')],
  S9: [v(100, 'AAA'), v(1000, 'GGG')]
}

describe('import worker: per-file cohort summary upkeep', () => {
  let dir: string
  let dbPath: string
  let db: DatabaseType

  const fileFor = (name: string): string => {
    const path = join(dir, `${name}.json`)
    writeFileSync(path, JSON.stringify({ variants: SAMPLES[name] }))
    return path
  }
  const request = (
    sample: string,
    caseName = sample,
    extra: Partial<StartMessage['files'][number]> = {}
  ): StartMessage['files'][number] =>
    ({ filePath: fileFor(sample), caseName, ...extra }) as StartMessage['files'][number]

  /** Runs a session, asserting exactness (and the meta state) after every completed file. */
  async function runSession(
    files: StartMessage['files'],
    options: { cancelAfterFiles?: number; discardCaseIds?: number[] } = {}
  ): Promise<WorkerMessage[]> {
    const messages: WorkerMessage[] = []
    let completed = 0
    await runImportSession(
      { type: 'start', files, dbPath, discardCaseIds: options.discardCaseIds } as StartMessage,
      {
        postMessage: (m) => {
          messages.push(m)
          if (m.type !== 'file-complete') return
          completed++
          expect(snapshotSummary(db), `after ${m.result.caseName}`).toEqual(referenceSummary(db))
          expect(summaryMeta(db, 'is_stale')).toBe('0')
          expect(summaryMeta(db, 'import_session_open')).toBe('1')
        }
      },
      () => options.cancelAfterFiles !== undefined && completed >= options.cancelAfterFiles
    )
    return messages
  }

  const statuses = (messages: WorkerMessage[]): string[] => {
    const done = messages.find((m) => m.type === 'complete')
    if (done?.type !== 'complete') throw new Error('session did not complete')
    return done.results.details.map((d) => `${d.caseName}:${d.status}`)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-summary-drift-'))
    dbPath = join(dir, 'test.db')
    db = new Database(dbPath)
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Two cases plus global and per-case annotations that exist before the batch. */
  async function seedAnnotatedCohort(): Promise<void> {
    await runSession([request('S0'), request('OLD')])
    const now = Date.now()
    const annotate = db.prepare(
      `INSERT INTO variant_annotations
         (chr, pos, ref, alt, global_comment, starred, acmg_classification, created_at, updated_at)
       VALUES ('chr1', ?, 'A', 'G', ?, ?, ?, ${now}, ${now})`
    )
    annotate.run(100, 'shared', 1, 'Likely benign')
    annotate.run(400, null, 1, null) // not carried by anyone until S1 arrives
    annotate.run(800, 'later', 0, 'Pathogenic')
    const perCase = db.prepare(
      `INSERT INTO case_variant_annotations
         (case_id, variant_id, per_case_comment, starred, acmg_classification, created_at, updated_at)
       SELECT v.case_id, v.id, ?, ?, ?, ${now}, ${now}
       FROM variants v JOIN cases c ON c.id = v.case_id
       WHERE c.name = ? AND v.pos = ? LIMIT 1`
    )
    perCase.run('keep', 1, 'Pathogenic', 'S0', 200)
    // pos 100 is recomputed when OLD (its CADD maximum) is replaced, and gains a
    // GRCh37 sibling row later: both must pick this per-case call up again.
    perCase.run(null, 0, 'Pathogenic', 'S0', 100)
    perCase.run('gone with the overwrite', 1, 'Pathogenic', 'OLD', 500)
    perCase.run(null, 1, 'Likely pathogenic', 'OLD', 100)
    expect(snapshotSummary(db)).toEqual(referenceSummary(db))
  }

  it('leaves a fresh database current, not stale, with the session marker cleared', async () => {
    const messages = await runSession([request('S0')])
    expect(statuses(messages)).toEqual(['S0:success'])
    expect(summaryMeta(db, 'is_stale')).toBe('0')
    expect(summaryMeta(db, 'import_session_open')).toBeUndefined()
    const summary = snapshotSummary(db)
    expect(summary).toEqual(referenceSummary(db))
    expect(summary.variants).toHaveLength(4)
    expect(summary.variants).toContainEqual(
      expect.objectContaining({ pos: 200, carrier_count: 1, het_count: 0, hom_count: 1 })
    )
    expect(summary.genes).toContainEqual({
      gene_symbol: 'AAA',
      genome_build: 'GRCh38',
      variant_count: 3,
      unique_variant_count: 3,
      affected_case_count: 1
    })
  })

  it('stays exact through overwrite, skipped duplicate, failing file and cancel', async () => {
    await seedAnnotatedCohort()
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{"variants": [{"chr": "chr1", "pos": ')

    const messages = await runSession(
      [
        request('S1'),
        request('OLD_V2', 'OLD', { isDuplicate: true, duplicateStrategy: 'overwrite' }),
        request('S0', 'S0', { isDuplicate: true, duplicateStrategy: 'skip' }),
        { filePath: broken, caseName: 'BROKEN' } as StartMessage['files'][number],
        request('S2'),
        request('S37', 'S37', { vcfGenomeBuild: 'GRCh37' }),
        request('S9')
      ],
      { cancelAfterFiles: 4 }
    )

    expect(statuses(messages)).toEqual([
      'S1:success',
      'OLD:success',
      'S0:skipped',
      'BROKEN:failed',
      'S2:success',
      'S37:success',
      'S9:skipped'
    ])
    const summary = snapshotSummary(db)
    expect(summary).toEqual(referenceSummary(db))
    expect(summaryMeta(db, 'is_stale')).toBe('0')
    expect(summaryMeta(db, 'import_session_open')).toBeUndefined()

    // Spot checks, so the comparison is not two wrong answers agreeing.
    const row = (pos: number, build = 'GRCh38') =>
      summary.variants.find((r) => {
        const s = r as { pos: number; genome_build: string }
        return s.pos === pos && s.genome_build === build
      })
    expect(row(100)).toMatchObject({
      carrier_count: 4,
      gene_symbol: 'BBB',
      cadd: 20,
      gnomad_af: 0.5,
      clinvar: 'Pathogenic',
      has_star: 1,
      has_comment: 1,
      acmg_best: 'Pathogenic'
    })
    expect(row(100, 'GRCh37')).toMatchObject({
      carrier_count: 1,
      cadd: 99,
      has_star: 1,
      acmg_best: 'Pathogenic'
    })
    expect(row(200)).toMatchObject({ carrier_count: 3, has_star: 1, acmg_best: 'Pathogenic' })
    expect(row(400)).toMatchObject({ carrier_count: 1, hom_count: 1, has_star: 1 })
    expect(row(500)).toMatchObject({ carrier_count: 1, cadd: 5, has_star: 0, acmg_best: null })
    expect(row(600)).toBeUndefined()
    expect(row(1000)).toBeUndefined()
    expect(summary.genes).toContainEqual({
      gene_symbol: 'AAA',
      genome_build: 'GRCh38',
      variant_count: 7,
      unique_variant_count: 3,
      affected_case_count: 4
    })
    expect(summary.genes).toContainEqual(
      expect.objectContaining({ gene_symbol: 'EEE', variant_count: 2, unique_variant_count: 1 })
    )
    expect(summary.genes).toContainEqual(
      expect.objectContaining({ gene_symbol: 'MMM', unique_variant_count: 1 })
    )
  })

  it('removes a replaced case exactly even when its replacement fails to import', async () => {
    await seedAnnotatedCohort()
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{"variants": [{"chr": "chr1", "pos": ')

    const messages = await runSession([
      {
        filePath: broken,
        caseName: 'OLD',
        isDuplicate: true,
        duplicateStrategy: 'overwrite'
      } as StartMessage['files'][number]
    ])

    expect(statuses(messages)).toEqual(['OLD:failed'])
    const summary = snapshotSummary(db)
    expect(summary).toEqual(referenceSummary(db))
    expect(summary.variants).toContainEqual(
      expect.objectContaining({ pos: 100, carrier_count: 1, cadd: 10, acmg_best: 'Pathogenic' })
    )
    expect(summary.variants).toContainEqual(
      expect.objectContaining({ pos: 500, carrier_count: 1, has_star: 0, acmg_best: null })
    )
    expect(summaryMeta(db, 'is_stale')).toBe('0')
  })

  it('rebuilds a stale summary once at session start, then continues incrementally', async () => {
    await runSession([request('S0')])
    db.exec('DELETE FROM cohort_variant_summary; DELETE FROM gene_burden_summary;')
    db.exec(MARK_STALE_SQL)

    await runSession([request('S1'), request('S2')])
    expect(snapshotSummary(db)).toEqual(referenceSummary(db))
    expect(summaryMeta(db, 'is_stale')).toBe('0')
  })

  it('rebuilds after a crashed worker left the session marker or a partial case', async () => {
    await runSession([request('S0'), request('S1')])
    // A worker that died mid-session: marker set, summary missing a committed case.
    db.exec(
      "INSERT OR REPLACE INTO cohort_summary_meta (key, value) VALUES ('import_session_open', '1')"
    )
    db.exec('DELETE FROM cohort_variant_summary WHERE pos = 400')

    const service = new DatabaseService(dbPath)
    try {
      expect(service.needsStartupRebuild()).toBe(true)
    } finally {
      service.close()
    }

    const s1 = db.prepare("SELECT id FROM cases WHERE name = 'S1'").get() as { id: number }
    const messages = await runSession([], { discardCaseIds: [s1.id] })
    expect(statuses(messages)).toEqual([])
    const summary = snapshotSummary(db)
    expect(summary).toEqual(referenceSummary(db))
    expect(summary.genes.map((g) => (g as { gene_symbol: string }).gene_symbol)).not.toContain(
      'EEE'
    )
    expect(summaryMeta(db, 'import_session_open')).toBeUndefined()

    const reopened = new DatabaseService(dbPath)
    try {
      expect(reopened.needsStartupRebuild()).toBe(false)
    } finally {
      reopened.close()
    }
  })
})
