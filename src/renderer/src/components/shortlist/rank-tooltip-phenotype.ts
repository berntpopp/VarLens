/** Text lines for the phenotype block of the score tooltip (spec 2026-10-14 §4). */
import type { HpoExplanation } from '../../../../shared/types/hpo-profile'

/** Items shown per line before "+N". */
const MAX_ITEMS = 3

export interface PhenotypeLines {
  title: string
  matched: string | null
  conflicts: string | null
  /** Case-relative rank; deliberately not phrased as a probability. */
  rank: string
}

function capped(items: string[]): string {
  const shown = items.slice(0, MAX_ITEMS).join(' · ')
  return items.length > MAX_ITEMS ? `${shown} · +${items.length - MAX_ITEMS}` : shown
}

const percent = (f: number): string => `${Math.round(f * 100)} %`

export function phenotypeLines(hpo: HpoExplanation): PhenotypeLines {
  const matched = [...hpo.matched]
    .sort((a, b) => Number(b.key) - Number(a.key))
    .map((m) => (m.key ? `★ ${m.patientLabel}` : m.patientLabel))
  const conflicts = hpo.conflicts.map(
    (c) => `${c.excludedLabel} excluded (${percent(c.frequency)} in ${hpo.diseaseLabel})`
  )
  // percentile = share of the case's genes scoring lower; never below "top 1 %".
  const top = Math.max(1, Math.round((1 - hpo.percentile) * 100))
  return {
    title: `Phenotype match ${hpo.score.toFixed(2)} · best: ${hpo.diseaseLabel}`,
    matched: matched.length > 0 ? `✓ matched: ${capped(matched)}` : null,
    conflicts: conflicts.length > 0 ? `⊖ conflicts: ${capped(conflicts)}` : null,
    rank: `top ${top} % of genes in this case`
  }
}
