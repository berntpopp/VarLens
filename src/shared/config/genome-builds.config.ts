/**
 * Genome builds VarLens recognises, as data. Detection (`detectGenomeBuild`)
 * and the import UI read only this file, so adding a build is a config change.
 *
 * Evidence ranking, fixed in code (src/shared/genome/genome-build.ts):
 * contig lengths are definitive, header tags are strong, data positions only
 * exclude a build, and chr-vs-bare naming is never evidence.
 *
 * Lengths: UCSC chrom.sizes (hg19, hg38, hs1). hg19 and GRCh37 share every
 * primary length; only the mitochondrion differs (hg19 chrM = NC_001807).
 */

export interface GenomeBuildDef {
  /** Stored in cases.genome_build. */
  id: string
  label: string
  /** false = recognised, but import is blocked. */
  importable: boolean
  /** Lower-case tokens matched in header tag lines. */
  aliases: readonly string[]
  /** Mitochondrion name -> length in this build's references. */
  mito: Readonly<Record<string, number>>
  /** Bare primary name ('1'..'22', 'X', 'Y') -> length. */
  contigs: Readonly<Record<string, number>>
  /**
   * Stored names (src/shared/utils/contig.ts): the build's reference-dictionary
   * form of the 25 primary contigs. Every other contig is stored verbatim.
   */
  naming: {
    /** Prefix of 1..22, X, Y. */
    primaryPrefix: 'chr' | ''
    /** Stored mitochondrion name. */
    mito: string
    /** Mito names (upper case, `chr` stripped) that are this build's rCRS mitochondrion. */
    mitoAliases: readonly string[]
  }
  /**
   * External-link placeholders: `{build_ucsc}`, `{dataset_gnomad}`, and the
   * UCSC name of this build's rCRS mitochondrion (`{chr_ucsc}` of MT).
   */
  links?: { ucscDb: string; gnomadDataset: string; ucscRcrsMito: string }
}

export const GENOME_BUILDS = [
  {
    id: 'GRCh38',
    label: 'GRCh38 (hg38)',
    importable: true,
    aliases: [
      'grch38',
      'hg38',
      'hs38dh',
      'hs38',
      'b38',
      'homo_sapiens_assembly38',
      'gca_000001405.15',
      // RefSeq GRCh38 and its patches (.26 = GRCh38 ... .40 = GRCh38.p14)
      ...Array.from({ length: 15 }, (_, i) => `gcf_000001405.${26 + i}`)
    ],
    mito: { chrM: 16_569, MT: 16_569 },
    naming: { primaryPrefix: 'chr', mito: 'chrM', mitoAliases: ['M', 'MT'] },
    links: { ucscDb: 'hg38', gnomadDataset: 'gnomad_r4', ucscRcrsMito: 'chrM' },
    contigs: {
      1: 248_956_422,
      2: 242_193_529,
      3: 198_295_559,
      4: 190_214_555,
      5: 181_538_259,
      6: 170_805_979,
      7: 159_345_973,
      8: 145_138_636,
      9: 138_394_717,
      10: 133_797_422,
      11: 135_086_622,
      12: 133_275_309,
      13: 114_364_328,
      14: 107_043_718,
      15: 101_991_189,
      16: 90_338_345,
      17: 83_257_441,
      18: 80_373_285,
      19: 58_617_616,
      20: 64_444_167,
      21: 46_709_983,
      22: 50_818_468,
      X: 156_040_895,
      Y: 57_227_415
    }
  },
  {
    id: 'GRCh37',
    label: 'GRCh37 (hg19)',
    importable: true,
    aliases: [
      'grch37',
      'hg19',
      'hs37d5',
      'hs37',
      'b37',
      'human_g1k_v37',
      'homo_sapiens_assembly19',
      'grch37lite',
      // RefSeq GRCh37 and its patches (.13 = GRCh37 ... .25 = GRCh37.p13)
      ...Array.from({ length: 13 }, (_, i) => `gcf_000001405.${13 + i}`)
    ],
    // MT = rCRS (GRCh37); chrM = hg19's NC_001807, two bases longer.
    mito: { MT: 16_569, chrM: 16_571 },
    // hg19 chrM / M (NC_001807) is a different sequence: never renamed to MT.
    naming: { primaryPrefix: '', mito: 'MT', mitoAliases: ['MT'] },
    // hg19's chrM is NC_001807; its rCRS is chrMT (hg19.p13.plusMT).
    links: { ucscDb: 'hg19', gnomadDataset: 'gnomad_r2_1', ucscRcrsMito: 'chrMT' },
    contigs: {
      1: 249_250_621,
      2: 243_199_373,
      3: 198_022_430,
      4: 191_154_276,
      5: 180_915_260,
      6: 171_115_067,
      7: 159_138_663,
      8: 146_364_022,
      9: 141_213_431,
      10: 135_534_747,
      11: 135_006_516,
      12: 133_851_895,
      13: 115_169_878,
      14: 107_349_540,
      15: 102_531_392,
      16: 90_354_753,
      17: 81_195_210,
      18: 78_077_248,
      19: 59_128_983,
      20: 63_025_520,
      21: 48_129_895,
      22: 51_304_566,
      X: 155_270_560,
      Y: 59_373_566
    }
  },
  {
    id: 'T2T-CHM13',
    label: 'T2T-CHM13v2.0 (hs1)',
    // Needs gene-reference, panel and link data before it can be imported.
    importable: false,
    aliases: ['chm13', 't2t', 'hs1'],
    mito: { chrM: 16_569 },
    naming: { primaryPrefix: 'chr', mito: 'chrM', mitoAliases: ['M', 'MT'] },
    contigs: {
      1: 248_387_328,
      2: 242_696_752,
      3: 201_105_948,
      4: 193_574_945,
      5: 182_045_439,
      6: 172_126_628,
      7: 160_567_428,
      8: 146_259_331,
      9: 150_617_247,
      10: 134_758_134,
      11: 135_127_769,
      12: 133_324_548,
      13: 113_566_686,
      14: 101_161_492,
      15: 99_753_195,
      16: 96_330_374,
      17: 84_276_897,
      18: 80_542_538,
      19: 61_707_364,
      20: 66_210_255,
      21: 45_090_682,
      22: 51_324_926,
      X: 154_259_566,
      Y: 62_460_029
    }
  }
] as const satisfies readonly GenomeBuildDef[]

/** rCRS (NC_012920) length; any other mitochondrial length is hg19's NC_001807. */
export const RCRS_MITO_LENGTH = 16_569

/** RefSeq contig names (NC_0000NN.<version>) map to primaries; lengths then decide the build. */
export const REFSEQ_CONTIG_NAMES = {
  chromosome: /^NC_0000(\d\d)\.\d+$/i,
  sexChromosomes: { 23: 'X', 24: 'Y' } as Readonly<Record<number, string>>,
  mitochondria: /^NC_(012920|001807)\.\d+$/i
}

export interface BuildTagSource {
  prefix: string
  label: string
  /** Command-line tags: only the values of these reference arguments are read. */
  referenceArgs?: readonly string[]
}

/** Header lines whose alias tokens name a build, with the label shown as evidence. */
export const BUILD_TAG_SOURCES: readonly BuildTagSource[] = [
  { prefix: '##reference=', label: 'Reference' },
  { prefix: '##assembly=', label: 'Assembly' },
  { prefix: '##contig=', label: 'Contig assembly' },
  { prefix: '##VEP=', label: 'VEP cache' },
  { prefix: '##VEP-command-line=', label: 'VEP' },
  { prefix: '##SnpEffCmd=', label: 'SnpEff' },
  {
    prefix: '##GATKCommandLine',
    label: 'GATK',
    referenceArgs: ['--reference', '-R', 'reference_sequence']
  },
  { prefix: '##DRAGENCommandLine', label: 'DRAGEN', referenceArgs: ['--ref-dir', '-r'] },
  { prefix: '##bcftools_', label: 'bcftools' }
]

/**
 * Tokens of a liftover record. Such lines name the source build, so their
 * aliases are ignored, and the confidence is capped so the user confirms.
 * ponytail: seed list from tool docs; extend from real CrossMap/Picard headers.
 */
export const LIFTOVER_MARKERS: readonly string[] = [
  '##liftoverprogram',
  '##targetrefgenome',
  '.over.chain',
  'chain='
]

const listBuilds = (builds: readonly string[]): string => builds.join(', ')

/** UI copy of the genome-build control (src/renderer/.../GenomeBuildField.vue). */
export const BUILD_COPY = {
  fieldLabel: 'Genome build',
  fallbackLabel: 'Build for files without one',
  evidenceLabel: 'Build evidence',
  suggestedSuffix: ' · suggested',
  excludedSuffix: ' — header disagrees',
  required: 'Choose the genome build these coordinates use.',
  definitive: (build: string, detail: string) => `Contig lengths match ${build} (${detail}).`,
  strong: (source: string, detail: string) =>
    `Found in the ${source} header (${detail}). No contig lengths to confirm it. Select the build to continue.`,
  conflictSuggested: (build: string, source: string, other: string) =>
    `Contig lengths say ${build}, but the ${source} header says ${other}. Check before importing.`,
  conflictNone: (builds: readonly string[]) =>
    `The header points to more than one build (${listBuilds(builds)}). Choose the build these coordinates use.`,
  liftover: (build: string) =>
    `This file records a liftover. Check that ${build} is the build of these coordinates.`,
  excludedSuggestion: (build: string, detail: string) =>
    `The header suggests ${build}, but ${detail}. Choose the build these coordinates use.`,
  none: 'No genome build found in this file. Choose the build these coordinates use.',
  json: 'JSON files carry no genome build. Choose the build their coordinates use.',
  notImportable: (label: string) => `This file is ${label}. VarLens cannot import ${label} yet.`,
  override: (suggested: string, chosen: string) =>
    `The contig lengths are ${suggested}. Variants imported as ${chosen} get the wrong chromosome names and links.`,
  mixedFiles: (a: string, b1: string, b: string, b2: string) =>
    `${a} is ${b1}, ${b} is ${b2}. One case holds one build: remove one file or import them as separate cases.`,
  noLengthMatch: 'Contig lengths match no known build',
  hg19Mito:
    'Mitochondrial positions use the hg19 chrM (NC_001807, 16,571 bp), not the rCRS of GRCh37 and GRCh38.',
  liftoverEvidence: 'Header records a liftover',
  lengthMismatch: (contig: string, length: number, expected: number) =>
    `${contig} is ${length.toLocaleString('en-US')} bp, not ${expected.toLocaleString('en-US')}`,
  positionBeyond: (contig: string, pos: number, length: number) =>
    `${contig} position ${pos.toLocaleString('en-US')} is beyond its ${length.toLocaleString('en-US')} bp`,
  lengthMatch: (matched: number, checked: number) => `${matched} of ${checked}`,
  tally: (counts: readonly { build: string; count: number }[], tagOnly: number, without: number) =>
    [
      ...counts.map((c) => `${c.count} ${c.build}`),
      ...(tagOnly > 0 ? [`${tagOnly} from header tags only`] : []),
      ...(without > 0 ? [`${without} without a build`] : [])
    ].join(' · '),
  skippedConflict: 'Genome build unclear in the header: import this file on its own to choose it.',
  missingBuild: 'No genome build: choose the build for files without one.',
  // Build check of stored cases before their chromosome names are updated
  // (contig-naming migration, src/renderer/.../BuildReviewDialog.vue).
  reviewBanner: (count: number) =>
    count === 1
      ? '1 case needs its genome build confirmed before its chromosome names are updated.'
      : `${count} cases need their genome build confirmed before their chromosome names are updated.`,
  reviewOpen: 'Review',
  reviewTitle: 'Confirm genome builds',
  reviewIntro:
    "VarLens stores chromosome names in each build's reference form (GRCh38 chr1, GRCh37 1). The build of these cases could not be confirmed, so their names were left unchanged. Choose the build their coordinates use.",
  reviewReason: {
    no_evidence: 'No source header or positions confirm the stored build',
    build_disagrees: 'The source header names another build',
    build_excluded: 'Stored positions lie beyond the stored build'
  },
  reviewCase: 'Case',
  reviewStored: 'Stored',
  reviewSuggested: 'Header',
  reviewChoice: 'Build',
  reviewSetSelected: 'Set selected to',
  reviewSelectGroup: (reason: string) => `Select all: ${reason}`,
  reviewApplySelected: (count: number) => `Confirm selected (${count})`,
  reviewApplyAll: (count: number) => `Confirm all (${count})`,
  renameFailed:
    'The background update of chromosome names keeps failing; VarLens retries it automatically. Ask your VarLens administrator to check the server log (entries "Chromosome-name update").',
  renameInProgress:
    'Chromosome names are being updated in the background. Until it finishes, cohort counts can mix old and new names.',
  reviewLater: 'Later',
  migrationNoSpace: (needed: string, free: string) =>
    `Updating the chromosome names of this database needs about ${needed} of free disk space next to it (a backup copy and the change log), but only ${free} is free. Free some space and open the database again; nothing has been changed.`,
  migrationBusy:
    'The database is open in another program, so VarLens cannot take the backup it needs before updating chromosome names. Close the other program and open the database again; nothing has been changed.',
  reviewApplied: (count: number) =>
    `Genome build confirmed for ${count} case${count === 1 ? '' : 's'}.`
} as const

export interface GenomeBuildConfig {
  builds: readonly GenomeBuildDef[]
  tagSources: readonly BuildTagSource[]
  liftoverMarkers: readonly string[]
}

export const GENOME_BUILD_CONFIG: GenomeBuildConfig = {
  builds: GENOME_BUILDS,
  tagSources: BUILD_TAG_SOURCES,
  liftoverMarkers: LIFTOVER_MARKERS
}

export const IMPORTABLE_GENOME_BUILDS: readonly GenomeBuildDef[] = GENOME_BUILDS.filter(
  (b) => b.importable
)

/** Link placeholders of a build; an unknown build gets GRCh38's. */
export function genomeBuildLinks(id: string): NonNullable<GenomeBuildDef['links']> {
  const builds: readonly GenomeBuildDef[] = GENOME_BUILDS
  return (builds.find((b) => b.id === id) ?? builds[0]).links ?? builds[0].links!
}

/**
 * A coordinate or HGVS string as shown and copied, with the build it refers to
 * (#576): "GRCh38 chr22:29539391:T:C". Unchanged while the build is unknown.
 */
export const withGenomeBuild = (text: string, build: string | null): string =>
  build === null ? text : `${build} ${text}`

export function isImportableGenomeBuild(id: string): boolean {
  return IMPORTABLE_GENOME_BUILDS.some((b) => b.id === id)
}
