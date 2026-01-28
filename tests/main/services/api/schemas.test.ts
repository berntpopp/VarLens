/**
 * Tests for VEP and HPO API response schemas
 */

import { describe, it, expect } from 'vitest'
import { VepResponseSchema } from '../../../../src/main/services/api/schemas/vep-response'
import {
  HpoAutocompleteResponseSchema,
  HpoTermTupleSchema
} from '../../../../src/main/services/api/schemas/hpo-response'

describe('VEP Response Schemas', () => {
  it('should parse valid VEP response with transcript consequences', () => {
    const sampleResponse = [
      {
        input: '1:100:A:T',
        transcript_consequences: [
          {
            transcript_id: 'ENST00000123456',
            gene_symbol: 'BRCA1',
            consequence_terms: ['missense_variant'],
            impact: 'MODERATE' as const,
            cadd_phred: 25.3,
            revel_score: 0.85,
            gnomad_af: 0.0001
          }
        ],
        most_severe_consequence: 'missense_variant'
      }
    ]

    const result = VepResponseSchema.parse(sampleResponse)
    expect(result).toHaveLength(1)
    expect(result[0].input).toBe('1:100:A:T')
    expect(result[0].transcript_consequences).toHaveLength(1)
    expect(result[0].transcript_consequences![0].gene_symbol).toBe('BRCA1')
    expect(result[0].transcript_consequences![0].cadd_phred).toBe(25.3)
  })

  it('should parse VEP response with missing optional fields', () => {
    const minimalResponse = [
      {
        input: '1:200:G:C'
        // No transcript_consequences - intergenic variant
        // No most_severe_consequence
      }
    ]

    const result = VepResponseSchema.parse(minimalResponse)
    expect(result).toHaveLength(1)
    expect(result[0].input).toBe('1:200:G:C')
    expect(result[0].transcript_consequences).toBeUndefined()
    expect(result[0].most_severe_consequence).toBeUndefined()
  })

  it('should parse VEP response with SpliceAI scores', () => {
    const spliceAIResponse = [
      {
        input: '2:300:A:G',
        transcript_consequences: [
          {
            transcript_id: 'ENST00000789012',
            gene_symbol: 'TP53',
            consequence_terms: ['splice_region_variant'],
            impact: 'HIGH' as const,
            spliceai_pred_ds_ag: 0.95,
            spliceai_pred_ds_al: 0.02,
            spliceai_pred_ds_dg: 0.01,
            spliceai_pred_ds_dl: 0.88
          }
        ]
      }
    ]

    const result = VepResponseSchema.parse(spliceAIResponse)
    const tc = result[0].transcript_consequences![0]
    expect(tc.spliceai_pred_ds_ag).toBe(0.95)
    expect(tc.spliceai_pred_ds_dl).toBe(0.88)
  })

  it('should parse VEP response with MANE Select transcript', () => {
    const maneResponse = [
      {
        input: '3:400:T:C',
        transcript_consequences: [
          {
            transcript_id: 'ENST00000456789',
            gene_symbol: 'BRCA2',
            consequence_terms: ['missense_variant'],
            mane_select: 'ENST00000456789.1',
            canonical: 1
          }
        ]
      }
    ]

    const result = VepResponseSchema.parse(maneResponse)
    const tc = result[0].transcript_consequences![0]
    expect(tc.mane_select).toBe('ENST00000456789.1')
    expect(tc.canonical).toBe(1)
  })

  it('should reject VEP response with malformed structure', () => {
    const malformedResponse = [
      {
        // Missing required 'input' field
        transcript_consequences: []
      }
    ]

    expect(() => VepResponseSchema.parse(malformedResponse)).toThrow()
  })

  it('should reject VEP response with invalid impact value', () => {
    const invalidImpact = [
      {
        input: '1:100:A:T',
        transcript_consequences: [
          {
            transcript_id: 'ENST00000123456',
            consequence_terms: ['missense_variant'],
            impact: 'INVALID' // Not in enum
          }
        ]
      }
    ]

    expect(() => VepResponseSchema.parse(invalidImpact)).toThrow()
  })
})

describe('HPO Autocomplete Response Schema', () => {
  it('should parse valid HPO autocomplete response', () => {
    const sampleResponse = [
      3, // total count
      ['HP:0001250', 'HP:0002104', 'HP:0012469'], // id array
      null, // extra data
      [
        ['HP:0001250', 'Seizure'],
        ['HP:0002104', 'Apnea'],
        ['HP:0012469', 'Infantile spasms']
      ] // terms
    ]

    const result = HpoAutocompleteResponseSchema.parse(sampleResponse)
    expect(result[0]).toBe(3) // total count
    expect(result[1]).toHaveLength(3) // id array
    expect(result[2]).toBeNull() // extra data
    expect(result[3]).toHaveLength(3) // terms array
    expect(result[3][0]).toEqual(['HP:0001250', 'Seizure'])
  })

  it('should parse empty HPO response', () => {
    const emptyResponse = [
      0, // no results
      [], // empty id array
      null,
      [] // empty terms array
    ]

    const result = HpoAutocompleteResponseSchema.parse(emptyResponse)
    expect(result[0]).toBe(0)
    expect(result[1]).toHaveLength(0)
    expect(result[3]).toHaveLength(0)
  })

  it('should reject HPO response with wrong structure', () => {
    const wrongStructure = {
      // Object instead of tuple
      count: 3,
      terms: [['HP:0001250', 'Seizure']]
    }

    expect(() => HpoAutocompleteResponseSchema.parse(wrongStructure)).toThrow()
  })

  it('should reject HPO response with malformed term tuples', () => {
    const malformedTerms = [
      1,
      ['HP:0001250'],
      null,
      [
        ['HP:0001250'] // Missing name (should be 2-element tuple)
      ]
    ]

    expect(() => HpoAutocompleteResponseSchema.parse(malformedTerms)).toThrow()
  })

  it('should parse HPO term tuple correctly', () => {
    const term = ['HP:0001250', 'Seizure']
    const result = HpoTermTupleSchema.parse(term)
    expect(result[0]).toBe('HP:0001250')
    expect(result[1]).toBe('Seizure')
  })
})
