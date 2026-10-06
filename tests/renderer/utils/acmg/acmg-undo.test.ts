import { describe, expect, it } from 'vitest'
import {
  evidenceFingerprint,
  hasMeaningfulAcmgEvidence,
  planAcmgUndo,
  summarizeAcmgDraft
} from '../../../../src/renderer/src/utils/acmg/acmg-undo'

describe('planAcmgUndo', () => {
  it('returns null when nothing changed (no snackbar, nothing to undo)', () => {
    expect(planAcmgUndo({ classification: null }, { classification: null })).toBeNull()
    expect(
      planAcmgUndo(
        { classification: 'Benign', evidenceJson: '{"a":1}' },
        { classification: 'Benign', evidenceJson: '{"a":1}' }
      )
    ).toBeNull()
  })

  it('restores the previous classification for a quick class pick', () => {
    const plan = planAcmgUndo({ classification: null }, { classification: 'Likely pathogenic' })
    expect(plan).toEqual({
      message: 'Classified as Likely pathogenic',
      restore: { classification: null }
    })
  })

  it('describes clearing and restores the cleared value', () => {
    const plan = planAcmgUndo({ classification: 'Pathogenic' }, { classification: null })
    expect(plan?.message).toBe('ACMG classification cleared')
    expect(plan?.restore).toEqual({ classification: 'Pathogenic' })
  })

  it('restores previous evidence when the change carried evidence', () => {
    const plan = planAcmgUndo(
      { classification: 'Uncertain significance', evidenceJson: null },
      { classification: 'Likely pathogenic', evidenceJson: '{"pathogenic":["PVS1"]}' }
    )
    expect(plan?.restore).toEqual({ classification: 'Uncertain significance', evidenceJson: '' })
  })

  it('reports evidence-only edits', () => {
    const plan = planAcmgUndo(
      { classification: 'Benign', evidenceJson: '{"notes":"a"}' },
      { classification: 'Benign', evidenceJson: '{"notes":"b"}' }
    )
    expect(plan?.message).toBe('ACMG evidence saved')
    expect(plan?.restore.evidenceJson).toBe('{"notes":"a"}')
  })
})

describe('draft helpers', () => {
  it('summarises the draft for the confirm bar', () => {
    expect(
      summarizeAcmgDraft({
        classification: 'Likely pathogenic',
        netPoints: 9,
        codes: ['PVS1', 'PM2']
      })
    ).toBe('Likely pathogenic · 9 pts · PVS1, PM2')
    expect(summarizeAcmgDraft({ classification: null, netPoints: 1, codes: [] })).toBe(
      'No classification · 1 pt · no criteria'
    )
  })

  it('ignores the volatile classification_date when fingerprinting', () => {
    const a = JSON.stringify({ pathogenic: [], classification_date: 1 })
    const b = JSON.stringify({ pathogenic: [], classification_date: 2 })
    expect(evidenceFingerprint(a)).toBe(evidenceFingerprint(b))
  })

  it('only reports evidence when criteria, notes or an override remain', () => {
    const empty = JSON.stringify({ pathogenic: [], benign: [], notes: '', is_override: false })
    expect(hasMeaningfulAcmgEvidence(empty)).toBe(false)
    expect(hasMeaningfulAcmgEvidence(null)).toBe(false)
    const withCode = JSON.stringify({ pathogenic: [{ code: 'PVS1', confirmed: true }], benign: [] })
    expect(hasMeaningfulAcmgEvidence(withCode)).toBe(true)
    const suggestedOnly = JSON.stringify({ pathogenic: [{ code: 'PM2', confirmed: false }] })
    expect(hasMeaningfulAcmgEvidence(suggestedOnly)).toBe(false)
    expect(hasMeaningfulAcmgEvidence(JSON.stringify({ notes: 'segregates' }))).toBe(true)
  })
})
