import { BaseRepository } from './BaseRepository'
import { sql } from 'kysely'
import type {
  DatabaseOverview,
  OverviewCase,
  OverviewCohortGroup,
  OverviewTag,
  OverviewPhenotype
} from '../../shared/types/database-overview'
import { CohortService } from './cohort'

export class DatabaseOverviewService extends BaseRepository {
  getDatabaseOverview(): DatabaseOverview {
    const cohortService = new CohortService(this.db)
    const summary = cohortService.getCohortSummary()

    const cases = this.execAll<OverviewCase>(
      this.kysely
        .selectFrom('cases as c')
        .leftJoin('case_metadata as cm', 'c.id', 'cm.case_id')
        .select(['c.id', 'c.name', 'c.variant_count', 'c.created_at', 'cm.affected_status'])
        .orderBy('c.created_at', 'desc')
    )

    const cohortGroupsCompiled = sql<OverviewCohortGroup>`
      SELECT cg.id, cg.name, cg.description, cg.created_at,
             COUNT(ccl.case_id) as member_count
      FROM cohort_groups cg
      LEFT JOIN case_cohort_links ccl ON cg.id = ccl.cohort_id
      GROUP BY cg.id
      ORDER BY cg.name
    `.compile(this.kysely)
    const cohortGroups = this.db
      .prepare(cohortGroupsCompiled.sql)
      .all(...cohortGroupsCompiled.parameters) as OverviewCohortGroup[]

    const tagsCompiled = sql<OverviewTag>`
      SELECT t.id, t.name, t.color,
             COUNT(vt.variant_id) as usage_count
      FROM tags t
      LEFT JOIN variant_tags vt ON t.id = vt.tag_id
      GROUP BY t.id
      ORDER BY t.name
    `.compile(this.kysely)
    const tags = this.db.prepare(tagsCompiled.sql).all(...tagsCompiled.parameters) as OverviewTag[]

    const topPhenotypesCompiled = sql<OverviewPhenotype>`
      SELECT hpo_id, hpo_label, COUNT(DISTINCT case_id) as case_count
      FROM case_hpo_terms
      GROUP BY hpo_id, hpo_label
      ORDER BY case_count DESC
      LIMIT 25
    `.compile(this.kysely)
    const topPhenotypes = this.db
      .prepare(topPhenotypesCompiled.sql)
      .all(...topPhenotypesCompiled.parameters) as OverviewPhenotype[]

    return { summary, cases, cohortGroups, tags, topPhenotypes }
  }
}
