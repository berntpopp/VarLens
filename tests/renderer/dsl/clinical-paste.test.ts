import { describe, it, expect } from 'vitest'
import { normalizeClinicalPaste } from '../../../src/renderer/src/dsl/clinical-paste'
import { parseDsl } from '../../../src/renderer/src/dsl/parser'
import { translateAst } from '../../../src/renderer/src/dsl/translator'

describe('normalizeClinicalPaste', () => {
  it('normalizes single genomic coordinates with commas and chr prefix', () => {
    expect(normalizeClinicalPaste('chr17:43,094,464')).toBe('chr:=:17 AND pos:=:43094464')
    expect(normalizeClinicalPaste('17:43094464')).toBe('chr:=:17 AND pos:=:43094464')
    expect(normalizeClinicalPaste('chrX:154000000')).toBe('chr:=:X AND pos:=:154000000')
    expect(normalizeClinicalPaste('chrMT:1234')).toBe('chr:=:MT AND pos:=:1234')
  })

  it('normalizes genomic intervals with hyphen, dashes, and ..', () => {
    expect(normalizeClinicalPaste('chr17:43,044,295-43,125,483')).toBe(
      'chr:=:17 AND pos:>=:43044295 AND pos:<=:43125483'
    )
    expect(normalizeClinicalPaste('17:43044295..43125483')).toBe(
      'chr:=:17 AND pos:>=:43044295 AND pos:<=:43125483'
    )
    expect(normalizeClinicalPaste('chr2:100000–200000')).toBe(
      'chr:=:2 AND pos:>=:100000 AND pos:<=:200000'
    )
  })

  it('swaps reversed genomic intervals so min is always <= max', () => {
    expect(normalizeClinicalPaste('chr17:43,125,483-43,044,295')).toBe(
      'chr:=:17 AND pos:>=:43044295 AND pos:<=:43125483'
    )
  })

  it('normalizes VCF-style variant keys with - and :', () => {
    expect(normalizeClinicalPaste('17-43094464-G-A')).toBe(
      'chr:=:17 AND pos:=:43094464 AND ref:=:G AND alt:=:A'
    )
    expect(normalizeClinicalPaste('chr17:43094464:G:A')).toBe(
      'chr:=:17 AND pos:=:43094464 AND ref:=:G AND alt:=:A'
    )
    expect(normalizeClinicalPaste('chr17:43094464:g:a')).toBe(
      'chr:=:17 AND pos:=:43094464 AND ref:=:G AND alt:=:A'
    )
    expect(normalizeClinicalPaste('1-1000-A-*')).toBe(
      'chr:=:1 AND pos:=:1000 AND ref:=:A AND alt:=:*'
    )
  })

  it('normalizes multi-symbol uppercase gene lists separated by commas, semicolons, whitespace', () => {
    expect(normalizeClinicalPaste('BRCA1, BRCA2, PALB2, ATM')).toBe(
      '(gene_symbol:=:BRCA1 OR gene_symbol:=:BRCA2 OR gene_symbol:=:PALB2 OR gene_symbol:=:ATM)'
    )
    expect(normalizeClinicalPaste('BRCA1 BRCA2 PALB2')).toBe(
      '(gene_symbol:=:BRCA1 OR gene_symbol:=:BRCA2 OR gene_symbol:=:PALB2)'
    )
    expect(normalizeClinicalPaste('BRCA1; BRCA2; PALB2')).toBe(
      '(gene_symbol:=:BRCA1 OR gene_symbol:=:BRCA2 OR gene_symbol:=:PALB2)'
    )
    expect(normalizeClinicalPaste('BRCA1\nBRCA2\nPALB2')).toBe(
      '(gene_symbol:=:BRCA1 OR gene_symbol:=:BRCA2 OR gene_symbol:=:PALB2)'
    )
  })

  it('deduplicates gene symbols in gene lists', () => {
    expect(normalizeClinicalPaste('BRCA1, BRCA2, BRCA1')).toBe(
      '(gene_symbol:=:BRCA1 OR gene_symbol:=:BRCA2)'
    )
  })

  it('leaves single gene symbols, free text, HGVS, and rsIDs unchanged', () => {
    expect(normalizeClinicalPaste('BRCA1')).toBe('BRCA1')
    expect(normalizeClinicalPaste('pathogenic variant')).toBe('pathogenic variant')
    expect(normalizeClinicalPaste('c.123A>G')).toBe('c.123A>G')
    expect(normalizeClinicalPaste('p.Val600Glu')).toBe('p.Val600Glu')
    expect(normalizeClinicalPaste('rs12345')).toBe('rs12345')
  })

  it('leaves existing DSL unchanged', () => {
    expect(normalizeClinicalPaste('gnomad_af:<:0.01')).toBe('gnomad_af:<:0.01')
    expect(normalizeClinicalPaste('@preset')).toBe('@preset')
    expect(normalizeClinicalPaste('gene:=:BRCA1 AND cadd:>=:20')).toBe(
      'gene:=:BRCA1 AND cadd:>=:20'
    )
  })

  it('handles empty or whitespace-only input', () => {
    expect(normalizeClinicalPaste('')).toBe('')
    expect(normalizeClinicalPaste('   ')).toBe('')
  })

  it('integrates with parseDsl and translateAst for gene lists', () => {
    const raw = 'BRCA1, BRCA2, PALB2'
    const normalized = normalizeClinicalPaste(raw)
    const parsed = parseDsl(normalized)
    expect(parsed.errors).toEqual([])
    const translated = translateAst(parsed.ast!)
    expect(translated.errors).toEqual([])
    expect(translated.columnFilters.gene_symbol).toEqual({
      operator: 'in',
      value: ['BRCA1', 'BRCA2', 'PALB2']
    })
  })
})
