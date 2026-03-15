import { describe, it, expect } from 'vitest'
import { tokenize } from '../../../src/renderer/src/dsl/tokenizer'

describe('tokenizer', () => {
  it('tokenizes a simple filter rule', () => {
    const tokens = tokenize('gnomad_af:<:0.01')
    expect(tokens).toEqual([
      { type: 'column', value: 'gnomad_af', position: 0 },
      { type: 'colon', value: ':', position: 9 },
      { type: 'operator', value: '<', position: 10 },
      { type: 'colon', value: ':', position: 11 },
      { type: 'value', value: '0.01', position: 12 }
    ])
  })

  it('tokenizes compound operators', () => {
    const tokens = tokenize('cadd:>=:20')
    const opToken = tokens.find((t) => t.type === 'operator')
    expect(opToken?.value).toBe('>=')
  })

  it('tokenizes is:null operator', () => {
    const tokens = tokenize('gnomad_af:is:null')
    expect(tokens).toContainEqual(expect.objectContaining({ type: 'operator', value: 'is:null' }))
  })

  it('tokenizes is:notnull operator', () => {
    const tokens = tokenize('gnomad_af:is:notnull')
    expect(tokens).toContainEqual(
      expect.objectContaining({ type: 'operator', value: 'is:notnull' })
    )
  })

  it('tokenizes AND combinator', () => {
    const tokens = tokenize('gnomad_af:<:0.01 AND cadd:>=:20')
    expect(tokens).toContainEqual(expect.objectContaining({ type: 'combinator', value: 'AND' }))
  })

  it('tokenizes OR combinator', () => {
    const tokens = tokenize('gnomad_af:<:0.01 OR gnomad_af:is:null')
    expect(tokens).toContainEqual(expect.objectContaining({ type: 'combinator', value: 'OR' }))
  })

  it('tokenizes parentheses', () => {
    const tokens = tokenize('(gene:=:BRCA1 OR gene:=:TP53)')
    expect(tokens[0]).toEqual({ type: 'lparen', value: '(', position: 0 })
    expect(tokens[tokens.length - 1]).toEqual(
      expect.objectContaining({ type: 'rparen', value: ')' })
    )
  })

  it('tokenizes preset reference', () => {
    const tokens = tokenize('@rare_pathogenic')
    expect(tokens).toEqual([{ type: 'preset', value: 'rare_pathogenic', position: 0 }])
  })

  it('tokenizes quoted values', () => {
    const tokens = tokenize('clinvar:~:"Likely pathogenic"')
    const valueToken = tokens.find((t) => t.type === 'value')
    expect(valueToken?.value).toBe('Likely pathogenic')
  })

  it('tokenizes not-contains operator', () => {
    const tokens = tokenize('clinvar:!~:benign')
    const opToken = tokens.find((t) => t.type === 'operator')
    expect(opToken?.value).toBe('!~')
  })

  it('returns empty array for empty input', () => {
    expect(tokenize('')).toEqual([])
  })
})
