import { describe, it, expect } from 'vitest'
import {
  buildGnomadUrl,
  buildClinvarUrl,
  buildClinvarSearchUrl,
  buildOmimUrl,
  buildOmimGeneSearchUrl,
  buildUcscUrl,
  buildVarsomeUrl,
  buildFranklinUrl,
  resolveUrlTemplate
} from '../../src/renderer/src/utils/externalLinks'

describe('buildGnomadUrl', () => {
  it('returns correct URL for GRCh37', () => {
    const url = buildGnomadUrl('1', 12345, 'A', 'G', 'GRCh37')
    expect(url).toBe('https://gnomad.broadinstitute.org/variant/1-12345-A-G?dataset=gnomad_r2_1')
  })

  it('returns correct URL for GRCh38', () => {
    const url = buildGnomadUrl('1', 12345, 'A', 'G', 'GRCh38')
    expect(url).toBe('https://gnomad.broadinstitute.org/variant/1-12345-A-G?dataset=gnomad_r4')
  })

  it('returns null when chr is empty string', () => {
    const url = buildGnomadUrl('', 12345, 'A', 'G', 'GRCh37')
    expect(url).toBeNull()
  })

  it('returns null when pos is 0', () => {
    const url = buildGnomadUrl('1', 0, 'A', 'G', 'GRCh37')
    expect(url).toBeNull()
  })

  it('returns null when ref is empty', () => {
    const url = buildGnomadUrl('1', 12345, '', 'G', 'GRCh37')
    expect(url).toBeNull()
  })

  it('returns null when alt is empty', () => {
    const url = buildGnomadUrl('1', 12345, 'A', '', 'GRCh37')
    expect(url).toBeNull()
  })

  it('encodes ref/alt with special characters (insertion)', () => {
    const url = buildGnomadUrl('1', 12345, 'A', 'ATCGATCG', 'GRCh37')
    expect(url).toBe(
      'https://gnomad.broadinstitute.org/variant/1-12345-A-ATCGATCG?dataset=gnomad_r2_1'
    )
  })

  it('encodes ref/alt with special characters (deletion)', () => {
    const url = buildGnomadUrl('1', 12345, 'ATCG', 'A', 'GRCh37')
    expect(url).toBe('https://gnomad.broadinstitute.org/variant/1-12345-ATCG-A?dataset=gnomad_r2_1')
  })
})

describe('buildClinvarUrl', () => {
  it('returns correct URL for valid ClinVar ID', () => {
    const url = buildClinvarUrl('12345')
    expect(url).toBe('https://www.ncbi.nlm.nih.gov/clinvar/variation/12345/')
  })

  it('returns null for null input', () => {
    const url = buildClinvarUrl(null)
    expect(url).toBeNull()
  })

  it('returns null for empty string input', () => {
    const url = buildClinvarUrl('')
    expect(url).toBeNull()
  })
})

describe('buildClinvarSearchUrl', () => {
  it('returns correct URL with chr:pos:ref:alt search term', () => {
    const url = buildClinvarSearchUrl('1', 12345, 'A', 'G')
    expect(url).toBe('https://www.ncbi.nlm.nih.gov/clinvar/?term=1%3A12345%3AA%3AG')
  })

  it('returns null when chr is empty', () => {
    const url = buildClinvarSearchUrl('', 12345, 'A', 'G')
    expect(url).toBeNull()
  })

  it('returns null when pos is 0', () => {
    const url = buildClinvarSearchUrl('1', 0, 'A', 'G')
    expect(url).toBeNull()
  })

  it('returns null when ref is empty', () => {
    const url = buildClinvarSearchUrl('1', 12345, '', 'G')
    expect(url).toBeNull()
  })

  it('returns null when alt is empty', () => {
    const url = buildClinvarSearchUrl('1', 12345, 'A', '')
    expect(url).toBeNull()
  })

  it('correctly encodes the entire search term string', () => {
    const url = buildClinvarSearchUrl('X', 98765, 'AT', 'GC')
    expect(url).toBe('https://www.ncbi.nlm.nih.gov/clinvar/?term=X%3A98765%3AAT%3AGC')
  })
})

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

describe('buildOmimGeneSearchUrl', () => {
  it('returns correct URL for valid gene symbol', () => {
    const url = buildOmimGeneSearchUrl('BRCA1')
    expect(url).toBe('https://omim.org/search?search=BRCA1')
  })

  it('returns null for null input', () => {
    const url = buildOmimGeneSearchUrl(null)
    expect(url).toBeNull()
  })

  it('returns null for empty string input', () => {
    const url = buildOmimGeneSearchUrl('')
    expect(url).toBeNull()
  })

  it('correctly encodes gene symbols with special characters', () => {
    const url = buildOmimGeneSearchUrl('GENE-1')
    expect(url).toBe('https://omim.org/search?search=GENE-1')
  })

  it('correctly encodes gene symbols with spaces', () => {
    const url = buildOmimGeneSearchUrl('GENE SYMBOL')
    expect(url).toBe('https://omim.org/search?search=GENE%20SYMBOL')
  })
})

describe('buildUcscUrl', () => {
  it('returns correct URL for GRCh37', () => {
    const url = buildUcscUrl('1', 12345, 'GRCh37')
    expect(url).toBe('https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg19&position=1%3A12320-12370')
  })

  it('returns correct URL for GRCh38', () => {
    const url = buildUcscUrl('1', 12345, 'GRCh38')
    expect(url).toBe('https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position=1%3A12320-12370')
  })

  it('returns null when chr is empty', () => {
    const url = buildUcscUrl('', 12345, 'GRCh37')
    expect(url).toBeNull()
  })

  it('returns null when pos is 0', () => {
    const url = buildUcscUrl('1', 0, 'GRCh37')
    expect(url).toBeNull()
  })

  it('start position is clamped to minimum 1', () => {
    const url = buildUcscUrl('1', 10, 'GRCh37')
    // pos=10, so start would be 10-25=-15, but clamped to 1
    // end would be 10+25=35
    expect(url).toBe('https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg19&position=1%3A1-35')
  })

  it('correctly handles mitochondrial chromosome', () => {
    const url = buildUcscUrl('MT', 5000, 'GRCh37')
    expect(url).toBe('https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg19&position=MT%3A4975-5025')
  })
})

describe('buildVarsomeUrl', () => {
  it('returns correct URL for GRCh37', () => {
    const url = buildVarsomeUrl('1', 12345, 'A', 'G', 'GRCh37')
    expect(url).toBe('https://varsome.com/variant/hg19/1-12345-A-G')
  })

  it('returns correct URL for GRCh38', () => {
    const url = buildVarsomeUrl('1', 12345, 'A', 'G', 'GRCh38')
    expect(url).toBe('https://varsome.com/variant/hg38/1-12345-A-G')
  })

  it('returns null when chr is missing', () => {
    const url = buildVarsomeUrl('', 12345, 'A', 'G', 'GRCh37')
    expect(url).toBeNull()
  })

  it('returns null when pos is 0', () => {
    const url = buildVarsomeUrl('1', 0, 'A', 'G', 'GRCh37')
    expect(url).toBeNull()
  })

  it('returns null when ref is missing', () => {
    const url = buildVarsomeUrl('1', 12345, '', 'G', 'GRCh37')
    expect(url).toBeNull()
  })

  it('returns null when alt is missing', () => {
    const url = buildVarsomeUrl('1', 12345, 'A', '', 'GRCh37')
    expect(url).toBeNull()
  })

  it('encodes ref/alt properly', () => {
    const url = buildVarsomeUrl('1', 12345, 'ATCG', 'A', 'GRCh37')
    expect(url).toBe('https://varsome.com/variant/hg19/1-12345-ATCG-A')
  })
})

describe('buildFranklinUrl', () => {
  it('returns correct URL for GRCh37', () => {
    const url = buildFranklinUrl('1', 12345, 'A', 'G', 'GRCh37')
    expect(url).toBe('https://franklin.genoox.com/clinical-db/variant/snp/chr1-12345-A-G/GRCh37')
  })

  it('returns correct URL for GRCh38', () => {
    const url = buildFranklinUrl('1', 12345, 'A', 'G', 'GRCh38')
    expect(url).toBe('https://franklin.genoox.com/clinical-db/variant/snp/chr1-12345-A-G/GRCh38')
  })

  it('returns null when chr is missing', () => {
    const url = buildFranklinUrl('', 12345, 'A', 'G', 'GRCh37')
    expect(url).toBeNull()
  })

  it('returns null when pos is 0', () => {
    const url = buildFranklinUrl('1', 0, 'A', 'G', 'GRCh37')
    expect(url).toBeNull()
  })

  it('returns null when ref is missing', () => {
    const url = buildFranklinUrl('1', 12345, '', 'G', 'GRCh37')
    expect(url).toBeNull()
  })

  it('returns null when alt is missing', () => {
    const url = buildFranklinUrl('1', 12345, 'A', '', 'GRCh37')
    expect(url).toBeNull()
  })

  it('encodes ref/alt properly', () => {
    const url = buildFranklinUrl('1', 12345, 'ATCG', 'A', 'GRCh37')
    expect(url).toBe('https://franklin.genoox.com/clinical-db/variant/snp/chr1-12345-ATCG-A/GRCh37')
  })

  it('correctly handles X chromosome', () => {
    const url = buildFranklinUrl('X', 98765, 'T', 'C', 'GRCh38')
    expect(url).toBe('https://franklin.genoox.com/clinical-db/variant/snp/chrX-98765-T-C/GRCh38')
  })
})

describe('resolveUrlTemplate', () => {
  it('resolves gnomAD template matching buildGnomadUrl output', () => {
    const template =
      'https://gnomad.broadinstitute.org/variant/{chr}-{pos}-{ref}-{alt}?dataset={dataset_gnomad}'
    const data = { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos', 'ref', 'alt'])
    const expected = buildGnomadUrl('1', 12345, 'A', 'G', 'GRCh37')
    expect(url).toBe(expected)
  })

  it('resolves UCSC template matching buildUcscUrl output', () => {
    const template =
      'https://genome.ucsc.edu/cgi-bin/hgTracks?db={build_ucsc}&position={chr}%3A{pos_start}-{pos_end}'
    const data = { chr: '1', pos: 12345, ref: null, alt: null, gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos'])
    const expected = buildUcscUrl('1', 12345, 'GRCh37')
    expect(url).toBe(expected)
  })

  it('resolves ClinVar search template matching buildClinvarSearchUrl output', () => {
    const template = 'https://www.ncbi.nlm.nih.gov/clinvar/?term={chr}%3A{pos}%3A{ref}%3A{alt}'
    const data = { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos', 'ref', 'alt'])
    const expected = buildClinvarSearchUrl('1', 12345, 'A', 'G')
    expect(url).toBe(expected)
  })

  it('resolves OMIM gene search template matching buildOmimGeneSearchUrl output', () => {
    const template = 'https://omim.org/search?search={gene}'
    const data = { chr: null, pos: null, ref: null, alt: null, gene_symbol: 'BRCA1' }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['gene'])
    const expected = buildOmimGeneSearchUrl('BRCA1')
    expect(url).toBe(expected)
  })

  it('resolves VarSome template matching buildVarsomeUrl output', () => {
    const template = 'https://varsome.com/variant/{build_ucsc}/{chr}-{pos}-{ref}-{alt}'
    const data = { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos', 'ref', 'alt'])
    const expected = buildVarsomeUrl('1', 12345, 'A', 'G', 'GRCh37')
    expect(url).toBe(expected)
  })

  it('resolves Franklin template matching buildFranklinUrl output', () => {
    const template =
      'https://franklin.genoox.com/clinical-db/variant/snp/chr{chr}-{pos}-{ref}-{alt}/{build}'
    const data = { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: null }
    const url = resolveUrlTemplate(template, data, 'GRCh37', ['chr', 'pos', 'ref', 'alt'])
    const expected = buildFranklinUrl('1', 12345, 'A', 'G', 'GRCh37')
    expect(url).toBe(expected)
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
    // pos=10, so pos_start would be 10-25=-15, clamped to 1, pos_end=10+25=35
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
