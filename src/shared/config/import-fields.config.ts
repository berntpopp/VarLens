/**
 * Import field profile configuration (spec §16): which source fields of a
 * varvis columnar / object JSON export or a VCF (INFO, VEP CSQ, SnpEff ANN)
 * land in a VarLens column, which in `info_json` (as `info.<KEY>`), and which
 * canonical evidence keys are derived so one rule works for every source.
 *
 * Pure data. The engine that applies it is `src/shared/utils/import-field-profile.ts`;
 * main-only parsing (columnar default indices, data dictionaries) stays in
 * `src/main/import/config/fieldMapping.ts`.
 */

/** Where a source field comes from. `JSON` covers the columnar and object exports. */
export type FieldOrigin = 'INFO' | 'CSQ' | 'ANN' | 'JSON'

/**
 * Whether a field without a per-field choice (and without a column) is kept:
 * all of them, only the evidence fields (canonical aliases), or none.
 */
export type KeepUnknownPolicy = 'all' | 'selected' | 'none'

/** A per-field choice; `key` renames the stored `info.<KEY>`. */
export interface FieldChoice {
  keep: boolean
  key?: string
}

export interface ImportFieldProfile {
  keepUnknown: KeepUnknownPolicy
  /** Keyed by `<origin>:<source name>`, see `fieldProfileKey`. */
  fields: Record<string, FieldChoice>
}

export const KEEP_UNKNOWN_OPTIONS: ReadonlyArray<{ value: KeepUnknownPolicy; title: string }> = [
  { value: 'all', title: 'Keep' },
  { value: 'selected', title: 'Keep evidence fields only' },
  { value: 'none', title: 'Skip' }
]

/** Bounds a profile so it stays a small settings / IPC payload. */
export const IMPORT_FIELD_PROFILE_LIMITS = {
  maxFields: 4_096,
  maxNameChars: 256
} as const

/**
 * The default profile: keep everything; the object export's per-variant
 * identifiers repeat case metadata and are skipped.
 */
export const DEFAULT_IMPORT_FIELD_PROFILE: ImportFieldProfile = {
  keepUnknown: 'all',
  fields: {
    'JSON:lims_id': { keep: false },
    'JSON:person_id': { keep: false },
    'JSON:analysis_id': { keep: false }
  }
}

/**
 * Per-import bound on the source field names a resolver keeps (names come
 * from untrusted files): distinct fields, and their total characters. A VCF
 * header allows 4,096 INFO plus 256 CSQ / ANN fields.
 */
export const IMPORT_FIELD_NAME_LIMITS = {
  maxDistinctFields: 8_192,
  maxNameChars: 1024 * 1024
} as const

/** Per-variant `info_json` budget; the VCF reader enforces the same numbers on raw INFO. */
export const MAX_INFO_JSON_FIELDS = 4_096
export const MAX_INFO_JSON_CHARS = 1024 * 1024

// ── Known columns ──────────────────────────────────────────────

/** Internal slots the columnar mapper reads by index. */
export type ColumnarSlot =
  | 'SELECTED_TRANSCRIPT'
  | 'CHR'
  | 'POS'
  | 'REF'
  | 'ALT'
  | 'QUAL'
  | 'GT_NUM'
  | 'FUNC'
  | 'IMPACT'
  | 'GENE'
  | 'OMIM'
  | 'TRANSCRIPT'
  | 'CDNA'
  | 'AA_CHANGE'
  | 'CADD'
  | 'CLINVAR'
  | 'GNOMAD_AF'
  | 'HPO_SIM_SCORE'
  | 'MOI'

/** varvis columnar header id → slot. Several varvis versions name a column differently. */
export const COLUMNAR_HEADER_TO_SLOT: Readonly<Record<string, ColumnarSlot>> = {
  selectedTranscript: 'SELECTED_TRANSCRIPT',
  Chr: 'CHR',
  Pos: 'POS',
  Ref: 'REF',
  Alt: 'ALT',
  Qual: 'QUAL',
  'Qual-Index': 'QUAL',
  Genotype: 'GT_NUM',
  'GTNum-Index': 'GT_NUM',
  VarType: 'FUNC',
  Func: 'FUNC',
  Consequence: 'IMPACT',
  Impact: 'IMPACT',
  Gene: 'GENE',
  Omim: 'OMIM',
  OMIM: 'OMIM',
  Transcript: 'TRANSCRIPT',
  HGVS_C: 'CDNA',
  cDNA: 'CDNA',
  HGVS_P: 'AA_CHANGE',
  AAChange: 'AA_CHANGE',
  CADDPhredScore: 'CADD',
  ClinVar: 'CLINVAR',
  ClinVSig: 'CLINVAR',
  GnomadAF: 'GNOMAD_AF',
  GnomPMaxFiltAF: 'GNOMAD_AF',
  GnomTotal: 'GNOMAD_AF',
  HpoSimScore: 'HPO_SIM_SCORE',
  MoI: 'MOI'
}

/** The VarLens column each slot fills (shown in the field table). */
export const COLUMNAR_SLOT_COLUMN: Readonly<Record<ColumnarSlot, string>> = {
  SELECTED_TRANSCRIPT: 'transcript selection',
  CHR: 'chr',
  POS: 'pos',
  REF: 'ref',
  ALT: 'alt',
  QUAL: 'qual',
  GT_NUM: 'gt_num',
  FUNC: 'func',
  IMPACT: 'consequence',
  GENE: 'gene_symbol',
  OMIM: 'omim_mim_number',
  TRANSCRIPT: 'transcript',
  CDNA: 'cdna',
  AA_CHANGE: 'aa_change',
  CADD: 'cadd',
  CLINVAR: 'clinvar',
  GNOMAD_AF: 'gnomad_af',
  HPO_SIM_SCORE: 'hpo_sim_score',
  MOI: 'moi'
}

/**
 * varvis columnar columns without a VarLens column whose array holds one
 * value per transcript (manual 2.11.1: values of the selected / alternative
 * transcript). The importer keeps the selected transcript's value; every
 * other array is a list and is stored comma-joined.
 */
export const COLUMNAR_TRANSCRIPT_FIELDS: ReadonlySet<string> = new Set([
  'ExonIntronRank',
  'ExonDist',
  'AltFunc',
  'AltImpact',
  'AionShortlist',
  'InterProDomain'
])

/** Object-export variant property → column (`ObjectFormatMapper`). */
export const OBJECT_FORMAT_COLUMNS: Readonly<Record<string, string>> = {
  chr: 'chr',
  pos: 'pos',
  ref: 'ref',
  alt: 'alt',
  gene_symbol: 'gene_symbol',
  omim_mim_number: 'omim_mim_number',
  consequence: 'consequence',
  gnomad_af: 'gnomad_af',
  cadd: 'cadd',
  clinvar: 'clinvar',
  gt_num: 'gt_num',
  func: 'func',
  qual: 'qual',
  hpo_sim_score: 'hpo_sim_score',
  transcript: 'transcript',
  cdna: 'cdna',
  aa_change: 'aa_change',
  moi: 'moi',
  hpo_match: 'hpo_match'
}

/** VEP CSQ subfields the annotation parser turns into columns (`vcf-annotation-parser.ts`). */
export const CSQ_COLUMN_FIELDS: Readonly<Record<string, string>> = {
  Allele: 'alt (allele match)',
  Consequence: 'func',
  IMPACT: 'consequence',
  SYMBOL: 'gene_symbol',
  Feature: 'transcript',
  HGVSc: 'cdna',
  HGVSp: 'aa_change',
  gnomADe_AF: 'gnomad_af',
  CADD_PHRED: 'cadd',
  ClinVar_CLNSIG: 'clinvar'
}

/** SnpEff ANN subfield names in order (the header does not carry them in a parseable form). */
export const ANN_FIELD_NAMES: readonly string[] = [
  'Allele',
  'Annotation',
  'Annotation_Impact',
  'Gene_Name',
  'Gene_ID',
  'Feature_Type',
  'Feature_ID',
  'Transcript_BioType',
  'Rank',
  'HGVS.c',
  'HGVS.p',
  'cDNA.pos/cDNA.length',
  'CDS.pos/CDS.length',
  'AA.pos/AA.length',
  'Distance',
  'ERRORS/WARNINGS/INFO'
]

export const ANN_COLUMN_FIELDS: Readonly<Record<string, string>> = {
  Allele: 'alt (allele match)',
  Annotation: 'func',
  Annotation_Impact: 'consequence',
  Gene_Name: 'gene_symbol',
  Feature_ID: 'transcript',
  'HGVS.c': 'cdna',
  'HGVS.p': 'aa_change'
}

/**
 * varvis SNV annotation columns (user manual 2.11.1, SNV table) with their
 * value type. A field the preview sample leaves empty shows this type.
 */
export const VARVIS_SNV_COLUMN_TYPES: Readonly<Record<string, 'number' | 'text'>> = {
  AionShortlist: 'text',
  AllexesFound: 'number',
  AllexesFoundHom: 'number',
  AllexesGeneLit: 'number',
  AllexesRelevant: 'number',
  AllexesSig: 'text',
  AllexesVariantLit: 'number',
  'AltAF-Index': 'number',
  AltFunc: 'text',
  AltImpact: 'text',
  'AltReads-Index': 'number',
  BayesDelAddAfRank: 'number',
  BayesDelNoAfRank: 'number',
  ClinVAcc: 'text',
  ClinVBenignFraction: 'number',
  ClinVLofFraction: 'number',
  ClinVMissenseFraction: 'number',
  ClinVSigSum: 'text',
  ClinVStatus: 'text',
  ClinVVariantsGeneSum: 'number',
  dbSNP: 'text',
  EigenPcRawRank: 'number',
  End: 'number',
  ExonDist: 'number',
  ExonIntronRank: 'text',
  FathmmMklCodingRank: 'number',
  FathmmRank: 'number',
  Filter: 'text',
  gDNA: 'text',
  GenesOverlapping: 'text',
  GenoCanyonRank: 'number',
  'GERP++RsRank': 'number',
  GnomACount: 'number',
  GnomHemInd: 'number',
  GnomHomInd: 'number',
  GnomGLofOe: 'number',
  GnomGLofOeUp: 'number',
  GnomGMisOe: 'number',
  GnomGMisZ: 'number',
  GnomGSynOe: 'number',
  GnomGSynZ: 'number',
  GnomPMaxFiltAF: 'number',
  GnomTotal: 'number',
  HGNC: 'text',
  HPODisease: 'text',
  HpoMatch: 'text',
  HpoMatchF: 'number',
  InterProDomain: 'text',
  IntFitConsRank: 'number',
  LocalAF: 'number',
  'LocalFound-Hom': 'number',
  LocalFound: 'number',
  LocalSig: 'text',
  LrtRank: 'number',
  'MaxEntScan-Alt': 'number',
  'MaxEntScan-Diff': 'number',
  'MaxEntScan-Ref': 'number',
  MCapRank: 'number',
  MetaLrRank: 'number',
  MetaRnnRank: 'number',
  MetaSvmRank: 'number',
  MMindCount: 'number',
  MutAssessorRank: 'number',
  MutPredRank: 'number',
  MutTasterRank: 'number',
  PangolinScore: 'number',
  'PhaseSet-Index': 'text',
  PhyloP100wayVertebratesScore: 'number',
  PhyloP470wayMammalsScore: 'number',
  ProveanRank: 'number',
  'Reads-Index': 'number',
  RevelRank: 'number',
  RevelScore: 'number',
  SB: 'number',
  'ScoreGERP++': 'number',
  ScSnvAda: 'number',
  ScSnvRf: 'number',
  SiftRank: 'number',
  SOR: 'number',
  'SpliceSiteFinder-Alt': 'number',
  'SpliceSiteFinder-Diff': 'number',
  'SpliceSiteFinder-Ref': 'number'
}

// ── Canonical evidence fields ──────────────────────────────────

export interface CanonicalEvidenceField {
  /** The `info.<KEY>` every source writes. */
  key: string
  label: string
  /** number: stored as a JSON number text (`0.5`); text: lower-cased, `&`/`_` read as `,`/space. */
  kind: 'number' | 'text'
  /** first: the first listed alias with a value; max: the largest value over all aliases. */
  combine: 'first' | 'max'
  /** Source field names, any origin (varvis columnar/object, VCF INFO, VEP CSQ). */
  aliases: readonly string[]
}

/**
 * Canonical evidence keys (spec §16 "Parity with VCFs from the annotation
 * pipeline"). Numeric aliases holding several values (`0.2&0.7`, one per
 * transcript) contribute their maximum, as varvis does across transcripts.
 */
export const CANONICAL_EVIDENCE_FIELDS: readonly CanonicalEvidenceField[] = [
  {
    key: 'REVEL',
    label: 'REVEL score',
    kind: 'number',
    combine: 'first',
    aliases: ['RevelScore', 'REVEL_score', 'REVEL']
  },
  {
    key: 'METARNN',
    label: 'MetaRNN rank score',
    kind: 'number',
    combine: 'first',
    aliases: ['MetaRnnRank', 'MetaRNN_rankscore']
  },
  {
    key: 'BAYESDEL',
    label: 'BayesDel (no AF) rank score',
    kind: 'number',
    combine: 'first',
    aliases: ['BayesDelNoAfRank', 'BayesDel_noAF_rankscore']
  },
  {
    key: 'ALPHAMISSENSE',
    label: 'AlphaMissense score',
    kind: 'number',
    combine: 'first',
    aliases: ['AlphaMissense_score', 'am_pathogenicity']
  },
  {
    key: 'SPLICEAI_MAX',
    label: 'SpliceAI maximum delta score',
    kind: 'number',
    combine: 'max',
    aliases: [
      'SpliceAI_pred_DS_AG',
      'SpliceAI_pred_DS_AL',
      'SpliceAI_pred_DS_DG',
      'SpliceAI_pred_DS_DL'
    ]
  },
  {
    key: 'PANGOLIN',
    label: 'Pangolin score',
    kind: 'number',
    combine: 'first',
    aliases: ['PangolinScore', 'Pangolin']
  },
  {
    key: 'GNOMAD_POPMAX_AF',
    label: 'gnomAD popmax allele frequency',
    kind: 'number',
    combine: 'first',
    aliases: ['GnomPMaxFiltAF', 'gnomAD4.1_joint_POPMAX_AF']
  },
  {
    key: 'GNOMAD_HOM',
    label: 'gnomAD homozygous individuals',
    kind: 'number',
    combine: 'first',
    aliases: ['GnomHomInd', 'gnomAD4.1_joint_nhomalt', 'gnomADe_nhomalt']
  },
  {
    // LOEUF is the upper bound of the LoF o/e interval: varvis GnomGLofOeUp, not GnomGLofOe.
    key: 'LOEUF',
    label: 'gnomAD LOEUF (LoF o/e upper bound)',
    kind: 'number',
    combine: 'first',
    aliases: ['GnomGLofOeUp', 'LOEUF']
  },
  {
    key: 'LOF_OE',
    label: 'gnomAD LoF observed/expected',
    kind: 'number',
    combine: 'first',
    aliases: ['GnomGLofOe', 'oe_lof']
  },
  {
    key: 'MISSENSE_Z',
    label: 'gnomAD missense Z-score',
    kind: 'number',
    combine: 'first',
    aliases: ['GnomGMisZ', 'mis_z']
  },
  {
    key: 'CLINVAR_REVSTAT',
    label: 'ClinVar review status',
    kind: 'text',
    combine: 'first',
    aliases: ['ClinVStatus', 'ClinVarCurrent_CLNREVSTAT', 'CLNREVSTAT']
  }
]
