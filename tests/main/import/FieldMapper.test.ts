import { describe, it, expect } from 'vitest'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { FieldMapper, createFieldMapper } from '../../../src/main/import/transforms/FieldMapper'
import type { DataDictionaries } from '../../../src/main/import/config/fieldMapping'
import type { RawVariantRow } from '../../../src/main/import/types'

// Mock dictionaries matching test data
const mockDictionaries: DataDictionaries = {
  gene: {
    '29808': 'LOC100132287',
    '32952': 'LOC101928626',
    '15471': 'BRCA1',
    '15472': 'TP53'
  },
  impact: {
    '1': 'HIGH',
    '2': 'MODERATE',
    '3': 'LOW',
    '4': 'MODIFIER'
  },
  transcript: {
    '1': 'NM_007294.4',
    '2': 'NM_007299.4'
  },
  hpoSimScore: {
    '100': 0.85,
    '200': 0.42
  },
  moi: {
    '1': 'AD',
    '2': 'AR'
  }
}

// Helper to create a test row with specified values
function createTestRow(overrides: Partial<Record<number, unknown>>): RawVariantRow {
  // Initialize row with 109 null values (0-108)
  const row: RawVariantRow = Array(109).fill(null)

  // Set defaults
  row[1] = 0 // selectedTranscript
  row[9] = ['1', 1] // Chr (multi-value)
  row[10] = [12345, 12345] // Pos (multi-value)
  row[11] = 'A' // Ref
  row[12] = 'T' // Alt
  row[21] = ['2', '3'] // Impact (multi-value)
  row[24] = ['29808', '32952'] // Gene (multi-value)
  row[46] = 25.5 // CADD
  row[72] = 'Pathogenic' // ClinVar
  row[108] = 0.0001 // GnomAD AF

  // Apply overrides
  Object.entries(overrides).forEach(([index, value]) => {
    row[Number(index)] = value
  })

  return row
}

// Helper to run transform and collect results
async function runTransform(rows: RawVariantRow[]): Promise<unknown[]> {
  const mapper = createFieldMapper(mockDictionaries)
  const results: unknown[] = []

  // Create readable stream with StreamArray format ({ key, value })
  const readable = Readable.from(
    rows.map((row, index) => ({ key: index, value: row })),
    { objectMode: true }
  )

  // Create writable stream to collect results
  const writable = new Writable({
    objectMode: true,
    write(chunk, encoding, callback) {
      results.push(chunk)
      callback()
    }
  })

  await pipeline(readable, mapper, writable)
  return results
}

describe('FieldMapper', () => {
  describe('Basic field mapping', () => {
    it('should map single-value fields correctly', async () => {
      const row = createTestRow({})
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        ref: 'A',
        alt: 'T',
        gnomad_af: 0.0001,
        cadd: 25.5,
        clinvar: 'Pathogenic'
      })
    })

    it('should handle null values in optional fields', async () => {
      const row = createTestRow({
        46: null, // CADD
        72: null, // ClinVar
        108: null // GnomAD AF
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        gnomad_af: null,
        cadd: null,
        clinvar: null
      })
    })
  })

  describe('Multi-value array extraction', () => {
    it('should extract value at selectedTranscript index', async () => {
      const row = createTestRow({
        1: 1, // selectedTranscript = 1
        9: ['1', '2'], // Chr
        10: [12345, 67890] // Pos
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        chr: '2',
        pos: 67890
      })
    })

    it('should fall back to first element when selectedTranscript is 0', async () => {
      const row = createTestRow({
        1: 0, // selectedTranscript = 0
        9: ['X', 'Y'],
        10: [11111, 22222]
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        chr: 'X',
        pos: 11111
      })
    })

    it('should fall back to first element when selectedTranscript out of bounds', async () => {
      const row = createTestRow({
        1: 5, // selectedTranscript = 5 (out of bounds)
        9: ['MT'],
        10: [99999]
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        chr: 'MT',
        pos: 99999
      })
    })

    it('should handle arrays with single element', async () => {
      const row = createTestRow({
        1: 0,
        9: ['22'],
        10: [55555]
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        chr: '22',
        pos: 55555
      })
    })
  })

  describe('Data dictionary lookups', () => {
    it('should resolve Gene ID to symbol using dictionary', async () => {
      const row = createTestRow({
        1: 0,
        24: ['29808', '32952'] // Gene IDs
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        gene_symbol: 'LOC100132287' // Resolved from mockDictionaries
      })
    })

    it('should resolve second Gene ID when selectedTranscript is 1', async () => {
      const row = createTestRow({
        1: 1,
        24: ['29808', '32952']
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        gene_symbol: 'LOC101928626' // Second gene
      })
    })

    it('should resolve Impact code to label using static dictionary', async () => {
      const row = createTestRow({
        1: 0,
        21: ['1', '2'] // Impact codes
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        consequence: 'HIGH' // Resolved from IMPACT_DICTIONARY
      })
    })

    it('should handle missing dictionary entries gracefully', async () => {
      const row = createTestRow({
        1: 0,
        24: ['99999'] // Unknown gene ID
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        gene_symbol: '99999' // Falls back to string value
      })
    })

    it('should handle null values in dictionary fields', async () => {
      const row = createTestRow({
        1: 0,
        24: [null], // Null gene
        21: [null] // Null impact
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        gene_symbol: null,
        consequence: null
      })
    })
  })

  describe('Validation and error handling', () => {
    it('should skip rows with missing chromosome', async () => {
      const row = createTestRow({
        9: null // Missing chr
      })
      const results = await runTransform([row])

      expect(results).toHaveLength(0)
    })

    it('should skip rows with missing position', async () => {
      const row = createTestRow({
        10: null // Missing pos
      })
      const results = await runTransform([row])

      expect(results).toHaveLength(0)
    })

    it('should skip rows with missing ref', async () => {
      const row = createTestRow({
        11: null // Missing ref
      })
      const results = await runTransform([row])

      expect(results).toHaveLength(0)
    })

    it('should skip rows with missing alt', async () => {
      const row = createTestRow({
        12: null // Missing alt
      })
      const results = await runTransform([row])

      expect(results).toHaveLength(0)
    })

    it('should process valid rows and skip invalid rows in mixed batch', async () => {
      const rows = [
        createTestRow({}), // Valid
        createTestRow({ 9: null }), // Invalid (missing chr)
        createTestRow({ chr: 'X' }), // Valid
        createTestRow({ 11: null }) // Invalid (missing ref)
      ]
      const results = await runTransform(rows)

      expect(results).toHaveLength(2)
    })
  })

  describe('Transform stream interface', () => {
    it('should handle StreamArray format with key/value wrapper', async () => {
      const mapper = createFieldMapper(mockDictionaries)
      const results: unknown[] = []

      const readable = Readable.from(
        [
          { key: 0, value: createTestRow({}) },
          { key: 1, value: createTestRow({ 9: ['X'] }) }
        ],
        { objectMode: true }
      )

      const writable = new Writable({
        objectMode: true,
        write(chunk, encoding, callback) {
          results.push(chunk)
          callback()
        }
      })

      await pipeline(readable, mapper, writable)

      expect(results).toHaveLength(2)
      expect(results[0]).toHaveProperty('chr', '1')
      expect(results[1]).toHaveProperty('chr', 'X')
    })

    it('should operate in objectMode', () => {
      const mapper = createFieldMapper(mockDictionaries)
      expect(mapper.readableObjectMode).toBe(true)
      expect(mapper.writableObjectMode).toBe(true)
    })

    it('should be created using factory function', () => {
      const mapper = createFieldMapper(mockDictionaries)
      expect(mapper).toBeInstanceOf(FieldMapper)
      expect(mapper).toBeInstanceOf(Readable)
      expect(mapper).toBeInstanceOf(Writable)
    })
  })

  describe('extractAllTranscripts (multi-transcript output)', () => {
    it('should emit _transcripts array with all transcript entries', async () => {
      const row = createTestRow({
        1: 0, // selectedTranscript = 0
        28: ['1', '2'], // Transcript IDs (use dictionary)
        24: ['29808', '32952'], // Gene IDs (use dictionary)
        21: ['2', '3'], // Impact codes (use dictionary)
        29: ['c.123A>G', 'c.456C>T'], // cDNA
        30: ['p.His41Arg', null] // AA change
      })

      const results = await runTransform([row])
      expect(results).toHaveLength(1)

      const variant = results[0] as Record<string, unknown>
      const transcripts = variant._transcripts as Record<string, unknown>[]
      expect(transcripts).toHaveLength(2)
      expect(transcripts[0].is_selected).toBe(1)
      expect(transcripts[1].is_selected).toBe(0)
    })

    it('should resolve dictionaries for transcript fields', async () => {
      const row = createTestRow({
        1: 0,
        28: ['1', '2'], // → transcript dict lookup
        24: ['29808', '32952'], // → gene dict lookup
        21: ['1', '2'] // → IMPACT_DICTIONARY: 1=HIGH, 2=MODERATE
      })

      const results = await runTransform([row])
      const variant = results[0] as Record<string, unknown>
      const transcripts = variant._transcripts as Record<string, unknown>[]

      // Transcript IDs should be resolved via transcript dictionary
      expect(transcripts[0].transcript_id).toBe('NM_007294.4')
      expect(transcripts[1].transcript_id).toBe('NM_007299.4')
      // Gene symbols should be resolved via gene dictionary
      expect(transcripts[0].gene_symbol).toBe('LOC100132287')
      expect(transcripts[1].gene_symbol).toBe('LOC101928626')
      // Consequences should be resolved via IMPACT_DICTIONARY
      expect(transcripts[0].consequence).toBe('HIGH')
      expect(transcripts[1].consequence).toBe('MODERATE')
    })

    it('extracts the per-transcript func (SO term) from the FUNC column', async () => {
      const row = createTestRow({
        1: 0,
        28: ['1', '2'], // Transcript IDs
        20: ['missense_variant', 'synonymous_variant'] // FUNC (SO term), per-transcript
      })

      const results = await runTransform([row])
      const variant = results[0] as Record<string, unknown>
      const transcripts = variant._transcripts as Record<string, unknown>[]

      // func = SO term (raw, no dictionary), matching the same per-transcript
      // index as consequence/cdna/aa_change — NOT the IMPACT dictionary value.
      expect(transcripts[0].func).toBe('missense_variant')
      expect(transcripts[1].func).toBe('synonymous_variant')
    })

    it('rejects unknown IMPACT codes for the parent and transcript rows', async () => {
      const row = createTestRow({
        21: ['99'],
        20: ['missense_variant'],
        28: ['1']
      })

      const results = await runTransform([row])
      const variant = results[0] as Record<string, unknown>
      const transcripts = variant._transcripts as Record<string, unknown>[]

      expect(variant.consequence).toBeNull()
      expect(variant.func).toBe('missense_variant')
      expect(transcripts[0]).toMatchObject({
        consequence: null,
        func: 'missense_variant'
      })
    })

    it('should emit single transcript for non-array columns', async () => {
      const row = createTestRow({
        1: 0,
        28: '1' // Not an array — single value (dict key)
      })

      const results = await runTransform([row])
      const variant = results[0] as Record<string, unknown>
      const transcripts = variant._transcripts as Record<string, unknown>[]
      expect(transcripts).toHaveLength(1)
      expect(transcripts[0].is_selected).toBe(1)
    })

    it('should not emit _transcripts when transcript column is null', async () => {
      const row = createTestRow({
        1: 0,
        28: null
      })

      const results = await runTransform([row])
      const variant = results[0] as Record<string, unknown>
      expect(variant._transcripts).toBeUndefined()
    })
  })

  describe('Complete variant mapping', () => {
    it('should map complete variant with all fields', async () => {
      const row = createTestRow({
        1: 0,
        9: ['17'],
        10: [43044295],
        11: 'G',
        12: 'A',
        21: ['1'], // HIGH
        24: ['15471'], // BRCA1
        46: 35.0,
        72: 'Pathogenic',
        108: 0.00001
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        chr: '17',
        pos: 43044295,
        ref: 'G',
        alt: 'A',
        gene_symbol: 'BRCA1',
        consequence: 'HIGH',
        cadd: 35.0,
        clinvar: 'Pathogenic',
        gnomad_af: 0.00001
      })
    })

    it('should map variant with minimal required fields', async () => {
      const row = createTestRow({
        1: 0,
        9: ['Y'],
        10: [2655180],
        11: 'C',
        12: 'T',
        21: null,
        24: null,
        46: null,
        72: null,
        108: null
      })
      const [result] = await runTransform([row])

      expect(result).toMatchObject({
        chr: 'Y',
        pos: 2655180,
        ref: 'C',
        alt: 'T',
        gene_symbol: null,
        consequence: null,
        cadd: null,
        clinvar: null,
        gnomad_af: null
      })
    })
  })
})
