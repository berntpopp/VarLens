/** Text lines for the phenotype block of the score tooltip (spec 2026-10-14 §4). */
import type { HpoExplanation, HpoLocusNote } from '../../../../shared/types/hpo-profile'

/** Items shown per line before "+N". */
const MAX_ITEMS = 3

export interface PhenotypeLines {
  title: string
  matched: string | null
  conflicts: string | null
  /** Rank among the reference HPO genes; deliberately not phrased as a probability. */
  rank: string
  /** CNV/STR rows: where the score came from (CNV/STR spec §6.3); null for SNVs. */
  locus: string | null
}

function capped(items: string[]): string {
  const shown = items.slice(0, MAX_ITEMS).join(' · ')
  return items.length > MAX_ITEMS ? `${shown} · +${items.length - MAX_ITEMS}` : shown
}

const percent = (f: number): string => `${Math.round(f * 100)} %`
/** Rounded down so the claim stays true (the epsilon absorbs float error: 0.29 * 100 = 28.99…). */
const floorPercent = (f: number): number => Math.floor(f * 100 + 1e-9)

/** `9 HPO genes of 27 overlapped`; "HPO genes" = genes with HPO disease annotations. */
function hpoGenes(n: HpoLocusNote): string | null {
  if (n.diseaseGenes == null) return null
  const of = n.genes != null ? ` of ${n.genes} overlapped` : ''
  return `${n.diseaseGenes} HPO ${n.diseaseGenes === 1 ? 'gene' : 'genes'}${of}`
}

function locusParts(n: HpoLocusNote): Array<string | false | null | undefined> {
  const genes = hpoGenes(n)
  switch (n.kind) {
    case 'region':
      return [
        `${n.label} (${n.id})`,
        n.dosage,
        n.coverage != null ? `${floorPercent(n.coverage)} % covered` : null,
        genes
      ]
    case 'gene':
      // Šidák with n = 1 is the identity, so only a multi-gene CNV is size-corrected.
      return [
        n.label,
        n.dosage,
        genes !== null && `best of ${genes}${(n.diseaseGenes ?? 0) > 1 ? ', size-corrected' : ''}`
      ]
    case 'str':
      return [
        [n.label, n.motif, n.copies].filter(Boolean).join(' '),
        n.band,
        n.inheritance,
        n.onset != null ? `onset ${n.onset}` : null
      ]
  }
}

export function locusLine(n: HpoLocusNote | undefined): string | null {
  return n ? `locus: ${locusParts(n).filter(Boolean).join(' · ')}` : null
}

export function phenotypeLines(hpo: HpoExplanation): PhenotypeLines {
  const matched = [...hpo.matched]
    .sort((a, b) => Number(b.key) - Number(a.key))
    .map((m) => (m.key ? `★ ${m.patientLabel}` : m.patientLabel))
  // The recorded annotation frequency; the conservative penalty bound is no disease frequency.
  const conflicts = [
    ...hpo.conflicts.map((c) =>
      c.frequencyRecorded
        ? `${c.excludedLabel} excluded (${percent(c.annotationFrequency)} in ${hpo.diseaseLabel})`
        : `${c.excludedLabel} excluded (frequency not recorded)`
    ),
    ...hpo.notConflicts.map((c) => `${c.patientLabel} present (absent in ${hpo.diseaseLabel})`)
  ]
  // percentile = share of all reference HPO genes scoring strictly lower (ties not counted).
  const above = floorPercent(hpo.percentile)
  return {
    title: `Phenotype match ${hpo.score.toFixed(2)} · best: ${hpo.diseaseLabel}`,
    matched: matched.length > 0 ? `✓ matched: ${capped(matched)}` : null,
    conflicts: conflicts.length > 0 ? `⊖ conflicts: ${capped(conflicts)}` : null,
    rank: `scores above ${above} % of HPO genes`,
    locus: locusLine(hpo.locus)
  }
}
