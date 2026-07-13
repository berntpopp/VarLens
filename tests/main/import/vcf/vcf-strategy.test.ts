// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import { VcfStrategy } from '../../../../src/main/import/vcf/VcfStrategy'
import { detectFormat } from '../../../../src/main/import/format-detection'
import {
  LineTooLongError,
  DecompressedSizeExceededError
} from '../../../../src/main/import/stream-utils'
import type { ImportOptions } from '../../../../src/main/import/types'
import type { StrategyContext } from '../../../../src/main/import/strategies/ImportStrategy'

const DECOMPRESSED_CAP_ENV_VAR = 'VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES'
const LINE_CAP_ENV_VAR = 'VARLENS_TEST_IMPORT_MAX_LINE_BYTES'
const TEST_LINE_CAP = 1024

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
      Record<string, unknown> | undefined
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

  it('rejects a malformed POS with a reasoned skip instead of a silent NaN row', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'varlens-vcf-strategy-'))
    const malformedVcf = join(tmpDir, 'malformed-pos.vcf')

    try {
      writeFileSync(
        malformedVcf,
        [
          '##fileformat=VCFv4.2',
          '##FILTER=<ID=PASS,Description="All filters passed">',
          '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
          '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
          'chr1\tNOTNUM\t.\tA\tG\t99\tPASS\t.\tGT\t0/1',
          'chr1\t99\t.\tA\tG\tBADQUAL\tPASS\t.\tGT\t0/1',
          'chr1\t100\trs1\tA\tG\t99\tPASS\t.\tGT\t0/1'
        ].join('\n') + '\n'
      )

      const caseId = db.cases.createCase('test-malformed-pos', malformedVcf, 1000)

      const options: ImportOptions = { caseName: 'test-malformed-pos' }
      const context: StrategyContext = {
        db,
        formatInfo: { format: 'vcf', caseKey: '' },
        caseId,
        startTime: Date.now()
      }

      const result = await strategy.import(malformedVcf, options, context, {
        selectedSamples: ['HG005'],
        genomeBuild: 'GRCh38'
      })

      // Only the valid line is inserted; the malformed-POS line is rejected.
      expect(result.variantCount).toBe(1)
      expect(result.skipped).toBeGreaterThanOrEqual(2)

      // The skip carries a reason -- not a silent drop.
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some((e) => /invalid POS/i.test(e))).toBe(true)
      expect(result.errors.some((e) => /invalid QUAL/i.test(e))).toBe(true)

      // No NaN-position row reached the database.
      const variants = db.database
        .prepare('SELECT pos FROM variants WHERE case_id = ?')
        .all(caseId) as Array<{ pos: number }>
      expect(variants.every((v) => Number.isInteger(v.pos))).toBe(true)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe('DoS guards', () => {
    afterEach(() => {
      delete process.env[DECOMPRESSED_CAP_ENV_VAR]
      delete process.env[LINE_CAP_ENV_VAR]
    })

    it('rejects a VCF containing a line over the production call-path cap', async () => {
      process.env[LINE_CAP_ENV_VAR] = String(TEST_LINE_CAP)
      const tmpDir = mkdtempSync(join(tmpdir(), 'varlens-vcf-strategy-dos-'))
      const filePath = join(tmpDir, 'giant-line.vcf')

      try {
        const giantLine = 'A'.repeat(TEST_LINE_CAP + 1)
        writeFileSync(
          filePath,
          [
            '##fileformat=VCFv4.2',
            '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
            '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
            giantLine,
            'chr1\t100\trs1\tA\tG\t99\tPASS\t.\tGT\t0/1'
          ].join('\n') + '\n'
        )

        const caseId = db.cases.createCase('test-giant-line', filePath, 1000)
        const options: ImportOptions = { caseName: 'test-giant-line' }
        const context: StrategyContext = {
          db,
          formatInfo: { format: 'vcf', caseKey: '' },
          caseId,
          startTime: Date.now()
        }

        await expect(
          strategy.import(filePath, options, context, {
            selectedSamples: ['HG005'],
            genomeBuild: 'GRCh38'
          })
        ).rejects.toThrow(LineTooLongError)
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('rejects a decompression bomb once decompressed bytes exceed the configured cap', async () => {
      process.env[DECOMPRESSED_CAP_ENV_VAR] = '1000'
      const tmpDir = mkdtempSync(join(tmpdir(), 'varlens-vcf-strategy-bomb-'))
      const filePath = join(tmpDir, 'bomb.vcf.gz')

      try {
        const inflated =
          [
            '##fileformat=VCFv4.2',
            '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
            '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005'
          ].join('\n') +
          '\n' +
          'A'.repeat(1_000_000) +
          '\n'
        writeFileSync(filePath, gzipSync(Buffer.from(inflated)))

        const caseId = db.cases.createCase('test-bomb', filePath, 1000)
        const options: ImportOptions = { caseName: 'test-bomb' }
        const context: StrategyContext = {
          db,
          formatInfo: { format: 'vcf', caseKey: '' },
          caseId,
          startTime: Date.now()
        }

        await expect(
          strategy.import(filePath, options, context, {
            selectedSamples: ['HG005'],
            genomeBuild: 'GRCh38'
          })
        ).rejects.toThrow(DecompressedSizeExceededError)
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })
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
