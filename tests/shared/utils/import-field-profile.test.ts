/**
 * The import field-profile engine (spec §16): key normalisation, policy,
 * per-field choices, canonical evidence keys and the field dictionary.
 */
import { describe, expect, it } from 'vitest'

import {
  FieldProfileResolver,
  ImportFieldBudgetError,
  jsonValueText,
  normaliseInfoKey
} from '../../../src/shared/utils/import-field-profile'
import { isValidInfoKey } from '../../../src/shared/filters/info-field-filter'
import {
  CANONICAL_EVIDENCE_FIELDS,
  COLUMNAR_HEADER_TO_SLOT,
  MAX_INFO_JSON_FIELDS,
  type ImportFieldProfile
} from '../../../src/shared/config/import-fields.config'

const ALL: ImportFieldProfile = { keepUnknown: 'all', fields: {} }

function info(
  resolver: FieldProfileResolver,
  fill: (r: ReturnType<FieldProfileResolver['record']>) => void
) {
  const record = resolver.record()
  fill(record)
  const json = record.toJson()
  return json === null ? null : (JSON.parse(json) as Record<string, string>)
}

describe('normaliseInfoKey', () => {
  it('keeps valid INFO ids and rewrites everything else to the INFO grammar', () => {
    expect(normaliseInfoKey('DP')).toBe('DP')
    expect(normaliseInfoKey('gnomAD4.1_joint_AF')).toBe('gnomAD4.1_joint_AF')
    expect(normaliseInfoKey('1000G')).toBe('1000G')
    expect(normaliseInfoKey('AltAF-Index')).toBe('AltAF_Index')
    expect(normaliseInfoKey('GERP++RsRank')).toBe('GERP__RsRank')
    expect(normaliseInfoKey('#HpoMatch')).toBe('_HpoMatch')
    expect(normaliseInfoKey('3prime')).toBe('_3prime')
    expect(normaliseInfoKey('x'.repeat(90))).toHaveLength(64)
  })

  it('always yields a key the info filter accepts', () => {
    for (const name of ['a-b', '', '9', 'ü', 'cDNA.pos/cDNA.length', 'ERRORS/WARNINGS/INFO']) {
      expect(isValidInfoKey(normaliseInfoKey(name))).toBe(true)
    }
  })
})

describe('FieldProfileResolver', () => {
  it('suffixes collisions in first-seen order', () => {
    const resolver = new FieldProfileResolver(ALL)
    resolver.seed('INFO', ['AF', 'A-B'])
    resolver.seed('CSQ', ['AF', 'A_B'])
    expect(resolver.resolve('INFO', 'AF').key).toBe('AF')
    expect(resolver.resolve('CSQ', 'AF').key).toBe('AF_2')
    expect(resolver.resolve('INFO', 'A-B').key).toBe('A_B')
    expect(resolver.resolve('CSQ', 'A_B').key).toBe('A_B_2')
  })

  it('reserves canonical keys for their aliases', () => {
    const resolver = new FieldProfileResolver(ALL)
    expect(resolver.resolve('INFO', 'SPLICEAI_MAX').key).toBe('SPLICEAI_MAX_2')
    expect(resolver.resolve('JSON', 'RevelScore')).toMatchObject({ key: 'REVEL' })
  })

  it('applies the unknown-field policy, keeping evidence aliases unless skipped', () => {
    const evidence = new FieldProfileResolver({ keepUnknown: 'selected', fields: {} })
    expect(evidence.resolve('JSON', 'LocalAF').key).toBeNull()
    expect(evidence.resolve('JSON', 'RevelScore').key).toBe('REVEL')
    const none = new FieldProfileResolver({ keepUnknown: 'none', fields: {} })
    expect(none.resolve('JSON', 'RevelScore').key).toBeNull()

    const selected = new FieldProfileResolver({
      keepUnknown: 'selected',
      fields: {
        'JSON:LocalAF': { keep: true, key: 'LOCAL_AF' },
        'JSON:RevelScore': { keep: false }
      }
    })
    expect(selected.resolve('JSON', 'LocalAF').key).toBe('LOCAL_AF')
    expect(selected.resolve('JSON', 'Other').key).toBeNull()
    expect(selected.resolve('JSON', 'RevelScore').key).toBeNull()
  })

  it('normalises a renamed key and keeps the rename distinct from canonical keys', () => {
    const resolver = new FieldProfileResolver({
      keepUnknown: 'all',
      fields: {
        'JSON:Foo': { keep: true, key: 'my-key' },
        'JSON:Bar': { keep: true, key: 'REVEL' }
      }
    })
    expect(resolver.resolve('JSON', 'Foo').key).toBe('my_key')
    expect(resolver.resolve('JSON', 'Bar').key).toBe('REVEL_2')
  })
})

describe('FieldRecord', () => {
  it('stores unknown fields as text and the canonical value of aliases', () => {
    const resolver = new FieldProfileResolver(ALL)
    expect(
      info(resolver, (r) => {
        r.set('JSON', 'AltAF-Index', '0.48')
        r.set('JSON', 'RevelScore', '0.912')
        r.set('JSON', 'ClinVStatus', 'criteria provided, multiple submitters, no conflicts')
      })
    ).toEqual({
      AltAF_Index: '0.48',
      REVEL: '0.912',
      CLINVAR_REVSTAT: 'criteria provided, multiple submitters, no conflicts'
    })
  })

  it('derives the same canonical values from VEP CSQ spellings', () => {
    const resolver = new FieldProfileResolver(ALL)
    const out = info(resolver, (r) => {
      r.set('CSQ', 'REVEL_score', '0.912')
      r.set(
        'CSQ',
        'ClinVarCurrent_CLNREVSTAT',
        'criteria_provided&_multiple_submitters&_no_conflicts'
      )
      r.set('CSQ', 'SpliceAI_pred_DS_AG', '0.01')
      r.set('CSQ', 'SpliceAI_pred_DS_AL', '0.00')
      r.set('CSQ', 'SpliceAI_pred_DS_DG', '0.62')
      r.set('CSQ', 'SpliceAI_pred_DS_DL', '.')
    })
    expect(out).toMatchObject({
      REVEL: '0.912',
      CLINVAR_REVSTAT: 'criteria provided, multiple submitters, no conflicts',
      SPLICEAI_MAX: '0.62',
      SpliceAI_pred_DS_DG: '0.62'
    })
    expect(resolver.dictionary()).toMatchObject({
      REVEL: 'CSQ:REVEL_score',
      SPLICEAI_MAX:
        'max(CSQ:SpliceAI_pred_DS_AG, CSQ:SpliceAI_pred_DS_AL, CSQ:SpliceAI_pred_DS_DG)',
      SpliceAI_pred_DS_DG: 'CSQ:SpliceAI_pred_DS_DG'
    })
  })

  it('takes the maximum of per-transcript values and normalises the number text', () => {
    const resolver = new FieldProfileResolver(ALL)
    expect(info(resolver, (r) => r.set('CSQ', 'REVEL_score', '0.20&.&0.700'))).toEqual({
      REVEL: '0.7'
    })
  })

  it('feeds canonical keys from column-mapped fields without storing them twice', () => {
    const resolver = new FieldProfileResolver(ALL)
    expect(info(resolver, (r) => r.deriveOnly('JSON', 'GnomPMaxFiltAF', '0.0001'))).toEqual({
      GNOMAD_POPMAX_AF: '0.0001'
    })
    const skipped = new FieldProfileResolver({
      keepUnknown: 'all',
      fields: { 'JSON:GnomPMaxFiltAF': { keep: false } }
    })
    expect(info(skipped, (r) => r.deriveOnly('JSON', 'GnomPMaxFiltAF', '0.0001'))).toBeNull()
  })

  it('stores keys like __proto__ as plain data', () => {
    const resolver = new FieldProfileResolver(ALL)
    expect(info(resolver, (r) => r.set('JSON', '__proto__', 'x'))).toEqual(
      JSON.parse('{"__proto__":"x"}')
    )
  })

  it('rejects a record over the field budget', () => {
    const resolver = new FieldProfileResolver(ALL)
    const record = resolver.record()
    for (let i = 0; i <= MAX_INFO_JSON_FIELDS; i++) record.set('INFO', `F${i}`, '1')
    expect(() => record.toJson()).toThrow(ImportFieldBudgetError)
  })
})

describe('jsonValueText', () => {
  it('turns export values into stored text', () => {
    expect(jsonValueText(null)).toBeNull()
    expect(jsonValueText('')).toBeNull()
    expect(jsonValueText('[]')).toBeNull()
    expect(jsonValueText(1e-5)).toBe('0.00001')
    expect(jsonValueText(['a', 2, null])).toBe('a,2')
    expect(jsonValueText([{ abbreviation: 'AD' }, { abbreviation: 'AR' }])).toBe('AD,AR')
    expect(jsonValueText({ x: 1 })).toBe('{"x":1}')
    expect(jsonValueText(true)).toBe('true')
  })
})

describe('import-fields config', () => {
  it('canonical keys are valid, unique INFO keys with unique aliases', () => {
    const keys = CANONICAL_EVIDENCE_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(isValidInfoKey(key)).toBe(true)
    const aliases = CANONICAL_EVIDENCE_FIELDS.flatMap((f) => f.aliases)
    expect(new Set(aliases).size).toBe(aliases.length)
  })

  it('no canonical alias is a columnar column except the popmax AF', () => {
    const aliases = CANONICAL_EVIDENCE_FIELDS.flatMap((f) => f.aliases)
    expect(aliases.filter((a) => a in COLUMNAR_HEADER_TO_SLOT)).toEqual(['GnomPMaxFiltAF'])
  })
})
