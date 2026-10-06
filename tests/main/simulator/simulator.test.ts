/**
 * Tests for the synthetic variant simulator engine and format writers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import * as XLSX from 'xlsx'
import { DeterministicRandom, deriveSeed } from '../../../src/main/simulator/random'
import { GeneCatalog } from '../../../src/main/simulator/catalog'
import {
  generateSampleVariants,
  compareGenomicPositions
} from '../../../src/main/simulator/generator'
import { writeSimpleJson } from '../../../src/main/simulator/writers/simple-json-writer'
import { writeColumnarJson } from '../../../src/main/simulator/writers/columnar-json-writer'
import { writeVcf } from '../../../src/main/simulator/writers/vcf-writer'
import { writeXlsx } from '../../../src/main/simulator/writers/xlsx-writer'
import { simulateCohort } from '../../../src/main/simulator/engine'
import { detectFormat, createDataPipeline } from '../../../src/main/import/format-detection'
import { parseVcfHeader } from '../../../src/main/import/vcf/vcf-header-parser'
import { parseVcfLine } from '../../../src/main/import/vcf/vcf-line-parser'
import type { SampleMetadata } from '../../../src/main/simulator/types'

describe('DeterministicRandom PRNG', () => {
  it('produces identical sequences for identical seeds', () => {
    const rng1 = new DeterministicRandom(12345)
    const rng2 = new DeterministicRandom(12345)

    const seq1 = Array.from({ length: 10 }, () => rng1.next())
    const seq2 = Array.from({ length: 10 }, () => rng2.next())

    expect(seq1).toEqual(seq2)
  })

  it('produces different sequences for different seeds', () => {
    const rng1 = new DeterministicRandom(12345)
    const rng2 = new DeterministicRandom(54321)

    expect(rng1.next()).not.toEqual(rng2.next())
  })

  it('generates integers within specified bounds', () => {
    const rng = new DeterministicRandom(42)
    for (let i = 0; i < 100; i++) {
      const val = rng.intBetween(10, 20)
      expect(val).toBeGreaterThanOrEqual(10)
      expect(val).toBeLessThanOrEqual(20)
    }
  })

  it('derives stable sub-seeds via hashSeed', () => {
    const seedA = deriveSeed(2026, 1, 'sample')
    const seedB = deriveSeed(2026, 1, 'sample')
    const seedC = deriveSeed(2026, 2, 'sample')

    expect(seedA).toBe(seedB)
    expect(seedA).not.toBe(seedC)
  })
})

describe('GeneCatalog', () => {
  it('loads human gene reference models', () => {
    const catalog = GeneCatalog.load()
    expect(catalog.count).toBeGreaterThan(10)

    const genes = catalog.getAll()
    expect(genes[0]).toHaveProperty('symbol')
    expect(genes[0]).toHaveProperty('chromosome')
    expect(genes[0]).toHaveProperty('start_pos')
    expect(genes[0]).toHaveProperty('end_pos')
  })

  it('filters genes by symbol', () => {
    const catalog = GeneCatalog.load()
    const filtered = catalog.filterGenes(['COL1A1', 'PKD1'])
    expect(filtered.count).toBe(2)
    expect(filtered.getBySymbol('COL1A1')).toBeDefined()
    expect(filtered.getBySymbol('PKD1')).toBeDefined()
  })
})

describe('Canonical Variant Generator', () => {
  const sample: SampleMetadata = {
    lims_id: 'SIM-TEST01',
    person_id: 101,
    analysis_id: 201,
    case_name: 'Test Case'
  }

  it('generates the exact requested number of variants', () => {
    const catalog = GeneCatalog.load()
    const variants = generateSampleVariants(sample, 50, 42, catalog)
    expect(variants).toHaveLength(50)
  })

  it('sorts variants naturally by chromosome and position', () => {
    const catalog = GeneCatalog.load()
    const variants = generateSampleVariants(sample, 100, 42, catalog)

    for (let i = 0; i < variants.length - 1; i++) {
      const cmp = compareGenomicPositions(
        variants[i].chr,
        variants[i].pos,
        variants[i + 1].chr,
        variants[i + 1].pos
      )
      expect(cmp).toBeLessThanOrEqual(0)
    }
  })

  it('produces valid 22-field variant schemas with HGVS annotations', () => {
    const catalog = GeneCatalog.load()
    const variants = generateSampleVariants(sample, 10, 42, catalog)
    const v = variants[0]

    expect(v.chr).toBeTruthy()
    expect(v.pos).toBeGreaterThan(0)
    expect(v.ref).toMatch(/^[ACGT]$/)
    expect(v.alt).toMatch(/^[ACGT]$/)
    expect(v.gene_symbol).toBeTruthy()
    expect(['HIGH', 'MODERATE', 'LOW', 'MODIFIER']).toContain(v.consequence)
    expect(v.func).toBeTruthy()
    expect(v.transcript).toMatch(/^NM_\d+\.\d+$/)
    expect(v.cdna).toMatch(/^c\./)
    expect(v.aa_change).toMatch(/^p\./)
    expect(['0/1', '1/1', './1']).toContain(v.gt_num)
  })
})

describe('Format Writers & Roundtrip Detection', () => {
  let testDir: string
  const sample: SampleMetadata = {
    lims_id: 'SIM-WRITE01',
    person_id: 501,
    analysis_id: 601,
    case_name: 'Write Test Case'
  }

  beforeAll(() => {
    testDir = join(tmpdir(), `varlens-sim-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('writes and validates Simple JSON format', async () => {
    const catalog = GeneCatalog.load()
    const variants = generateSampleVariants(sample, 25, 1234, catalog)
    const outPath = join(testDir, 'simple.json.gz')

    await writeSimpleJson(sample, variants, { outputPath: outPath, gzip: true })
    expect(existsSync(outPath)).toBe(true)

    // Unpack and verify JSON structure
    const raw = gunzipSync(readFileSync(outPath)).toString('utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.lims_id).toBe('SIM-WRITE01')
    expect(parsed.variant_count).toBe(25)
    expect(parsed.variants).toHaveLength(25)

    // VarLens format detection
    const formatInfo = await detectFormat(outPath)
    expect(formatInfo.format).toBe('simple')

    // Verify VarLens data pipeline can stream through the records
    const { stream } = await createDataPipeline(outPath)
    let recordCount = 0
    for await (const chunk of stream) {
      if (chunk && chunk.value) recordCount++
    }
    expect(recordCount).toBe(25)
  })

  it('writes and validates Columnar JSON format', async () => {
    const catalog = GeneCatalog.load()
    const variants = generateSampleVariants(sample, 25, 1234, catalog)
    const outPath = join(testDir, 'columnar.json.gz')

    await writeColumnarJson(sample, variants, { outputPath: outPath, gzip: true, wrapped: true })
    expect(existsSync(outPath)).toBe(true)

    // VarLens format detection
    const formatInfo = await detectFormat(outPath)
    expect(formatInfo.format).toBe('columnar')
    expect(formatInfo.caseKey).toBe('SIM-WRITE01')

    // Verify VarLens data pipeline can stream through the records
    const { stream } = await createDataPipeline(outPath)
    let recordCount = 0
    for await (const chunk of stream) {
      if (chunk && chunk.value) recordCount++
    }
    expect(recordCount).toBe(25)
  })

  it('writes and validates VCF 4.2 format', async () => {
    const catalog = GeneCatalog.load()
    const variants = generateSampleVariants(sample, 25, 1234, catalog)
    const outPath = join(testDir, 'sample.vcf.gz')

    await writeVcf(sample, variants, { outputPath: outPath, gzip: true })
    expect(existsSync(outPath)).toBe(true)

    // VarLens format detection
    const formatInfo = await detectFormat(outPath)
    expect(formatInfo.format).toBe('vcf')

    // Parse VCF header and data line via VarLens VCF import pipeline
    const { header, firstDataLine } = await parseVcfHeader(outPath)
    expect(header.samples).toEqual(['SIM-WRITE01'])
    expect(header.annotationType).toBe('csq')
    expect(firstDataLine).toBeTruthy()

    const rawRecord = parseVcfLine(firstDataLine!, header.samples)
    expect(rawRecord).not.toBeNull()
    expect(rawRecord?.chrom).toBeDefined()
    expect(rawRecord?.pos).toBeGreaterThan(0)
    expect(rawRecord?.samples.get('SIM-WRITE01')).toBeDefined()
    expect(rawRecord?.info.has('CSQ')).toBe(true)
  })

  it('writes and validates XLSX format', () => {
    const catalog = GeneCatalog.load()
    const variants = generateSampleVariants(sample, 15, 1234, catalog)
    const outPath = join(testDir, 'sample.xlsx')

    writeXlsx(sample, variants, { outputPath: outPath })
    expect(existsSync(outPath)).toBe(true)

    const buf = readFileSync(outPath)
    const wb = XLSX.read(buf, { type: 'buffer' })
    expect(wb.SheetNames).toContain('Variants')
    expect(wb.SheetNames).toContain('Export Info')
    const ws = wb.Sheets['Variants']
    const data = XLSX.utils.sheet_to_json(ws)
    expect(data).toHaveLength(15)
  })

  it('simulates cohort and generates manifest.json and samples.txt', async () => {
    const cohortDir = join(testDir, 'cohort')
    const manifest = await simulateCohort({
      samples: 3,
      preset: 'smoke',
      formats: ['simple-json', 'vcf'],
      outDir: cohortDir,
      gzip: true,
      seed: 9999,
      workers: 1
    })

    expect(manifest.totalSamples).toBe(3)
    expect(manifest.samples).toHaveLength(3)
    expect(existsSync(join(cohortDir, 'manifest.json'))).toBe(true)
    expect(existsSync(join(cohortDir, 'samples.txt'))).toBe(true)

    const samplesTxt = readFileSync(join(cohortDir, 'samples.txt'), 'utf8')
    const sampleLines = samplesTxt.trim().split('\n')
    expect(sampleLines).toEqual(['SIM-0001', 'SIM-0002', 'SIM-0003'])
  })
})
