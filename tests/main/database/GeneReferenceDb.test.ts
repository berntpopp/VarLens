import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import { GeneReferenceDb } from '../../../src/main/database/GeneReferenceDb'

describe('GeneReferenceDb', () => {
  let db: InstanceType<typeof Database>
  let geneRef: GeneReferenceDb

  beforeAll(() => {
    const dbPath = join(__dirname, '..', '..', '..', 'resources', 'gene_reference.db')
    db = new Database(dbPath, { readonly: true })
    geneRef = new GeneReferenceDb(db)
  })

  afterAll(() => {
    db.close()
  })

  describe('validateSymbol', () => {
    it('resolves an approved symbol', () => {
      const result = geneRef.validateSymbol('BRCA1')
      expect(result.status).toBe('approved')
      expect(result.symbol).toBe('BRCA1')
      expect(result.hgncId).toBe('HGNC:1100')
      expect(result.name).toBe('BRCA1 DNA repair associated')
      expect(result.locusGroup).toBe('protein-coding gene')
    })

    it('resolves a known alias_symbol', () => {
      const result = geneRef.validateSymbol('RNF53')
      expect(result.status).toBe('alias')
      expect(result.symbol).toBe('BRCA1')
      expect(result.hgncId).toBe('HGNC:1100')
      expect(result.currentSymbol).toBe('BRCA1')
      expect(result.aliasType).toBe('alias_symbol')
    })

    it('returns unknown for a nonexistent symbol', () => {
      const result = geneRef.validateSymbol('NOTAREALGENE999')
      expect(result.status).toBe('unknown')
      expect(result.input).toBe('NOTAREALGENE999')
      expect(result.symbol).toBeUndefined()
      expect(result.hgncId).toBeUndefined()
    })

    it('is case-insensitive', () => {
      const result = geneRef.validateSymbol('brca1')
      expect(result.status).toBe('approved')
      expect(result.symbol).toBe('BRCA1')
    })

    it('resolves case-insensitive alias', () => {
      const result = geneRef.validateSymbol('rnf53')
      expect(result.status).toBe('alias')
      expect(result.symbol).toBe('BRCA1')
    })

    it('trims whitespace from input', () => {
      const result = geneRef.validateSymbol('  BRCA1  ')
      expect(result.status).toBe('approved')
      expect(result.symbol).toBe('BRCA1')
    })
  })

  describe('validateSymbols', () => {
    it('validates a batch of mixed symbols', () => {
      const results = geneRef.validateSymbols(['BRCA1', 'RNF53', 'NOTAREALGENE999', 'TP53'])
      expect(results).toHaveLength(4)
      expect(results[0].status).toBe('approved')
      expect(results[0].symbol).toBe('BRCA1')
      expect(results[1].status).toBe('alias')
      expect(results[1].currentSymbol).toBe('BRCA1')
      expect(results[2].status).toBe('unknown')
      expect(results[3].status).toBe('approved')
      expect(results[3].symbol).toBe('TP53')
    })

    it('returns empty array for empty input', () => {
      const results = geneRef.validateSymbols([])
      expect(results).toEqual([])
    })

    it('preserves duplicate inputs and exact input casing in results', () => {
      const inputs = ['  BRCA1  ', 'brca1', 'BRCA1', 'RNF53', 'rnf53']
      const results = geneRef.validateSymbols(inputs)
      expect(results).toHaveLength(5)
      expect(results[0]).toMatchObject({ input: 'BRCA1', status: 'approved', symbol: 'BRCA1' })
      expect(results[1]).toMatchObject({ input: 'brca1', status: 'approved', symbol: 'BRCA1' })
      expect(results[2]).toMatchObject({ input: 'BRCA1', status: 'approved', symbol: 'BRCA1' })
      expect(results[3]).toMatchObject({ input: 'RNF53', status: 'alias', symbol: 'BRCA1' })
      expect(results[4]).toMatchObject({ input: 'rnf53', status: 'alias', symbol: 'BRCA1' })
    })

    it('handles batch size exceeding chunk limit (>500 unique symbols) (#672)', () => {
      // 550 unique unknown symbols + approved symbols to exercise batch chunking across >500 queries
      const largeList = Array.from({ length: 552 }, (_, i) => {
        if (i === 0) return 'BRCA1'
        if (i === 1) return 'TP53'
        return `UNKNOWN_GENE_${i - 2}`
      })
      const results = geneRef.validateSymbols(largeList)
      expect(results).toHaveLength(552)
      expect(results[0]).toMatchObject({ input: 'BRCA1', status: 'approved', symbol: 'BRCA1' })
      expect(results[1]).toMatchObject({ input: 'TP53', status: 'approved', symbol: 'TP53' })
      for (let i = 2; i < 552; i++) {
        expect(results[i].status).toBe('unknown')
      }
    })

    it('matches SQLite COLLATE NOCASE ASCII folding without Unicode collision (Kelvin bug #672)', () => {
      const kelvinKrt1 = '\u212ART1' // 'KRT1' with Kelvin sign
      const asciiKrt1 = 'KRT1'

      const r1 = geneRef.validateSymbols([kelvinKrt1, asciiKrt1])
      expect(r1).toHaveLength(2)
      expect(r1[0]).toMatchObject({ input: kelvinKrt1, status: 'unknown' })
      expect(r1[1]).toMatchObject({ input: asciiKrt1, status: 'approved', symbol: 'KRT1' })

      const r2 = geneRef.validateSymbols([asciiKrt1, kelvinKrt1])
      expect(r2).toHaveLength(2)
      expect(r2[0]).toMatchObject({ input: asciiKrt1, status: 'approved', symbol: 'KRT1' })
      expect(r2[1]).toMatchObject({ input: kelvinKrt1, status: 'unknown' })
    })

    it('handles ambiguous alias in batch validation (#672)', () => {
      const results = geneRef.validateSymbols(['2F1', '2f1'])
      expect(results).toHaveLength(2)
      expect(results[0].status).toBe('ambiguous')
      expect(results[0].input).toBe('2F1')
      expect(results[0].candidates?.length).toBeGreaterThan(1)
      expect(results[1].status).toBe('ambiguous')
      expect(results[1].input).toBe('2f1')
      expect(results[1].candidates?.length).toBeGreaterThan(1)
    })

    it('deduplicates case variations before chunking (>500 items) (#672)', () => {
      const list: string[] = []
      for (let i = 0; i < 300; i++) {
        list.push(`GENE_${i}`)
        list.push(`gene_${i}`)
      }
      list.push('BRCA1', 'brca1')
      const results = geneRef.validateSymbols(list)
      expect(results).toHaveLength(602)
      expect(results[600]).toMatchObject({ input: 'BRCA1', status: 'approved', symbol: 'BRCA1' })
      expect(results[601]).toMatchObject({ input: 'brca1', status: 'approved', symbol: 'BRCA1' })
    })
  })

  describe('autocomplete', () => {
    it('returns symbol matches for prefix query', () => {
      const results = geneRef.autocomplete('BRCA')
      expect(results.length).toBeGreaterThan(0)

      const symbols = results.map((r) => r.symbol)
      expect(symbols).toContain('BRCA1')
      expect(symbols).toContain('BRCA2')
    })

    it('returns alias matches', () => {
      const results = geneRef.autocomplete('RNF53')
      expect(results.length).toBeGreaterThan(0)

      const brca1Match = results.find((r) => r.symbol === 'BRCA1')
      expect(brca1Match).toBeDefined()
      expect(brca1Match!.matchType).toBe('alias')
      expect(brca1Match!.matchedAlias).toBe('RNF53')
    })

    it('returns empty for no matches', () => {
      const results = geneRef.autocomplete('ZZZZNOTREAL')
      expect(results).toEqual([])
    })

    it('respects limit parameter', () => {
      const results = geneRef.autocomplete('A', 5)
      expect(results.length).toBeLessThanOrEqual(5)
    })

    it('deduplicates by hgnc_id (symbol match takes priority)', () => {
      // BRCA1 should appear once even if matched via both symbol and alias
      const results = geneRef.autocomplete('BRCA1')
      const brca1Results = results.filter((r) => r.hgncId === 'HGNC:1100')
      expect(brca1Results).toHaveLength(1)
      expect(brca1Results[0].matchType).toBe('symbol')
    })

    it('handles empty query gracefully', () => {
      const results = geneRef.autocomplete('')
      expect(results).toEqual([])
    })

    it('is case-insensitive', () => {
      const results = geneRef.autocomplete('brca')
      const symbols = results.map((r) => r.symbol)
      expect(symbols).toContain('BRCA1')
    })
  })

  describe('getGeneCoordinates', () => {
    it('returns GRCh38 coordinates for BRCA1', () => {
      const coords = geneRef.getGeneCoordinates('HGNC:1100', 'GRCh38')
      expect(coords).not.toBeNull()
      expect(coords!.chromosome).toBe('17')
      expect(coords!.start_pos).toBeLessThan(coords!.end_pos)
      expect(coords!.strand).toBe('-')
      expect(coords!.assembly).toBe('GRCh38')
    })

    it('returns GRCh37 coordinates for BRCA1', () => {
      const coords = geneRef.getGeneCoordinates('HGNC:1100', 'GRCh37')
      expect(coords).not.toBeNull()
      expect(coords!.chromosome).toBe('17')
      expect(coords!.assembly).toBe('GRCh37')
    })

    it('returns null for unknown gene', () => {
      const coords = geneRef.getGeneCoordinates('HGNC:9999999', 'GRCh38')
      expect(coords).toBeNull()
    })

    it('returns null for unknown assembly', () => {
      const coords = geneRef.getGeneCoordinates('HGNC:1100', 'GRCh99')
      expect(coords).toBeNull()
    })
  })

  describe('getCoordinatesForGenes', () => {
    it('returns coordinates for multiple genes', () => {
      const coords = geneRef.getCoordinatesForGenes(['HGNC:1100', 'HGNC:11998'], 'GRCh38')
      expect(coords.size).toBe(2)
      expect(coords.get('HGNC:1100')).toBeDefined()
      expect(coords.get('HGNC:11998')).toBeDefined()
      expect(coords.get('HGNC:1100')!.chromosome).toBe('17')
    })

    it('skips unknown genes', () => {
      const coords = geneRef.getCoordinatesForGenes(['HGNC:1100', 'HGNC:9999999'], 'GRCh38')
      expect(coords.size).toBe(1)
      expect(coords.has('HGNC:1100')).toBe(true)
      expect(coords.has('HGNC:9999999')).toBe(false)
    })

    it('returns empty map for empty input', () => {
      const coords = geneRef.getCoordinatesForGenes([], 'GRCh38')
      expect(coords.size).toBe(0)
    })

    it('handles duplicate hgncIds and chunks exceeding 500 items', () => {
      // 550 items containing duplicates of HGNC:1100 and HGNC:11998 plus unknown IDs
      const largeList = Array.from({ length: 550 }, (_, i) => {
        if (i % 2 === 0) return 'HGNC:1100'
        if (i % 3 === 0) return 'HGNC:11998'
        return `HGNC:FAKE_${i}`
      })
      const coords = geneRef.getCoordinatesForGenes(largeList, 'GRCh38')
      expect(coords.size).toBe(2)
      expect(coords.has('HGNC:1100')).toBe(true)
      expect(coords.has('HGNC:11998')).toBe(true)
    })

    it('preserves exact input order of unique hgncIds (#672)', () => {
      const ids = ['HGNC:11998', 'HGNC:1100']
      const coords = geneRef.getCoordinatesForGenes(ids, 'GRCh38')
      expect(Array.from(coords.keys())).toEqual(['HGNC:11998', 'HGNC:1100'])

      const reversedIds = ['HGNC:1100', 'HGNC:11998']
      const coordsRev = geneRef.getCoordinatesForGenes(reversedIds, 'GRCh38')
      expect(Array.from(coordsRev.keys())).toEqual(['HGNC:1100', 'HGNC:11998'])
    })
  })

  describe('getAssemblies', () => {
    it('returns GRCh38 and GRCh37', () => {
      const assemblies = geneRef.getAssemblies()
      expect(assemblies.length).toBeGreaterThanOrEqual(2)

      const ids = assemblies.map((a) => a.id)
      expect(ids).toContain('GRCh38')
      expect(ids).toContain('GRCh37')
    })

    it('has parsed aliases as arrays', () => {
      const assemblies = geneRef.getAssemblies()
      const grch38 = assemblies.find((a) => a.id === 'GRCh38')
      expect(grch38).toBeDefined()
      expect(Array.isArray(grch38!.aliases)).toBe(true)
      expect(grch38!.aliases).toContain('hg38')
    })
  })

  describe('getInfo', () => {
    it('returns gene reference info with correct counts', () => {
      const info = geneRef.getInfo()
      expect(info.geneCount).toBeGreaterThan(40000)
      expect(info.aliasCount).toBeGreaterThan(0)
      expect(info.coordinateCount).toBeGreaterThan(0)
      expect(info.assemblies).toContain('GRCh38')
      expect(info.assemblies).toContain('GRCh37')
      expect(typeof info.builtAt).toBe('number')
    })
  })
})
