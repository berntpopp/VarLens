/**
 * VCF Mapper
 *
 * Orchestrates all VCF parsers to transform VcfRawRecords into VarLens
 * Variant objects ready for the BatchAccumulator.
 */

import type { VcfRawRecord, VcfHeader, VcfMappedVariant, InfoFieldMapping } from './types'
import { splitMultiAllelic } from './vcf-allele-splitter'
import { parseAnnotation } from './vcf-annotation-parser'
import { parseGenotype } from './vcf-genotype-parser'
import { applyInfoFieldRegistry } from './info-field-registry'

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
 * @returns Array of mapped variants (may be empty)
 */
export function mapVcfRecord(
  record: VcfRawRecord,
  header: VcfHeader,
  sampleName: string,
  registry: InfoFieldMapping[]
): VcfMappedVariant[] {
  // Step 1: Split multi-allelic into biallelic records
  const splitRecords = splitMultiAllelic(record, header.infoDefs, header.formatDefs)

  const results: VcfMappedVariant[] = []

  for (let altIdx = 0; altIdx < splitRecords.length; altIdx++) {
    const rec = splitRecords[altIdx]

    // Step 2: Extract genotype for the selected sample
    const sampleValues = rec.samples.get(sampleName)
    if (!sampleValues) continue

    const gtIdx = rec.format.indexOf('GT')
    const gtFieldValue = gtIdx >= 0 && gtIdx < sampleValues.length ? sampleValues[gtIdx] : '.'

    // Skip if sample does not carry the ALT allele (ref-hom, no-call, or other ALT)
    if (shouldSkipGenotype(gtFieldValue)) continue

    // Parse full genotype data (with altAlleleIndex=1 since already split)
    const genotype = parseGenotype(sampleValues, rec.format, 1)

    // Step 3: Parse annotation (CSQ or ANN)
    const altAllele = rec.alt[0]
    const annotation = parseAnnotation(rec.info, header, altAllele, rec.ref)

    // Step 4: Apply INFO field registry
    const infoResult = applyInfoFieldRegistry(rec.info, registry, annotation)

    // Step 5: Assemble the mapped variant
    const variant: VcfMappedVariant = {
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
      _transcripts: annotation.transcripts.length > 0 ? annotation.transcripts : undefined
    }

    results.push(variant)
  }

  return results
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
function shouldSkipGenotype(gt: string): boolean {
  // No-call shorthand
  if (gt === '.' || gt === './.' || gt === '.|.') return true

  // Split on / or |
  const alleles = gt.split(/[/|]/)

  // Skip if no allele is "1" (the ALT allele after remapping)
  // This covers ref-hom (0/0), no-call (./.), and partial no-call (0/.)
  return !alleles.includes('1')
}
