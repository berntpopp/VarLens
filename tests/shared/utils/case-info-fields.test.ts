import { describe, expect, it } from 'vitest'

import {
  caseInfoFields,
  infoFieldLimitation,
  infoJsonEntries
} from '../../../src/shared/utils/case-info-fields'

describe('caseInfoFields', () => {
  it('lists the dictionary sorted by key and drops invalid entries', () => {
    const text = JSON.stringify({
      SPLICEAI_MAX: 'max(CSQ:SpliceAI_pred_DS_AG, CSQ:SpliceAI_pred_DS_AL)',
      AltAF_Index: 'JSON:AltAF-Index',
      'bad key': 'JSON:x',
      NUM: 3
    })
    expect(caseInfoFields(text)).toEqual([
      { key: 'AltAF_Index', source: 'JSON:AltAF-Index' },
      { key: 'SPLICEAI_MAX', source: 'max(CSQ:SpliceAI_pred_DS_AG, CSQ:SpliceAI_pred_DS_AL)' }
    ])
  })

  it('reads header Type/Number entries next to pre-#538 source strings', () => {
    const text = JSON.stringify({
      DP: { source: 'INFO:DP', type: 'Integer', number: '1' },
      REVEL: 'CSQ:REVEL_score',
      NOSRC: { type: 'Flag' }
    })
    expect(caseInfoFields(text)).toEqual([
      { key: 'DP', source: 'INFO:DP', type: 'Integer', number: '1' },
      { key: 'REVEL', source: 'CSQ:REVEL_score' }
    ])
  })

  it.each([null, undefined, '', 'not json', '[1]', 'null'])('is empty for %s', (text) => {
    expect(caseInfoFields(text)).toEqual([])
  })
})

describe('infoJsonEntries', () => {
  it('returns stored pairs as text', () => {
    expect(infoJsonEntries('{"DP":"35","FLAG":"","N":2}')).toEqual([
      ['DP', '35'],
      ['FLAG', ''],
      ['N', '2']
    ])
    expect(infoJsonEntries(null)).toEqual([])
  })
})

describe('infoFieldLimitation', () => {
  it.each([
    [{ source: 'INFO:DB', type: 'Flag', number: '0' }, /Flag field/],
    [{ source: 'INFO:AD', type: 'Integer', number: 'R' }, /Number=R/],
    [{ source: 'INFO:X', type: 'String', number: '.' }, /Number=\./],
    [{ source: 'INFO:Y', type: 'Float', number: '2' }, /Number=2/]
  ])('marks %o as not comparable', (field, reason) => {
    expect(infoFieldLimitation(field)).toMatch(reason)
  })

  it.each([
    { source: 'INFO:DP', type: 'Integer', number: '1' },
    { source: 'INFO:AC', type: 'Integer', number: 'A' },
    { source: 'CSQ:REVEL_score' }
  ])(
    'accepts %o',
    (field) => {
      expect(infoFieldLimitation(field)).toBeNull()
    }
  )
})
