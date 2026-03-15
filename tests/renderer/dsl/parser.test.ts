import { describe, it, expect } from 'vitest'
import { parseDsl } from '../../../src/renderer/src/dsl/parser'

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
})
