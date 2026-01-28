/**
 * Zod schema for Ensembl VEP REST API responses
 *
 * VEP response structure varies based on variant type and available annotations.
 * All score and annotation fields are optional - VEP only includes fields when data is available.
 *
 * Reference: https://rest.ensembl.org/documentation/info/vep_region_get
 */

import { z } from 'zod'

/**
 * VEP transcript consequence schema
 * Represents annotation for a single transcript affected by the variant
 */
export const VepTranscriptConsequenceSchema = z.object({
  /** Ensembl transcript ID (e.g., ENST00000123456) */
  transcript_id: z.string(),
  /** Gene symbol (e.g., BRCA1), may be missing for intergenic variants */
  gene_symbol: z.string().optional(),
  /** Consequence terms (e.g., ["missense_variant", "splice_region_variant"]) */
  consequence_terms: z.array(z.string()),
  /** Impact level based on consequence severity */
  impact: z.enum(['HIGH', 'MODERATE', 'LOW', 'MODIFIER']).optional(),
  /** MANE Select transcript flag (presence indicates clinically preferred transcript) */
  mane_select: z.string().optional(),
  /** Canonical transcript flag (1 = canonical, 0 or missing = non-canonical) */
  canonical: z.number().optional(),
  /** Biotype (e.g., protein_coding, lincRNA) */
  biotype: z.string().optional(),

  // Prediction scores - all optional as availability varies by variant type
  /** CADD PHRED score (pathogenic >= 20) */
  cadd_phred: z.number().optional(),
  /** CADD raw score */
  cadd_raw: z.number().optional(),
  /** REVEL score (0-1, pathogenic >= 0.644) */
  revel_score: z.number().optional(),
  /** SIFT score (0-1, deleterious <= 0.05) */
  sift_score: z.number().optional(),
  /** SIFT prediction (deleterious/tolerated) */
  sift_prediction: z.string().optional(),
  /** PolyPhen score (0-1, damaging >= 0.85) */
  polyphen_score: z.number().optional(),
  /** PolyPhen prediction (probably_damaging/possibly_damaging/benign) */
  polyphen_prediction: z.string().optional(),

  // SpliceAI delta scores (0-1, pathogenic >= 0.2)
  /** SpliceAI acceptor gain delta score */
  spliceai_pred_ds_ag: z.number().optional(),
  /** SpliceAI acceptor loss delta score */
  spliceai_pred_ds_al: z.number().optional(),
  /** SpliceAI donor gain delta score */
  spliceai_pred_ds_dg: z.number().optional(),
  /** SpliceAI donor loss delta score */
  spliceai_pred_ds_dl: z.number().optional(),

  // gnomAD population frequencies
  /** gnomAD allele frequency (combined exomes + genomes) */
  gnomad_af: z.number().optional(),
  /** gnomAD exomes allele frequency */
  gnomad_exomes_af: z.number().optional(),
  /** gnomAD genomes allele frequency */
  gnomad_genomes_af: z.number().optional()
})

export type VepTranscriptConsequence = z.infer<typeof VepTranscriptConsequenceSchema>

/**
 * VEP colocated variant schema
 * Represents known variants at the same genomic position (e.g., dbSNP rsIDs)
 */
export const VepColocatedVariantSchema = z.object({
  /** rsID from dbSNP (e.g., rs123456) */
  id: z.string().optional(),
  /** Allele frequencies from various sources */
  frequencies: z.record(z.string(), z.number()).optional(),
  /** ClinVar clinical significance */
  clin_sig: z.array(z.string()).optional()
})

export type VepColocatedVariant = z.infer<typeof VepColocatedVariantSchema>

/**
 * VEP response item schema
 * Represents annotation for a single variant query
 */
export const VepResponseItemSchema = z.object({
  /** Variant ID from input (optional) */
  id: z.string().optional(),
  /** Input variant string (e.g., "1:100:A:T") */
  input: z.string(),
  /** Array of transcript consequences */
  transcript_consequences: z.array(VepTranscriptConsequenceSchema).optional(),
  /** Array of colocated variants (dbSNP, ClinVar, etc.) */
  colocated_variants: z.array(VepColocatedVariantSchema).optional(),
  /** Most severe consequence term for this variant */
  most_severe_consequence: z.string().optional()
})

export type VepResponseItem = z.infer<typeof VepResponseItemSchema>

/**
 * VEP response schema
 * VEP REST API returns an array of results (one per input variant)
 */
export const VepResponseSchema = z.array(VepResponseItemSchema)

export type VepResponse = z.infer<typeof VepResponseSchema>
