/**
 * JSON import/export of a shortlist ranking (spec §12). The file wraps the
 * preset's `ShortlistConfig` with its name; import validates it with the same
 * schema the `variants:shortlist` IPC boundary uses and drops the ruleset's
 * `sha256`, which identifies a frozen shipped artifact, not user data.
 */
import { ShortlistConfigSchema } from '../../../shared/types/ipc-schemas'
import type { ShortlistConfig } from '../../../shared/types/shortlist'
import { SHORTLIST_RANKING_EDITOR } from '../config/shortlistRankingEditor'

const { exportFormat, errors } = SHORTLIST_RANKING_EDITOR

export interface RankingFile {
  name: string
  description: string | null
  config: ShortlistConfig
}

export type RankingImport = ({ ok: true } & RankingFile) | { ok: false; error: string }

export function serializeRanking(file: RankingFile): string {
  return JSON.stringify({ format: exportFormat, version: 1, ...file }, null, 2)
}

/** A file name for the export, e.g. `my-lab-v2.ranking.json`. */
export function rankingFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'ranking'}.ranking.json`
}

export function parseRankingFile(text: string): RankingImport {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: errors.importFormat }
  }
  const file = raw as Partial<RankingFile> & { format?: unknown }
  if (file?.format !== exportFormat || typeof file.name !== 'string') {
    return { ok: false, error: errors.importFormat }
  }
  const parsed = ShortlistConfigSchema.safeParse(file.config)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: errors.importInvalid(`${issue.path.join('.')}: ${issue.message}`) }
  }
  const config = parsed.data as ShortlistConfig
  const ruleset = config.rankConfig.ruleset
  if (ruleset === undefined) return { ok: false, error: errors.importNotEvidence }
  delete ruleset.sha256
  return {
    ok: true,
    name: file.name,
    description: typeof file.description === 'string' ? file.description : null,
    config
  }
}
