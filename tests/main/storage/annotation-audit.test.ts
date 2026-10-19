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

  it('records an acmg_classify audit entry with null when acmg_classification is cleared', () => {
    const [entry1] = perCaseAnnotationAuditEntries(
      1,
      2,
      { acmg_classification: undefined },
      { acmg_classification: 'Pathogenic' }
    )
    expect(entry1.action_type).toBe('acmg_classify')
    expect(JSON.parse(entry1.new_value as string)).toEqual({ acmg_classification: null })

    const [entry2] = perCaseAnnotationAuditEntries(
      1,
      2,
      { acmg_classification: null },
      { acmg_classification: 'Pathogenic' }
    )
    expect(entry2.action_type).toBe('acmg_classify')
    expect(JSON.parse(entry2.new_value as string)).toEqual({ acmg_classification: null })
  })

  it('records a tag_assign audit entry when tag_id is provided', () => {
    const entries = perCaseAnnotationAuditEntries(1, 2, { tag_id: 42, user_name: 'reviewer' }, null)
    const tagEntry = entries.find((e) => e.action_type === 'tag_assign')
    expect(tagEntry).toBeDefined()
    expect(tagEntry).toEqual({
      action_type: 'tag_assign',
      entity_type: 'case_variant_annotation',
      entity_key: 'case:1:variant:2',
      old_value: null,
      new_value: JSON.stringify({ tag_id: 42 }),
      user_name: 'reviewer'
    })
  })
})
