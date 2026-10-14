/**
 * Row scoring with a compiled evidence ruleset (spec §3.4). Groups and modes
 * are decision lists: a group contributes its first matching rule; the row's
 * mode is the first specific mode that matches, fallback only when none does.
 * score = mode points + global groups + groups scoped to that mode (and, for a
 * type-scoped group, to the row's variant type), and the
 * returned contributions sum exactly to the score.
 */
import type { DerivedFields } from './case-context'
import type { CompiledGroup, CompiledMode, CompiledRuleset } from './ruleset'
import type { EvidenceContribution, ModeId } from '../../../../shared/types/evidence-ruleset'
import type { EvaluableRow } from '../../../../shared/dsl/evaluate'

export interface EvidenceScore {
  score: number
  mode: ModeId
  contributions: EvidenceContribution[]
}

function groupContribution(g: CompiledGroup, row: EvaluableRow): EvidenceContribution | null {
  for (const r of g.rules) {
    if (r.test(row))
      return { kind: 'rule', id: r.id, label: r.label, group: g.id, points: r.points }
  }
  return null
}

function selectMode(modes: readonly CompiledMode[], row: EvaluableRow): CompiledMode {
  // compileRuleset guarantees a trailing fallback (test === null).
  return modes.find((m) => m.test === null || m.test(row)) ?? modes[modes.length - 1]
}

export function scoreEvidenceRow(
  row: EvaluableRow,
  derived: DerivedFields,
  compiled: CompiledRuleset
): EvidenceScore {
  const view: EvaluableRow = {
    ...row,
    zygosity: derived.zygosity,
    gene_het_hits: derived.gene_het_hits,
    gene_hits: derived.gene_hits
  }
  const mode = selectMode(compiled.modes, view)
  const contributions: EvidenceContribution[] = [
    {
      kind: 'mode',
      id: mode.profile.id,
      label: mode.profile.label,
      group: null,
      points: mode.profile.points
    }
  ]
  for (const g of compiled.groups) {
    if (g.scope !== 'global' && g.scope !== mode.profile.id) continue
    if (g.variantType !== undefined && g.variantType !== view.variant_type) continue
    const c = groupContribution(g, view)
    if (c !== null) contributions.push(c)
  }
  const score = contributions.reduce((sum, c) => sum + c.points, 0)
  return { score, mode: mode.profile.id, contributions }
}
