import { describe, expect, it, vi } from 'vitest'

import { mainLogger } from '../../../src/main/services/MainLogger'
import {
  awaitBackgroundRebuild,
  REBUILD_RETRY_BASE_MS
} from '../../../src/main/storage/postgres/cohort-read-freshness'
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
      // The maintained counter (#460) first; the summary only if its row is missing.
      if (
        sql.includes('AS unique_variants') &&
        /COALESCE\(\s*\(SELECT unique_variant_count FROM "public"\."cohort_summary_state"/.test(sql)
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
  // The overview is the landing page: it must come up whatever state the
  // cohort summary is in, and say when its figures are being refreshed.
  describe('summary freshness', () => {
    interface ProbeRow {
      never_rebuilt: boolean
      variants_present: boolean
      summary_present: boolean
      gene_summary_missing: boolean
      is_stale: boolean
      total_cases: string
    }
    const fresh: ProbeRow = {
      never_rebuilt: false,
      variants_present: true,
      summary_present: true,
      gene_summary_missing: false,
      is_stale: false,
      total_cases: '2'
    }

    function makePool(probeRows: ProbeRow[] | Error): {
      pool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }
      releaseRebuild: () => void
    } {
      let releaseRebuild: () => void = () => undefined
      const rebuildGate = new Promise<void>((resolve) => {
        releaseRebuild = resolve
      })
      const query = vi.fn(async (config: string | { text: string }) => {
        const sql = typeof config === 'string' ? config : config.text
        if (sql.includes('"cohort_summary_state" s')) {
          if (probeRows instanceof Error) throw probeRows
          return { rows: probeRows }
        }
        return { rows: [] }
      })
      // A rebuild that would hold a request for as long as the test lets it.
      const connect = vi.fn(async () => {
        await rebuildGate
        return { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
      })
      return { pool: { query, connect }, releaseRebuild }
    }

    it('does not throw when the summary state row is missing', async () => {
      const { pool } = makePool([])
      const overview = await new PostgresOverviewRepository(
        pool as never,
        'ov_missing'
      ).getOverview()
      expect(overview.summary.total_cases).toBe(0)
      expect(overview.warnings).toBeUndefined()
      expect(pool.connect).not.toHaveBeenCalled()
    })

    it('does not throw when the freshness probe itself fails', async () => {
      const { pool } = makePool(new Error('relation "cohort_summary_state" does not exist'))
      const overview = await new PostgresOverviewRepository(
        pool as never,
        'ov_broken'
      ).getOverview()
      expect(overview.cases).toEqual([])
      expect(overview.warnings).toBeUndefined()
    })

    it('serves a fresh summary without a warning or a rebuild', async () => {
      const { pool } = makePool([fresh])
      const overview = await new PostgresOverviewRepository(pool as never, 'ov_fresh').getOverview()
      expect(overview.warnings).toBeUndefined()
      expect(pool.connect).not.toHaveBeenCalled()
    })

    it.each([
      ['a stale summary', { ...fresh, is_stale: true }],
      ['a summary that was never built for existing data', { ...fresh, summary_present: false }],
      ['a stale summary of a small cohort', { ...fresh, is_stale: true, total_cases: '1' }]
    ])('answers at once for %s, flags it stale and rebuilds in the background', async (_, row) => {
      const schema = `ov_stale_${Math.random().toString(36).slice(2)}`
      const { pool, releaseRebuild } = makePool([row])
      const repo = new PostgresOverviewRepository(pool as never, schema)

      // Resolves although the rebuild cannot even get a connection yet.
      const overview = await repo.getOverview()
      expect(overview.warnings).toEqual({ staleSummary: true })
      expect(pool.connect).toHaveBeenCalledTimes(1)

      // A second read while that rebuild runs does not start another one.
      expect((await repo.getOverview()).warnings).toEqual({ staleSummary: true })
      expect(pool.connect).toHaveBeenCalledTimes(1)

      releaseRebuild()
      await awaitBackgroundRebuild(schema)
    })
    it('backs off after a failed background rebuild instead of retrying on every read', async () => {
      const schema = `ov_backoff_${Math.random().toString(36).slice(2)}`
      const errorLog = vi.spyOn(mainLogger, 'error').mockImplementation(() => undefined)
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        const query = vi.fn(async (config: string | { text: string }) => {
          const sql = typeof config === 'string' ? config : config.text
          return sql.includes('"cohort_summary_state" s')
            ? { rows: [{ ...fresh, is_stale: true }] }
            : { rows: [] }
        })
        // Every attempt fails the way an over-long rebuild does.
        const connect = vi.fn(async () => {
          throw new Error('canceling statement due to statement timeout')
        })
        const repo = new PostgresOverviewRepository({ query, connect } as never, schema)

        expect((await repo.getOverview()).warnings).toEqual({ staleSummary: true })
        await awaitBackgroundRebuild(schema)
        expect(connect).toHaveBeenCalledTimes(1)
        // Visible at error level, with the reason and when it will be retried.
        expect(errorLog).toHaveBeenCalledWith(
          expect.stringMatching(
            /rebuild of .*ov_backoff.* failed \(attempt 1\): canceling statement due to statement timeout.*next attempt/
          ),
          'cohort'
        )

        // Reads keep being served (and flagged) but do not start another attempt …
        for (let read = 0; read < 5; read++) {
          expect((await repo.getOverview()).warnings).toEqual({ staleSummary: true })
        }
        await awaitBackgroundRebuild(schema)
        expect(connect).toHaveBeenCalledTimes(1)

        // … until the backoff has passed; a second failure waits longer.
        vi.setSystemTime(Date.now() + REBUILD_RETRY_BASE_MS + 1)
        await repo.getOverview()
        await awaitBackgroundRebuild(schema)
        expect(connect).toHaveBeenCalledTimes(2)
        vi.setSystemTime(Date.now() + REBUILD_RETRY_BASE_MS + 1)
        await repo.getOverview()
        await awaitBackgroundRebuild(schema)
        expect(connect).toHaveBeenCalledTimes(2)
        vi.setSystemTime(Date.now() + REBUILD_RETRY_BASE_MS + 1)
        await repo.getOverview()
        await awaitBackgroundRebuild(schema)
        expect(connect).toHaveBeenCalledTimes(3)
      } finally {
        vi.useRealTimers()
        errorLog.mockRestore()
      }
    })
  })
})
