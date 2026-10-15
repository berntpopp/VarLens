/**
 * Stored phenotype column (spec .planning/specs/2026-10-15-phenotype-column.md):
 * `case_phenotype_scores` holds one row per HPO gene for every case with
 * present HPO terms, `case_phenotype_state` the profile hash and HPO data key
 * they were scored with. A case is rescored only when either changes; table
 * reads join the stored rows and never score. SQLite and PostgreSQL twins.
 */
import { createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3-multiple-ciphers'
import type { Pool } from 'pg'
import type { HpoProfileTerm } from '../../../shared/types/hpo-profile'
import type { GenePhenotypeScore } from './hpo-similarity-db'
import { withTransaction } from '../../storage/postgres/transaction'

/** A case's current HPO terms next to the state its stored scores were computed for. */
export interface CasePhenotypeProfile {
  caseId: number
  terms: HpoProfileTerm[]
  /** null: nothing stored for the case */
  profileHash: string | null
  dataKey: string | null
}

/** Order-independent hash of a term list with its flags; null without terms. */
export function profileHash(terms: readonly HpoProfileTerm[]): string | null {
  if (terms.length === 0) return null
  const canonical = terms
    .map((t) => `${t.hpoId}:${t.excluded ? 1 : 0}${t.key ? 1 : 0}`)
    .sort()
    .join(',')
  return createHash('sha256').update(canonical).digest('base64url').slice(0, 22)
}

/** Stored scores are current: no terms and nothing stored, or the same profile and HPO data. */
export function isCurrent(profile: CasePhenotypeProfile, dataKey: string | null): boolean {
  const hash = profileHash(profile.terms)
  return hash === null
    ? profile.profileHash === null
    : profile.profileHash === hash && profile.dataKey === dataKey
}

interface TermRow {
  case_id: unknown
  hpo_id: string
  excluded: unknown
  key: unknown
}
interface StateRow {
  case_id: unknown
  profile_hash: string
  hpo_data_key: string | null
}

/** Cases with terms or stored scores; SQLite flags are 0/1, PostgreSQL ids bigint strings. */
function toProfiles(terms: TermRow[], states: StateRow[]): CasePhenotypeProfile[] {
  const byCase = new Map<number, CasePhenotypeProfile>()
  const profileOf = (caseId: unknown): CasePhenotypeProfile => {
    const id = Number(caseId)
    let profile = byCase.get(id)
    if (profile === undefined) {
      profile = { caseId: id, terms: [], profileHash: null, dataKey: null }
      byCase.set(id, profile)
    }
    return profile
  }
  for (const t of terms) {
    profileOf(t.case_id).terms.push({
      hpoId: t.hpo_id,
      excluded: Boolean(t.excluded),
      key: Boolean(t.key)
    })
  }
  for (const s of states) {
    const profile = profileOf(s.case_id)
    profile.profileHash = s.profile_hash
    profile.dataKey = s.hpo_data_key
  }
  return [...byCase.values()]
}

const TERMS_SQL = 'SELECT case_id, hpo_id, excluded, "key" FROM %t'
const STATE_SQL = 'SELECT case_id, profile_hash, hpo_data_key FROM %t'

/** One case, or every case with terms or stored scores (`caseId` null). */
export function readSqlitePhenotypeProfiles(
  db: Database,
  caseId: number | null
): CasePhenotypeProfile[] {
  const where = caseId === null ? '' : ' WHERE case_id = ?'
  const args = caseId === null ? [] : [caseId]
  return toProfiles(
    db.prepare(TERMS_SQL.replace('%t', 'case_hpo_terms') + where).all(...args) as TermRow[],
    db.prepare(STATE_SQL.replace('%t', 'case_phenotype_state') + where).all(...args) as StateRow[]
  )
}

/** Replace a case's scores and state in one transaction; a null hash clears both. */
export function replaceSqlitePhenotypeScores(
  db: Database,
  caseId: number,
  hash: string | null,
  dataKey: string | null,
  rows: readonly GenePhenotypeScore[]
): void {
  const insert = db.prepare('INSERT INTO case_phenotype_scores VALUES (?, ?, ?, ?)')
  db.transaction(() => {
    db.prepare('DELETE FROM case_phenotype_scores WHERE case_id = ?').run(caseId)
    db.prepare('DELETE FROM case_phenotype_state WHERE case_id = ?').run(caseId)
    if (hash === null) return
    for (const r of rows) insert.run(caseId, r.gene, r.score, r.disease)
    db.prepare('INSERT INTO case_phenotype_state VALUES (?, ?, ?, ?)').run(
      caseId,
      hash,
      dataKey,
      Date.now()
    )
  })()
}

export async function readPostgresPhenotypeProfiles(
  pool: Pick<Pool, 'query'>,
  tbl: (name: string) => string,
  caseId: number | null
): Promise<CasePhenotypeProfile[]> {
  const where = caseId === null ? '' : ' WHERE case_id = $1'
  const args = caseId === null ? [] : [caseId]
  const [terms, states] = await Promise.all([
    pool.query<TermRow>(TERMS_SQL.replace('%t', tbl('case_hpo_terms')) + where, args),
    pool.query<StateRow>(STATE_SQL.replace('%t', tbl('case_phenotype_state')) + where, args)
  ])
  return toProfiles(terms.rows, states.rows)
}

export async function replacePostgresPhenotypeScores(
  pool: Pick<Pool, 'connect'>,
  tbl: (name: string) => string,
  caseId: number,
  hash: string | null,
  dataKey: string | null,
  rows: readonly GenePhenotypeScore[]
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query(`DELETE FROM ${tbl('case_phenotype_scores')} WHERE case_id = $1`, [caseId])
    await client.query(`DELETE FROM ${tbl('case_phenotype_state')} WHERE case_id = $1`, [caseId])
    if (hash === null) return
    await client.query(
      `INSERT INTO ${tbl('case_phenotype_scores')} (case_id, gene_symbol, score, best_disease)
       SELECT $1, * FROM unnest($2::text[], $3::float8[], $4::text[])`,
      [caseId, rows.map((r) => r.gene), rows.map((r) => r.score), rows.map((r) => r.disease)]
    )
    await client.query(`INSERT INTO ${tbl('case_phenotype_state')} VALUES ($1, $2, $3, $4)`, [
      caseId,
      hash,
      dataKey,
      Date.now()
    ])
  })
}
