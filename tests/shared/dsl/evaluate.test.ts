import { describe, it, expect } from 'vitest'
import { compileRule, RULE_LIMITS } from '../../../src/shared/dsl/evaluate'

function pred(text: string): (row: Record<string, unknown>) => boolean {
  const r = compileRule(text)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.predicate
}
const row = (o: Record<string, unknown>): Record<string, unknown> => o

describe('compileRule — semantics', () => {
  it('numeric comparisons never fire on missing values', () => {
    const p = pred('cadd:>=:20')
    expect(p(row({ cadd: 25 }))).toBe(true)
    expect(p(row({ cadd: 15 }))).toBe(false)
    expect(p(row({ cadd: null }))).toBe(false)
    expect(p(row({}))).toBe(false)
    expect(p(row({ cadd: Number.NaN }))).toBe(false)
    expect(pred('cadd:!=:20')(row({ cadd: null }))).toBe(false)
  })

  it('is:null fires on null and blank text', () => {
    expect(pred('gnomad_af:is:null')(row({ gnomad_af: null }))).toBe(true)
    expect(pred('gnomad_af:is:null')(row({ gnomad_af: 0 }))).toBe(false)
    expect(pred('gene_symbol:is:null')(row({ gene_symbol: '' }))).toBe(true)
    expect(pred('gene_symbol:is:notnull')(row({ gene_symbol: 'BTK' }))).toBe(true)
  })

  it('severity columns match by normalised category, like the SQL filter', () => {
    expect(pred('clinvar:=:Pathogenic')(row({ clinvar: 'Pathogenic|drug_response' }))).toBe(true)
    expect(pred('clinvar:=:Pathogenic')(row({ clinvar: 'pathogenic' }))).toBe(true)
    // the aggregate category is contained in Pathogenic, as in severityFilterParts
    expect(pred('clinvar:=:Pathogenic')(row({ clinvar: 'Pathogenic/Likely_pathogenic' }))).toBe(
      true
    )
    expect(pred('clinvar:=:Pathogenic')(row({ clinvar: 'Benign' }))).toBe(false)
    expect(pred('clinvar:!=:Pathogenic')(row({ clinvar: null }))).toBe(false)
    expect(pred('clinvar:!=:Pathogenic')(row({ clinvar: 'Benign' }))).toBe(true)
    expect(pred('consequence:=:HIGH')(row({ consequence: 'HIGH' }))).toBe(true)
    expect(pred('consequence:=:high')(row({ consequence: 'HIGH' }))).toBe(true)
    expect(pred('consequence:=:HIGH')(row({ consequence: 'LOW' }))).toBe(false)
  })

  it('text = is exact, ~ is ASCII case-insensitive substring with literal % and _', () => {
    expect(pred('func:=:missense_variant')(row({ func: 'missense_variant' }))).toBe(true)
    expect(pred('func:=:missense_variant')(row({ func: 'Missense_variant' }))).toBe(false)
    expect(pred('moi:~:ar')(row({ moi: 'AD, AR' }))).toBe(true)
    expect(pred('gene_symbol:~:a_b')(row({ gene_symbol: 'XA_BX' }))).toBe(true)
    expect(pred('gene_symbol:~:a_b')(row({ gene_symbol: 'XAZBX' }))).toBe(false)
    expect(pred('gene_symbol:~:"a%"')(row({ gene_symbol: 'XAZ' }))).toBe(false)
    expect(pred('moi:~:AR')(row({ moi: null }))).toBe(false)
    // ASCII-only folding, like SQLite NOCASE
    expect(pred('gene_symbol:~:ä')(row({ gene_symbol: 'Ä' }))).toBe(false)
  })

  it('AND / OR / groups', () => {
    const p = pred('(func:=:stop_gained OR func:=:frameshift_truncation) AND gnomad_af:<:0.001')
    expect(p(row({ func: 'stop_gained', gnomad_af: 0.0001 }))).toBe(true)
    expect(p(row({ func: 'stop_gained', gnomad_af: null }))).toBe(false)
    expect(p(row({ func: 'missense_variant', gnomad_af: 0 }))).toBe(false)
  })

  it('info.<KEY> follows info-value semantics', () => {
    const info = JSON.stringify({ REVEL: '0.8', TAG: 'x', Z: '0.0' })
    expect(pred('info.REVEL:>=:0.7')(row({ info_json: info }))).toBe(true)
    expect(pred('info.TAG:>=:0.7')(row({ info_json: info }))).toBe(false)
    expect(pred('info.MISSING:is:null')(row({ info_json: info }))).toBe(true)
    expect(pred('info.Z:=:0')(row({ info_json: info }))).toBe(true)
    expect(pred('info.TAG:!=:y')(row({ info_json: info }))).toBe(true)
    expect(pred('info.MISSING:!=:y')(row({ info_json: info }))).toBe(false)
  })

  it('derived shortlist columns are accepted', () => {
    expect(
      pred('zygosity:=:het AND gene_het_hits:>=:2')(row({ zygosity: 'het', gene_het_hits: 2 }))
    ).toBe(true)
  })

  it('never throws on odd imported values (Review Focus 5)', () => {
    const p = pred('hpo_sim_score:>=:0.1 OR func:=:missense_variant')
    expect(() => p(row({ hpo_sim_score: [], func: ['a'] }))).not.toThrow()
    expect(p(row({ hpo_sim_score: [], func: ['a'] }))).toBe(false)
    expect(pred('clinvar:=:Pathogenic')(row({ clinvar: ['Pathogenic'] }))).toBe(false)
  })
})

describe('compileRule — validation', () => {
  it('rejects plain text, presets, unknown columns and oversized input', () => {
    expect(compileRule('BRCA1').ok).toBe(false)
    expect(compileRule('').ok).toBe(false)
    expect(compileRule('@my_preset').ok).toBe(false)
    expect(compileRule('cadd:>=:1 AND @my_preset').ok).toBe(false)
    expect(compileRule('nope:=:1').ok).toBe(false)
    expect(compileRule('carrier_count:>:1').ok).toBe(false) // cohort-only
    expect(compileRule('sv.svlen:>:1').ok).toBe(false) // extension columns are not SNV/indel fields
    expect(compileRule('cadd:>=:1 AND '.repeat(70) + 'cadd:>=:1').ok).toBe(false)
    expect(compileRule('x'.repeat(RULE_LIMITS.maxChars + 1)).ok).toBe(false)
  })

  it('bounds the nesting depth', () => {
    const deep = '('.repeat(9) + 'cadd:>=:1 AND cadd:<:2' + ')'.repeat(9)
    // parentheses around a single expression do not add AST levels; alternate combinators
    let nested = 'cadd:>=:1'
    for (let i = 0; i < RULE_LIMITS.maxDepth + 1; i++) {
      nested = `(${nested} ${i % 2 === 0 ? 'AND' : 'OR'} cadd:<:${i})`
    }
    expect(compileRule(deep).ok).toBe(true)
    expect(compileRule(nested).ok).toBe(false)
  })
})

describe('compileRule — incomplete input', () => {
  it('rejects a valid prefix with a trailing error', () => {
    expect(compileRule('cadd:>:20 AND').ok).toBe(false)
    expect(compileRule('cadd:>:20 garbage').ok).toBe(false)
  })
})
