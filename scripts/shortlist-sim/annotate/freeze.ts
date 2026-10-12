/**
 * Frozen spike annotations: genefoundry where it succeeded, otherwise the local VEP 115 +
 * dbNSFP run, with per-field provenance (coordinator policy for the Ensembl GRCh38 outage).
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

export function freezeSpikes(
  alleles: NormalizedAllele[],
  cache: Map<string, SpikeAnnotation>,
  local: Map<string, LocalVepRecord>
): FrozenSpike[] {
  return alleles
    .filter((a) => a.status === 'ok')
    .map((a): FrozenSpike => {
      const gf = cache.get(a.key)
      const l = local.get(a.key)
      const vep = gf?.vep ?? (l ? vepFromLocal(l) : null)
      const gnomad = gf?.gnomad ?? (l ? gnomadFromLocal(l) : null)
      return {
        key: a.key,
        poolKey: a.input,
        vep,
        gnomad,
        fetchedAt: gf?.fetchedAt ?? '',
        // Errors that a local fallback resolved are not carried over.
        errors: (gf?.errors ?? []).filter(
          (e) =>
            (e.startsWith('vep') && vep === null) || (e.startsWith('gnomad') && gnomad === null)
        ),
        vepSource: gf?.vep ? 'genefoundry' : l ? 'local-vep' : 'none',
        gnomadSource: gf?.gnomad ? 'genefoundry' : l ? 'local-vep' : 'none'
      }
    })
    .sort((x, y) => x.key.localeCompare(y.key))
}

export function countBy<T>(items: T[], f: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const it of items) out[f(it)] = (out[f(it)] ?? 0) + 1
  return out
}
