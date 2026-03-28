/**
 * gnomAD GraphQL API client with rate limiting and caching
 *
 * Fetches population variant frequencies per gene from gnomAD with:
 * - Bottleneck rate limiting (6000ms between requests, max 1 concurrent)
 * - SQLite caching with 30-day TTL
 * - Zod response validation
 * - Allele frequency combination (exome + genome)
 */

import Bottleneck from 'bottleneck'
import { ApiCache } from './ApiCache'
import { GnomadResponseSchema, ClinVarResponseSchema } from './schemas/protein-response'
import type {
  GnomadFetchResult,
  GnomadVariant,
  ClinVarFetchResult,
  ClinVarVariant,
  ProteinApiError
} from '../../../shared/types/protein'
import { parseProteinPosition } from '../../../shared/utils/protein-utils'
import { mainLogger } from '../MainLogger'

const GNOMAD_ENDPOINT = 'https://gnomad.broadinstitute.org/api'
const CACHE_TTL_DAYS = 30
const DATASET = 'gnomad_r4'
const REFERENCE_GENOME = 'GRCh38'

const GNOMAD_QUERY = `
query GeneVariants($geneSymbol: String!, $referenceGenome: ReferenceGenomeId!, $dataset: DatasetId!) {
  gene(gene_symbol: $geneSymbol, reference_genome: $referenceGenome) {
    gene_id
    symbol
    variants(dataset: $dataset) {
      variant_id
      pos
      ref
      alt
      exome { ac an af }
      genome { ac an af }
      transcript_consequence { major_consequence hgvsp hgvsc }
    }
  }
}
`

const CLINVAR_QUERY = `
query ClinVarVariantsInGene($geneSymbol: String!, $referenceGenome: ReferenceGenomeId!) {
  gene(gene_symbol: $geneSymbol, reference_genome: $referenceGenome) {
    clinvar_variants {
      variant_id
      clinical_significance
      clinvar_variation_id
      gold_stars
      hgvsp
      major_consequence
      pos
      gnomad {
        exome { ac an }
        genome { ac an }
      }
    }
  }
}
`

export class GnomadApiClient {
  private cache: ApiCache
  private limiter: Bottleneck

  constructor(cache: ApiCache) {
    this.cache = cache

    // gnomAD blocks after ~10 rapid queries — use 6000ms spacing, 1 concurrent
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 6000
    })
  }

  /**
   * Fetch gnomAD population variant frequencies for a gene
   *
   * @param geneSymbol - HGNC gene symbol (e.g., "TP53")
   * @returns GnomadFetchResult with parsed variants or ProteinApiError
   */
  async fetchGeneVariants(
    geneSymbol: string,
    dataset: string = DATASET
  ): Promise<GnomadFetchResult | ProteinApiError> {
    const cacheKey = `gnomad:${geneSymbol}:${REFERENCE_GENOME}:${dataset}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      try {
        const raw = GnomadResponseSchema.parse(JSON.parse(cached.data))
        const gene = raw.data.gene
        if (!gene) {
          return { success: false, error: `Gene not found in gnomAD: ${geneSymbol}` }
        }
        return {
          success: true,
          variants: this.transformVariants(gene.variants),
          geneId: gene.gene_id,
          dataset,
          cacheInfo: {
            cached: true,
            cachedAt: cached.createdAt
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        mainLogger.warn(`Corrupted cache entry for ${cacheKey}: ${message}`, 'api')
      }
    }

    try {
      const rawResponse = await this.limiter.schedule(() =>
        this.makeGnomadRequest(geneSymbol, dataset)
      )

      const data = GnomadResponseSchema.parse(rawResponse)
      const gene = data.data.gene

      if (!gene) {
        return { success: false, error: `Gene not found in gnomAD: ${geneSymbol}` }
      }

      // Cache response with 30-day TTL
      this.cache.set(cacheKey, JSON.stringify(rawResponse), CACHE_TTL_DAYS)

      return {
        success: true,
        variants: this.transformVariants(gene.variants),
        geneId: gene.gene_id,
        dataset,
        cacheInfo: {
          cached: false,
          cachedAt: undefined
        }
      }
    } catch (error) {
      // Handle Zod validation errors
      if (
        error !== null &&
        error !== undefined &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'ZodError'
      ) {
        return {
          success: false,
          error: 'Invalid gnomAD response format',
          offline: false
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        offline: false
      }
    }
  }

  /**
   * Make HTTP POST request to gnomAD GraphQL API
   *
   * @private
   * @throws Error on non-OK response
   */
  private async makeGnomadRequest(geneSymbol: string, dataset: string = DATASET): Promise<unknown> {
    const response = await fetch(GNOMAD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: GNOMAD_QUERY,
        variables: {
          geneSymbol,
          referenceGenome: REFERENCE_GENOME,
          dataset
        }
      })
    })

    if (!response.ok) {
      throw new Error(`gnomAD API error: ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Transform raw gnomAD variants into GnomadVariant objects
   *
   * Combines exome + genome frequencies:
   * - AF: prefer exome if > 0, otherwise use genome
   * - AC: sum of exome + genome
   * - AN: max of exome and genome
   *
   * @private
   */
  private transformVariants(
    rawVariants: Array<{
      variant_id: string
      exome?: { ac: number; an: number; af?: number } | null
      genome?: { ac: number; an: number; af?: number } | null
      transcript_consequence?: {
        major_consequence?: string
        hgvsp?: string | null
        hgvsc?: string | null
      } | null
    }>
  ): GnomadVariant[] {
    return rawVariants.map((v) => {
      const exomeAf = v.exome?.af ?? 0
      const genomeAf = v.genome?.af ?? 0
      const alleleFrequency = exomeAf > 0 ? exomeAf : genomeAf

      const exomeAc = v.exome?.ac ?? 0
      const genomeAc = v.genome?.ac ?? 0
      const alleleCount = exomeAc + genomeAc

      const exomeAn = v.exome?.an ?? 0
      const genomeAn = v.genome?.an ?? 0
      const alleleNumber = Math.max(exomeAn, genomeAn)

      const hgvsp = v.transcript_consequence?.hgvsp ?? null
      const consequence = v.transcript_consequence?.major_consequence ?? 'unknown'
      const proteinPosition = parseProteinPosition(hgvsp)

      return {
        variantId: v.variant_id,
        proteinPosition,
        hgvsp,
        consequence,
        alleleFrequency,
        alleleCount,
        alleleNumber
      }
    })
  }

  /**
   * Fetch ClinVar variants for a gene via gnomAD GraphQL API
   *
   * @param geneSymbol - HGNC gene symbol (e.g., "TP53")
   * @returns ClinVarFetchResult with parsed variants or ProteinApiError
   */
  async fetchClinVarVariants(
    geneSymbol: string,
    dataset: string = DATASET
  ): Promise<ClinVarFetchResult | ProteinApiError> {
    const genome = dataset.includes('r2') ? 'GRCh37' : REFERENCE_GENOME
    const cacheKey = `clinvar:${geneSymbol}:${genome}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      try {
        const raw = ClinVarResponseSchema.parse(JSON.parse(cached.data))
        const gene = raw.data.gene
        if (!gene) {
          return { success: false, error: `Gene not found in gnomAD: ${geneSymbol}` }
        }
        return {
          success: true,
          variants: this.transformClinVarVariants(gene.clinvar_variants),
          cacheInfo: { cached: true, cachedAt: cached.createdAt }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        mainLogger.warn(`Corrupted cache entry for ${cacheKey}: ${message}`, 'api')
      }
    }

    try {
      const rawResponse = await this.limiter.schedule(() =>
        this.makeClinVarRequest(geneSymbol, genome)
      )

      const data = ClinVarResponseSchema.parse(rawResponse)
      const gene = data.data.gene

      if (!gene) {
        return { success: false, error: `Gene not found in gnomAD: ${geneSymbol}` }
      }

      // Cache response with 30-day TTL
      this.cache.set(cacheKey, JSON.stringify(rawResponse), CACHE_TTL_DAYS)

      return {
        success: true,
        variants: this.transformClinVarVariants(gene.clinvar_variants),
        cacheInfo: { cached: false, cachedAt: undefined }
      }
    } catch (error) {
      if (
        error !== null &&
        error !== undefined &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'ZodError'
      ) {
        return {
          success: false,
          error: 'Invalid ClinVar response format',
          offline: false
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        offline: false
      }
    }
  }

  /**
   * Make HTTP POST request for ClinVar variants via gnomAD GraphQL API
   *
   * @private
   * @throws Error on non-OK response
   */
  private async makeClinVarRequest(geneSymbol: string, referenceGenome: string): Promise<unknown> {
    const response = await fetch(GNOMAD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: CLINVAR_QUERY,
        variables: {
          geneSymbol,
          referenceGenome
        }
      })
    })

    if (!response.ok) {
      throw new Error(`gnomAD API error: ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Transform raw ClinVar variants into ClinVarVariant objects
   *
   * @private
   */
  private transformClinVarVariants(
    rawVariants: Array<{
      variant_id: string
      clinical_significance?: string | null
      clinvar_variation_id?: string | null
      gold_stars?: number | null
      hgvsp?: string | null
      major_consequence?: string | null
      pos: number
      gnomad?: {
        exome?: { ac: number; an: number } | null
        genome?: { ac: number; an: number } | null
      } | null
    }>
  ): ClinVarVariant[] {
    return rawVariants.map((v) => {
      const proteinPosition = parseProteinPosition(v.hgvsp ?? null)

      // Compute allele frequency from gnomAD data if available
      let alleleFrequency: number | null = null
      const exomeAc = v.gnomad?.exome?.ac ?? 0
      const exomeAn = v.gnomad?.exome?.an ?? 0
      const genomeAc = v.gnomad?.genome?.ac ?? 0
      const genomeAn = v.gnomad?.genome?.an ?? 0
      const totalAc = exomeAc + genomeAc
      const totalAn = Math.max(exomeAn, genomeAn)
      if (totalAn > 0) {
        alleleFrequency = totalAc / totalAn
      }

      return {
        variantId: v.variant_id,
        clinicalSignificance: v.clinical_significance ?? 'not provided',
        clinvarVariationId: v.clinvar_variation_id ?? '',
        goldStars: v.gold_stars ?? 0,
        proteinPosition,
        hgvsp: v.hgvsp ?? null,
        consequence: v.major_consequence ?? 'unknown',
        alleleFrequency,
        genomicPosition: v.pos ?? null
      }
    })
  }

  /**
   * Clear all cached gnomAD responses
   */
  clearCache(): void {
    this.cache.clearByPrefix('gnomad:')
    this.cache.clearByPrefix('clinvar:')
  }
}
