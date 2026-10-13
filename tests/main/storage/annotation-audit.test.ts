import { describe, expect, it } from 'vitest'

import { perCaseAnnotationAuditEntries } from '../../../src/main/storage/annotation-audit'

describe('ACMG history entries', () => {
  it('records the override reason with the class it justifies (#567)', () => {
    const evidence = JSON.stringify({ pathogenic: [], benign: [], override_reason: ' Family ' })
    const [classify] = perCaseAnnotationAuditEntries(
      1,
      2,
      { acmg_classification: 'Benign', acmg_evidence: evidence },
      null
    )
    expect(JSON.parse(classify.new_value as string)).toEqual({
      acmg_classification: 'Benign',
      override_reason: 'Family'
    })
  })

  it('a class without a reason is recorded as before', () => {
    const [classify] = perCaseAnnotationAuditEntries(1, 2, { acmg_classification: 'Benign' }, null)
    expect(JSON.parse(classify.new_value as string)).toEqual({ acmg_classification: 'Benign' })
  })
})
