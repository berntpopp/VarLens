/**
 * High-performance streaming writer for Simple JSON format (.json and .json.gz).
 * Matches the 22-field schema ingested by VarLens SimpleStrategy.
 */
import { createWriteStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { CanonicalVariant, SampleMetadata } from '../types'

export interface SimpleJsonWriterOptions {
  outputPath: string
  gzip?: boolean
}

/**
 * Creates an async generator yielding JSON string chunks for the entire file.
 */
export async function* generateSimpleJsonChunks(
  sample: SampleMetadata,
  variants: readonly CanonicalVariant[]
): AsyncGenerator<string, void, unknown> {
  // Top-level header
  yield `{\n  "person_id": ${sample.person_id},\n  "lims_id": ${JSON.stringify(sample.lims_id)},\n  "analysis_id": ${sample.analysis_id},\n  "variant_count": ${variants.length},\n  "variants": [\n`

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]
    const row = {
      lims_id: sample.lims_id,
      person_id: sample.person_id,
      analysis_id: sample.analysis_id,
      chr: v.chr,
      pos: v.pos,
      ref: v.ref,
      alt: v.alt,
      gene_symbol: v.gene_symbol,
      omim_mim_number: v.omim_mim_number,
      consequence: v.consequence,
      gnomad_af: v.gnomad_af,
      cadd: v.cadd,
      clinvar: v.clinvar,
      gt_num: v.gt_num,
      func: v.func,
      qual: v.qual,
      hpo_sim_score: v.hpo_sim_score,
      transcript: v.transcript,
      cdna: v.cdna,
      aa_change: v.aa_change,
      hpo_match: v.hpo_match,
      moi: v.moi
    }
    const isLast = i === variants.length - 1
    yield `    ${JSON.stringify(row)}${isLast ? '' : ','}\n`
  }

  yield '  ]\n}\n'
}

/**
 * Writes the sample variants to a .json or .json.gz file using streaming pipes.
 */
export async function writeSimpleJson(
  sample: SampleMetadata,
  variants: readonly CanonicalVariant[],
  options: SimpleJsonWriterOptions
): Promise<string> {
  const { outputPath, gzip = false } = options
  const readStream = Readable.from(generateSimpleJsonChunks(sample, variants))
  const writeStream = createWriteStream(outputPath)

  if (gzip) {
    const gzipStream = createGzip({ level: 6 })
    await pipeline(readStream, gzipStream, writeStream)
  } else {
    await pipeline(readStream, writeStream)
  }

  return outputPath
}
