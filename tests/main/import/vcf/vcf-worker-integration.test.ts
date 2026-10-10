// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import { prepareStatements, streamInsertVcf } from '../../../../src/main/workers/import-pipeline'

const SYNTHETIC_VCF = resolve(__dirname, '../../../test-data/vcf/synthetic-unit-test.vcf')

describe('VCF import worker integration', () => {
  let db: DatabaseService

  beforeEach(() => {
    db = new DatabaseService(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('imports multiple samples sequentially (multi-sample workflow)', async () => {
    const stmts = prepareStatements(db.database)
    const samples = ['HG005', 'HG006', 'HG007']
    const caseIds: number[] = []
    const variantCounts: number[] = []

    for (const sample of samples) {
      const caseId = db.cases.createCase(`case-${sample}`, SYNTHETIC_VCF, 1000)
      caseIds.push(caseId)

      const count = await streamInsertVcf(
        SYNTHETIC_VCF,
        { format: 'vcf', caseKey: '' },
        caseId,
        1000,
        stmts,
        () => false,
        [sample],
        () => {}
      )

      variantCounts.push(count)
      expect(count).toBeGreaterThan(0)
    }

    // Each sample should have variants (counts may differ by genotype)
    for (const count of variantCounts) {
      expect(count).toBeGreaterThan(0)
    }

    // Verify each case has the right variant count in DB
    for (let i = 0; i < samples.length; i++) {
      const count = db.database
        .prepare('SELECT COUNT(*) as cnt FROM variants WHERE case_id = ?')
        .get(caseIds[i]) as { cnt: number }
      expect(count.cnt).toBe(variantCounts[i])
    }
  })

  it('populates variant_transcripts for CSQ-annotated variants', async () => {
    const stmts = prepareStatements(db.database)
    const caseId = db.cases.createCase('test-transcripts', SYNTHETIC_VCF, 1000)

    await streamInsertVcf(
      SYNTHETIC_VCF,
      { format: 'vcf', caseKey: '' },
      caseId,
      1000,
      stmts,
      () => false,
      ['HG005'],
      () => {}
    )

    // Check that variant_transcripts were created
    const transcripts = db.database
      .prepare(
        `SELECT vt.* FROM variant_transcripts vt
         JOIN variants v ON vt.variant_id = v.id
         WHERE v.case_id = ?`
      )
      .all(caseId) as Array<Record<string, unknown>>

    expect(transcripts.length).toBeGreaterThan(0)

    // Check that at least one is_selected = 1
    const selectedCount = transcripts.filter((t) => t.is_selected === 1).length
    expect(selectedCount).toBeGreaterThan(0)

    const IMPACT_LEVELS = new Set(['HIGH', 'MODERATE', 'LOW', 'MODIFIER'])
    for (const t of transcripts) {
      if (t.consequence !== null) {
        expect(IMPACT_LEVELS.has(t.consequence as string)).toBe(true)
      }
    }
    const withFunc = transcripts.filter((t) => t.func !== null)
    expect(withFunc.length).toBeGreaterThan(0)
    for (const t of withFunc) {
      expect(IMPACT_LEVELS.has(t.func as string)).toBe(false)
    }
  })

  it('handles cancellation via isCancelled callback', async () => {
    const stmts = prepareStatements(db.database)
    const caseId = db.cases.createCase('test-cancel', SYNTHETIC_VCF, 1000)

    const count = await streamInsertVcf(
      SYNTHETIC_VCF,
      { format: 'vcf', caseKey: '' },
      caseId,
      1000,
      stmts,
      () => true,
      ['HG005'],
      () => {}
    )

    // Should complete with 0 variants (cancelled immediately)
    expect(count).toBe(0)
  })

  it('stores VCF-specific fields (gq, dp, filter, source_format)', async () => {
    const stmts = prepareStatements(db.database)
    const caseId = db.cases.createCase('test-vcf-fields', SYNTHETIC_VCF, 1000)

    await streamInsertVcf(
      SYNTHETIC_VCF,
      { format: 'vcf', caseKey: '' },
      caseId,
      1000,
      stmts,
      () => false,
      ['HG005'],
      () => {}
    )

    // Verify VCF-specific columns are populated
    const variants = db.database
      .prepare('SELECT * FROM variants WHERE case_id = ?')
      .all(caseId) as Array<Record<string, unknown>>

    expect(variants.length).toBeGreaterThan(0)

    // At least some variants should have genotype quality
    const withGq = variants.filter((v) => v.gq !== null)
    expect(withGq.length).toBeGreaterThan(0)

    // All should be marked as VCF source format
    const withSourceFormat = variants.filter((v) => v.source_format === 'vcf')
    expect(withSourceFormat.length).toBe(variants.length)

    // Filter field should be populated
    const withFilter = variants.filter((v) => v.filter !== null)
    expect(withFilter.length).toBeGreaterThan(0)
  })
})
