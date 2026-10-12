import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveImportGenomeBuild } from '../../../../src/main/import/vcf/resolve-genome-build'
import { BUILD_COPY, GENOME_BUILDS } from '../../../../src/shared/config/genome-builds.config'

const dir = mkdtempSync(join(tmpdir(), 'resolve-build-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function vcf(name: string, headerLines: string[]): string {
  const path = join(dir, name)
  writeFileSync(
    path,
    [
      '##fileformat=VCFv4.2',
      ...headerLines,
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
      ''
    ].join('\n')
  )
  return path
}

const [grch38, grch37, t2t] = GENOME_BUILDS
const declares37 = vcf('declares37.vcf', [`##contig=<ID=1,length=${grch37.contigs[1]}>`])
const declaresNothing = vcf('nothing.vcf', [])
const conflicting = vcf('conflict.vcf', ['##reference=hg19.fa', '##reference=hg38.fa'])
const declaresT2t = vcf('t2t.vcf', [`##contig=<ID=chr1,length=${t2t.contigs[1]}>`])

describe('resolveImportGenomeBuild', () => {
  it('the explicit (user-confirmed) build wins over the header', async () => {
    await expect(
      resolveImportGenomeBuild({ filePath: declares37, isVcf: true, explicit: 'GRCh38' })
    ).resolves.toBe('GRCh38')
  })

  it('a VCF that declares its build keeps it over the fallback', async () => {
    await expect(
      resolveImportGenomeBuild({ filePath: declares37, isVcf: true, fallback: grch38.id })
    ).resolves.toBe('GRCh37')
  })

  it('a VCF without a build and a JSON file take the fallback', async () => {
    await expect(
      resolveImportGenomeBuild({ filePath: declaresNothing, isVcf: true, fallback: 'GRCh37' })
    ).resolves.toBe('GRCh37')
    await expect(
      resolveImportGenomeBuild({ filePath: 'x.json', isVcf: false, fallback: 'GRCh37' })
    ).resolves.toBe('GRCh37')
  })

  it('never defaults silently: no build and no fallback fails', async () => {
    await expect(resolveImportGenomeBuild({ filePath: 'x.json', isVcf: false })).rejects.toThrow(
      BUILD_COPY.missingBuild
    )
  })

  it('a conflicting header fails the file', async () => {
    await expect(
      resolveImportGenomeBuild({ filePath: conflicting, isVcf: true, fallback: 'GRCh38' })
    ).rejects.toThrow(BUILD_COPY.skippedConflict)
  })

  it('a recognised but non-importable build fails the file', async () => {
    await expect(
      resolveImportGenomeBuild({ filePath: declaresT2t, isVcf: true, fallback: 'GRCh38' })
    ).rejects.toThrow(BUILD_COPY.notImportable(t2t.label))
  })

  it('rejects an unknown explicit build', async () => {
    await expect(
      resolveImportGenomeBuild({ filePath: 'x.json', isVcf: false, explicit: 'hg99' })
    ).rejects.toThrow(/Unsupported genome build/)
  })
})
