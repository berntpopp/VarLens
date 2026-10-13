/**
 * Cases whose genome build the chromosome-name job could not confirm
 * (postgres-contig-naming.ts), and the user's answers. SQLite twin:
 * listBuildReviews / resolveBuildReviews in database/contig-rename-sqlite.ts.
 */
import type { Pool } from 'pg'

import { serializeAuditContractValue } from '../../../shared/audit/audit-contract'
import { isImportableGenomeBuild } from '../../../shared/config/genome-builds.config'
import type {
  BuildReview,
  BuildReviewChoice,
  BuildReviewList
} from '../../../shared/types/build-review'
import { auditActorName } from '../../security/request-context'
import { quoteIdentifier } from './identifiers'
import { contigNamingFailed, scheduleContigNaming } from './postgres-contig-naming'
import { withTransaction } from './transaction'

export class PostgresBuildReviewRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query' | 'connect'>,
    private readonly schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async listBuildReviews(): Promise<BuildReviewList> {
    // Opening the app is a good moment to let a pending update catch up.
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
        ORDER BY r.reason, c.name`
    )
    const pending = await this.pool.query(
      `SELECT 1 FROM ${this.schemaName}."contig_naming_pending" LIMIT 1`
    )
    return {
      reviews: result.rows.map((r) => ({
        caseId: Number(r.case_id),
        caseName: r.case_name,
        storedBuild: r.stored_build,
        suggestedBuild: r.suggested_build,
        reason: r.reason
      })),
      renameInProgress: pending.rows.length > 0,
      renameFailed: contigNamingFailed(this.schema)
    }
  }

  /**
   * Store the confirmed builds (audit-logged) and queue the cases for the
   * background rename, in one short transaction; the job does the rewrite.
   */
  async resolveBuildReviews(choices: readonly BuildReviewChoice[]): Promise<number> {
    for (const c of choices) {
      if (!isImportableGenomeBuild(c.build)) throw new Error(`Unknown genome build: ${c.build}`)
    }
    const user = auditActorName('local') // desktop on PostgreSQL has no request actor
    await withTransaction(this.pool, async (client) => {
      for (const { caseId, build } of choices) {
        const review = await client.query<{ genome_build: string | null }>(
          `SELECT c.genome_build FROM ${this.schemaName}."contig_build_review" r
             JOIN ${this.schemaName}."cases_all" c ON c.id = r.case_id
            WHERE r.case_id = $1 FOR UPDATE OF r, c`,
          [caseId]
        )
        if (review.rows.length === 0)
          throw new Error(`Case ${caseId} has no genome build to confirm`)
        // The case's global annotations follow it to the confirmed build (#577):
        // copied (the old build's other cases keep theirs); the new build's own win.
        // The queued rename then moves the copies to the build's contig names.
        await client.query(
          `INSERT INTO ${this.schemaName}."variant_annotations"
             (chr, pos, ref, alt, genome_build, global_comment, starred,
              acmg_classification, acmg_evidence, created_at, updated_at)
           SELECT va.chr, va.pos, va.ref, va.alt, $1, va.global_comment, va.starred,
                  va.acmg_classification, va.acmg_evidence, va.created_at, va.updated_at
           FROM ${this.schemaName}."variant_annotations" va
           WHERE va.genome_build = $2 AND $1 <> $2
             AND EXISTS (SELECT 1 FROM ${this.schemaName}."variants_all" v WHERE v.case_id = $3
               AND v.chr = va.chr AND v.pos = va.pos AND v.ref = va.ref AND v.alt = va.alt)
           ON CONFLICT (chr, pos, ref, alt, genome_build) DO NOTHING`,
          [build, review.rows[0].genome_build, caseId]
        )
        await client.query(
          `UPDATE ${this.schemaName}."cases_all" SET genome_build = $1 WHERE id = $2`,
          [build, caseId]
        )
        await client.query(
          `INSERT INTO varlens_audit."audit_log"
             (project_schema, action_type, entity_type, entity_key, old_value, new_value, user_name)
           VALUES ($1, 'api_write', 'api_call', $2, $3, $4, $5)`,
          [
            this.schema,
            `cases:${caseId}:genome_build`,
            serializeAuditContractValue(
              JSON.stringify({ genome_build: review.rows[0].genome_build })
            ),
            serializeAuditContractValue(
              JSON.stringify({ genome_build: build, reason: 'build_review' })
            ),
            user
          ]
        )
        await client.query(
          `DELETE FROM ${this.schemaName}."contig_build_review" WHERE case_id = $1`,
          [caseId]
        )
        await client.query(
          `INSERT INTO ${this.schemaName}."contig_naming_pending" (case_id, confirmed)
           VALUES ($1, true)
           ON CONFLICT (case_id) DO UPDATE SET confirmed = true, pairs = NULL`,
          [caseId]
        )
      }
    })
    scheduleContigNaming({ pool: this.pool, schema: this.schema }, true)
    return choices.length
  }
}
