import { describe, it, expect } from 'vitest'
import {
  translateAst,
  serializeColumnFilters,
  normalizeClinicalPaste
} from '../../../src/renderer/src/dsl/translator'
import { parseDsl } from '../../../src/renderer/src/dsl/parser'
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

  it('translates is:null / is:notnull to dedicated null-check operators', () => {
    // Never `= ''`: both backends coerce that to `= 0` on a numeric column.
    const rule = (operator: 'is:null' | 'is:notnull'): DslNode => ({
      type: 'rule',
      column: 'gnomad_af',
      operator,
      value: null
    })
    expect(translateAst(rule('is:null')).columnFilters).toEqual({
      gnomad_af: { operator: 'is_null', value: '' }
    })
    expect(translateAst(rule('is:notnull')).columnFilters).toEqual({
      gnomad_af: { operator: 'not_null', value: '' }
    })
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

  it('rejects repeated-field AND instead of dropping a bound', () => {
    const ast: DslNode = {
      type: 'group',
      combinator: 'AND',
      children: [
        { type: 'rule', column: 'cadd', operator: '>=', value: 20 },
        { type: 'rule', column: 'cadd', operator: '<=', value: 30 }
      ]
    }
    const result = translateAst(ast)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('cadd:<=:30')
  })
})

describe('translateAst Boolean fidelity (#526)', () => {
  const translate = (input: string) => {
    const parsed = parseDsl(input)
    expect(parsed.errors).toEqual([])
    return translateAst(parsed.ast!)
  }

  it.each([
    ['cadd:>=:20 AND cadd:<=:30', 'only one condition per field'],
    ['cadd:<:10 OR cadd:>:20', "OR is only supported between '=' conditions"],
    ['gene:=:BRCA1 OR cadd:>=:20', "OR is only supported between '=' conditions"],
    ['gene:=:BRCA1 OR gene:~:TP', "OR is only supported between '=' conditions"],
    ['(gene:=:BRCA1 AND cadd:>=:20) OR gnomad_af:<:0.01', 'OR is only supported'],
    ['@a OR @b', 'OR is only supported'],
    ['@a AND @b', 'only one @preset'],
    ['(gene:=:A OR gene:=:B) AND gene:=:C', 'only one condition per field']
  ])('rejects %s', (input, message) => {
    const result = translate(input)
    expect(result.errors.join(' ')).toContain(message)
  })

  it.each([
    ['gene:=:BRCA1 OR gene:=:TP53', { gene_symbol: { operator: 'in', value: ['BRCA1', 'TP53'] } }],
    [
      '(gene:=:BRCA1 OR symbol:=:TP53) AND cadd:>=:20',
      {
        gene_symbol: { operator: 'in', value: ['BRCA1', 'TP53'] },
        cadd: { operator: '>=', value: 20, includeEmpty: true }
      }
    ],
    ['gnomad_af:is:null', { gnomad_af: { operator: 'is_null', value: '' } }],
    ['cnv.copy_number:<:2', { 'cnv.copy_number': { operator: '<', value: 2 } }],
    ['clinvar:~:"Likely pathogenic"', { clinvar: { operator: 'like', value: 'Likely pathogenic' } }]
  ])('translates %s faithfully', (input, expected) => {
    const result = translate(input)
    expect(result.errors).toEqual([])
    expect(result.columnFilters).toEqual(expected)
  })

  it('combines pos lower and upper bounds into a single range filter (#683)', () => {
    const result = translate('pos:>=:43044295 AND pos:<=:43125483')
    expect(result.errors).toEqual([])
    expect(result.columnFilters.pos).toEqual({
      operator: 'between',
      value: [43044295, 43125483]
    })
  })

  it('translates normalized clinical coordinate interval to chr and pos bounds (#683)', () => {
    const input = normalizeClinicalPaste('chr17:43,044,295-43,125,483')
    const result = translate(input)
    expect(result.errors).toEqual([])
    expect(result.columnFilters.chr).toEqual({
      operator: 'in',
      value: ['chr17', '17']
    })
    expect(result.columnFilters.pos).toEqual({
      operator: 'between',
      value: [43044295, 43125483]
    })
  })
})

describe('translateAst — chromosome', () => {
  const translate = (input: string) => translateAst(parseDsl(input).ast!)

  it('chr equality matches the stored spelling of every build', () => {
    const result = translate('chr:=:1')
    expect(result.errors).toEqual([])
    expect(result.columnFilters.chr).toEqual({ operator: 'in', value: ['chr1', '1'] })
  })

  it('a mitochondrion matches chrM and MT', () => {
    expect(translate('chr:=:MT').columnFilters.chr.value).toEqual(
      expect.arrayContaining(['chrM', 'MT'])
    )
  })

  it('OR alternatives expand without duplicates', () => {
    expect(translate('chr:=:1 OR chr:=:chr1').columnFilters.chr).toEqual({
      operator: 'in',
      value: ['chr1', '1']
    })
  })
})

describe('serializeColumnFilters', () => {
  it.each([
    'gene:=:BRCA1 OR gene:=:TP53',
    'cadd:>=:20 AND gnomad_af:<:0.01 AND chr:=:01',
    'chr:=:X AND gene:=:DMD',
    'clinvar:~:"Likely \\"odd\\" pathogenic" AND gnomad_af:is:notnull',
    'cnv.copy_number:<:2 AND gene:=:"AND"'
  ])('round-trips %s', (input) => {
    const first = translateAst(parseDsl(input).ast!)
    const text = serializeColumnFilters(first.columnFilters)
    const second = parseDsl(text)
    expect(second.errors).toEqual([])
    expect(translateAst(second.ast!).columnFilters).toEqual(first.columnFilters)
  })

  it('round-trips clinical interval with between operator (#683)', () => {
    const filters = {
      chr: { operator: 'in' as const, value: ['chr17', '17'] },
      pos: { operator: 'between' as const, value: [43044295, 43125483] as [number, number] }
    }
    const text = serializeColumnFilters(filters)
    const second = parseDsl(text)
    expect(second.errors).toEqual([])
    expect(translateAst(second.ast!).columnFilters).toEqual(filters)
  })
})
