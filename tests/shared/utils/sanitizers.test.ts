import { describe, it, expect } from 'vitest'
import { sanitizeLogMessage } from '../../../src/shared/utils/sanitizers'

describe('sanitizeLogMessage', () => {
  describe('HGVS redaction', () => {
    it('redacts HGVS coding notation', () => {
      const result = sanitizeLogMessage('Variant c.123A>G found')
      expect(result).toContain('[REDACTED:HGVS]')
      expect(result).not.toContain('c.123A>G')
    })

    it('redacts HGVS genomic notation', () => {
      const result = sanitizeLogMessage('Position g.12345C>T annotated')
      expect(result).toContain('[REDACTED:HGVS]')
    })
  })

  describe('genomic coordinate redaction', () => {
    it('redacts chr:pos coordinates', () => {
      const result = sanitizeLogMessage('Variant at chr1:12345 processed')
      expect(result).toContain('[REDACTED:COORD]')
      expect(result).not.toContain('chr1:12345')
    })

    it('redacts chr:pos-end range coordinates', () => {
      const result = sanitizeLogMessage('Region X:12345-67890 imported')
      expect(result).toContain('[REDACTED:COORD]')
    })
  })

  describe('patient/sample ID redaction', () => {
    it('redacts PATIENT- prefixed identifiers', () => {
      const result = sanitizeLogMessage('Loading PATIENT-12345 record')
      expect(result).toContain('[REDACTED:ID]')
      expect(result).not.toContain('PATIENT-12345')
    })

    it('redacts SAMPLE_ prefixed identifiers', () => {
      const result = sanitizeLogMessage('Importing SAMPLE_ABC123 now')
      expect(result).toContain('[REDACTED:ID]')
    })
  })

  describe('key/password redaction (defense-in-depth, S8)', () => {
    it('redacts a quoted SQLcipher key= value', () => {
      const result = sanitizeLogMessage("pragma key='S3cr3tPass!' done")
      expect(result).toContain('[REDACTED:KEY]')
      expect(result).not.toContain('S3cr3tPass!')
      expect(result).toContain('done')
    })

    it('redacts a quoted rekey= value', () => {
      const result = sanitizeLogMessage("running rekey='N3wSecret$' now")
      expect(result).toContain('[REDACTED:KEY]')
      expect(result).not.toContain('N3wSecret$')
    })

    it('redacts a double-quoted PRAGMA key = "..." value', () => {
      const result = sanitizeLogMessage('PRAGMA key = "TopSecretValue123"')
      expect(result).toContain('[REDACTED:KEY]')
      expect(result).not.toContain('TopSecretValue123')
    })

    it('redacts an unquoted password: value', () => {
      const result = sanitizeLogMessage('password: hunter2')
      expect(result).toContain('[REDACTED:KEY]')
      expect(result).not.toContain('hunter2')
    })

    it('redacts an unquoted password= value', () => {
      const result = sanitizeLogMessage('config password=hunter2;retry=1')
      expect(result).toContain('[REDACTED:KEY]')
      expect(result).not.toContain('hunter2')
      expect(result).toContain('retry=1')
    })

    it('redacts a passphrase value', () => {
      const result = sanitizeLogMessage("connecting with passphrase='MyLongPhrase'")
      expect(result).toContain('[REDACTED:KEY]')
      expect(result).not.toContain('MyLongPhrase')
    })

    it('redacts a secret= value', () => {
      const result = sanitizeLogMessage('secret=abc123XYZ found in env')
      expect(result).toContain('[REDACTED:KEY]')
      expect(result).not.toContain('abc123XYZ')
    })

    it('redacts a token= value', () => {
      const result = sanitizeLogMessage('token=ghp_abcdef1234567890 sent')
      expect(result).toContain('[REDACTED:KEY]')
      expect(result).not.toContain('ghp_abcdef1234567890')
    })

    it('does not over-redact the bare word "key" with no value', () => {
      const result = sanitizeLogMessage('the key insight is that imports are slow')
      expect(result).not.toContain('[REDACTED:KEY]')
      expect(result).toBe('the key insight is that imports are slow')
    })

    it('does not over-redact "key" used as a plain object property name in prose', () => {
      const result = sanitizeLogMessage('cache key lookup missed for entry 42')
      expect(result).not.toContain('[REDACTED:KEY]')
    })

    it('does not over-redact an unquoted "key:"/"key=" in ordinary prose (specificity tradeoff)', () => {
      // Unlike password/secret/token, "key" is common enough in normal log
      // text (sort key, cache key, map key: value) that only the quoted
      // SQLcipher pragma form is redacted — an unquoted key=/key: is left
      // alone even though this means an unquoted, non-quoted secret value
      // assigned via a bare "key=" would not be caught by this pattern.
      const sortResult = sanitizeLogMessage('sort key: chromosome')
      expect(sortResult).not.toContain('[REDACTED:KEY]')
      expect(sortResult).toBe('sort key: chromosome')

      const mapResult = sanitizeLogMessage('map key=geneId resolved')
      expect(mapResult).not.toContain('[REDACTED:KEY]')
      expect(mapResult).toBe('map key=geneId resolved')
    })

    it('preserves surrounding text outside the redacted value', () => {
      const result = sanitizeLogMessage("opening db with key='abc' before import")
      expect(result).toContain('[REDACTED:KEY]')
      expect(result).not.toContain("'abc'")
      expect(result.startsWith('opening db with key=')).toBe(true)
      expect(result.endsWith('before import')).toBe(true)
    })
  })

  describe('interaction with existing PHI redaction', () => {
    it('still redacts HGVS notation unchanged when no key/password present', () => {
      const result = sanitizeLogMessage('Variant c.123A>G found')
      expect(result).toBe('Variant [REDACTED:HGVS] found')
    })

    it('still redacts genomic coordinates unchanged when no key/password present', () => {
      const result = sanitizeLogMessage('Variant at chr1:12345 processed')
      expect(result).toBe('Variant at [REDACTED:COORD] processed')
    })

    it('still redacts patient IDs unchanged when no key/password present', () => {
      const result = sanitizeLogMessage('Loading PATIENT-12345 record')
      expect(result).toBe('Loading [REDACTED:ID] record')
    })

    it('redacts both a key and PHI in the same message', () => {
      const result = sanitizeLogMessage("key='S3cr3t' for PATIENT-12345 at chr1:12345")
      expect(result).toContain('[REDACTED:KEY]')
      expect(result).toContain('[REDACTED:ID]')
      expect(result).toContain('[REDACTED:COORD]')
      expect(result).not.toContain('S3cr3t')
    })
  })
})
