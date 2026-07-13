/**
 * VCF Mapper
 *
 * Orchestrates all VCF parsers to transform VcfRawRecords into VarLens
 * Variant objects ready for the BatchAccumulator.
 */

import type { VcfRawRecord, VcfHeader, VcfMappedVariant, InfoFieldMapping } from './types'
import { splitAlleleForSample } from './vcf-allele-splitter'
import { parseAnnotationsForAlleles } from './vcf-annotation-parser'
import { parseGenotype } from './vcf-genotype-parser'
import { applyInfoFieldRegistry } from './info-field-registry'
import { detectVariantType } from './variant-type-detector'
import { extractSvFields, extractCnvFields, extractStrFields } from './extension-parsers'
import { splitGenotypeAlleles, VcfResourceLimitError } from './vcf-resource-limits'

const MAX_VCF_EXPANDED_RECORD_BYTES = 64 * 1024 * 1024
const MAX_VCF_ALLELE_EXPANSION_WORK = 1_000_000

/** Parse integer from string, returning null for missing/invalid values */
function parseIntOrNull(val: string | undefined): number | null {
  if (val === undefined || val === '' || val === '.') return null
  const n = parseInt(val, 10)
  return Number.isNaN(n) ? null : n
}

/**
 * Map a VcfRawRecord into zero or more VcfMappedVariant objects.
 *
 * Returns zero variants if the selected sample has no ALT allele (0/0 or ./.).
 * Returns one variant for single-allelic sites with a non-ref genotype.
 * Returns multiple variants for multi-allelic sites (one per ALT allele with a non-ref genotype).
 *
 * @param record - Raw VCF record
 * @param header - Parsed VCF header
 * @param sampleName - Which sample to extract genotype for
 * @param registry - INFO field mappings
 * @param callerName - Detected caller name (null if unknown)
 * @returns Array of mapped variants (may be empty)
 */
export function mapVcfRecord(
  record: VcfRawRecord,
  header: VcfHeader,
  sampleName: string,
  registry: InfoFieldMapping[],
  callerName: string | null = null
): VcfMappedVariant[] {
  const results: VcfMappedVariant[] = []
  const selectedValues = record.samples.get(sampleName)
  if (selectedValues === undefined) return results

  const gtIdx = record.format.indexOf('GT')
  const rawGt = gtIdx >= 0 && gtIdx < selectedValues.length ? selectedValues[gtIdx] : '.'
  const carriedAlleles = carriedAltAlleles(rawGt)
  const targetAltIndexes: number[] = []

  for (let altIdx = 0; altIdx < record.alt.length; altIdx++) {
    const rawAlt = record.alt[altIdx]
    const isStructural =
      rawAlt.startsWith('<') ||
      rawAlt.includes('[') ||
      rawAlt.includes(']') ||
      record.info.has('SVTYPE')
    if (isStructural || carriedAlleles.has(altIdx + 1)) targetAltIndexes.push(altIdx)
  }

  assertBoundedExpandedRecord(record, targetAltIndexes.length)
  assertBoundedAlleleExpansionWork(record, header, targetAltIndexes.length)
  const annotationByTarget = parseAnnotationsForAlleles(
    record.info,
    header,
    targetAltIndexes.map((index) => record.alt[index]),
    record.ref,
    targetAltIndexes,
    record.alt
  )

  for (let targetIndex = 0; targetIndex < targetAltIndexes.length; targetIndex++) {
    const altIdx = targetAltIndexes[targetIndex]
    // Build only the one selected sample/ALT view that will be mapped.
    const rec = splitAlleleForSample(record, header.infoDefs, header.formatDefs, altIdx, sampleName)
    const sampleValues = rec.samples.get(sampleName)
    if (sampleValues === undefined) continue

    // Parse full genotype data (with altAlleleIndex=1 since already split)
    const genotype = parseGenotype(
      sampleValues,
      rec.format,
      1,
      header.formatDefs.get('AD')?.number ?? 'R'
    )

    // Step 3: Select the pre-grouped annotation result for this ALT.
    const altAllele = rec.alt[0]
    const annotation = annotationByTarget[targetIndex]

    // Step 4: Apply INFO field registry
    const infoResult = applyInfoFieldRegistry(rec.info, registry, annotation)

    // Step 5: Build sample raw FORMAT values for extension parsers
    const sampleRawValues = new Map<string, string>()
    const sampleVals = rec.samples.get(sampleName)
    if (rec.format.length > 0 && sampleVals !== undefined) {
      for (let i = 0; i < rec.format.length; i++) {
        if (i < sampleVals.length && sampleVals[i] !== undefined) {
          sampleRawValues.set(rec.format[i], sampleVals[i])
        }
      }
    }

    // Step 6: Assemble the mapped variant
    const mapped: VcfMappedVariant = {
      chr: rec.chrom,
      pos: rec.pos,
      ref: rec.ref,
      alt: altAllele,
      gene_symbol: annotation.geneSymbol,
      omim_mim_number: null,
      consequence: annotation.impact,
      gnomad_af:
        annotation.gnomadAf ?? (infoResult.mappedValues.get('gnomad_af') as number | null) ?? null,
      cadd: annotation.cadd ?? (infoResult.mappedValues.get('cadd') as number | null) ?? null,
      clinvar:
        annotation.clinvar ?? (infoResult.mappedValues.get('clinvar') as string | null) ?? null,
      gt_num: genotype.gt,
      func: annotation.consequence,
      qual: rec.qual,
      hpo_sim_score: null,
      transcript: annotation.transcript,
      cdna: annotation.cdna,
      aa_change: annotation.aaChange,
      hpo_match: null,
      moi: null,
      gq: genotype.gq,
      dp: genotype.dp,
      ad_ref: genotype.adRef,
      ad_alt: genotype.adAlt,
      ab: genotype.ab,
      filter: rec.filter,
      info_json: infoResult.infoJson ? JSON.stringify(infoResult.infoJson) : null,
      source_format: 'vcf',
      _transcripts: annotation.transcripts.length > 0 ? annotation.transcripts : undefined,
      variant_type: detectVariantType(rec.ref, altAllele, rec.info, callerName),
      end_pos: parseIntOrNull(rec.info.get('END')),
      sv_type: rec.info.get('SVTYPE') ?? null,
      sv_length: parseIntOrNull(rec.info.get('SVLEN')),
      caller: callerName
    }

    // Step 7: Attach extension data for non-SNV/indel variant types
    const vt = mapped.variant_type
    if (vt === 'sv') {
      mapped._sv = extractSvFields(rec.info, sampleRawValues)
    } else if (vt === 'cnv') {
      mapped._cnv = extractCnvFields(rec.info, sampleRawValues)
    } else if (vt === 'str') {
      mapped._str = extractStrFields(rec.info, sampleRawValues)
    }

    results.push(mapped)
  }

  return results
}

function assertBoundedExpandedRecord(record: VcfRawRecord, mappedAltCount: number): void {
  if (mappedAltCount <= 1) return
  let retainedInfoBytes = 0
  for (const [key, value] of record.info) {
    if (key === 'CSQ' || key === 'ANN') continue
    retainedInfoBytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8')
  }
  const expandedBytes = retainedInfoBytes * mappedAltCount
  if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_VCF_EXPANDED_RECORD_BYTES) {
    throw new VcfResourceLimitError(
      `VCF record expanded output exceeds ${MAX_VCF_EXPANDED_RECORD_BYTES} bytes`
    )
  }
}

function assertBoundedAlleleExpansionWork(
  record: VcfRawRecord,
  header: VcfHeader,
  mappedAltCount: number
): void {
  if (mappedAltCount <= 1) return
  let alleleValuedFields = 0
  for (const key of record.info.keys()) {
    const number = header.infoDefs.get(key)?.number
    if (number === 'A' || number === 'R') alleleValuedFields += 1
  }
  for (const key of record.format) {
    const number = header.formatDefs.get(key)?.number
    if (number === 'A' || number === 'R') alleleValuedFields += 1
  }
  const work =
    mappedAltCount *
    (record.info.size + record.format.length + alleleValuedFields * record.alt.length)
  if (!Number.isSafeInteger(work) || work > MAX_VCF_ALLELE_EXPANSION_WORK) {
    throw new VcfResourceLimitError(
      `VCF record allele expansion exceeds work budget ${MAX_VCF_ALLELE_EXPANSION_WORK}`
    )
  }
}

/**
 * Check if a GT field value indicates the sample does NOT carry the ALT allele.
 *
 * After multi-allelic splitting, the target ALT allele is always remapped to "1".
 * A sample should be skipped if:
 * - The GT is no-call (all alleles are ".")
 * - The GT is ref-homozygous (all alleles are "0")
 * - The GT does not contain "1" at all (sample doesn't carry this specific ALT)
 */
function carriedAltAlleles(gt: string): Set<number> {
  const result = new Set<number>()
  if (gt === '.' || gt === './.' || gt === '.|.') return result
  const alleles = splitGenotypeAlleles(gt)
  if (alleles === null) throw new VcfResourceLimitError('Genotype ploidy exceeds 64 alleles')
  for (const allele of alleles) {
    if (!/^\d+$/.test(allele)) continue
    const value = Number(allele)
    if (Number.isSafeInteger(value) && value > 0) result.add(value)
  }
  return result
}
