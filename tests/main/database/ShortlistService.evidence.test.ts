/**
 * Evidence-rule ranking in the SQLite shortlist service (spec §3.3–3.4,
 * Review Focus 2 and 4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createRepositories } from '../../../src/main/database/createRepositories'
import { DatabaseError } from '../../../src/main/database/errors'
import { openHpoGeneScorer } from '../../../src/main/services/phenotype/hpo-similarity-db'
import type { ShortlistService } from '../../../src/main/database/ShortlistService'
import type { ShortlistConfig } from '../../../src/shared/types/shortlist'
import {
  AD_LOF_ID,
  COMPHET_INDEL_ID,
  COMPHET_SNV_ID,
  EVIDENCE_CONFIG,
  EVIDENCE_RULESET,
  evidenceFixtureRows
} from '../../fixtures/shortlist/evidence-fixture'
import { SHORTLIST_PAGE_SIZE } from '../../../src/main/database/shortlist-query'

vi.mock('../../../src/main/services/phenotype/hpo-similarity-db', async (original) => ({
  ...(await original<object>()),
  openHpoGeneScorer: vi.fn(() => null)
}))

const bufferCap = vi.hoisted(() => ({ rows: null as number | null }))
vi.mock('../../../src/main/database/shortlist-query', async (original) => {
  const actual = await original<typeof import('../../../src/main/database/shortlist-query')>()
  return {
    ...actual,
    get SHORTLIST_BUFFER_MAX_ROWS() {
      return bufferCap.rows ?? actual.SHORTLIST_BUFFER_MAX_ROWS
    }
  }
})

function seed(db: DatabaseType): void {
  db.prepare(
    `INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at, genome_build)
     VALUES (1, 'evidence', '/test/evidence.vcf', 0, 0, 0, 'GRCh38')`
  ).run()
  const insert = db.prepare(
    `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol, moi,
                           gt_num, consequence, func, gnomad_af)
     VALUES (@id, 1, @variant_type, @chr, @pos, @ref, @alt, @gene_symbol, @moi,
             @gt_num, @consequence, @func, @gnomad_af)`
  )
  db.transaction(() => {
    for (const row of evidenceFixtureRows()) insert.run(row)
  })()
}

describe('ShortlistService — evidence ranking', () => {
  let db: DatabaseType
  let service: ShortlistService
  let repos: ReturnType<typeof createRepositories>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    seed(db)
    repos = createRepositories(db)
    service = repos.shortlistService
  })

  afterEach(() => db.close())

  const run = (
    config: ShortlistConfig = EVIDENCE_CONFIG
  ): ReturnType<ShortlistService['getShortlist']> =>
    service.getShortlist({ caseId: 1, adHocConfig: config }, () => null)

  it('opens the HPO scorer only for rulesets that read hpo_resnik', () => {
    vi.mocked(openHpoGeneScorer).mockClear()
    run()
    expect(openHpoGeneScorer).not.toHaveBeenCalled()
    const ruleset = EVIDENCE_CONFIG.rankConfig.ruleset!
    const hpoGroup = {
      id: 'hpo',
      label: 'HPO',
      scope: 'global' as const,
      rules: [{ id: 'hpo', label: 'HPO', when: 'hpo_resnik:>=:2', points: 1 }]
    }
    run({
      ...EVIDENCE_CONFIG,
      rankConfig: {
        ...EVIDENCE_CONFIG.rankConfig,
        ruleset: { ...ruleset, groups: [...ruleset.groups, hpoGroup] }
      }
    })
    expect(openHpoGeneScorer).toHaveBeenCalledTimes(1)
  })

  it('pairs compound-het alleles split across pages and SNV/indel types', () => {
    const { rows } = run()
    const snv = rows.find((r) => r.id === COMPHET_SNV_ID)
    const indel = rows.find((r) => r.id === COMPHET_INDEL_ID)
    expect(snv?.rank_mode).toBe('ar_comphet')
    expect(indel?.rank_mode).toBe('ar_comphet')
    expect(snv?.rank_partners).toEqual([COMPHET_INDEL_ID])
    expect(indel?.rank_partners).toEqual([COMPHET_SNV_ID])
    expect(rows.slice(0, 3).map((r) => r.id)).toEqual([COMPHET_INDEL_ID, AD_LOF_ID, COMPHET_SNV_ID])
  })

  it('explains every score exactly: contributions sum to rank_score', () => {
    const { rows } = run()
    expect(rows).toHaveLength(50)
    for (const row of rows) {
      const sum = (row.rank_evidence ?? []).reduce((acc, c) => acc + c.points, 0)
      expect(row.rank_evidence?.[0].kind).toBe('mode')
      expect(sum).toBeCloseTo(row.rank_score, 10)
    }
  })

  it('reads the case sex from case metadata (male chrX hom → hemi)', () => {
    db.prepare(
      `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol, moi,
                             gt_num, consequence, func, gnomad_af)
       VALUES (9001, 1, 'snv', 'X', 50000000, 'A', 'G', 'GENEX', 'XR', '1/1', 'HIGH', 'stop_gained', NULL)`
    ).run()
    const config: ShortlistConfig = {
      ...EVIDENCE_CONFIG,
      rankConfig: {
        ...EVIDENCE_CONFIG.rankConfig,
        ruleset: {
          ...EVIDENCE_RULESET,
          modes: [
            EVIDENCE_RULESET.modes[0],
            { id: 'xl', label: 'X-linked hemizygous', when: 'zygosity:=:hemi', points: 4 },
            EVIDENCE_RULESET.modes[EVIDENCE_RULESET.modes.length - 1]
          ]
        }
      }
    }
    expect(run(config).rows.find((r) => r.id === 9001)?.rank_mode).toBe('fallback')
    repos.metadata.upsertCaseMetadata(1, { sex: 'male' })
    expect(run(config).rows.find((r) => r.id === 9001)?.rank_mode).toBe('xl')
  })

  it('fails loudly with the preset name when a stored rule is invalid', () => {
    const bad = repos.filterPresets.createPreset({
      name: 'Broken evidence',
      kind: 'shortlist',
      filterJson: {
        shortlist: {
          ...EVIDENCE_CONFIG,
          rankConfig: {
            ...EVIDENCE_CONFIG.rankConfig,
            ruleset: {
              ...EVIDENCE_RULESET,
              groups: [
                {
                  id: 'bad',
                  label: 'Bad',
                  scope: 'global',
                  rules: [{ id: 'bad_rule', label: 'Bad', when: 'nope:=:1', points: 1 }]
                }
              ]
            }
          }
        }
      } as never
    })
    const attempt = (): unknown => service.getShortlist({ caseId: 1, presetId: bad.id }, () => null)
    expect(attempt).toThrow(DatabaseError)
    expect(attempt).toThrow(/Shortlist preset "Broken evidence".*nope/)
  })

  it('rejects an evidence configuration that scopes SVs', () => {
    expect(() => run({ ...EVIDENCE_CONFIG, variantTypeScope: ['snv', 'sv'] })).toThrow(
      /variantTypeScope/
    )
    expect(() => run({ ...EVIDENCE_CONFIG, variantTypeScope: ['snv', 'sv'] })).toThrow(
      DatabaseError
    )
  })

  it('rankCase(…, Infinity) ranks every candidate and agrees with getShortlist', () => {
    const top = run()
    const all = service.rankCase({ caseId: 1, adHocConfig: EVIDENCE_CONFIG }, () => null, Infinity)
    expect(all.rows).toHaveLength(all.totalCandidates)
    expect(all.totalCandidates).toBe(evidenceFixtureRows().length)
    expect(all.rows.slice(0, top.rows.length).map((r) => [r.id, r.rank_score])).toEqual(
      top.rows.map((r) => [r.id, r.rank_score])
    )
  })

  it('ranks identically whether pass 2 reuses the pass-1 rows or re-queries them', () => {
    const buffered = service.rankCase({ caseId: 1, adHocConfig: EVIDENCE_CONFIG }, () => null, Infinity)
    bufferCap.rows = 0
    try {
      const requeried = service.rankCase(
        { caseId: 1, adHocConfig: EVIDENCE_CONFIG },
        () => null,
        Infinity
      )
      expect(requeried.rows.length).toBeGreaterThan(SHORTLIST_PAGE_SIZE)
      expect(buffered.rows).toEqual(requeried.rows)
    } finally {
      bufferCap.rows = null
    }
  })

  it('keeps legacy rows free of evidence fields', () => {
    const legacyRank = { ...EVIDENCE_CONFIG.rankConfig, ruleset: undefined }
    const { rows } = run({ ...EVIDENCE_CONFIG, rankConfig: legacyRank })
    expect(rows[0].rank_evidence).toBeUndefined()
    expect(rows[0].rank_mode).toBeUndefined()
  })
})
