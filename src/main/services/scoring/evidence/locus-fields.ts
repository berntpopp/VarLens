/**
 * Locus fields of CNV and STR rows (CNV/STR spec §4–§6.1): `hpo_resnik` is the
 * locus score (S_cnv, S_str) instead of the row gene's, plus `hpo_best_locus`,
 * `cnv_gene_count`, `str_band` and the tooltip's locus note. Pure: the
 * backends pass the reference data in as {@link LocusInputs}.
 */
import { HPO_LOCUS_SCORING_CONFIG } from '../../../../shared/config/hpo-locus-scoring.config'
import {
  cnvEnd,
  cnvGeneSet,
  parseInfoDosage,
  scoreCnv,
  type GeneSpanLookup
} from '../../../../shared/phenotype/cnv-score'
import { bandOf, resolveLocus, scoreStr } from '../../../../shared/phenotype/str-score'
import type { HpoExplanation, HpoLocusNote } from '../../../../shared/types/hpo-profile'
import type { LocusReference, StrBand } from '../../../../shared/types/locus-reference'
import type { CaseInfo, DerivedFields, LightRow } from './case-context'

/** Reference data of the case build, loaded only when pass 1 saw a CNV or STR row. */
export interface LocusInputs {
  /** ClinGen dosage and STRchive tables; null without them (scores null, Stranger band). */
  reference: LocusReference | null
  /** Gene intervals of the case build; null without `gene_reference.db`. */
  genes: GeneSpanLookup | null
  /** CNV row id → its distinct `variant_transcripts` genes; absent → interval overlap. */
  cnvGenes: ReadonlyMap<number, readonly string[]>
}

/** The phenotype and locus fields of `DerivedFields`. */
export type LocusFields = Pick<
  DerivedFields,
  | 'hpo_resnik'
  | 'hpo_best_disease'
  | 'hpo_conflicts'
  | 'hpo_best_locus'
  | 'cnv_gene_count'
  | 'str_band'
>

export interface LocusResult {
  fields: LocusFields
  /** The tooltip's locus line; null when no locus was resolved. */
  note: HpoLocusNote | null
}

export const isLocusRow = (row: Pick<LightRow, 'variant_type'>): boolean =>
  row.variant_type === 'cnv' || row.variant_type === 'str'

const NO_GENES: GeneSpanLookup = { overlapping: () => [], span: () => undefined }
const BANDS: readonly StrBand[] = ['normal', 'intermediate', 'premutation', 'full']
const EMPTY: LocusFields = {
  hpo_resnik: null,
  hpo_best_disease: null,
  hpo_conflicts: null,
  hpo_best_locus: null,
  cnv_gene_count: null,
  str_band: null
}
const NONE: LocusResult = { fields: EMPTY, note: null }

/** Without the catalogue the band is Stranger's per-allele status, the highest one (spec §6.1). */
function strangerBand(status: string | null | undefined): StrBand | null {
  if (status == null || status === '') return null
  const bands = status
    .split(',')
    .map((s) => HPO_LOCUS_SCORING_CONFIG.str.strangerStatusBand[s.trim()] ?? 'normal')
  return bands.reduce((a, b) => (BANDS.indexOf(b) > BANDS.indexOf(a) ? b : a))
}

/** The band of an STR row: catalogue thresholds, else Stranger's status; null off-catalogue. */
export function strBand(
  row: LightRow,
  build: string,
  reference: LocusReference | null
): StrBand | null {
  if (reference === null) return strangerBand(row.str_status)
  const locus = resolveLocus(row, reference.strLoci, build)
  return locus === null ? null : bandOf(row, locus).band
}

/** Conflicts of a disease-level score; explanations are only built for scored loci. */
function diseaseConflicts(info: CaseInfo, disease: string | null): number | null {
  return disease === null ? null : (info.hpo?.explainDisease(disease)?.conflicts.length ?? null)
}

/**
 * The locus fields of one CNV or STR row. `otherHetHits(gene)` counts the het
 * alleles of the gene other than the row itself (the CNV/STR second hit).
 */
export function scoreLocusRow(
  row: LightRow,
  info: CaseInfo,
  inputs: LocusInputs | undefined,
  otherHetHits: (gene: string) => number
): LocusResult {
  const reference = inputs?.reference ?? null
  if (row.variant_type === 'str') {
    if (reference === null) {
      return { fields: { ...EMPTY, str_band: strBand(row, info.build, null) }, note: null }
    }
    const s = scoreStr(row, reference, { ...info, hetHits: otherHetHits })
    if (s === null) return NONE
    const fields: LocusFields = {
      ...EMPTY,
      hpo_resnik: s.score,
      hpo_best_disease: s.bestDisease,
      hpo_conflicts: diseaseConflicts(info, s.bestDisease),
      hpo_best_locus: s.bestLocus,
      str_band: s.band
    }
    return { fields, note: s.note }
  }
  const genes = inputs?.genes ?? NO_GENES
  const set = cnvGeneSet(inputs?.cnvGenes.get(row.id), genes, row.chr, row.pos, cnvEnd(row))
  const c = scoreCnv(row, set, parseInfoDosage(row.info_json), {
    build: info.build,
    sex: info.sex,
    reference,
    scorer: info.hpo ?? null,
    hetHits: otherHetHits
  })
  if (c === null) return NONE
  const fields: LocusFields = {
    ...EMPTY,
    hpo_resnik: c.score,
    hpo_best_disease: c.bestDisease,
    hpo_conflicts:
      c.note?.kind === 'gene'
        ? (info.hpo?.conflicts(c.note.id) ?? null)
        : diseaseConflicts(info, c.bestDisease),
    hpo_best_locus: c.bestLocus,
    cnv_gene_count: c.geneCount
  }
  return { fields, note: c.note }
}

/** The tooltip explanation of a scored locus: its disease at the locus score, plus the note. */
export function explainLocus(result: LocusResult, info: CaseInfo): HpoExplanation | null {
  const { hpo_resnik: score, hpo_best_disease: disease } = result.fields
  const { note } = result
  if (score === null || disease === null || note === null) return null
  const e = info.hpo?.explainDisease(disease, score) ?? null
  return e === null ? null : { ...e, locus: note }
}
