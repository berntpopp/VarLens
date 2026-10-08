import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import {
  GT_DOSAGE_SQL,
  HEMI_GT_SQL,
  HET_GT_SQL,
  HOM_GT_SQL,
  gtDosageSql
} from '../../../src/shared/sql/genotype-dosage'
import { genotypeZygosity, gtToDosage } from '../../../src/shared/utils/genotype'

describe('GT_DOSAGE_SQL cross-check with gtToDosage', () => {
  let db: InstanceType<typeof Database>

  beforeAll(() => {
    db = new Database(':memory:')
    db.exec('CREATE TABLE test_gt (gt_num TEXT)')
  })

  afterAll(() => {
    db.close()
  })

  const testCases: Array<[string | null, number | null]> = [
    ['0/0', 0],
    ['0|0', 0],
    ['0/1', 1],
    ['1/0', 1],
    ['0|1', 1],
    ['1|0', 1],
    ['1/1', 2],
    ['1|1', 2],
    ['0', 0],
    ['1', 1],
    ['1/.', 1],
    ['./1', 1],
    ['1|.', 1],
    ['.|1', 1],
    ['0/.', null],
    ['./.', null],
    ['.|.', null],
    ['.', null],
    [null, null]
  ]

  for (const [gt, expected] of testCases) {
    it(`GT "${gt}" produces dosage ${expected} in both SQL and TS`, () => {
      // TS utility
      const tsResult = gtToDosage(gt)
      expect(tsResult).toBe(expected)

      // SQL CASE
      db.exec('DELETE FROM test_gt')
      db.prepare('INSERT INTO test_gt (gt_num) VALUES (?)').run(gt)
      const row = db.prepare(`SELECT ${GT_DOSAGE_SQL} AS dosage FROM test_gt`).get() as {
        dosage: number | null
      }
      expect(row.dosage).toBe(expected)
    })
  }

  it('reads the genotype from the column it is given', () => {
    db.exec('DELETE FROM test_gt')
    db.prepare('INSERT INTO test_gt (gt_num) VALUES (?)').run('1|.')
    const row = db.prepare(`SELECT ${gtDosageSql('t.gt_num')} AS dosage FROM test_gt t`).get()
    expect(row).toEqual({ dosage: 1 })
  })

  it('the SQL zygosity lists are the classes of genotypeZygosity', () => {
    const classOf = db.prepare(
      `SELECT CASE WHEN @gt IN ${HET_GT_SQL} THEN 'het' WHEN @gt IN ${HOM_GT_SQL} THEN 'hom'
              WHEN @gt IN ${HEMI_GT_SQL} THEN 'hemi' END AS zygosity`
    )
    for (const [gt] of testCases) {
      expect(classOf.get({ gt }), String(gt)).toEqual({ zygosity: genotypeZygosity(gt) })
    }
  })
})
