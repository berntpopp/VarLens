import { describe, expect, it } from 'vitest'

import {
  globalAnnotationAuditEntries,
  perCaseAnnotationAuditEntries
} from '../../../src/main/storage/annotation-audit'

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

  it('keys a global entry by its build: builds do not share a history (#577)', () => {
    const [entry] = globalAnnotationAuditEntries(
      { chr: '1', pos: 5, ref: 'A', alt: 'G', genome_build: 'GRCh37' },
      { starred: true },
      null
    )
    expect(entry.entity_key).toBe('1:5:A:G@GRCh37')
  })
})
