import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { AssemblyInfo, GeneRefInfo } from '../../shared/types/gene-reference'

interface AssemblyRow {
  id: string
  display_name: string
  aliases: string
  source_version: string | null
}

interface CountRow {
  c: number
}

interface BuiltAtRow {
  built_at: number
}

export interface WebGeneReferenceDb {
  getInfo: () => GeneRefInfo
  getAssemblies: () => AssemblyInfo[]
}

interface WebGeneReferenceDbInstance extends WebGeneReferenceDb {
  close: () => void
}

let instance: WebGeneReferenceDbInstance | null = null

function resolveWebGeneReferencePath(): string {
  const explicit = process.env.VARLENS_GENE_REF_DB_PATH
  if (explicit !== undefined && explicit.trim() !== '') return explicit

  const candidates = [resolve(process.cwd(), 'resources/gene_reference.db')]
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.trim() !== '') {
    candidates.push(join(process.resourcesPath, 'gene_reference.db'))
  }

  const found = candidates.find((candidate) => candidate !== '' && existsSync(candidate))
  if (found !== undefined) return found

  throw new Error(
    `Gene reference database not found for web server. Checked: ${candidates.join(', ')}`
  )
}

function queryRows<T>(db: DatabaseSync, sql: string): T[] {
  return db.prepare(sql).all() as T[]
}

function firstCount(db: DatabaseSync, tableName: string): number {
  return queryRows<CountRow>(db, `SELECT COUNT(*) AS c FROM ${tableName}`)[0]?.c ?? 0
}

function createWebGeneReferenceDb(dbPath: string): WebGeneReferenceDbInstance {
  const db = new DatabaseSync(dbPath, { readOnly: true })

  return {
    getInfo() {
      const assemblies = queryRows<{ id: string }>(
        db,
        'SELECT id FROM assemblies ORDER BY rowid'
      ).map((row) => row.id)
      const builtAt =
        queryRows<BuiltAtRow>(db, 'SELECT built_at FROM assemblies ORDER BY rowid LIMIT 1')[0]
          ?.built_at ?? 0
      return {
        geneCount: firstCount(db, 'genes'),
        aliasCount: firstCount(db, 'gene_aliases'),
        coordinateCount: firstCount(db, 'gene_coordinates'),
        assemblies,
        builtAt
      }
    },
    getAssemblies() {
      return queryRows<AssemblyRow>(
        db,
        'SELECT id, display_name, aliases, source_version FROM assemblies ORDER BY rowid'
      ).map((row) => ({
        id: row.id,
        display_name: row.display_name,
        aliases: JSON.parse(row.aliases) as string[],
        source_version: row.source_version ?? ''
      }))
    },
    close() {
      db.close()
    }
  }
}

export function getWebGeneReferenceDb(): WebGeneReferenceDb {
  instance ??= createWebGeneReferenceDb(resolveWebGeneReferencePath())
  return instance
}

export function closeWebGeneReferenceDb(): void {
  instance?.close()
  instance = null
}
