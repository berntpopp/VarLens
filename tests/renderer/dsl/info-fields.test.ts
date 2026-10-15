import { describe, expect, it } from 'vitest'

import { parseDsl } from '../../../src/shared/dsl/parser'
import { serializeColumnFilters, translateAst } from '../../../src/renderer/src/dsl/translator'

/** Column filters for a DSL string, or its first error message. */
function translate(input: string, scope: 'case' | 'cohort' = 'case') {
  const parsed = parseDsl(input, scope)
  if (parsed.errors.length > 0) return { error: parsed.errors[0].message }
  return translateAst(parsed.ast!).columnFilters
}

describe('DSL info.<KEY> fields (#538)', () => {
  it('keeps =/!= values as text so the backend can tell 01 from 1', () => {
    expect(translate('info.DP:=:01')).toEqual({ 'info.DP': { operator: '=', value: '01' } })
    expect(translate('info.DP:!=:0')).toEqual({ 'info.DP': { operator: '!=', value: '0' } })
  })

  it('parses range bounds as numbers, without includeEmpty', () => {
    expect(translate('info.DP:>=:10')).toEqual({ 'info.DP': { operator: '>=', value: 10 } })
  })

  it('supports contains and null checks, keeping the key case and dots', () => {
    expect(translate('info.Gene.Name:~:abc')).toEqual({
      'info.Gene.Name': { operator: 'like', value: 'abc' }
    })
    expect(translate('INFO.DP:is:null')).toEqual({ 'info.DP': { operator: 'is_null', value: '' } })
  })

  it.each([
    ['info.DP:>:abc', 'needs a number'],
    ['info.LIST:=:"1,2"', 'list values'],
    ['info.9bad:=:1', 'not a valid INFO field name'],
    ['info.DP:~:""', 'needs a non-empty value']
  ])('rejects %s', (input, message) => {
    expect(translate(input)).toEqual({ error: expect.stringContaining(message) })
  })

  it('accepts info fields in the cohort view (#639)', () => {
    expect(translate('info.DP:=:1', 'cohort')).toEqual({
      'info.DP': { operator: '=', value: '1' }
    })
  })

  it('round-trips through the serialized text (URL / saved filters keep the identity)', () => {
    const filters = translate('info.DP:>:0.5 AND info.A.B:=:"x y" AND info.F:is:notnull')
    expect(translate(serializeColumnFilters(filters as never))).toEqual(filters)
  })
})
