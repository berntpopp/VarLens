import { describe, expect, it } from 'vitest'
import { rng } from '../../../../scripts/shortlist-sim/common/rng'
import {
  canonicalText,
  constraintByGene,
  maxNumber
} from '../../../../scripts/shortlist-sim/sim/extra-fields'
import { describeBackground } from '../../../../scripts/shortlist-sim/sim/background-db'
import {
  applyScenarioToBackground,
  applyScenarioToSpike
} from '../../../../scripts/shortlist-sim/sim/scenarios'
import { spikeRow } from '../../../../scripts/shortlist-sim/sim/spikes'
import { poolSpike, SPIKE_OPTIONS, syntheticBackground } from './fixtures'

describe('extra fields (#597)', () => {
  it('takes the maximum over per-transcript values and ignores missing', () => {
    expect(maxNumber('.;0.56;.;0.64')).toBe(0.64)
    expect(maxNumber('.')).toBeNull()
  })

  it('writes ClinVar review status in the importer canonical form', () => {
    expect(canonicalText('criteria_provided,_multiple_submitters,_no_conflicts')).toBe(
      'criteria provided, multiple submitters, no conflicts'
    )
  })

  it('reads LOEUF, LoF o/e and missense Z from the MANE row of the constraint table', () => {
    const tsv = [
      'gene\tmane_select\tcanonical\tlof.oe_ci.upper\tlof.oe\tmis.z_score',
      'G1\tfalse\ttrue\t0.9\t0.8\t1.0',
      'G1\ttrue\tfalse\t0.3\t0.2\t3.5',
      'G2\tfalse\tfalse\tNA\t0.5\t0.1'
    ].join('\n')
    const m = constraintByGene(tsv)
    expect(m.get('G1')).toEqual({ LOEUF: '0.3', LOF_OE: '0.2', MISSENSE_Z: '3.5' })
    expect(m.get('G2')).toEqual({ LOF_OE: '0.5', MISSENSE_Z: '0.1' })
  })

  it('puts spike extras into info_json and masks the review status with ClinVar', () => {
    const bg = syntheticBackground()
    bg.rows[0].info_json = JSON.stringify({ REVEL: '0.9', CLINVAR_REVSTAT: 'practice guideline' })
    const info = describeBackground('bg1', bg.rows)
    const src = {
      ...poolSpike('GENE1'),
      extra: { REVEL: '0.8', CLINVAR_REVSTAT: 'reviewed by expert panel' }
    }
    const s = spikeRow(src, 'causal', info, new Set(), 'het', rng(1), SPIKE_OPTIONS)
    if (typeof s === 'string') throw new Error(s)
    expect(JSON.parse(s.row.info_json!)).toEqual(src.extra)
    expect(JSON.parse(applyScenarioToSpike(s.row, 'primary', info, rng(2)).info_json!)).toEqual({
      REVEL: '0.8'
    })
    expect(
      JSON.parse(applyScenarioToSpike(s.row, 'clinvar_visible', info, rng(2)).info_json!)
    ).toEqual(src.extra)
    const masked = applyScenarioToBackground(bg.rows, 'primary', rng(3))[0]
    expect(JSON.parse(masked.info_json!)).toEqual({ REVEL: '0.9' })
  })
})
