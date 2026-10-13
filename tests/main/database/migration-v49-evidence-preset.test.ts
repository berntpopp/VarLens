import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createRepositories } from '../../../src/main/database/createRepositories'
import {
  EVIDENCE_BETA_PRESET,
  EVIDENCE_BETA_RULESET_SHA256,
  evidenceBetaFilterJson
} from '../../../src/main/database/evidence-ranking-preset'
import {
  VARVIS_EVIDENCE_BETA_V1,
  rulesetSha256
} from '../../../src/main/database/evidence-rulesets/artifact'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../src/shared/config/evidence-rulesets/varvis-template'
import { compileRuleset, validateEvidenceConfig } from '../../../src/main/services/scoring/evidence'

function presetRows(db: DatabaseType) {
  return db
    .prepare(`SELECT name, filter_json, is_built_in, kind FROM filter_presets WHERE name = ?`)
    .all(EVIDENCE_BETA_PRESET.name) as Array<{
    name: string
    filter_json: string
    is_built_in: number
    kind: string
  }>
}

describe('evidence ranking (beta) artifact', () => {
  it('is the frozen hand-set varvis template and its hash matches', () => {
    expect(rulesetSha256(VARVIS_EVIDENCE_BETA_V1)).toBe(VARVIS_EVIDENCE_BETA_V1.sha256)
    expect(VARVIS_EVIDENCE_BETA_V1.sha256).toBe(EVIDENCE_BETA_RULESET_SHA256)
    const body = (rs: typeof VARVIS_EVIDENCE_BETA_V1): object => ({ ...rs, id: '', sha256: '' })
    expect(body(VARVIS_EVIDENCE_BETA_V1)).toEqual(body(VARVIS_EVIDENCE_TEMPLATE))
  })

  it('compiles and is a valid evidence configuration', () => {
    expect(() => compileRuleset(VARVIS_EVIDENCE_BETA_V1)).not.toThrow()
    expect(validateEvidenceConfig(EVIDENCE_BETA_PRESET.config)).toEqual([])
  })
})

describe('SQLite migration v49', () => {
  let db: DatabaseType
  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })
  afterEach(() => db.close())

  it('seeds the built-in shortlist preset with the exact filter_json', () => {
    const rows = presetRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ is_built_in: 1, kind: 'shortlist' })
    expect(rows[0].filter_json).toBe(evidenceBetaFilterJson())
  })

  it('is a no-op on replay and keeps a user preset of the same name', () => {
    db.prepare('DELETE FROM filter_presets WHERE name = ?').run(EVIDENCE_BETA_PRESET.name)
    db.prepare(
      `INSERT INTO filter_presets (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
       VALUES (?, 'mine', '{"shortlist":{}}', 0, 1, 99, 'shortlist', 0, 0)`
    ).run(EVIDENCE_BETA_PRESET.name)
    db.pragma('user_version = 48')
    runMigrations(db)
    const rows = presetRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].is_built_in).toBe(0)
  })

  it('ranks a case through getShortlist by preset id', () => {
    const { id } = db
      .prepare('SELECT id FROM filter_presets WHERE name = ?')
      .get(EVIDENCE_BETA_PRESET.name) as { id: number }
    db.prepare(
      `INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at, genome_build)
       VALUES (1, 'c', '/c', 1, 0, 0, 'GRCh38')`
    ).run()
    db.prepare(
      `INSERT INTO variants (case_id, variant_type, chr, pos, ref, alt, gene_symbol, consequence, func, gnomad_af, cadd, gt_num, moi)
       VALUES (1, 'snv', '1', 100, 'C', 'T', 'GENEA', 'HIGH', 'stop_gained', NULL, 38, '1/1', 'AR'),
              (1, 'snv', '1', 200, 'G', 'A', 'GENEB', 'MODERATE', 'missense_variant', 0.004, 12, '0/1', 'AD')`
    ).run()
    const { shortlistService } = createRepositories(db)
    const result = shortlistService.getShortlist({ caseId: 1, presetId: id }, () => null)
    expect(result.rows.map((r) => r.gene_symbol)).toEqual(['GENEA', 'GENEB'])
    expect(result.rows[0].rank_mode).toBe('ar_hom')
  })
})
