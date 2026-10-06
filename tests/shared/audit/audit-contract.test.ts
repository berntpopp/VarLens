import { describe, expect, it } from 'vitest'

import {
  AUDIT_ROLE_MEANINGS,
  serializeAuditContractMetadata,
  serializeAuditContractValue
} from '../../../src/shared/audit/audit-contract'

describe('audit contract', () => {
  it('describes the current technical roles without adding role identifiers', () => {
    expect(Object.keys(AUDIT_ROLE_MEANINGS)).toEqual(['viewer', 'analyst', 'admin'])
    expect(AUDIT_ROLE_MEANINGS.admin).toContain('administrator')
    expect(AUDIT_ROLE_MEANINGS.analyst).toContain('analyst')
    expect(AUDIT_ROLE_MEANINGS.viewer).toContain('Read-only')
  })

  it('keeps coded audit fields and redacts free text evidence content', () => {
    expect(
      serializeAuditContractValue({
        acmg_classification: 'Pathogenic',
        acmg_evidence: 'PS1,PM2 patient-specific note',
        starred: true,
        tag_id: 7
      })
    ).toBe(
      JSON.stringify({
        acmg_classification: 'Pathogenic',
        acmg_evidence: { present: true },
        starred: 1,
        tag_id: 7
      })
    )
  })

  it('redacts values outside the safe audit value vocabulary', () => {
    expect(
      serializeAuditContractValue({
        patient_name: 'Jane Example',
        payload: { variants: [{ chr: '1', pos: 42 }] },
        free_text: 'clinical detail'
      })
    ).toBe(JSON.stringify({ redacted: true }))
  })

  it('redacts non-json strings instead of storing raw text', () => {
    expect(serializeAuditContractValue('patient note')).toBe(JSON.stringify({ redacted: true }))
  })

  it('keeps safe web audit facts without storing credentials or payloads', () => {
    expect(
      serializeAuditContractValue({
        success: true,
        role: 'admin',
        method: 'cases:query',
        audited: true,
        password: 'secret',
        payload: { patient: 'hidden' }
      })
    ).toBe(JSON.stringify({ success: true, role: 'admin', method: 'cases:query', audited: true }))
  })

  it('keeps only low-cardinality metadata', () => {
    expect(serializeAuditContractMetadata({ source: 'web-smoke', patient_id: 123 })).toBe(
      JSON.stringify({ source: 'web-smoke' })
    )
    expect(serializeAuditContractMetadata({ patient_id: 123 })).toBe(
      JSON.stringify({ redacted: true, kind: 'metadata' })
    )
  })
})
