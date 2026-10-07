import type { Pool, QueryResult } from 'pg'

import type {
  DatabaseOverview,
  OverviewCase,
  OverviewCohortGroup,
  OverviewPhenotype
} from '../../../shared/types/database-overview'
import { cohortVariantTotalsSql } from './cohort-gene-summary-sql'
import { quoteIdentifier } from './identifiers'
import { runNamed } from './named-query'

type Queryable = Pick<Pool, 'query'>
type Row = Record<string, unknown>

function numberValue(value: unknown): number {
  return Number(value ?? 0)
}

function firstNumber(result: QueryResult<Row>, key: string): number {
  return numberValue(result.rows[0]?.[key])
}

export class PostgresOverviewRepository {
  private readonly schemaName: string
  private readonly schema: string

  constructor(
    private readonly pool: Queryable,
    schema: string
  ) {
    this.schema = schema
    this.schemaName = quoteIdentifier(schema)
  }

  async getOverview(): Promise<DatabaseOverview> {
    // Maintained aggregates: none of the three reads a variant row.
    const totals = cohortVariantTotalsSql((table) => this.table(table))
    const [
      totalCasesResult,
      totalVariantsResult,
      uniqueVariantsResult,
      genesWithVariantsResult,
      casesResult,
      cohortGroupsResult,
      topPhenotypesResult
    ] = await Promise.all([
      runNamed<Row>(this.pool as Pool, {
        name: 'overview:total_cases:v1',
        text: `SELECT COUNT(*)::int AS total_cases FROM ${this.table('cases')}`,
        values: [],
        schema: this.schema
      }),
      runNamed<Row>(this.pool as Pool, {
        name: 'overview:total_variants:v2',
        text: `SELECT (${totals.totalVariants}) AS total_variants`,
        values: [],
        schema: this.schema
      }),
      runNamed<Row>(this.pool as Pool, {
        name: 'overview:unique_variants:v2',
        text: `SELECT (${totals.uniqueVariants}) AS unique_variants`,
        values: [],
        schema: this.schema
      }),
      runNamed<Row>(this.pool as Pool, {
        name: 'overview:genes_with_variants:v2',
        text: `SELECT (${totals.genesWithVariants}) AS genes_with_variants`,
        values: [],
        schema: this.schema
      }),
      this.pool.query<Row>(
        `
          SELECT c.id, c.name, c.variant_count, c.created_at, cm.affected_status
          FROM ${this.table('cases')} c
          LEFT JOIN ${this.table('case_metadata')} cm ON c.id = cm.case_id
          ORDER BY c.created_at DESC
        `
      ),
      this.pool.query<Row>(
        `
          SELECT cg.id, cg.name, cg.description, cg.created_at,
                 COUNT(ccl.case_id)::int AS member_count
          FROM ${this.table('cohort_groups')} cg
          LEFT JOIN ${this.table('case_cohort_links')} ccl ON cg.id = ccl.cohort_id
          GROUP BY cg.id, cg.name, cg.description, cg.created_at
          ORDER BY cg.name
        `
      ),
      this.pool.query<Row>(
        `
          SELECT hpo_id, hpo_label, COUNT(DISTINCT case_id)::int AS case_count
          FROM ${this.table('case_hpo_terms')}
          GROUP BY hpo_id, hpo_label
          ORDER BY case_count DESC
          LIMIT 25
        `
      )
    ])

    const totalCases = firstNumber(totalCasesResult, 'total_cases')
    const totalVariants = firstNumber(totalVariantsResult, 'total_variants')

    return {
      summary: {
        total_cases: totalCases,
        total_variants: totalVariants,
        unique_variants: firstNumber(uniqueVariantsResult, 'unique_variants'),
        avg_variants_per_case: totalCases > 0 ? totalVariants / totalCases : 0,
        genes_with_variants: firstNumber(genesWithVariantsResult, 'genes_with_variants'),
        starred_variants: 0,
        acmg_counts: {
          pathogenic: 0,
          likely_pathogenic: 0,
          vus: 0,
          likely_benign: 0,
          benign: 0
        }
      },
      cases: casesResult.rows.map((row) => this.toOverviewCase(row)),
      cohortGroups: cohortGroupsResult.rows.map((row) => this.toOverviewCohortGroup(row)),
      tags: [],
      topPhenotypes: topPhenotypesResult.rows.map((row) => this.toOverviewPhenotype(row))
    }
  }

  private table(name: string): string {
    return `${this.schemaName}.${quoteIdentifier(name)}`
  }

  private toOverviewCase(row: Row): OverviewCase {
    return {
      id: numberValue(row.id),
      name: String(row.name),
      variant_count: numberValue(row.variant_count),
      created_at: numberValue(row.created_at),
      affected_status: row.affected_status === null ? null : String(row.affected_status)
    }
  }

  private toOverviewCohortGroup(row: Row): OverviewCohortGroup {
    return {
      id: numberValue(row.id),
      name: String(row.name),
      description: row.description === null ? null : String(row.description),
      created_at: numberValue(row.created_at),
      member_count: numberValue(row.member_count)
    }
  }

  private toOverviewPhenotype(row: Row): OverviewPhenotype {
    return {
      hpo_id: String(row.hpo_id),
      hpo_label: String(row.hpo_label),
      case_count: numberValue(row.case_count)
    }
  }
}
