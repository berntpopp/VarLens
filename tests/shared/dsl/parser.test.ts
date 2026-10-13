import { describe, it, expect } from 'vitest'
import { parseDsl } from '../../../src/shared/dsl/parser'

describe('parseDsl', () => {
  it('parses a single filter rule', () => {
    const result = parseDsl('gnomad_af:<:0.01')
    expect(result.isDsl).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.ast).toEqual({
      type: 'rule',
      column: 'gnomad_af',
      operator: '<',
      value: 0.01
    })
  })

  it('parses string value', () => {
    const result = parseDsl('gene:=:BRCA1')
    expect(result.ast).toEqual({
      type: 'rule',
      column: 'gene_symbol',
      operator: '=',
      value: 'BRCA1'
    })
  })

  it('parses is:null', () => {
    const result = parseDsl('gnomad_af:is:null')
    expect(result.ast).toEqual({
      type: 'rule',
      column: 'gnomad_af',
      operator: 'is:null',
      value: null
    })
  })

  it('parses AND expression', () => {
    const result = parseDsl('gnomad_af:<:0.01 AND cadd:>=:20')
    expect(result.ast?.type).toBe('group')
    if (result.ast?.type === 'group') {
      expect(result.ast.combinator).toBe('AND')
      expect(result.ast.children).toHaveLength(2)
    }
  })

  it('parses OR expression', () => {
    const result = parseDsl('gene:=:BRCA1 OR gene:=:TP53')
    expect(result.ast?.type).toBe('group')
    if (result.ast?.type === 'group') {
      expect(result.ast.combinator).toBe('OR')
    }
  })

  it('parses parenthesized groups', () => {
    const result = parseDsl('(gene:=:BRCA1 OR gene:=:TP53) AND gnomad_af:<:0.01')
    expect(result.errors).toEqual([])
    expect(result.ast?.type).toBe('group')
    if (result.ast?.type === 'group') {
      expect(result.ast.combinator).toBe('AND')
      expect(result.ast.children).toHaveLength(2)
      expect(result.ast.children[0].type).toBe('group')
    }
  })

  it('parses preset reference', () => {
    const result = parseDsl('@rare_pathogenic')
    expect(result.isDsl).toBe(true)
    expect(result.ast).toEqual({
      type: 'preset',
      name: 'rare_pathogenic'
    })
  })

  it('returns FTS mode for plain text', () => {
    const result = parseDsl('BRCA1 pathogenic')
    expect(result.isDsl).toBe(false)
    expect(result.ast).toBeNull()
    expect(result.ftsQuery).toBe('BRCA1 pathogenic')
  })

  it('returns FTS mode for empty input', () => {
    const result = parseDsl('')
    expect(result.isDsl).toBe(false)
    expect(result.ftsQuery).toBe('')
  })

  it('coerces numeric values', () => {
    const result = parseDsl('cadd:>=:20')
    if (result.ast?.type === 'rule') {
      expect(result.ast.value).toBe(20)
      expect(typeof result.ast.value).toBe('number')
    }
  })

  it('reports error for incomplete expression', () => {
    const result = parseDsl('gnomad_af:<:')
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('reports error for unknown operator', () => {
    const result = parseDsl('gene:??:BRCA1')
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('reports error for mixed AND/OR without parentheses', () => {
    const result = parseDsl('gene:=:BRCA1 AND cadd:>=:20 OR gnomad_af:<:0.01')
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].message).toContain('parentheses')
  })

  it('allows mixed combinators with parentheses', () => {
    const result = parseDsl('(gene:=:BRCA1 AND cadd:>=:20) OR gnomad_af:<:0.01')
    expect(result.errors).toEqual([])
    expect(result.ast?.type).toBe('group')
  })

  it('handles deeply nested parentheses', () => {
    const result = parseDsl('((gene:=:BRCA1 OR gene:=:TP53) AND cadd:>=:20) OR gnomad_af:<:0.01')
    expect(result.errors).toEqual([])
    expect(result.ast?.type).toBe('group')
  })

  it('does not coerce text column values to numbers', () => {
    const result = parseDsl('chr:=:01')
    if (result.ast?.type === 'rule') {
      expect(result.ast.value).toBe('01')
      expect(typeof result.ast.value).toBe('string')
    }
  })

  it('preserves string values for non-numeric columns', () => {
    const result = parseDsl('chr:=:X')
    if (result.ast?.type === 'rule') {
      expect(result.ast.value).toBe('X')
    }
  })

  // Shorthand: column:value (no explicit operator)
  it('supports shorthand gene_symbol:PKD1 → like match', () => {
    const result = parseDsl('gene_symbol:PKD1')
    expect(result.errors).toEqual([])
    expect(result.isDsl).toBe(true)
    expect(result.ast?.type).toBe('rule')
    if (result.ast?.type === 'rule') {
      expect(result.ast.column).toBe('gene_symbol')
      expect(result.ast.operator).toBe('~')
      expect(result.ast.value).toBe('PKD1')
    }
  })

  it('supports shorthand with alias gene:BRCA1', () => {
    const result = parseDsl('gene:BRCA1')
    expect(result.errors).toEqual([])
    expect(result.ast?.type).toBe('rule')
    if (result.ast?.type === 'rule') {
      expect(result.ast.column).toBe('gene_symbol')
      expect(result.ast.operator).toBe('~')
    }
  })

  it('shorthand defaults to = for numeric columns with numeric coercion', () => {
    const result = parseDsl('gnomad_af:0.01')
    expect(result.errors).toEqual([])
    expect(result.ast?.type).toBe('rule')
    if (result.ast?.type === 'rule') {
      expect(result.ast.column).toBe('gnomad_af')
      expect(result.ast.operator).toBe('=')
      expect(result.ast.value).toBe(0.01)
      expect(typeof result.ast.value).toBe('number')
    }
  })

  it('shorthand defaults to ~ for categorical columns', () => {
    const result = parseDsl('consequence:HIGH')
    expect(result.errors).toEqual([])
    expect(result.ast?.type).toBe('rule')
    if (result.ast?.type === 'rule') {
      expect(result.ast.column).toBe('consequence')
      expect(result.ast.operator).toBe('~')
    }
  })

  it('shorthand defaults to = for columns that do not support ~', () => {
    // chr only supports = and != (no LIKE)
    const result = parseDsl('chr:1')
    expect(result.errors).toEqual([])
    expect(result.ast?.type).toBe('rule')
    if (result.ast?.type === 'rule') {
      expect(result.ast.column).toBe('chr')
      expect(result.ast.operator).toBe('=')
      expect(result.ast.value).toBe('1')
    }
  })

  it('shorthand does not trigger for unknown columns', () => {
    const result = parseDsl('unknown_col:value')
    // Should be treated as FTS, not DSL
    expect(result.isDsl).toBe(false)
  })

  it('shorthand works in compound expressions', () => {
    const result = parseDsl('gene:BRCA1 AND consequence:HIGH')
    expect(result.errors).toEqual([])
    expect(result.ast?.type).toBe('group')
  })

  describe('validation (#527)', () => {
    it.each([
      ['gene:=:BRCA1 AND', "after 'AND'"],
      ['gene:=:BRCA1 OR', "after 'OR'"],
      ['gene:=:BRCA1)', "Unexpected ')'"],
      ['(gene:=:BRCA1', 'Expected rparen'],
      ['gene:=:BRCA1 cadd:>=:20', 'Unexpected'],
      ['gene:=:"BRCA1', 'Unclosed quote'],
      ['gene:=:BRCA1 ! cadd:>=:20', "Unexpected character '!'"],
      ['foo:=:bar', "Unknown field 'foo'"],
      ['foo:is:null', "Unknown field 'foo'"],
      ['cadd:<:abc', "'abc' is not a number"],
      ['cadd:=:""', "'' is not a number"],
      ['cadd:=:" "', "' ' is not a number"],
      ['gene:~:""', 'needs a non-empty value'],
      ['clinvar:!~:benign', "Operator '!~' is not supported"],
      ['gene:^:BR', "Operator '^' is not supported"],
      ['gene:$:A1', "Operator '$' is not supported"],
      ['cadd:~:20', "Operator '~' is not supported"],
      ['cnv.copy_number:~:2', "Operator '~' is not supported"]
    ])('rejects %s', (input, message) => {
      const result = parseDsl(input)
      expect(result.errors.map((e) => e.message).join(' ')).toContain(message)
    })

    it.each([
      ['cadd:=:0', { type: 'rule', column: 'cadd', operator: '=', value: 0 }],
      ['cadd:0', { type: 'rule', column: 'cadd', operator: '=', value: 0 }],
      [
        'gnomad_af:is:notnull',
        { type: 'rule', column: 'gnomad_af', operator: 'is:notnull', value: null }
      ],
      ['cnv.copy_number:<:2', { type: 'rule', column: 'cnv.copy_number', operator: '<', value: 2 }],
      ['clinvar:=:"a \\"b\\""', { type: 'rule', column: 'clinvar', operator: '=', value: 'a "b"' }],
      ['gene:=:""', { type: 'rule', column: 'gene_symbol', operator: '=', value: '' }]
    ])('accepts %s', (input, ast) => {
      const result = parseDsl(input)
      expect(result.errors).toEqual([])
      expect(result.ast).toEqual(ast)
    })
  })

  describe('view scope', () => {
    it('rejects per-case fields in the cohort view', () => {
      for (const input of ['gt_num:=:1/1', 'hpo:>:0.3', 'qual:>=:30', 'moi:=:AD']) {
        const result = parseDsl(input, 'cohort')
        expect(result.ast).toBeNull()
        expect(result.errors[0].message).toContain('per-case field')
      }
    })

    it('rejects cohort-only fields in a single case and accepts them in the cohort view', () => {
      expect(parseDsl('carrier_count:>=:2').errors[0].message).toContain('cohort field')
      expect(parseDsl('carrier_count:>=:2', 'cohort').errors).toEqual([])
      expect(parseDsl('gt_num:=:1/1').errors).toEqual([])
      expect(parseDsl('cadd:>=:20', 'cohort').errors).toEqual([])
    })
  })
})

describe('parseDsl — shortlist scope', () => {
  it('accepts derived shortlist fields only in shortlist rules', () => {
    expect(parseDsl('zygosity:=:het', 'case').errors).not.toEqual([])
    expect(parseDsl('gene_het_hits:>=:2', 'cohort').errors).not.toEqual([])
    expect(parseDsl('zygosity:=:het', 'shortlist').errors).toEqual([])
    expect(parseDsl('gene_het_hits:>=:2', 'shortlist').errors).toEqual([])
  })

  it('treats shortlist like the case view for case fields, INFO and cohort-only fields', () => {
    expect(parseDsl('qual:>:30', 'shortlist').errors).toEqual([])
    expect(parseDsl('info.DP:>:3', 'shortlist').errors).toEqual([])
    expect(parseDsl('carrier_count:>:3', 'shortlist').errors).not.toEqual([])
  })
})
