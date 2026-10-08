/**
 * The tables whose rows belong to a case, read from the schema: every table
 * with a foreign key to `cases` or `variants`. A connection that runs with
 * foreign_keys = OFF (the import worker) deletes them by hand, so the list
 * must not be a copy that a new table can be left out of.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

export interface CaseDependent {
  table: string
  /** The column that holds the case id or the variant id. */
  column: string
  parent: 'cases' | 'variants'
}

/**
 * One entry per dependent table, by its case id where it has one (an indexed
 * equality) and by its variant id otherwise. `variants` itself is not listed.
 */
export function caseDependents(db: DatabaseType): CaseDependent[] {
  const keys = db
    .prepare(
      `SELECT m.name AS "table", f."from" AS "column", f."table" AS parent
         FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f
        WHERE m.type = 'table' AND m.name <> 'variants' AND f."table" IN ('cases', 'variants')
        ORDER BY f."table", m.name`
    )
    .all() as CaseDependent[]
  // 'cases' sorts first: a table with both keys is kept once, by its case id.
  return keys.filter((key, index) => keys.findIndex((k) => k.table === key.table) === index)
}

/** Delete the rows of `caseId` in every dependent table, then its variants and the case. */
export function deleteCaseSqls(db: DatabaseType): string[] {
  return [
    ...caseDependents(db).map(({ table, column, parent }) =>
      parent === 'cases'
        ? `DELETE FROM "${table}" WHERE "${column}" = ?`
        : `DELETE FROM "${table}" WHERE "${column}" IN (SELECT id FROM variants WHERE case_id = ?)`
    ),
    'DELETE FROM variants WHERE case_id = ?',
    'DELETE FROM cases WHERE id = ?'
  ]
}
