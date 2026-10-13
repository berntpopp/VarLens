/** Extract compact spike annotations from genefoundry vep-link (full mode) and gnomad-link payloads. */
import { POPMAX_EXCLUDED } from './local-vep'

export interface SpikeVep {
  mostSevere: string
  consequenceTerms: string[]
  impact: string | null
  transcript: string | null
  isMane: boolean
  hgvsc: string | null
  hgvsp: string | null
  gene: string | null
  caddPhred: number | null
}

export interface SpikeGnomad {
  found: boolean
  exomeAf: number | null
  genomeAf: number | null
  jointAf: number | null
  popmaxAf: number | null
  exomePopmaxAf: number | null
  genomePopmaxAf: number | null
  dataset: string
}

export interface SpikeAnnotation {
  key: string // normalised chr:pos:ref:alt
  poolKey: string // ClinVar key before normalisation
  vep: SpikeVep | null
  gnomad: SpikeGnomad | null
  fetchedAt: string
  errors: string[]
}

type Json = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** MANE Select first, then canonical, then the first transcript with the most severe term. */
export function extractVep(result: Json): SpikeVep {
  const tcs = (result.transcript_consequences as Json[] | undefined) ?? []
  const mostSevere = String(result.most_severe_consequence ?? '')
  const picked =
    tcs.find((t) => typeof t.mane_select === 'string') ??
    tcs.find((t) => t.canonical === 1) ??
    tcs.find((t) => ((t.consequence_terms as string[]) ?? []).includes(mostSevere)) ??
    tcs[0]
  const scores = (result.position_scores as Json | undefined) ?? {}
  return {
    mostSevere,
    consequenceTerms: (picked?.consequence_terms as string[] | undefined) ?? [],
    impact: str(picked?.impact),
    transcript: str(picked?.transcript_id),
    isMane: typeof picked?.mane_select === 'string',
    hgvsc: str(picked?.hgvsc),
    hgvsp: str(picked?.hgvsp),
    gene: str(picked?.gene_symbol) ?? str(result.gene_symbol),
    caddPhred: num(scores.cadd_phred)
  }
}

interface Part {
  ac?: number
  an?: number
  af?: number
  populations?: Array<{ id: string; ac?: number; an?: number }>
}

type PopCounts = Map<string, { ac: number; an: number }>

function addPops(into: PopCounts, part: Part): void {
  for (const pop of part.populations ?? []) {
    // Bottlenecked/catch-all groups and subcohort/sex rows (ids with "_") are not grpmax groups.
    if (POPMAX_EXCLUDED.has(pop.id) || pop.id.includes('_')) continue
    const cur = into.get(pop.id) ?? { ac: 0, an: 0 }
    into.set(pop.id, { ac: cur.ac + (pop.ac ?? 0), an: cur.an + (pop.an ?? 0) })
  }
}

function maxAf(pops: PopCounts): number | null {
  const afs = [...pops.values()].filter((p) => p.an > 0).map((p) => p.ac / p.an)
  return afs.length > 0 ? Math.max(...afs) : null
}

function popmaxOf(...parts: Part[]): number | null {
  const pops: PopCounts = new Map()
  for (const p of parts) addPops(pops, p)
  return maxAf(pops)
}

/** Joint AF and grpmax-style popmax (bottlenecked groups excluded): joint, exome-only, genome-only. */
export function extractGnomad(payload: Json): SpikeGnomad {
  const exome = payload.exome as Part | undefined
  const genome = payload.genome as Part | undefined
  const parts = [exome, genome].filter((p): p is Part => !!p && typeof p === 'object')
  const ac = parts.reduce((s, p) => s + (p.ac ?? 0), 0)
  const an = parts.reduce((s, p) => s + (p.an ?? 0), 0)
  return {
    found: true,
    exomeAf: num(exome?.af),
    genomeAf: num(genome?.af),
    jointAf: an > 0 ? ac / an : null,
    popmaxAf: popmaxOf(...parts),
    exomePopmaxAf: exome ? popmaxOf(exome) : null,
    genomePopmaxAf: genome ? popmaxOf(genome) : null,
    dataset: String(payload.dataset ?? 'gnomad_r4')
  }
}

export const NOT_IN_GNOMAD: SpikeGnomad = {
  found: false,
  exomeAf: null,
  genomeAf: null,
  jointAf: null,
  popmaxAf: null,
  exomePopmaxAf: null,
  genomePopmaxAf: null,
  dataset: 'gnomad_r4'
}
