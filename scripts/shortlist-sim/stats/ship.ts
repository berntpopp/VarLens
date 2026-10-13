// Pre-registered ship criterion (spec §11.5) evaluated from summary inputs.
import { CASE_MODES, type CaseMode } from '../common/types'
import type { Interval } from './bootstrap'
import { clopperPearsonLower } from './clopper-pearson'

export const SHIP = {
  minClusters: 300,
  minModeCases: 30,
  primaryMinDeltaHit10: 0.03,
  maxDeltaDecoys: 0.5,
  visibleMinDeltaHit10: -0.02,
  minSensitivityLower: 0.97,
  sensitivityAlpha: 0.025
} as const

export interface ShipInputs {
  /** Test gene clusters in the primary analysis. */
  testGeneClusters: number
  /** Cases per mode stratum in the primary analysis. */
  modeCases: Partial<Record<CaseMode, number>>
  /** Evidence − Tier 1, Hit@10 as a share (0.03 = 3 points), and mean decoys in the top 10. */
  primary: { deltaHit10: Interval; deltaDecoys: Interval }
  clinvarVisible: { deltaHit10: Interval; deltaDecoys: Interval }
  /** Gene clusters and clusters with ≥ 1 gated-out causal allele (candidate gate). */
  sensitivity: { n: number; failures: number }
  /** Inputs not fully accepted (spec §11.4): the verdict is never SHIP. */
  provisional?: boolean
}

export interface ShipCheck {
  id: string
  description: string
  value: number
  threshold: string
  pass: boolean
}

export interface ShipVerdict {
  ship: boolean
  checks: ShipCheck[]
  pooledModes: CaseMode[]
  droppedModes: CaseMode[]
  sensitivityLower: number
  reasons: string[]
}

/** Mode strata entering the pooled primary endpoint (≥ 30 cases); others are reported separately. */
export function pooledModes(modeCases: Partial<Record<CaseMode, number>>): CaseMode[] {
  return CASE_MODES.filter((m) => (modeCases[m] ?? 0) >= SHIP.minModeCases)
}

export function evaluateShip(input: ShipInputs): ShipVerdict {
  const pooled = pooledModes(input.modeCases)
  const dropped = CASE_MODES.filter((m) => !pooled.includes(m) && (input.modeCases[m] ?? 0) > 0)
  const { n, failures } = input.sensitivity
  const sensitivityLower = n > 0 ? clopperPearsonLower(n - failures, n, SHIP.sensitivityAlpha) : 0
  const checks: ShipCheck[] = [
    check(
      'power_clusters',
      'Test gene clusters (primary)',
      input.testGeneClusters,
      `≥ ${SHIP.minClusters}`,
      input.testGeneClusters >= SHIP.minClusters
    ),
    check(
      'power_modes',
      'Mode strata in the pooled endpoint',
      pooled.length,
      '≥ 1 stratum with ≥ 30 cases',
      pooled.length > 0
    ),
    check(
      'primary_hit10',
      'Primary: lower 95 % bound of ΔHit@10',
      input.primary.deltaHit10.lo,
      `> +${SHIP.primaryMinDeltaHit10}`,
      input.primary.deltaHit10.lo > SHIP.primaryMinDeltaHit10
    ),
    check(
      'primary_decoys',
      'Primary: upper 95 % bound of Δ decoys in top 10',
      input.primary.deltaDecoys.hi,
      `≤ +${SHIP.maxDeltaDecoys}`,
      input.primary.deltaDecoys.hi <= SHIP.maxDeltaDecoys
    ),
    check(
      'visible_hit10',
      'ClinVar visible: lower 95 % bound of ΔHit@10',
      input.clinvarVisible.deltaHit10.lo,
      `> ${SHIP.visibleMinDeltaHit10}`,
      input.clinvarVisible.deltaHit10.lo > SHIP.visibleMinDeltaHit10
    ),
    check(
      'visible_decoys',
      'ClinVar visible: upper 95 % bound of Δ decoys in top 10',
      input.clinvarVisible.deltaDecoys.hi,
      `≤ +${SHIP.maxDeltaDecoys}`,
      input.clinvarVisible.deltaDecoys.hi <= SHIP.maxDeltaDecoys
    ),
    check(
      'inputs_final',
      'Annotation acceptance fully evaluated (inputs not provisional)',
      input.provisional === true ? 0 : 1,
      '= 1',
      input.provisional !== true
    ),
    check(
      'sensitivity',
      `Filter sensitivity: one-sided 97.5 % Clopper–Pearson lower bound (${n - failures}/${n} clusters)`,
      sensitivityLower,
      `≥ ${SHIP.minSensitivityLower}`,
      sensitivityLower >= SHIP.minSensitivityLower
    )
  ]
  const reasons = checks
    .filter((c) => !c.pass)
    .map((c) => `${c.description} = ${fmt(c.value)} (needs ${c.threshold})`)
  return {
    ship: reasons.length === 0,
    checks,
    pooledModes: pooled,
    droppedModes: dropped,
    sensitivityLower,
    reasons
  }
}

function check(
  id: string,
  description: string,
  value: number,
  threshold: string,
  pass: boolean
): ShipCheck {
  // NaN bounds (no data) never pass: every comparison above is false for NaN.
  return { id, description, value, threshold, pass: pass && !Number.isNaN(value) }
}

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(4))
