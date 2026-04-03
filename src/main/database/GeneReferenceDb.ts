import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
import { mainLogger } from '../services/MainLogger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type {
  GeneValidationResult,
  GeneAutocompleteResult,
  GeneCoordinates,
  AssemblyInfo,
  GeneRefInfo
} from '../../shared/types/gene-reference'
export type {
  GeneValidationResult,
  GeneAutocompleteResult,
  GeneCoordinates,
  AssemblyInfo,
  GeneRefInfo
}

// ---------------------------------------------------------------------------
// Internal row types (raw DB results)
// ---------------------------------------------------------------------------

interface GeneRow {
  hgnc_id: string
  symbol: string
  name: string | null
  status: string | null
  locus_group: string | null
}

interface AliasRow {
  alias: string
  hgnc_id: string
  alias_type: string
}

interface CoordinateRow {
  hgnc_id: string
  assembly: string
  chromosome: string
  start_pos: number
  end_pos: number
  strand: string
}

interface AssemblyRow {
  id: string
  display_name: string
  aliases: string
  source_version: string
  built_at: number
}

interface CountRow {
  c: number
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Read-only service for querying the bundled gene reference database.
 *
 * Uses prepared statements cached in the constructor for performance.
 * All methods are synchronous (better-sqlite3 is synchronous by design).
 */
export class GeneReferenceDb {
  // Prepared statements
  private readonly stmtGeneBySymbol: Statement
  private readonly stmtAliasByAlias: Statement
  private readonly stmtGeneByHgncId: Statement
  private readonly stmtCoordsByHgncAssembly: Statement
  private readonly stmtAssemblies: Statement
  private readonly stmtGeneCount: Statement
  private readonly stmtAliasCount: Statement
  private readonly stmtCoordCount: Statement
  private readonly stmtBuiltAt: Statement

  constructor(private readonly db: DatabaseType) {
    // Validate / autocomplete
    this.stmtGeneBySymbol = db.prepare(
      'SELECT hgnc_id, symbol, name, status, locus_group FROM genes WHERE symbol = ? COLLATE NOCASE'
    )
    this.stmtAliasByAlias = db.prepare(
      'SELECT alias, hgnc_id, alias_type FROM gene_aliases WHERE alias = ? COLLATE NOCASE'
    )
    this.stmtGeneByHgncId = db.prepare(
      'SELECT hgnc_id, symbol, name, status, locus_group FROM genes WHERE hgnc_id = ?'
    )

    // Coordinates
    this.stmtCoordsByHgncAssembly = db.prepare(
      'SELECT hgnc_id, assembly, chromosome, start_pos, end_pos, strand FROM gene_coordinates WHERE hgnc_id = ? AND assembly = ?'
    )

    // Assemblies & info
    this.stmtAssemblies = db.prepare(
      'SELECT id, display_name, aliases, source_version, built_at FROM assemblies'
    )
    this.stmtGeneCount = db.prepare('SELECT COUNT(*) as c FROM genes')
    this.stmtAliasCount = db.prepare('SELECT COUNT(*) as c FROM gene_aliases')
    this.stmtCoordCount = db.prepare('SELECT COUNT(*) as c FROM gene_coordinates')
    this.stmtBuiltAt = db.prepare('SELECT built_at FROM assemblies LIMIT 1')
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  validateSymbol(input: string): GeneValidationResult {
    const trimmed = input.trim()

    // Step 1: exact match on genes.symbol (case-insensitive via COLLATE NOCASE)
    const gene = this.stmtGeneBySymbol.get(trimmed) as GeneRow | undefined
    if (gene) {
      return {
        input: trimmed,
        status: 'approved',
        symbol: gene.symbol,
        hgncId: gene.hgnc_id,
        name: gene.name ?? undefined,
        locusGroup: gene.locus_group ?? undefined
      }
    }

    // Step 2-3: search gene_aliases (covers both alias_symbol and prev_symbol)
    const aliases = this.stmtAliasByAlias.all(trimmed) as AliasRow[]
    if (aliases.length === 1) {
      const alias = aliases[0]
      const resolvedGene = this.stmtGeneByHgncId.get(alias.hgnc_id) as GeneRow | undefined
      return {
        input: trimmed,
        status: 'alias',
        symbol: resolvedGene?.symbol,
        hgncId: alias.hgnc_id,
        name: resolvedGene?.name ?? undefined,
        locusGroup: resolvedGene?.locus_group ?? undefined,
        currentSymbol: resolvedGene?.symbol,
        aliasType: alias.alias_type
      }
    }

    // Step 4: multiple aliases → ambiguous
    if (aliases.length > 1) {
      const candidates = aliases.map((a) => {
        const g = this.stmtGeneByHgncId.get(a.hgnc_id) as GeneRow | undefined
        return { symbol: g?.symbol ?? a.hgnc_id, hgncId: a.hgnc_id }
      })
      return {
        input: trimmed,
        status: 'ambiguous',
        candidates
      }
    }

    // Step 5: no match
    return { input: trimmed, status: 'unknown' }
  }

  validateSymbols(inputs: string[]): GeneValidationResult[] {
    return inputs.map((input) => this.validateSymbol(input))
  }

  // -------------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------------

  autocomplete(query: string, limit: number = 20): GeneAutocompleteResult[] {
    const sanitized = query.replace(/[^a-zA-Z0-9-]/g, '').trim()
    if (!sanitized) return []

    const escaped = sanitized.replace(/"/g, '""')
    const ftsQuery = `"${escaped}"*`
    const seen = new Map<string, GeneAutocompleteResult>()

    // Symbol matches first (higher priority)
    try {
      const symbolFts = this.db
        .prepare(
          `SELECT g.hgnc_id, g.symbol, g.name, g.locus_group
           FROM genes_fts f
           JOIN genes g ON g.rowid = f.rowid
           WHERE genes_fts MATCH ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(ftsQuery, limit) as Array<{
        hgnc_id: string
        symbol: string
        name: string | null
        locus_group: string | null
      }>

      for (const row of symbolFts) {
        if (!seen.has(row.hgnc_id)) {
          seen.set(row.hgnc_id, {
            symbol: row.symbol,
            hgncId: row.hgnc_id,
            name: row.name ?? '',
            locusGroup: row.locus_group ?? '',
            matchType: 'symbol'
          })
        }
      }
    } catch (e) {
      mainLogger.warn(
        'FTS5 symbol autocomplete query failed: ' + (e instanceof Error ? e.message : String(e)),
        'GeneReferenceDb'
      )
    }

    // Alias matches second
    try {
      const aliasFts = this.db
        .prepare(
          `SELECT a.alias, a.hgnc_id, g.symbol, g.name, g.locus_group
           FROM aliases_fts f
           JOIN gene_aliases a ON a.rowid = f.rowid
           JOIN genes g ON g.hgnc_id = a.hgnc_id
           WHERE aliases_fts MATCH ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(ftsQuery, limit) as Array<{
        alias: string
        hgnc_id: string
        symbol: string
        name: string | null
        locus_group: string | null
      }>

      for (const row of aliasFts) {
        if (!seen.has(row.hgnc_id)) {
          seen.set(row.hgnc_id, {
            symbol: row.symbol,
            hgncId: row.hgnc_id,
            name: row.name ?? '',
            locusGroup: row.locus_group ?? '',
            matchType: 'alias',
            matchedAlias: row.alias
          })
        }
      }
    } catch (e) {
      mainLogger.warn(
        'FTS5 alias autocomplete query failed: ' + (e instanceof Error ? e.message : String(e)),
        'GeneReferenceDb'
      )
    }

    return Array.from(seen.values()).slice(0, limit)
  }

  // -------------------------------------------------------------------------
  // Coordinates
  // -------------------------------------------------------------------------

  getGeneCoordinates(hgncId: string, assembly: string): GeneCoordinates | null {
    const row = this.stmtCoordsByHgncAssembly.get(hgncId, assembly) as CoordinateRow | undefined
    if (!row) return null
    return {
      hgncId: row.hgnc_id,
      assembly: row.assembly,
      chromosome: row.chromosome,
      start_pos: row.start_pos,
      end_pos: row.end_pos,
      strand: row.strand
    }
  }

  getCoordinatesForGenes(hgncIds: string[], assembly: string): Map<string, GeneCoordinates> {
    const result = new Map<string, GeneCoordinates>()
    for (const hgncId of hgncIds) {
      const coords = this.getGeneCoordinates(hgncId, assembly)
      if (coords) {
        result.set(hgncId, coords)
      }
    }
    return result
  }

  // -------------------------------------------------------------------------
  // Assemblies & Info
  // -------------------------------------------------------------------------

  getAssemblies(): AssemblyInfo[] {
    const rows = this.stmtAssemblies.all() as AssemblyRow[]
    return rows.map((row) => ({
      id: row.id,
      display_name: row.display_name,
      aliases: JSON.parse(row.aliases) as string[],
      source_version: row.source_version
    }))
  }

  getInfo(): GeneRefInfo {
    const geneCount = (this.stmtGeneCount.get() as CountRow).c
    const aliasCount = (this.stmtAliasCount.get() as CountRow).c
    const coordinateCount = (this.stmtCoordCount.get() as CountRow).c
    const assemblies = (this.stmtAssemblies.all() as AssemblyRow[]).map((r) => r.id)
    const builtAtRow = this.stmtBuiltAt.get() as { built_at: number } | undefined
    const builtAt = builtAtRow?.built_at ?? 0

    return { geneCount, aliasCount, coordinateCount, assemblies, builtAt }
  }
}
