/**
 * Streaming writer for Columnar JSON format (.json and .json.gz).
 * Matches the VarVis export format ingested by VarLens ColumnarStrategy.
 */
import { createWriteStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { CanonicalVariant, SampleMetadata } from '../types'

export interface ColumnarJsonWriterOptions {
  outputPath: string
  gzip?: boolean
  wrapped?: boolean
}

const IMPACT_TO_CODE: Record<string, string> = {
  HIGH: '1',
  MODERATE: '2',
  LOW: '3',
  MODIFIER: '4'
}

/**
 * Builds data dictionaries for Gene, Transcript, HpoSimScore, and MoI.
 */
function buildColumnarDictionaries(variants: readonly CanonicalVariant[]): {
  geneDict: Record<string, string>
  geneMap: Map<string, string>
  transcriptDict: Record<string, string>
  transcriptMap: Map<string, string>
  hpoScoreDict: Record<string, number>
  hpoScoreMap: Map<number, string>
  moiDict: Record<string, Array<{ accessionId?: number; name?: string; abbreviation?: string }>>
  moiMap: Map<string, string>
} {
  const geneDict: Record<string, string> = {}
  const geneMap = new Map<string, string>()
  const transcriptDict: Record<string, string> = {}
  const transcriptMap = new Map<string, string>()
  const hpoScoreDict: Record<string, number> = {}
  const hpoScoreMap = new Map<number, string>()
  const moiDict: Record<
    string,
    Array<{ accessionId?: number; name?: string; abbreviation?: string }>
  > = {}
  const moiMap = new Map<string, string>()

  let geneIdx = 1
  let transcriptIdx = 1
  let hpoIdx = 1
  let moiIdx = 1

  for (const v of variants) {
    if (!geneMap.has(v.gene_symbol)) {
      const code = String(geneIdx++)
      geneMap.set(v.gene_symbol, code)
      geneDict[code] = v.gene_symbol
    }
    if (!transcriptMap.has(v.transcript)) {
      const code = String(transcriptIdx++)
      transcriptMap.set(v.transcript, code)
      transcriptDict[code] = v.transcript
    }
    if (v.hpo_sim_score !== null && !hpoScoreMap.has(v.hpo_sim_score)) {
      const code = String(hpoIdx++)
      hpoScoreMap.set(v.hpo_sim_score, code)
      hpoScoreDict[code] = v.hpo_sim_score
    }
    const moiKey = v.moi
      .map((m) => (m.abbreviation !== null && m.abbreviation !== '' ? m.abbreviation : m.name))
      .join(';')
    if (!moiMap.has(moiKey)) {
      const code = String(moiIdx++)
      moiMap.set(moiKey, code)
      moiDict[code] = v.moi.map((m) => ({
        accessionId: m.accessionId,
        name: m.name,
        abbreviation: m.abbreviation ?? undefined
      }))
    }
  }

  return {
    geneDict,
    geneMap,
    transcriptDict,
    transcriptMap,
    hpoScoreDict,
    hpoScoreMap,
    moiDict,
    moiMap
  }
}

/**
 * Builds the 163-element header descriptor array.
 */
function buildHeaderDescriptors(dicts: ReturnType<typeof buildColumnarDictionaries>): Array<{
  id: string
  title?: string
  dataDictionary?: Record<string, unknown> | null
}> {
  const header: Array<{
    id: string
    title?: string
    dataDictionary?: Record<string, unknown> | null
  }> = []
  for (let i = 0; i <= 162; i++) {
    header.push({ id: `field_${i}`, dataDictionary: null })
  }

  header[0] = { id: 'VariantId', title: 'Variant ID', dataDictionary: null }
  header[1] = { id: 'selectedTranscript', title: 'Selected Transcript', dataDictionary: null }
  header[9] = { id: 'Chr', title: 'Chromosome', dataDictionary: null }
  header[10] = { id: 'Pos', title: 'Position', dataDictionary: null }
  header[11] = { id: 'Ref', title: 'Reference', dataDictionary: null }
  header[12] = { id: 'Alt', title: 'Alternate', dataDictionary: null }
  header[14] = { id: 'Qual', title: 'Quality', dataDictionary: null }
  header[15] = { id: 'Genotype', title: 'Genotype', dataDictionary: null }
  header[20] = { id: 'Func', title: 'Function', dataDictionary: null }
  header[21] = {
    id: 'Impact',
    title: 'Impact',
    dataDictionary: { '1': 'HIGH', '2': 'MODERATE', '3': 'LOW', '4': 'MODIFIER' }
  }
  header[24] = { id: 'Gene', title: 'Gene', dataDictionary: dicts.geneDict }
  header[25] = { id: 'OMIM', title: 'OMIM', dataDictionary: null }
  header[28] = { id: 'Transcript', title: 'Transcript', dataDictionary: dicts.transcriptDict }
  header[29] = { id: 'HGVS_C', title: 'cDNA', dataDictionary: null }
  header[30] = { id: 'HGVS_P', title: 'Protein', dataDictionary: null }
  header[46] = { id: 'CADDPhredScore', title: 'CADD', dataDictionary: null }
  header[72] = { id: 'ClinVSig', title: 'ClinVar', dataDictionary: null }
  header[108] = { id: 'GnomPMaxFiltAF', title: 'gnomAD AF', dataDictionary: null }
  header[156] = { id: 'HpoSimScore', title: 'HPO Sim Score', dataDictionary: dicts.hpoScoreDict }
  header[162] = { id: 'MoI', title: 'Mode of Inheritance', dataDictionary: dicts.moiDict }

  return header
}

export async function* generateColumnarJsonChunks(
  sample: SampleMetadata,
  variants: readonly CanonicalVariant[],
  wrapped = true
): AsyncGenerator<string, void, unknown> {
  const dicts = buildColumnarDictionaries(variants)
  const header = buildHeaderDescriptors(dicts)

  const prefix = wrapped ? `{\n  ${JSON.stringify(sample.lims_id)}: {\n` : '{\n'
  const indent = wrapped ? '    ' : '  '

  yield prefix
  yield `${indent}"header": ${JSON.stringify(header)},\n`
  yield `${indent}"data": [\n`

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]
    const row = new Array<unknown>(163).fill(null)
    const moiKey = v.moi
      .map((m) => (m.abbreviation !== null && m.abbreviation !== '' ? m.abbreviation : m.name))
      .join(';')

    row[0] = i + 1
    row[1] = 1
    row[9] = v.chr
    row[10] = v.pos
    row[11] = v.ref
    row[12] = v.alt
    row[14] = v.qual
    row[15] = v.gt_num
    row[20] = v.func
    row[21] = IMPACT_TO_CODE[v.consequence] ?? '2'
    row[24] = dicts.geneMap.get(v.gene_symbol) ?? v.gene_symbol
    row[25] = v.omim_mim_number
    row[28] = dicts.transcriptMap.get(v.transcript) ?? v.transcript
    row[29] = v.cdna
    row[30] = v.aa_change
    row[46] = v.cadd
    row[72] = v.clinvar
    row[108] = v.gnomad_af
    row[156] = v.hpo_sim_score !== null ? (dicts.hpoScoreMap.get(v.hpo_sim_score) ?? null) : null
    row[162] = dicts.moiMap.get(moiKey) ?? null

    const isLast = i === variants.length - 1
    yield `${indent}  ${JSON.stringify(row)}${isLast ? '' : ','}\n`
  }

  yield `${indent}]\n`
  yield wrapped ? '  }\n}\n' : '}\n'
}

export async function writeColumnarJson(
  sample: SampleMetadata,
  variants: readonly CanonicalVariant[],
  options: ColumnarJsonWriterOptions
): Promise<string> {
  const { outputPath, gzip = false, wrapped = true } = options
  const readStream = Readable.from(generateColumnarJsonChunks(sample, variants, wrapped))
  const writeStream = createWriteStream(outputPath)

  if (gzip) {
    const gzipStream = createGzip({ level: 6 })
    await pipeline(readStream, gzipStream, writeStream)
  } else {
    await pipeline(readStream, writeStream)
  }

  return outputPath
}
