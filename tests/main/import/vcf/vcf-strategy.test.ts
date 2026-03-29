// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import { VcfStrategy } from '../../../../src/main/import/vcf/VcfStrategy'
import { detectFormat } from '../../../../src/main/import/format-detection'
import type { ImportOptions } from '../../../../src/main/import/types'
import type { StrategyContext } from '../../../../src/main/import/strategies/ImportStrategy'

const SYNTHETIC_VCF = resolve(__dirname, '../../../test-data/vcf/synthetic-unit-test.vcf')
const SINGLE_SAMPLE_VCF = resolve(__dirname, '../../../test-data/vcf/single-sample.vcf.gz')
const VEP_VCF = resolve(__dirname, '../../../test-data/vcf/trio-region.vep.vcf.gz')
const SNPEFF_VCF = resolve(__dirname, '../../../test-data/vcf/trio-region.snpeff.vcf.gz')

describe('VcfStrategy', () => {
  let db: DatabaseService
  const strategy = new VcfStrategy()

  beforeEach(() => {
    db = new DatabaseService(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('has formatId "vcf"', () => {
    expect(strategy.formatId).toBe('vcf')
  })

  it('canHandle returns true for VCF format', () => {
    expect(strategy.canHandle({ format: 'vcf', caseKey: '' })).toBe(true)
  })

  it('canHandle returns false for JSON formats', () => {
    expect(strategy.canHandle({ format: 'columnar', caseKey: 'test' })).toBe(false)
    expect(strategy.canHandle({ format: 'object', caseKey: 'test' })).toBe(false)
    expect(strategy.canHandle({ format: 'simple', caseKey: 'test' })).toBe(false)
  })

  it('imports synthetic VCF for sample HG005', async () => {
    const caseId = db.cases.createCase('test-hg005', SYNTHETIC_VCF, 1000)

    const options: ImportOptions = {
      caseName: 'test-hg005'
    }

    const context: StrategyContext = {
      db,
      formatInfo: { format: 'vcf', caseKey: '' },
      caseId,
      startTime: Date.now()
    }

    const result = await strategy.import(SYNTHETIC_VCF, options, context, {
      selectedSamples: ['HG005'],
      genomeBuild: 'GRCh38'
    })

    expect(result.caseId).toBe(caseId)
    expect(result.variantCount).toBeGreaterThan(0)
    expect(result.errors).toEqual([])

    // Verify variants are in the database
    const variants = db.database
      .prepare('SELECT * FROM variants WHERE case_id = ?')
      .all(caseId) as Array<Record<string, unknown>>
    expect(variants.length).toBe(result.variantCount)

    // Check that VCF-specific fields are populated
    const firstVariant = variants.find((v) => v.pos === 20000100) as
      | Record<string, unknown>
      | undefined
    expect(firstVariant).toBeDefined()
    expect(firstVariant!.gt_num).toBe('0/1')
    expect(firstVariant!.gq).toBe(99)
    expect(firstVariant!.source_format).toBe('vcf')
    expect(firstVariant!.filter).toBe('PASS')
  })

  it('skips ref-hom variants for sample HG006', async () => {
    const caseId = db.cases.createCase('test-hg006', SYNTHETIC_VCF, 1000)

    const options: ImportOptions = { caseName: 'test-hg006' }
    const context: StrategyContext = {
      db,
      formatInfo: { format: 'vcf', caseKey: '' },
      caseId,
      startTime: Date.now()
    }

    const result = await strategy.import(SYNTHETIC_VCF, options, context, {
      selectedSamples: ['HG006'],
      genomeBuild: 'GRCh38'
    })

    // HG006 has fewer non-ref variants than HG005
    expect(result.variantCount).toBeGreaterThan(0)
    expect(result.skipped).toBeGreaterThan(0) // Some lines skipped as ref-hom
  })

  it('uses first sample when no selectedSamples provided', async () => {
    const caseId = db.cases.createCase('test-default', SYNTHETIC_VCF, 1000)

    const options: ImportOptions = { caseName: 'test-default' }
    const context: StrategyContext = {
      db,
      formatInfo: { format: 'vcf', caseKey: '' },
      caseId,
      startTime: Date.now()
    }

    // No vcfOptions => uses first sample (HG005)
    const result = await strategy.import(SYNTHETIC_VCF, options, context)

    expect(result.variantCount).toBeGreaterThan(0)
    expect(result.errors).toEqual([])
  })

  it('imports single-sample gzipped VCF', async () => {
    const caseId = db.cases.createCase('test-single', SINGLE_SAMPLE_VCF, 1000)

    const options: ImportOptions = { caseName: 'test-single' }
    const context: StrategyContext = {
      db,
      formatInfo: { format: 'vcf', caseKey: '' },
      caseId,
      startTime: Date.now()
    }

    const result = await strategy.import(SINGLE_SAMPLE_VCF, options, context)

    expect(result.caseId).toBe(caseId)
    expect(result.variantCount).toBeGreaterThan(0)
    expect(result.errors).toEqual([])
  })

  it('imports VEP-annotated VCF', async () => {
    const caseId = db.cases.createCase('test-vep', VEP_VCF, 1000)

    const options: ImportOptions = { caseName: 'test-vep' }
    const context: StrategyContext = {
      db,
      formatInfo: { format: 'vcf', caseKey: '' },
      caseId,
      startTime: Date.now()
    }

    const result = await strategy.import(VEP_VCF, options, context)

    expect(result.caseId).toBe(caseId)
    expect(result.variantCount).toBeGreaterThan(0)
    expect(result.errors).toEqual([])

    // Verify annotation fields are populated
    const variants = db.database
      .prepare('SELECT * FROM variants WHERE case_id = ? AND gene_symbol IS NOT NULL')
      .all(caseId) as Array<Record<string, unknown>>
    expect(variants.length).toBeGreaterThan(0)
  })

  it('imports SnpEff-annotated VCF', async () => {
    const caseId = db.cases.createCase('test-snpeff', SNPEFF_VCF, 1000)

    const options: ImportOptions = { caseName: 'test-snpeff' }
    const context: StrategyContext = {
      db,
      formatInfo: { format: 'vcf', caseKey: '' },
      caseId,
      startTime: Date.now()
    }

    const result = await strategy.import(SNPEFF_VCF, options, context)

    expect(result.caseId).toBe(caseId)
    expect(result.variantCount).toBeGreaterThan(0)
    expect(result.errors).toEqual([])

    // Verify annotation fields are populated
    const variants = db.database
      .prepare('SELECT * FROM variants WHERE case_id = ? AND gene_symbol IS NOT NULL')
      .all(caseId) as Array<Record<string, unknown>>
    expect(variants.length).toBeGreaterThan(0)
  })
})

describe('format-detection for VCF', () => {
  it('detects .vcf file as VCF format', async () => {
    const result = await detectFormat(SYNTHETIC_VCF)
    expect(result.format).toBe('vcf')
    expect(result.caseKey).toBe('')
  })

  it('detects .vcf.gz file as VCF format', async () => {
    const result = await detectFormat(SINGLE_SAMPLE_VCF)
    expect(result.format).toBe('vcf')
    expect(result.caseKey).toBe('')
  })
})
