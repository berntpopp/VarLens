import { describe, it, expect } from 'vitest'
import { translateAst } from '../../../src/renderer/src/dsl/translator'
import type { DslNode } from '../../../src/renderer/src/dsl/types'

describe('translateAst', () => {
  it('translates a single numeric rule to column filter', () => {
    const ast: DslNode = { type: 'rule', column: 'gnomad_af', operator: '<', value: 0.01 }
    const result = translateAst(ast)
    expect(result.columnFilters).toEqual({
      gnomad_af: { operator: '<', value: 0.01, includeEmpty: true }
    })
  })

  it('translates a text contains rule', () => {
    const ast: DslNode = {
      type: 'rule',
      column: 'gene_symbol',
      operator: '~',
      value: 'BRCA'
    }
    const result = translateAst(ast)
    expect(result.columnFilters).toEqual({
      gene_symbol: { operator: 'like', value: 'BRCA' }
    })
  })

  it('translates is:null to column filter', () => {
    const ast: DslNode = {
      type: 'rule',
      column: 'gnomad_af',
      operator: 'is:null',
      value: null
    }
    const result = translateAst(ast)
    expect(result.columnFilters.gnomad_af).toBeDefined()
  })

  it('translates AND group to merged column filters', () => {
    const ast: DslNode = {
      type: 'group',
      combinator: 'AND',
      children: [
        { type: 'rule', column: 'gnomad_af', operator: '<', value: 0.01 },
        { type: 'rule', column: 'cadd', operator: '>=', value: 20 }
      ]
    }
    const result = translateAst(ast)
    expect(result.columnFilters.gnomad_af).toBeDefined()
    expect(result.columnFilters.cadd).toBeDefined()
  })

  it('returns preset names from preset refs', () => {
    const ast: DslNode = { type: 'preset', name: 'rare_pathogenic' }
    const result = translateAst(ast)
    expect(result.presetNames).toEqual(['rare_pathogenic'])
  })

  it('handles mixed rules and presets in AND group', () => {
    const ast: DslNode = {
      type: 'group',
      combinator: 'AND',
      children: [
        { type: 'preset', name: 'rare' },
        { type: 'rule', column: 'cadd', operator: '>=', value: 20 }
      ]
    }
    const result = translateAst(ast)
    expect(result.presetNames).toEqual(['rare'])
    expect(result.columnFilters.cadd).toBeDefined()
  })

  it('maps ~ operator to like for backend', () => {
    const ast: DslNode = {
      type: 'rule',
      column: 'clinvar',
      operator: '~',
      value: 'pathogenic'
    }
    const result = translateAst(ast)
    expect(result.columnFilters.clinvar.operator).toBe('like')
  })

  it('includes NULL for numeric range operators by default', () => {
    const ast: DslNode = { type: 'rule', column: 'cadd', operator: '>=', value: 15 }
    const result = translateAst(ast)
    expect(result.columnFilters.cadd.includeEmpty).toBe(true)
  })
})
