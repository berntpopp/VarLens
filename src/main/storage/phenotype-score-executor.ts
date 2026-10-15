/**
 * Keeps `case_phenotype_scores` current in front of the table reads that join
 * it (spec .planning/specs/2026-10-15-phenotype-column.md). Before a case
 * variant query (that case) or a cohort query (every case with terms or
 * scores) it compares each case's HPO profile and the installed HPO data key
 * with the stored state and rescores only stale cases: in the scorer worker
 * on desktop SQLite, written by the writer. Current cases cost one small read;
 * the query itself only joins stored values. A case query waits for its case;
 * a cohort query never waits (after an HPO update every case is stale, which
 * on a large web cohort takes minutes): it starts one background pass and
 * reads what is stored.
 */
import { mainLogger } from '../services/MainLogger'
import { hpoDataKey as currentHpoDataKey } from '../services/phenotype/hpo-similarity-db'
import type { GenePhenotypeScore } from '../services/phenotype/hpo-similarity-db'
import {
  isCurrent,
  profileHash,
  type CasePhenotypeProfile
} from '../services/phenotype/case-phenotype-scores'
import type { StorageReadExecutor, StorageReadTask } from './read-executor'
import type { StorageWriteExecutor } from './write-executor'

/** The cases a read needs current scores for: one id, all (null), or none (undefined). */
function scoreScope(task: StorageReadTask): number | null | undefined {
  if (task.type === 'variants:query') return task.params[0].case_id
  if (task.type === 'cohort:query') return null
  return undefined
}

export function withPhenotypeScores(
  read: StorageReadExecutor,
  write: StorageWriteExecutor,
  dataKey: () => string | null = currentHpoDataKey
): StorageReadExecutor {
  // Concurrent reads of one case share its rescore instead of scoring twice.
  const pending = new Map<number, Promise<void>>()
  let cohortPass: Promise<void> | null = null

  async function rescore(profile: CasePhenotypeProfile, key: string | null): Promise<void> {
    const hash = profileHash(profile.terms)
    const rows =
      hash === null
        ? []
        : ((await read.execute({
            type: 'hpo:caseScores',
            params: [profile.terms]
          })) as GenePhenotypeScore[])
    await write.execute({
      type: 'phenotype:replaceScores',
      params: [profile.caseId, hash, key, rows]
    })
  }

  async function ensure(caseId: number | null): Promise<void> {
    const key = dataKey()
    const profiles = (await read.execute({
      type: 'phenotype:profiles',
      params: [caseId]
    })) as CasePhenotypeProfile[]
    await Promise.all(
      profiles
        .filter((profile) => !isCurrent(profile, key))
        .map((profile) => {
          let job = pending.get(profile.caseId)
          if (job === undefined) {
            job = rescore(profile, key).finally(() => pending.delete(profile.caseId))
            pending.set(profile.caseId, job)
          }
          return job
        })
    )
  }

  // A failed rescore leaves the old values (or none) visible; the table must still load.
  const ensureLogged = (caseId: number | null): Promise<void> =>
    ensure(caseId).catch((error: unknown) =>
      mainLogger.warn(
        `Phenotype scores not refreshed: ${error instanceof Error ? error.message : String(error)}`,
        'phenotype-scores'
      )
    )

  return {
    async execute(task) {
      const scope = scoreScope(task)
      if (scope === null) {
        cohortPass ??= ensureLogged(null).finally(() => (cohortPass = null))
      } else if (scope !== undefined) {
        await ensureLogged(scope)
      }
      return read.execute(task)
    }
  }
}
