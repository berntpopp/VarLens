/**
 * Tests for gzip auto-detection and plain JSON import support.
 *
 * Verifies that the import pipeline handles both gzipped and plain JSON files
 * for all supported formats (simple, object, columnar).
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { isGzipped } from '../../../src/main/import/stream-utils'
import { detectFormat } from '../../../src/main/import/format-detection'
import { prepareStatements, streamInsertJson } from '../../../src/main/workers/import-pipeline'

const FIXTURES_DIR = join(__dirname, '../../fixtures/import')

describe('isGzipped', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-gzip-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should detect gzipped files', () => {
    const gzPath = join(tmpDir, 'test.json.gz')
    writeFileSync(gzPath, gzipSync(Buffer.from('{"test": true}')))
    expect(isGzipped(gzPath)).toBe(true)
  })

  it('should detect plain JSON files as not gzipped', () => {
    const jsonPath = join(tmpDir, 'test.json')
    writeFileSync(jsonPath, '{"test": true}')
    expect(isGzipped(jsonPath)).toBe(false)
  })

  it('should detect gzipped fixture files', () => {
    expect(isGzipped(join(FIXTURES_DIR, 'simple-format.json.gz'))).toBe(true)
    expect(isGzipped(join(FIXTURES_DIR, 'object-format.json.gz'))).toBe(true)
    expect(isGzipped(join(FIXTURES_DIR, 'columnar-format.json.gz'))).toBe(true)
  })

  it('should detect plain JSON fixture files', () => {
    expect(isGzipped(join(FIXTURES_DIR, 'simple-format.json'))).toBe(false)
    expect(isGzipped(join(FIXTURES_DIR, 'object-format.json'))).toBe(false)
    expect(isGzipped(join(FIXTURES_DIR, 'columnar-format.json'))).toBe(false)
  })
})

describe('detectFormat with plain JSON', () => {
  it('rejects an adversarial number of top-level keys within a fixed detection budget', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'varlens-format-budget-'))
    const filePath = join(tmpDir, 'many-keys.json')
    const entries = Array.from({ length: 20_000 }, (_, index) => `"k${index}":null`).join(',')
    writeFileSync(filePath, `{"metadata":null,${entries}}`)

    try {
      await expect(detectFormat(filePath)).rejects.toThrow(/format detection.*top-level keys/i)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('rejects an oversized top-level key before stream-json packs it', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'varlens-format-key-budget-'))
    const filePath = join(tmpDir, 'giant-key.json')
    writeFileSync(filePath, `{"metadata":null,"${'k'.repeat(2 * 1024 * 1024)}":null}`)

    try {
      await expect(detectFormat(filePath)).rejects.toThrow(/format detection.*key/i)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should detect simple format from plain JSON', async () => {
    const result = await detectFormat(join(FIXTURES_DIR, 'simple-format.json'))
    expect(result.format).toBe('simple')
  })

  it('should detect simple format from gzipped JSON', async () => {
    const result = await detectFormat(join(FIXTURES_DIR, 'simple-format.json.gz'))
    expect(result.format).toBe('simple')
  })

  it('should detect object format from plain JSON', async () => {
    const result = await detectFormat(join(FIXTURES_DIR, 'object-format.json'))
    expect(result.format).toBe('object')
    expect(result.caseKey).toBe('sample-001')
  })

  it('should detect object format from gzipped JSON', async () => {
    const result = await detectFormat(join(FIXTURES_DIR, 'object-format.json.gz'))
    expect(result.format).toBe('object')
    expect(result.caseKey).toBe('sample-001')
  })

  it('should detect columnar format from plain JSON', async () => {
    const result = await detectFormat(join(FIXTURES_DIR, 'columnar-format.json'))
    expect(result.format).toBe('columnar')
    expect(result.caseKey).toBe('DemoCase')
  })

  it('should detect columnar format from gzipped JSON', async () => {
    const result = await detectFormat(join(FIXTURES_DIR, 'columnar-format.json.gz'))
    expect(result.format).toBe('columnar')
    expect(result.caseKey).toBe('DemoCase')
  })
})

describe('streamInsertJson with plain JSON files', () => {
  let tmpDir: string
  let db: DatabaseService
  let stmts: ReturnType<typeof prepareStatements>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-import-test-'))
    const dbPath = join(tmpDir, 'test.db')
    db = new DatabaseService(dbPath)
    stmts = prepareStatements(db.database)
  })

  afterEach(() => {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  async function importJson(filePath: string, caseName: string) {
    const caseId = db.cases.createCase(caseName, filePath, 1000)
    const formatInfo = await detectFormat(filePath)
    const variantCount = await streamInsertJson(
      filePath,
      formatInfo,
      caseId,
      1000,
      stmts,
      () => false,
      () => {}
    )
    return { caseId, variantCount }
  }

  it('should import simple format from plain JSON', async () => {
    const result = await importJson(join(FIXTURES_DIR, 'simple-format.json'), 'Simple Plain JSON')

    expect(result.caseId).toBeGreaterThan(0)
    expect(result.variantCount).toBe(3)

    const variants = db.variants.getVariants({ case_id: result.caseId }, 10)
    expect(variants.data).toHaveLength(3)
    expect(variants.data[0].gene_symbol).toBe('BRCA1')
  })

  it('should import simple format from gzipped JSON', async () => {
    const result = await importJson(
      join(FIXTURES_DIR, 'simple-format.json.gz'),
      'Simple Gzipped JSON'
    )

    expect(result.variantCount).toBe(3)
  })

  it('should import object format from plain JSON', async () => {
    const result = await importJson(join(FIXTURES_DIR, 'object-format.json'), 'Object Plain JSON')

    expect(result.caseId).toBeGreaterThan(0)
    expect(result.variantCount).toBe(2)

    const variants = db.variants.getVariants({ case_id: result.caseId }, 10)
    expect(variants.data).toHaveLength(2)
    const geneSymbols = variants.data.map((v) => v.gene_symbol).sort()
    expect(geneSymbols).toEqual(['COL4A5', 'SCN1A'])
  })

  it('should import object format from gzipped JSON', async () => {
    const result = await importJson(
      join(FIXTURES_DIR, 'object-format.json.gz'),
      'Object Gzipped JSON'
    )

    expect(result.variantCount).toBe(2)
  })

  it('should import columnar format from plain JSON', async () => {
    const result = await importJson(
      join(FIXTURES_DIR, 'columnar-format.json'),
      'Columnar Plain JSON'
    )

    expect(result.caseId).toBeGreaterThan(0)
    expect(result.variantCount).toBeGreaterThan(0)
  })

  it('should import columnar format from gzipped JSON', async () => {
    const result = await importJson(
      join(FIXTURES_DIR, 'columnar-format.json.gz'),
      'Columnar Gzipped JSON'
    )

    expect(result.variantCount).toBeGreaterThan(0)
  })

  it('should produce identical results for plain and gzipped simple format', async () => {
    const plainResult = await importJson(join(FIXTURES_DIR, 'simple-format.json'), 'Plain Compare')
    const gzipResult = await importJson(join(FIXTURES_DIR, 'simple-format.json.gz'), 'Gzip Compare')

    expect(plainResult.variantCount).toBe(gzipResult.variantCount)
  })
})
