/** The HPO release files behind the built hpo_similarity.db (#600), verified against its meta. */
import Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HPO_DB, HPO_RAW_DIR } from '../common/paths'

/** Raw release files, refused unless they are the bytes the DB was built from. */
export function readVerifiedSources(): {
  ontology: string
  annotations: string
  genes: string
  release: string
} {
  const db = new Database(HPO_DB, { readonly: true, fileMustExist: true })
  const meta = new Map(
    (db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>).map(
      (r) => [r.key, r.value]
    )
  )
  db.close()
  const digests = JSON.parse(meta.get('sources_sha256') ?? '{}') as Record<string, string>
  const read = (name: string): string => {
    const bytes = readFileSync(join(HPO_RAW_DIR, name))
    if (createHash('sha256').update(bytes).digest('hex') !== digests[name])
      throw new Error(`${name} in ${HPO_RAW_DIR} is not the release ${HPO_DB} was built from`)
    return bytes.toString('utf8')
  }
  return {
    ontology: read('hp.json'),
    annotations: read('phenotype.hpoa'),
    genes: read('genes_to_phenotype.txt'),
    release: meta.get('hpo_version') ?? 'unknown'
  }
}
