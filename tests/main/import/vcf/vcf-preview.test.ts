import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { getVcfPreview } from '../../../../src/main/import/vcf/vcf-preview'
import {
  LineTooLongError,
  DecompressedSizeExceededError
} from '../../../../src/main/import/stream-utils'

const SYNTHETIC_VCF = resolve(__dirname, '../../../test-data/vcf/synthetic-unit-test.vcf')
const DECOMPRESSED_CAP_ENV_VAR = 'VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES'
const LINE_CAP_ENV_VAR = 'VARLENS_TEST_IMPORT_MAX_LINE_BYTES'
const TEST_LINE_CAP = 1024

describe('vcf-preview', () => {
  it('returns preview result for synthetic VCF', async () => {
    const result = await getVcfPreview(SYNTHETIC_VCF)

    expect(result.fileformat).toBe('VCFv4.2')
    expect(result.samples).toEqual(['HG005', 'HG006', 'HG007'])
    expect(result.annotationType).toBe('csq')
    expect(result.detectedGenomeBuild).toBe('GRCh38')
    expect(result.variantCountEstimate).toBeGreaterThan(0)

    // Check INFO field mappings
    expect(result.infoFields).toBeInstanceOf(Array)
    const clinvar = result.infoFields.find((f) => f.id === 'CLINVAR_CLNSIG')
    expect(clinvar).toBeDefined()
    expect(clinvar!.mapsToColumn).toBe('clinvar')

    const revel = result.infoFields.find((f) => f.id === 'dbNSFP_REVEL_score')
    expect(revel).toBeDefined()
    expect(revel!.mapsToColumn).toBeNull() // not in default registry
  })

  it('counts data lines correctly', async () => {
    const result = await getVcfPreview(SYNTHETIC_VCF)
    // synthetic-unit-test.vcf has 18 data lines
    expect(result.variantCountEstimate).toBe(18)
  })

  it('excludes annotation fields (CSQ/ANN) from infoFields', async () => {
    const result = await getVcfPreview(SYNTHETIC_VCF)

    const csq = result.infoFields.find((f) => f.id === 'CSQ')
    const ann = result.infoFields.find((f) => f.id === 'ANN')
    expect(csq).toBeUndefined()
    expect(ann).toBeUndefined()
  })

  it('rejects for non-existent file', async () => {
    await expect(getVcfPreview('/tmp/does-not-exist.vcf')).rejects.toThrow('ENOENT')
  })

  describe('DoS guards', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'varlens-preview-dos-'))
    })

    afterEach(() => {
      delete process.env[DECOMPRESSED_CAP_ENV_VAR]
      delete process.env[LINE_CAP_ENV_VAR]
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('rejects a file containing a line over the production call-path cap', async () => {
      process.env[LINE_CAP_ENV_VAR] = String(TEST_LINE_CAP)
      const filePath = join(tmpDir, 'giant-line.vcf')
      const giantLine = 'A'.repeat(TEST_LINE_CAP + 1)
      writeFileSync(filePath, `##fileformat=VCFv4.2\n${giantLine}\nchr1\t100\n`)

      await expect(getVcfPreview(filePath)).rejects.toThrow(LineTooLongError)
    })

    it('rejects a decompression bomb once decompressed bytes exceed the configured cap', async () => {
      process.env[DECOMPRESSED_CAP_ENV_VAR] = '1000'
      const filePath = join(tmpDir, 'bomb.vcf.gz')
      const inflated = '##fileformat=VCFv4.2\n' + 'A'.repeat(1_000_000) + '\n'
      writeFileSync(filePath, gzipSync(Buffer.from(inflated)))

      await expect(getVcfPreview(filePath)).rejects.toThrow(DecompressedSizeExceededError)
    })
  })
})
