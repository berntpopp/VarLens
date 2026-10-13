import { describe, expect, it } from 'vitest'

import { caseInfoFields, infoJsonEntries } from '../../../src/shared/utils/case-info-fields'

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
