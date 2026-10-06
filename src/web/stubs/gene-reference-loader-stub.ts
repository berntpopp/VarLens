/**
 * Web-build replacement for `src/main/database/geneReferenceLoader`.
 *
 * The desktop loader resolves the bundled `gene_reference.db` via
 * `electron.app.getPath('userData')`; Electron is absent from the web
 * container. The web server instead opens the same read-only database with
 * `node:sqlite` (see `web-gene-reference.ts`: `VARLENS_GENE_REF_DB_PATH`,
 * then `<cwd>/resources/gene_reference.db`) and wraps it in the desktop
 * `GeneReferenceDb` service, so code shared with desktop (Postgres panel
 * interval resolution, panel symbol validation/autocomplete) works in web.
 *
 * If the file is missing, `getGeneReferenceDb()` throws a clear error that
 * names the checked paths, rather than failing silently.
 */

import { join } from 'path'

import type { GeneReferenceDb } from '../../main/database/GeneReferenceDb'
import { closeWebGeneReferenceDb, getWebGeneReferenceService } from '../server/web-gene-reference'

export function resolveGeneRefDbPath(): string {
  return process.env.VARLENS_GENE_REF_DB_PATH ?? join(process.cwd(), 'resources/gene_reference.db')
}

export function getGeneReferenceDb(): GeneReferenceDb {
  return getWebGeneReferenceService()
}

export function closeGeneReferenceDb(): void {
  closeWebGeneReferenceDb()
}
