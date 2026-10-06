/**
 * Streaming writer for VCF 4.2 format (.vcf and .vcf.gz).
 * Annotations follow Ensembl VEP CSQ format parsed by VarLens VcfStrategy.
 */
import { createWriteStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { CanonicalVariant, SampleMetadata } from '../types'

export interface VcfWriterOptions {
  outputPath: string
  gzip?: boolean
  genomeAssembly?: 'GRCh38' | 'GRCh37'
}

export async function* generateVcfChunks(
  sample: SampleMetadata,
  variants: readonly CanonicalVariant[],
  assembly: 'GRCh38' | 'GRCh37' = 'GRCh38'
): AsyncGenerator<string, void, unknown> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  // VCF Header
  yield '##fileformat=VCFv4.2\n'
  yield `##fileDate=${dateStr}\n`
  yield '##source=VarLensSyntheticSimulator\n'
  yield `##reference=${assembly}\n`
  yield '##FILTER=<ID=PASS,Description="All filters passed">\n'
  yield '##INFO=<ID=CSQ,Number=.,Type=String,Description="Consequence annotations from Ensembl VEP. Format: Allele|Consequence|IMPACT|SYMBOL|Gene|Feature|BIOTYPE|cDNA_position|CDS_position|Protein_position|Amino_acids|Codons|Existing_variation|gnomADe_AF|CADD_PHRED|ClinVar_CLNSIG">\n'
  yield '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">\n'
  yield '##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype Quality">\n'
  yield '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Read Depth">\n'
  yield '##FORMAT=<ID=AD,Number=R,Type=Integer,Description="Allelic depths for the ref and alt alleles in the order listed">\n'
  yield `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${sample.lims_id}\n`

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]

    // Construct CSQ annotation string
    const gnomadStr = v.gnomad_af !== null ? String(v.gnomad_af) : ''
    const caddStr = v.cadd !== null ? String(v.cadd) : ''
    const clinvarStr = v.clinvar ?? ''

    // Extract cDNA pos if available
    const cdnaMatch = v.cdna.match(/c\.(\d+)/)
    const cdnaPos = cdnaMatch ? cdnaMatch[1] : ''

    const csq = `${v.alt}|${v.func}|${v.consequence}|${v.gene_symbol}|${v.gene_symbol}|${v.transcript}|protein_coding|${cdnaPos}|${cdnaPos}|.|.|.|.|${gnomadStr}|${caddStr}|${clinvarStr}`

    const qual = v.qual ?? 500
    const filter = 'PASS'
    const info = `CSQ=${csq}`
    const format = 'GT:GQ:DP:AD'

    const gt = v.gt_num
    const gq = v.gq ?? 99
    const dp = v.dp ?? 40
    const adRef = v.ad_ref ?? 20
    const adAlt = v.ad_alt ?? 20
    const sampleData = `${gt}:${gq}:${dp}:${adRef},${adAlt}`

    yield `${v.chr}\t${v.pos}\t.\t${v.ref}\t${v.alt}\t${qual}\t${filter}\t${info}\t${format}\t${sampleData}\n`
  }
}

export async function writeVcf(
  sample: SampleMetadata,
  variants: readonly CanonicalVariant[],
  options: VcfWriterOptions
): Promise<string> {
  const { outputPath, gzip = false, genomeAssembly = 'GRCh38' } = options
  const readStream = Readable.from(generateVcfChunks(sample, variants, genomeAssembly))
  const writeStream = createWriteStream(outputPath)

  if (gzip) {
    const gzipStream = createGzip({ level: 6 })
    await pipeline(readStream, gzipStream, writeStream)
  } else {
    await pipeline(readStream, writeStream)
  }

  return outputPath
}
