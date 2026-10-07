import { describe, expect, it, vi } from 'vitest'

import { PostgresOverviewRepository } from '../../../src/main/storage/postgres/PostgresOverviewRepository'

describe('PostgresOverviewRepository', () => {
  it('returns a database overview matching the SQLite overview shape', async () => {
    const query = vi.fn(async (config: string | { text: string }) => {
      const sql = typeof config === 'string' ? config : config.text
      if (sql.includes('COUNT(*)::int AS total_cases')) {
        return { rows: [{ total_cases: '2' }] }
      }
      if (sql.includes('SUM(variant_count), 0)::bigint FROM "public"."cases") AS total_variants')) {
        return { rows: [{ total_variants: '10' }] }
      }
      // The maintained counter (#460): one row of the state table, no scan.
      if (
        sql.includes('AS unique_variants') &&
        sql.includes('unique_variant_count FROM "public"."cohort_summary_state"') &&
        !sql.includes('cohort_variant_summary')
      ) {
        return { rows: [{ unique_variants: '8' }] }
      }
      if (sql.includes('"cohort_gene_summary") AS genes_with_variants')) {
        return { rows: [{ genes_with_variants: '4' }] }
      }
      if (sql.includes('FROM "public"."cases" c')) {
        return {
          rows: [
            {
              id: '7',
              name: 'case-b',
              variant_count: '6',
              created_at: '2000',
              affected_status: 'affected'
            },
            {
              id: '3',
              name: 'case-a',
              variant_count: '4',
              created_at: '1000',
              affected_status: null
            }
          ]
        }
      }
      if (sql.includes('FROM "public"."cohort_groups" cg')) {
        return {
          rows: [
            {
              id: '5',
              name: 'trio',
              description: 'Example cohort',
              created_at: '3000',
              member_count: '2'
            }
          ]
        }
      }
      if (sql.includes('FROM "public"."case_hpo_terms"')) {
        return {
          rows: [{ hpo_id: 'HP:0001250', hpo_label: 'Seizure', case_count: '2' }]
        }
      }
      return { rows: [] }
    })
    const repo = new PostgresOverviewRepository({ query } as never, 'public')

    await expect(repo.getOverview()).resolves.toEqual({
      summary: {
        total_cases: 2,
        total_variants: 10,
        unique_variants: 8,
        avg_variants_per_case: 5,
        genes_with_variants: 4,
        starred_variants: 0,
        acmg_counts: {
          pathogenic: 0,
          likely_pathogenic: 0,
          vus: 0,
          likely_benign: 0,
          benign: 0
        }
      },
      cases: [
        {
          id: 7,
          name: 'case-b',
          variant_count: 6,
          created_at: 2000,
          affected_status: 'affected'
        },
        {
          id: 3,
          name: 'case-a',
          variant_count: 4,
          created_at: 1000,
          affected_status: null
        }
      ],
      cohortGroups: [
        {
          id: 5,
          name: 'trio',
          description: 'Example cohort',
          created_at: 3000,
          member_count: 2
        }
      ],
      tags: [],
      topPhenotypes: [{ hpo_id: 'HP:0001250', hpo_label: 'Seizure', case_count: 2 }]
    })
  })
})
