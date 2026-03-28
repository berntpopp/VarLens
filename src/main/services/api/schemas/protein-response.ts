// src/main/services/api/schemas/protein-response.ts

/**
 * Zod schemas for external protein API responses
 * Validates data at the boundary to catch upstream API changes
 */

import { z } from 'zod'

// ── UniProt REST API ──────────────────────────────────────────────

export const UniProtGeneSchema = z.object({
  geneName: z.object({ value: z.string() }).optional()
})

export const UniProtResultSchema = z.object({
  primaryAccession: z.string(),
  uniProtkbId: z.string().optional(),
  genes: z.array(UniProtGeneSchema).optional(),
  proteinDescription: z
    .object({
      recommendedName: z
        .object({
          fullName: z.object({ value: z.string() }).optional()
        })
        .optional()
    })
    .optional(),
  sequence: z.object({ length: z.number() })
})

export const UniProtResponseSchema = z.object({
  results: z.array(UniProtResultSchema)
})

export type UniProtResponse = z.infer<typeof UniProtResponseSchema>

// ── InterPro REST API ─────────────────────────────────────────────

const InterProFragmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  'dc-status': z.string().optional()
})

const InterProLocationSchema = z.object({
  fragments: z.array(InterProFragmentSchema)
})

const InterProProteinSchema = z.object({
  accession: z.string(),
  protein_length: z.number().optional(),
  entry_protein_locations: z.array(InterProLocationSchema).optional()
})

const InterProEntrySchema = z.object({
  metadata: z.object({
    accession: z.string(),
    name: z.string(),
    type: z.string(),
    source_database: z.string().optional()
  }),
  proteins: z.array(InterProProteinSchema).optional()
})

export const InterProResponseSchema = z.object({
  count: z.number(),
  results: z.array(InterProEntrySchema)
})

export type InterProResponse = z.infer<typeof InterProResponseSchema>

// ── AlphaFold DB API ──────────────────────────────────────────────

export const AlphaFoldPredictionSchema = z.object({
  entryId: z.string(),
  uniprotAccession: z.string().optional(),
  uniprotId: z.string().optional(),
  uniprotDescription: z.string().optional(),
  modelUrl: z.string().url().optional(),
  cifUrl: z.string().url().optional(),
  bcifUrl: z.string().url().optional(),
  pdbUrl: z.string().url().optional(),
  paeImageUrl: z.string().url().optional(),
  modelCreatedDate: z.string().optional(),
  latestVersion: z.number().optional()
})

export const AlphaFoldResponseSchema = z.array(AlphaFoldPredictionSchema)

export type AlphaFoldResponse = z.infer<typeof AlphaFoldResponseSchema>

// ── Ensembl REST API (gene lookup with transcript exons) ─────────

const EnsemblExonSchema = z.object({
  start: z.number(),
  end: z.number(),
  id: z.string().optional(),
  strand: z.number().optional(),
  seq_region_name: z.string().optional(),
  object_type: z.string().optional()
})

const EnsemblTranscriptSchema = z.object({
  id: z.string(),
  display_name: z.string().optional(),
  start: z.number(),
  end: z.number(),
  strand: z.number(),
  is_canonical: z.number().optional(),
  Exon: z.array(EnsemblExonSchema).optional()
})

export const EnsemblGeneLookupSchema = z.object({
  id: z.string(),
  display_name: z.string().optional(),
  start: z.number(),
  end: z.number(),
  strand: z.number(),
  seq_region_name: z.string(),
  Transcript: z.array(EnsemblTranscriptSchema).optional()
})

export type EnsemblGeneLookup = z.infer<typeof EnsemblGeneLookupSchema>

// ── gnomAD GraphQL API ────────────────────────────────────────────

const GnomadTranscriptConsequenceSchema = z.object({
  major_consequence: z.string().optional(),
  hgvsp: z.string().nullable().optional(),
  hgvsc: z.string().nullable().optional()
})

const GnomadPopulationFreqSchema = z
  .object({
    ac: z.number(),
    an: z.number(),
    af: z.number().optional()
  })
  .nullable()

const GnomadVariantSchema = z.object({
  variant_id: z.string(),
  pos: z.number(),
  ref: z.string().optional(),
  alt: z.string().optional(),
  exome: GnomadPopulationFreqSchema.optional().nullable(),
  genome: GnomadPopulationFreqSchema.optional().nullable(),
  transcript_consequence: GnomadTranscriptConsequenceSchema.optional().nullable()
})

const GnomadGeneSchema = z.object({
  gene_id: z.string(),
  symbol: z.string(),
  variants: z.array(GnomadVariantSchema)
})

export const GnomadResponseSchema = z.object({
  data: z.object({
    gene: GnomadGeneSchema.nullable()
  })
})

export type GnomadResponse = z.infer<typeof GnomadResponseSchema>

// ── ClinVar via gnomAD GraphQL API ──────────────────────────────────

const ClinVarGnomadFreqSchema = z
  .object({
    ac: z.number(),
    an: z.number()
  })
  .nullable()
  .optional()

const ClinVarVariantSchema = z.object({
  variant_id: z.string(),
  clinical_significance: z.string().nullable().optional(),
  clinvar_variation_id: z.string().nullable().optional(),
  gold_stars: z.number().nullable().optional(),
  hgvsp: z.string().nullable().optional(),
  major_consequence: z.string().nullable().optional(),
  pos: z.number(),
  gnomad: z
    .object({
      exome: ClinVarGnomadFreqSchema,
      genome: ClinVarGnomadFreqSchema
    })
    .nullable()
    .optional()
})

const ClinVarGeneSchema = z.object({
  clinvar_variants: z.array(ClinVarVariantSchema)
})

export const ClinVarResponseSchema = z.object({
  data: z.object({
    gene: ClinVarGeneSchema.nullable()
  })
})

export type ClinVarResponse = z.infer<typeof ClinVarResponseSchema>
