/**
 * Cases whose genome build the chromosome-name job could not confirm
 * (postgres-contig-naming.ts), and the user's answer. SQLite twin:
 * listBuildReviews / resolveBuildReview in database/contig-naming-migration.ts.
 */
import type { Pool } from 'pg'

import { isImportableGenomeBuild } from '../../../shared/config/genome-builds.config'
import { contigRenamePairs } from '../../../shared/genome/contig-naming-plan'
import type { BuildReview } from '../../../shared/types/build-review'
import { quoteIdentifier } from './identifiers'
import { caseContigs, renameCaseContigsPg, scheduleContigNaming } from './postgres-contig-naming'
import { withTransaction } from './transaction'

export class PostgresBuildReviewRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query' | 'connect'>,
    private readonly schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async listBuildReviews(): Promise<BuildReview[]> {
    // Opening the app is a good moment to let a pending check catch up.
    scheduleContigNaming({ pool: this.pool, schema: this.schema })
    const result = await this.pool.query<{
      case_id: string
      case_name: string
      stored_build: string
      suggested_build: string | null
      reason: BuildReview['reason']
    }>(
      `SELECT r.case_id, c.name AS case_name, r.stored_build, r.suggested_build, r.reason
         FROM ${this.schemaName}."contig_build_review" r
         JOIN ${this.schemaName}."cases" c ON c.id = r.case_id
        ORDER BY c.name`
    )
    return result.rows.map((r) => ({
      caseId: Number(r.case_id),
      caseName: r.case_name,
      storedBuild: r.stored_build,
      suggestedBuild: r.suggested_build,
      reason: r.reason
    }))
  }

  /** Store the confirmed build and rename the case's contigs to its form, in one transaction. */
  async resolveBuildReview(caseId: number, build: string): Promise<void> {
    if (!isImportableGenomeBuild(build)) throw new Error(`Unknown genome build: ${build}`)
    await withTransaction(this.pool, async (client) => {
      const review = await client.query(
        `SELECT 1 FROM ${this.schemaName}."contig_build_review" WHERE case_id = $1 FOR UPDATE`,
        [caseId]
      )
      if (review.rows.length === 0) throw new Error(`Case ${caseId} has no genome build to confirm`)
      await client.query(
        `UPDATE ${this.schemaName}."cases_all" SET genome_build = $1 WHERE id = $2`,
        [build, caseId]
      )
      const chrs = (await caseContigs(client, this.schema, caseId)).map((c) => c.chr)
      await renameCaseContigsPg(client, this.schema, caseId, contigRenamePairs(chrs, build))
      await client.query(
        `DELETE FROM ${this.schemaName}."contig_build_review" WHERE case_id = $1`,
        [caseId]
      )
      // The summary is keyed by build: a changed build alone needs a rebuild too.
      await client.query(
        `INSERT INTO ${this.schemaName}."cohort_summary_rebuild_requests" (reason) VALUES ('contig_naming')`
      )
    })
  }
}
