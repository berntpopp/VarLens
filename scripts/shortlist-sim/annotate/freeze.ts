/**
 * Frozen spike annotations. All spike fields come from the local VEP 115 + dbNSFP run; the
 * genefoundry fetch is kept only as an independent cross-check subset (frozen separately).
 */
import type { LocalVepRecord } from './local-vep'
import type { NormalizedAllele } from './normalize'
import type { SpikeAnnotation, SpikeGnomad, SpikeVep } from './spike-annotation'

export type Source = 'genefoundry' | 'local-vep' | 'none'

export interface FrozenSpike extends SpikeAnnotation {
  vepSource: Source
  gnomadSource: Source
}

export function vepFromLocal(l: LocalVepRecord): SpikeVep {
  return {
    mostSevere: l.mostSevere,
    consequenceTerms: l.terms,
    impact: l.impact === '' ? null : l.impact,
    transcript: l.transcript,
    isMane: l.isMane,
    hgvsc: null,
    hgvsp: null,
    gene: l.gene,
    caddPhred: l.caddPhred // dbNSFP: missense/splice SNVs only
  }
}

export function gnomadFromLocal(l: LocalVepRecord): SpikeGnomad {
  return {
    found: l.inGnomadCache || l.gnomadJointAf !== null,
    exomeAf: l.gnomadExomeAf,
    genomeAf: l.gnomadGenomeAf,
    jointAf: l.gnomadJointAf,
    popmaxAf: l.popmaxAf,
    exomePopmaxAf: l.exomePopmaxAf,
    genomePopmaxAf: l.genomePopmaxAf,
    dataset: 'vep115-cache+dbNSFP5.3.1a'
  }
}

/** Spike annotations come from the local VEP run for every field (coordinator decision). */
export function freezeSpikes(
  alleles: NormalizedAllele[],
  local: Map<string, LocalVepRecord>
): FrozenSpike[] {
  return alleles
    .filter((a) => a.status === 'ok')
    .map((a): FrozenSpike => {
      const l = local.get(a.key)
      const source: Source = l ? 'local-vep' : 'none'
      return {
        key: a.key,
        poolKey: a.input,
        vep: l ? vepFromLocal(l) : null,
        gnomad: l ? gnomadFromLocal(l) : null,
        fetchedAt: '',
        errors: l ? [] : ['local-vep: no record'],
        vepSource: source,
        gnomadSource: source
      }
    })
    .sort((x, y) => x.key.localeCompare(y.key))
}

export function countBy<T>(items: T[], f: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const it of items) out[f(it)] = (out[f(it)] ?? 0) + 1
  return out
}
