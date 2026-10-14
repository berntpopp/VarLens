/**
 * Headless build of hpo_similarity.db for web deployments (#600), using the
 * same download + sha256 verify + build path as the desktop update.
 *
 * Usage: npm run build:hpo-db -- [--out <path>] [--tag vYYYY-MM-DD]
 * Output defaults to $VARLENS_HPO_DB_PATH, else ./hpo_similarity.db.
 * ClinGen genes are keyed by HGNC id via $VARLENS_GENE_REF_DB_PATH, else ./resources/gene_reference.db.
 * Exits non-zero on any download or verification failure.
 * Restart a running web server afterwards: its boot prewarm loads the new index;
 * otherwise the first hpo_resnik ranking reloads it on the event loop, stalling every request.
 * Requires: npm run rebuild:node (so better-sqlite3 works under Node.js)
 */
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { apiFetch } from '../src/main/services/api/http-fetch'
import { buildHpoFromFiles } from '../src/main/services/phenotype/hpo-build-worker-client'
import { updateHpoData } from '../src/main/services/phenotype/hpo-data-update'
import { HPO_DATA_CONFIG } from '../src/shared/config/hpo-data.config'
import type { HpoDataUpdateResult } from '../src/shared/types/hpo-data'

export async function buildHpoDbCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<HpoDataUpdateResult> {
  const { values } = parseArgs({
    args: argv,
    options: { out: { type: 'string' }, tag: { type: 'string' } }
  })
  const fromEnv = env[HPO_DATA_CONFIG.envPath]?.trim()
  const dbPath = resolve(values.out ?? (fromEnv || HPO_DATA_CONFIG.dbFileName))
  return updateHpoData({
    fetch: apiFetch,
    isOnline: () => true,
    dbPath,
    tag: values.tag,
    geneRefPath: env.VARLENS_GENE_REF_DB_PATH ?? resolve('resources/gene_reference.db'),
    build: async (request) => buildHpoFromFiles(request)
  })
}

if (process.argv[1]?.endsWith('build-hpo-similarity-db.ts')) {
  buildHpoDbCli(process.argv.slice(2)).then(
    (result) => console.log(`${result.message} (${result.status.termCount} terms)`),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  )
}
