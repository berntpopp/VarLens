import { describe, expect, it } from 'vitest'

import {
  acmgEvidenceFields,
  overrideReasonMissing,
  parseAcmgEvidence
} from '../../../src/shared/acmg/acmg-evidence'
import {
  GenomeBuildArgSchema,
  GlobalAnnotationUpdatesSchema,
  PerCaseAnnotationUpdatesSchema
} from '../../../src/shared/api/schemas/annotations'

/** PVS1 + PS1 = Pathogenic, 12 points. */
const evidence = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    pathogenic: [
      { code: 'PVS1', strength: 'very_strong', confirmed: true, auto_suggested: false },
      { code: 'PS1', strength: 'strong', confirmed: true, auto_suggested: false }
    ],
    benign: [],
    notes: '',
    is_override: false,
    ...extra
  })

describe('ACMG override reason (#567)', () => {
  it('a class that agrees with its evidence needs no reason', () => {
    expect(
      overrideReasonMissing({ acmg_classification: 'Pathogenic', acmg_evidence: evidence() })
    ).toBe(false)
    expect(overrideReasonMissing({ acmg_classification: 'P', acmg_evidence: evidence() })).toBe(
      false
    )
  })

  it('an override without a reason is refused, flagged or not', () => {
    const flagged = evidence({ is_override: true, calculated_classification: 'Benign' })
    expect(overrideReasonMissing({ acmg_classification: 'Benign', acmg_evidence: flagged })).toBe(
      true
    )
    expect(
      overrideReasonMissing({ acmg_classification: 'Benign', acmg_evidence: evidence() })
    ).toBe(true)
    const blank = evidence({ is_override: true, override_reason: '   ' })
    expect(overrideReasonMissing({ acmg_classification: 'Benign', acmg_evidence: blank })).toBe(
      true
    )
  })

  it('an override with a reason is accepted', () => {
    const reasoned = evidence({ is_override: true, override_reason: 'Segregation data' })
    expect(overrideReasonMissing({ acmg_classification: 'Benign', acmg_evidence: reasoned })).toBe(
      false
    )
    expect(parseAcmgEvidence(reasoned)?.overrideReason).toBe('Segregation data')
  })

  it('updates without evidence are not checked here', () => {
    expect(overrideReasonMissing({ acmg_classification: 'Benign' })).toBe(false)
    expect(overrideReasonMissing({ starred: true } as never)).toBe(false)
  })

  it('both update schemas refuse an override without a reason', () => {
    const update = { acmg_classification: 'Benign', acmg_evidence: evidence() }
    expect(GlobalAnnotationUpdatesSchema.safeParse(update).success).toBe(false)
    expect(PerCaseAnnotationUpdatesSchema.safeParse(update).success).toBe(false)
    const ok = { ...update, acmg_evidence: evidence({ override_reason: 'Functional study' }) }
    expect(GlobalAnnotationUpdatesSchema.safeParse(ok).success).toBe(true)
    expect(PerCaseAnnotationUpdatesSchema.safeParse(ok).data).toMatchObject({
      acmg_classification: 'Benign'
    })
  })
})

describe('ACMG export fields (#574)', () => {
  it('reports net points and the override reason', () => {
    expect(acmgEvidenceFields(evidence({ override_reason: 'x' }))).toEqual({
      points: 12,
      overrideReason: 'x'
    })
  })

  it('old string codes count at their default strength', () => {
    expect(acmgEvidenceFields(JSON.stringify({ pathogenic: ['PM2'], benign: [] }))).toEqual({
      points: 1,
      overrideReason: null
    })
  })

  it('is empty without evidence or criteria, and for unreadable JSON', () => {
    const none = { points: null, overrideReason: null }
    expect(acmgEvidenceFields(null)).toEqual(none)
    expect(acmgEvidenceFields('{')).toEqual(none)
    expect(acmgEvidenceFields(JSON.stringify({ pathogenic: [], benign: [] }))).toEqual(none)
  })
})

describe('genome build of a global annotation (#577)', () => {
  it('is one of the configured build ids, spelled as stored', () => {
    for (const id of ['GRCh37', 'GRCh38', 'T2T-CHM13']) {
      expect(GenomeBuildArgSchema.safeParse(id).success).toBe(true)
    }
    for (const id of ['grch38', 'hg38', '', 'GRCh38 ']) {
      expect(GenomeBuildArgSchema.safeParse(id).success).toBe(false)
    }
  })
})
