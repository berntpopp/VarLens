import { describe, it, expect } from 'vitest'
import { buildOmimUrl, resolveUrlTemplate } from '../../src/renderer/src/utils/externalLinks'

describe('buildOmimUrl', () => {
  it('returns correct URL for valid MIM number', () => {
    const url = buildOmimUrl('601728')
    expect(url).toBe('https://omim.org/entry/601728')
  })

  it('returns null for null input', () => {
    const url = buildOmimUrl(null)
    expect(url).toBeNull()
  })

  it('returns null for empty string input', () => {
    const url = buildOmimUrl('')
    expect(url).toBeNull()
  })
})

describe('resolveUrlTemplate', () => {
  it('resolves gnomAD template matching expected format', () => {
    const template =
      'https://gnomad.broadinstitute.org/variant/{chr}-{pos}-{ref}-{alt}?dataset={dataset_gnomad}'
    const data = { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos', 'ref', 'alt'])
    expect(url).toBe('https://gnomad.broadinstitute.org/variant/1-12345-A-G?dataset=gnomad_r2_1')
  })

  it('resolves UCSC template matching expected format', () => {
    const template =
      'https://genome.ucsc.edu/cgi-bin/hgTracks?db={build_ucsc}&position={chr}%3A{pos_start}-{pos_end}'
    const data = { chr: '1', pos: 12345, ref: null, alt: null, gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos'])
    expect(url).toBe('https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg19&position=1%3A12320-12370')
  })

  it('resolves ClinVar search template matching expected format', () => {
    const template = 'https://www.ncbi.nlm.nih.gov/clinvar/?term={chr}%3A{pos}%3A{ref}%3A{alt}'
    const data = { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos', 'ref', 'alt'])
    expect(url).toBe('https://www.ncbi.nlm.nih.gov/clinvar/?term=1%3A12345%3AA%3AG')
  })

  it('resolves OMIM gene search template matching expected format', () => {
    const template = 'https://omim.org/search?search={gene}'
    const data = { chr: null, pos: null, ref: null, alt: null, gene_symbol: 'BRCA1' }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['gene'])
    expect(url).toBe('https://omim.org/search?search=BRCA1')
  })

  it('resolves VarSome template matching expected format', () => {
    const template = 'https://varsome.com/variant/{build_ucsc}/{chr}-{pos}-{ref}-{alt}'
    const data = { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos', 'ref', 'alt'])
    expect(url).toBe('https://varsome.com/variant/hg19/1-12345-A-G')
  })

  it('resolves Franklin template matching expected format', () => {
    const template =
      'https://franklin.genoox.com/clinical-db/variant/snp/chr{chr}-{pos}-{ref}-{alt}/{build}'
    const data = { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos', 'ref', 'alt'])
    expect(url).toBe('https://franklin.genoox.com/clinical-db/variant/snp/chr1-12345-A-G/GRCh37')
  })

  it('returns null when required field chr is null', () => {
    const template = 'https://example.com/{chr}-{pos}'
    const data = { chr: null, pos: 12345, ref: null, alt: null, gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos'])
    expect(url).toBeNull()
  })

  it('returns null when required field is empty string', () => {
    const template = 'https://example.com/{chr}-{pos}'
    const data = { chr: '', pos: 12345, ref: null, alt: null, gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos'])
    expect(url).toBeNull()
  })

  it('returns null when pos is 0', () => {
    const template = 'https://example.com/{chr}-{pos}'
    const data = { chr: '1', pos: 0, ref: null, alt: null, gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos'])
    expect(url).toBeNull()
  })

  it('encodes ref/alt with special characters', () => {
    const template = 'https://example.com/{chr}-{pos}-{ref}-{alt}'
    const data = { chr: '1', pos: 12345, ref: 'AT CG', alt: 'G&T', gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos', 'ref', 'alt'])
    expect(url).toBe('https://example.com/1-12345-AT%20CG-G%26T')
  })

  it('handles custom template with only gene variable', () => {
    const template = 'https://example.com/gene/{gene}'
    const data = { chr: null, pos: null, ref: null, alt: null, gene_symbol: 'BRCA1' }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['gene'])
    expect(url).toBe('https://example.com/gene/BRCA1')
  })

  it('pos_start clamps to minimum 1', () => {
    const template = 'https://example.com/{chr}:{pos_start}-{pos_end}'
    const data = { chr: '1', pos: 10, ref: null, alt: null, gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos'])
    expect(url).toBe('https://example.com/1:1-35')
  })

  it('build_ucsc resolves to hg19 for GRCh37', () => {
    const template = 'https://example.com/{build_ucsc}'
    const data = { chr: '1', pos: 12345, ref: null, alt: null, gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr'])
    expect(url).toBe('https://example.com/hg19')
  })

  it('build_ucsc resolves to hg38 for GRCh38', () => {
    const template = 'https://example.com/{build_ucsc}'
    const data = { chr: '1', pos: 12345, ref: null, alt: null, gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh38', ['chr'])
    expect(url).toBe('https://example.com/hg38')
  })

  it('dataset_gnomad resolves to gnomad_r2_1 for GRCh37', () => {
    const template = 'https://example.com/{dataset_gnomad}'
    const data = { chr: '1', pos: 12345, ref: null, alt: null, gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr'])
    expect(url).toBe('https://example.com/gnomad_r2_1')
  })

  it('dataset_gnomad resolves to gnomad_r4 for GRCh38', () => {
    const template = 'https://example.com/{dataset_gnomad}'
    const data = { chr: '1', pos: 12345, ref: null, alt: null, gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh38', ['chr'])
    expect(url).toBe('https://example.com/gnomad_r4')
  })
})
