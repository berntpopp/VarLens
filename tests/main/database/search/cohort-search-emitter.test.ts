import Database from 'better-sqlite3-multiple-ciphers'
import { describe, it, expect } from 'vitest'
import { emitCohortSearch } from '../../../../src/main/database/search/cohort-search-emitter'
import { tokenize, parse } from '../../../../src/shared/utils/boolean-search'

function emit(input: string) {
  return emitCohortSearch(parse(tokenize(input)))
}

describe('emitCohortSearch', () => {
  it('emits LIKE conditions for single term', () => {
    const { sql, params } = emit('BRCA1')
    expect(sql).toContain('LIKE ?')
    expect(params).toEqual(['%BRCA1%', '%BRCA1%', '%BRCA1%'])
  })

  it('emits AND between two terms', () => {
    const { sql, params } = emit('BRCA1 AND TP53')
    expect(sql).toContain('AND')
    expect(params).toEqual(['%BRCA1%', '%BRCA1%', '%BRCA1%', '%TP53%', '%TP53%', '%TP53%'])
  })

  it('emits OR between two terms', () => {
    const { sql, params } = emit('BRCA1 OR TP53')
    expect(sql).toContain('OR')
    expect(params).toEqual(['%BRCA1%', '%BRCA1%', '%BRCA1%', '%TP53%', '%TP53%', '%TP53%'])
  })

  it('emits NOT correctly for A OR NOT B', () => {
    const { sql, params } = emit('BRCA1 OR NOT TP53')
    expect(sql).toContain('OR')
    expect(sql).toContain('NOT')
    expect(params).toEqual(['%BRCA1%', '%BRCA1%', '%BRCA1%', '%TP53%', '%TP53%', '%TP53%'])
    // The bug: old code emitted "OR AND NOT" — verify it's gone
    expect(sql).not.toMatch(/OR\s+AND\s+NOT/)
  })

  it('handles genomic coordinate pattern', () => {
    const { sql, params } = emit('chr1:12345')
    // Import stores `chr` verbatim, so both spellings must match (#492).
    expect(sql).toBe('(cvs.chr IN (?, ?) AND cvs.pos = ?)')
    expect(params).toEqual(['1', 'chr1', 12345])
    expect(emit('x:5').params).toEqual(['X', 'chrX', 5])
  })

  it('handles HGVS pattern', () => {
    const { sql, params } = emit('c.1234A>G')
    expect(sql).toContain('LIKE ?')
    expect(params).toEqual(['%c.1234A>G%', '%c.1234A>G%'])
  })

  it('takes _ and % in an HGVS term literally', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`CREATE TABLE cvs (cdna TEXT, aa_change TEXT);
               INSERT INTO cvs (cdna) VALUES ('c.1_2del'), ('c.112del'), ('c.1%2del')`)
      const found = (term: string): unknown[] => {
        const { sql, params } = emit(term)
        return db
          .prepare(`SELECT cdna FROM cvs WHERE ${sql} ORDER BY cdna`)
          .pluck()
          .all(...params)
      }

      expect(found('c.1_2del')).toEqual(['c.1_2del'])
      expect(found('c.1%2del')).toEqual(['c.1%2del'])
      expect(found('c.1')).toHaveLength(3)
    } finally {
      db.close()
    }
  })
})
