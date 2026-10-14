import { describe, expect, it } from 'vitest'

import {
  RESNIK_HAND_POINTS,
  resnikBin,
  resnikGroup,
  tuneResnikPoints
} from '../../../../scripts/shortlist-sim/phenotype/resnik-group'
import { compileRuleset } from '../../../../src/main/services/scoring/evidence'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../../src/shared/config/evidence-rulesets/varvis-template'

describe('hpo_resnik evidence group', () => {
  it('bins scores into exclusive ranges with a reference for low or missing scores', () => {
    expect([3.2, 3, 2.7, 2.2, 1.6, 1.49, 0, null].map(resnikBin)).toEqual([0, 0, 1, 2, 3, 4, 4, 4])
  })

  it('appends to the varvis template as a valid production ruleset', () => {
    const rs = {
      ...VARVIS_EVIDENCE_TEMPLATE,
      groups: [...VARVIS_EVIDENCE_TEMPLATE.groups, resnikGroup(RESNIK_HAND_POINTS)]
    }
    expect(compileRuleset(rs).usesHpoResnik).toBe(true)
  })

  it('tunes higher points for bins enriched in positives', () => {
    const points = tuneResnikPoints([60, 20, 10, 5, 5], [10, 20, 40, 200, 5000])
    expect(points[0]).toBeGreaterThan(points[4])
    expect(points).toHaveLength(5)
  })
})
