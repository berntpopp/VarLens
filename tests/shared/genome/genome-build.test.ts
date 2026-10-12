import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import {
  BUILD_TAG_SOURCES,
  GENOME_BUILDS,
  GENOME_BUILD_CONFIG,
  type GenomeBuildDef
} from '../../../src/shared/config/genome-builds.config'
import {
  combineBuildDetections,
  describeBuildDetection,
  detectGenomeBuild,
  detectionBuild,
  redetectStoredCaseBuild
} from '../../../src/shared/genome/genome-build'

const contigLine = (id: string, length: number): string => `##contig=<ID=${id},length=${length}>`
const fullHeader = (build: GenomeBuildDef, prefix: '' | 'chr'): string[] => [
  '##fileformat=VCFv4.2',
  ...Object.entries(build.contigs).map(([name, len]) => contigLine(`${prefix}${name}`, len))
]
const other = (build: GenomeBuildDef): GenomeBuildDef =>
  GENOME_BUILDS.find((b) => b.id !== build.id)!

describe.each(GENOME_BUILDS.map((b) => [b.id, b] as const))(
  'detectGenomeBuild — %s',
  (_id, build) => {
    it('a full contig header is definitive', () => {
      const d = detectGenomeBuild(fullHeader(build, 'chr'))
      expect(d).toMatchObject({ suggested: build.id, confidence: 'definitive' })
      expect(d.evidence[0].detail).toBe('24 of 24')
    })

    it.each(Object.keys(build.contigs))('contig %s alone is definitive', (name) => {
      const d = detectGenomeBuild([contigLine(name, build.contigs[name])])
      expect(d).toMatchObject({ suggested: build.id, confidence: 'definitive' })
    })

    it('chr-prefixed and bare naming give the same result', () => {
      const bare = detectGenomeBuild(fullHeader(build, ''))
      const chr = detectGenomeBuild(fullHeader(build, 'chr'))
      const decision = (d: typeof bare) => ({
        suggested: d.suggested,
        confidence: d.confidence,
        evidence: d.evidence,
        excluded: d.excluded.map((e) => e.build)
      })
      expect(decision(chr)).toEqual(decision(bare))
    })

    it.each(BUILD_TAG_SOURCES.flatMap((s) => build.aliases.map((a) => [s.prefix, a, s.label])))(
      'tag %s with alias %s is strong',
      (prefix, alias, label) => {
        const d = detectGenomeBuild([`${prefix}x/path/${alias}.fa`])
        expect(d).toMatchObject({ suggested: build.id, confidence: 'strong' })
        expect(d.evidence[0]).toMatchObject({ build: build.id, source: label })
      }
    )

    it('a tag that contradicts the lengths is a conflict that keeps the lengths', () => {
      const header = [...fullHeader(build, 'chr'), `##reference=${other(build).aliases[0]}.fa`]
      expect(detectGenomeBuild(header)).toMatchObject({
        suggested: build.id,
        confidence: 'conflict'
      })
    })

    it.each(Object.keys(build.contigs))(
      'a position beyond contig %s excludes the build',
      (name) => {
        const d = detectGenomeBuild([], { [`chr${name}`]: build.contigs[name] + 1 })
        expect(d.excluded.map((e) => e.build)).toContain(build.id)
        expect(d.suggested).toBeNull()
      }
    )

    it('aliases on a liftover line are ignored', () => {
      const d = detectGenomeBuild([`##reference=/chains/${build.aliases[0]}.over.chain`])
      expect(d.suggested).toBeNull()
    })

    it('a liftover marker caps a definitive result at conflict', () => {
      const d = detectGenomeBuild([...fullHeader(build, ''), '##liftOverProgram=CrossMap'])
      expect(d).toMatchObject({ suggested: build.id, confidence: 'conflict' })
    })
  }
)

describe('detectGenomeBuild — fixed cases', () => {
  it('mito-only 16,569 decides nothing', () => {
    expect(detectGenomeBuild([contigLine('chrM', 16569)])).toMatchObject({
      suggested: null,
      confidence: 'none'
    })
  })

  it('hg19 chrM 16,571 is GRCh37 definitive', () => {
    expect(detectGenomeBuild([contigLine('chrM', 16571)])).toMatchObject({
      suggested: 'GRCh37',
      confidence: 'definitive'
    })
  })

  it('a custom chr1 length is none, with an evidence line', () => {
    const d = detectGenomeBuild([contigLine('chr1', 123)])
    expect(d).toMatchObject({ suggested: null, confidence: 'none' })
    expect(d.evidence[0].detail).toBe('Contig lengths match no known build')
  })

  it('lengths from two builds are a conflict without a suggestion', () => {
    const d = detectGenomeBuild([
      contigLine('chr1', GENOME_BUILDS[0].contigs[1]),
      contigLine('chr2', GENOME_BUILDS[1].contigs[2])
    ])
    expect(d).toMatchObject({ suggested: null, confidence: 'conflict' })
  })

  it('tags naming two builds are a conflict', () => {
    const d = detectGenomeBuild(['##reference=hg19.fa', '##VEP="v1" cache="/x/115_GRCh38"'])
    expect(d).toMatchObject({ suggested: null, confidence: 'conflict' })
  })

  it('alias boundaries: hg19tohg38 names only hg19, grch380 names nothing', () => {
    expect(detectGenomeBuild(['##reference=hg19tohg38.fa']).suggested).toBe('GRCh37')
    expect(detectGenomeBuild(['##reference=grch380.fa']).suggested).toBeNull()
  })

  it('a position beyond the tagged build drops the tag, without suggesting another', () => {
    const d = detectGenomeBuild(['##reference=hg38.fa'], { chr1: 249_000_000 })
    expect(d).toMatchObject({ suggested: null, confidence: 'none' })
    expect(d.excluded.map((e) => e.build)).toContain('GRCh38')
  })

  it('tags match case-insensitively', () => {
    expect(detectGenomeBuild(['##reference=GRCH38.fa'])).toMatchObject({ suggested: 'GRCh38' })
  })

  it('an empty header is none', () => {
    expect(detectGenomeBuild([])).toEqual({
      suggested: null,
      confidence: 'none',
      evidence: [],
      excluded: []
    })
  })

  it('positions never suggest a build', () => {
    expect(detectGenomeBuild([], { chr1: 100 }).suggested).toBeNull()
  })

  it.each([
    'single-sample.vcf.gz',
    'single-sample.vep.vcf.gz',
    'single-sample.snpeff.vcf.gz',
    'trio-region.vcf.gz'
  ])('fixture %s is GRCh38 definitive', (file) => {
    const text = gunzipSync(readFileSync(join('tests/test-data/vcf', file))).toString('utf8')
    const header = text.split('\n').filter((l) => l.startsWith('##'))
    expect(detectGenomeBuild(header)).toMatchObject({
      suggested: 'GRCh38',
      confidence: 'definitive'
    })
  })
})

describe('adding a build is config-only', () => {
  const fake: GenomeBuildDef = {
    id: 'FakeBuild1',
    label: 'Fake',
    importable: true,
    aliases: ['fakeref'],
    primaryPrefix: 'chr',
    mito: { canonical: 'chrM', lengths: { chrM: 16_000 } },
    contigs: { 1: 111, 2: 222 }
  }
  const config = { ...GENOME_BUILD_CONFIG, builds: [...GENOME_BUILD_CONFIG.builds, fake] }

  it('detects the injected build from lengths and from tags', () => {
    expect(detectGenomeBuild([contigLine('1', 111)], undefined, config)).toMatchObject({
      suggested: 'FakeBuild1',
      confidence: 'definitive'
    })
    expect(detectGenomeBuild(['##reference=/a/fakeref.fa'], undefined, config)).toMatchObject({
      suggested: 'FakeBuild1',
      confidence: 'strong'
    })
  })
})

describe('combineBuildDetections', () => {
  const definitive = (build: string) =>
    detectGenomeBuild([contigLine('1', GENOME_BUILDS.find((b) => b.id === build)!.contigs[1])])
  const strong = detectGenomeBuild(['##reference=hg38.fa'])
  const none = detectGenomeBuild([])

  it('files that agree keep the build', () => {
    const d = combineBuildDetections([
      { filePath: 'a.vcf', buildDetection: definitive('GRCh38') },
      { filePath: 'b.vcf', buildDetection: definitive('GRCh38') }
    ])
    expect(d).toMatchObject({ suggested: 'GRCh38', confidence: 'definitive' })
    expect(d.evidence[0].detail.startsWith('a.vcf: ')).toBe(true)
  })

  it('files that disagree are a mixed conflict', () => {
    const d = combineBuildDetections([
      { filePath: 'a.vcf', buildDetection: definitive('GRCh38') },
      { filePath: 'b.vcf', buildDetection: definitive('GRCh37') }
    ])
    expect(d).toMatchObject({ suggested: null, confidence: 'conflict' })
    expect(d.mixedFiles).toEqual([
      { fileName: 'a.vcf', build: 'GRCh38' },
      { fileName: 'b.vcf', build: 'GRCh37' }
    ])
  })

  it('a none file does not lower the weakest confidence', () => {
    const d = combineBuildDetections([
      { filePath: 'a.vcf', buildDetection: none },
      { filePath: 'b.vcf', buildDetection: strong },
      { filePath: 'c.vcf', buildDetection: definitive('GRCh38') }
    ])
    expect(d).toMatchObject({ suggested: 'GRCh38', confidence: 'strong' })
  })

  it('an exclusion that hits the suggestion is a conflict', () => {
    const d = combineBuildDetections([
      { filePath: 'a.vcf', buildDetection: strong },
      { filePath: 'b.vcf', buildDetection: detectGenomeBuild([], { chr1: 249_000_000 }) }
    ])
    expect(d).toMatchObject({ suggested: 'GRCh38', confidence: 'conflict' })
  })
})

describe('detectionBuild / describeBuildDetection', () => {
  it('only definitive and strong count as a detected build', () => {
    expect(detectionBuild(detectGenomeBuild(['##reference=hg38.fa']))).toBe('GRCh38')
    expect(
      detectionBuild(detectGenomeBuild(['##reference=hg19.fa', '##reference=hg38.fa']))
    ).toBeNull()
  })

  it('never says "Auto-detected"', () => {
    for (const d of [detectGenomeBuild([]), detectGenomeBuild(fullHeader(GENOME_BUILDS[0], ''))]) {
      expect(describeBuildDetection(d)).not.toMatch(/auto-detected/i)
    }
    expect(describeBuildDetection(detectGenomeBuild(fullHeader(GENOME_BUILDS[0], '')))).toBe(
      'Contig lengths match GRCh38 (24 of 24).'
    )
  })
})

describe('redetectStoredCaseBuild', () => {
  it('re-detects from the stored raw header lines', () => {
    expect(
      redetectStoredCaseBuild({
        genomeBuild: 'GRCh38',
        headerLines: fullHeader(GENOME_BUILDS[1], '')
      })
    ).toMatchObject({ stored: 'GRCh38', detected: 'GRCh37', disagrees: true })
  })

  it('stored positions beyond the stored build flag it, without suggesting another', () => {
    expect(
      redetectStoredCaseBuild({
        genomeBuild: 'GRCh38',
        headerLines: [],
        maxPos: { '1': 249_000_000 }
      })
    ).toMatchObject({ detected: null, storedExcluded: true, disagrees: true })
  })

  it('a case without stored header evidence cannot be re-detected', () => {
    expect(redetectStoredCaseBuild({ genomeBuild: 'GRCh38', headerLines: [] })).toMatchObject({
      detected: null,
      disagrees: false
    })
  })
})
