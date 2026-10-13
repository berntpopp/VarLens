/**
 * STRING DB API client for protein-protein interaction network queries
 *
 * Fetches interaction partners for seed genes from STRING database.
 * Uses POST requests with form data. 30s timeout (StringDB can be slow).
 *
 * API docs: https://string-db.org/help/api/
 */

import { z } from 'zod'
import { mainLogger } from '../MainLogger'
import { apiFetch } from './http-fetch'

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation of API responses
// ---------------------------------------------------------------------------

const StringDbInteractionSchema = z
  .object({
    preferredName_A: z.string(),
    preferredName_B: z.string(),
    score: z.number()
  })
  .passthrough()

const StringDbResponseSchema = z.array(StringDbInteractionSchema)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StringDbInteraction {
  stringId_A: string
  stringId_B: string
  preferredName_A: string
  preferredName_B: string
  ncbiTaxonId: number
  score: number
  nscore: number
  fscore: number
  pscore: number
  ascore: number
  escore: number
  dscore: number
  tscore: number
}

export interface StringDbPartner {
  symbol: string
  score: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'https://string-db.org/api/json'
const TIMEOUT_MS = 30_000
const SPECIES_HUMAN = 9606

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class StringDbClient {
  /**
   * Get interaction partners for a set of seed genes.
   *
   * Queries STRING DB for protein-protein interactions, then extracts
   * unique partner gene symbols (excluding seed genes) sorted by score.
   *
   * @param genes       - Array of gene symbols to query
   * @param options     - Score threshold and network type
   * @returns Partners sorted by score descending (excludes seed genes)
   */
  async getInteractionPartners(
    genes: string[],
    options: { requiredScore: number; networkType: 'physical' | 'functional' }
  ): Promise<StringDbPartner[]> {
    if (genes.length === 0) return []

    const interactions = await this.fetchInteractions(genes, options)

    // Build a set of seed genes for exclusion (case-insensitive)
    const seedSet = new Set(genes.map((g) => g.toUpperCase()))

    // Collect best score per partner symbol
    const partnerMap = new Map<string, number>()

    for (const interaction of interactions) {
      // Check both sides of the interaction
      for (const name of [interaction.preferredName_A, interaction.preferredName_B]) {
        if (!seedSet.has(name.toUpperCase())) {
          const existing = partnerMap.get(name)
          if (existing === undefined || interaction.score > existing) {
            partnerMap.set(name, interaction.score)
          }
        }
      }
    }

    // Sort by score descending
    const partners: StringDbPartner[] = Array.from(partnerMap.entries())
      .map(([symbol, score]) => ({ symbol, score }))
      .sort((a, b) => b.score - a.score)

    mainLogger.debug(
      `StringDB: ${genes.length} seed genes -> ${partners.length} partners (score >= ${options.requiredScore})`,
      'api'
    )

    return partners
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async fetchInteractions(
    genes: string[],
    options: { requiredScore: number; networkType: 'physical' | 'functional' }
  ): Promise<StringDbInteraction[]> {
    const url = `${BASE_URL}/interaction_partners`

    // Build form data
    const formData = new URLSearchParams()
    formData.set('identifiers', genes.join('\n'))
    formData.set('species', String(SPECIES_HUMAN))
    formData.set('required_score', String(options.requiredScore))
    formData.set('network_type', options.networkType)

    mainLogger.debug(
      `StringDB query: ${genes.length} genes, score=${options.requiredScore}, type=${options.networkType}`,
      'api'
    )

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await apiFetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        headers: {
          Accept: 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`StringDB API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()

      const parseResult = StringDbResponseSchema.safeParse(data)
      if (!parseResult.success) {
        mainLogger.warn(`StringDB response validation failed: ${parseResult.error.message}`, 'api')
        return []
      }

      return parseResult.data as unknown as StringDbInteraction[]
    } finally {
      clearTimeout(timer)
    }
  }
}
