import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import {
  createCaseAnnotationBatchLookup,
  createCohortAnnotationBatchLookup
} from '../../../src/main/database/annotation-export-lookup'

describe('annotation-export-lookup', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE cases (
        id INTEGER PRIMARY KEY,
        genome_build TEXT
      );
      CREATE TABLE case_variant_annotations (
        case_id INTEGER,
        variant_id INTEGER,
        acmg_classification TEXT,
        acmg_evidence TEXT,
        per_case_comment TEXT
      );
      CREATE TABLE variant_annotations (
        chr TEXT,
        pos INTEGER,
        ref TEXT,
        alt TEXT,
        genome_build TEXT,
        acmg_classification TEXT,
        acmg_evidence TEXT,
        global_comment TEXT
      );
    `)

    db.prepare('INSERT INTO cases (id, genome_build) VALUES (?, ?)').run(1, 'GRCh38')
    db.prepare(
      'INSERT INTO case_variant_annotations (case_id, variant_id, acmg_classification, per_case_comment) VALUES (?, ?, ?, ?)'
    ).run(1, 101, 'Pathogenic', 'case note')

    db.prepare(
      'INSERT INTO variant_annotations (chr, pos, ref, alt, genome_build, acmg_classification, global_comment) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('1', 100, 'A', 'T', 'GRCh38', 'Likely pathogenic', 'global note')
  })

  afterEach(() => {
    db.close()
  })

  describe('createCaseAnnotationBatchLookup', () => {
    it('batches coordinate queries and returns matching annotation cells', () => {
      const lookup = createCaseAnnotationBatchLookup(db, 1)
      const rows = [
        { id: 101, case_id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T' },
        { id: 102, case_id: 1, chr: '1', pos: 200, ref: 'C', alt: 'G' }
      ]
      const results = lookup(rows)
      expect(results.get(101)).toEqual({
        acmg_classification: 'Pathogenic',
        acmg_points: null,
        acmg_override_reason: null,
        case_comment: 'case note',
        global_comment: 'global note'
      })
      expect(results.get(102)).toEqual({
        acmg_classification: null,
        acmg_points: null,
        acmg_override_reason: null,
        case_comment: null,
        global_comment: null
      })
    })

    it('queries case_variant_annotations and variant_annotations in chunks of 200 (O(chunks) queries)', () => {
      const prepareSpy = vi.spyOn(db, 'prepare')
      const lookup = createCaseAnnotationBatchLookup(db, 1)
      prepareSpy.mockClear()

      // Create 450 rows => ceil(450 / 200) = 3 chunks
      const rows = Array.from({ length: 450 }, (_, i) => ({
        id: i + 1,
        case_id: 1,
        chr: '1',
        pos: 1000 + i,
        ref: 'A',
        alt: 'T'
      }))

      lookup(rows)

      const caseAnnQueries = prepareSpy.mock.calls.filter(([sql]) =>
        String(sql).includes('FROM case_variant_annotations')
      )
      const globalAnnQueries = prepareSpy.mock.calls.filter(([sql]) =>
        String(sql).includes('FROM variant_annotations')
      )

      expect(caseAnnQueries.length).toBe(3)
      expect(globalAnnQueries.length).toBe(3)
    })
  })

  describe('createCohortAnnotationBatchLookup', () => {
    it('createCohortAnnotationBatchLookup returns batch results', () => {
      const lookup = createCohortAnnotationBatchLookup(db)
      const rows = [
        { id: 1, chr: '1', pos: 100, ref: 'A', alt: 'T', genome_build: 'GRCh38' },
        { id: 2, chr: '1', pos: 100, ref: 'A', alt: 'T', genome_build: 'GRCh37' }
      ]
      const results = lookup(rows)
      expect(results.get(1)).toEqual({
        acmg_classification: 'Likely pathogenic',
        acmg_points: null,
        acmg_override_reason: null,
        global_comment: 'global note'
      })
      expect(results.get(2)).toEqual({
        acmg_classification: null,
        acmg_points: null,
        acmg_override_reason: null,
        global_comment: null
      })
    })

    it('queries variant_annotations in chunks of 200 (O(chunks) queries)', () => {
      const prepareSpy = vi.spyOn(db, 'prepare')
      const lookup = createCohortAnnotationBatchLookup(db)
      prepareSpy.mockClear()

      const rows = Array.from({ length: 450 }, (_, i) => ({
        id: i + 1,
        chr: '1',
        pos: 1000 + i,
        ref: 'A',
        alt: 'T',
        genome_build: 'GRCh38'
      }))

      lookup(rows)

      const globalAnnQueries = prepareSpy.mock.calls.filter(([sql]) =>
        String(sql).includes('variant_annotations')
      )
      expect(globalAnnQueries.length).toBe(3)
    })
  })
})
