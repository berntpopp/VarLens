/**
 * Zod schema for NLM Clinical Tables HPO autocomplete API responses
 *
 * The HPO autocomplete API returns a tuple format:
 * [total_count, id_array, extra_data, terms_array]
 *
 * Reference: https://clinicaltables.nlm.nih.gov/apidoc/hpo/v3/doc.html
 */

import { z } from 'zod'

/**
 * HPO term schema - represents a single HPO term as [id, name] tuple
 */
export const HpoTermTupleSchema = z.tuple([
  z.string(), // HPO ID (e.g., "HP:0001250")
  z.string() // Term name (e.g., "Seizure")
])

/**
 * HPO autocomplete response schema
 * Tuple format: [total_count, id_array, extra_data, terms]
 */
export const HpoAutocompleteResponseSchema = z.tuple([
  z.number(), // Total count of matching terms
  z.array(z.string()), // Array of HPO IDs (for quick lookup)
  z.null(), // Extra data (always null for HPO API)
  z.array(HpoTermTupleSchema) // Array of [id, name] tuples
])

export type HpoAutocompleteResponse = z.infer<typeof HpoAutocompleteResponseSchema>

/**
 * Parsed HPO term for application use
 * Transformed from tuple format to object for better ergonomics
 */
export interface HpoTerm {
  /** HPO ID in format HP:XXXXXXX */
  id: string
  /** Human-readable term name */
  name: string
}
