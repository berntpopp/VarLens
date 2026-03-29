import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { getVcfPreview } from '../../../../src/main/import/vcf/vcf-preview'

const SYNTHETIC_VCF = resolve(__dirname, '../../../test-data/vcf/synthetic-unit-test.vcf')

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
})
