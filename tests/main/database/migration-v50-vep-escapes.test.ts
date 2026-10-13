/**
 * Migration v50 (#547): rows imported before the fix kept VEP's %3D / %3B
 * escapes in cdna / aa_change; the migration decodes them in place.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'

describe('migration v50: decode VEP HGVS escapes', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => db.close())

  it('decodes existing variant, transcript and cohort summary rows', () => {
    db.exec(`
      INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at)
        VALUES (1, 'c', '/c.vcf', 0, 1, 0);
      INSERT INTO variants (id, case_id, chr, pos, ref, alt, cdna, aa_change)
        VALUES (1, 1, 'chr1', 100, 'A', 'G', 'c.1%3B2del', 'p.Pro814%3D'),
               (2, 1, 'chr1', 200, 'A', 'G', 'c.5A>G', 'p.%ZZ');
      INSERT INTO variant_transcripts (variant_id, transcript_id, cdna, aa_change)
        VALUES (1, 'T1', 'c.1%3B2del', 'p.Pro814%3D');
      INSERT INTO cohort_variant_summary
        (chr, pos, ref, alt, cdna, aa_change, carrier_count, het_count, hom_count, variant_key)
        VALUES ('chr1', 100, 'A', 'G', 'c.1%3B2del', 'p.Pro814%3D', 1, 1, 0, 'k');
      PRAGMA user_version = 49;
    `)

    runMigrations(db)

    expect(db.prepare('SELECT cdna, aa_change FROM variants ORDER BY id').all()).toEqual([
      { cdna: 'c.1;2del', aa_change: 'p.Pro814=' },
      { cdna: 'c.5A>G', aa_change: 'p.%ZZ' }
    ])
    expect(db.prepare('SELECT cdna, aa_change FROM variant_transcripts').get()).toEqual({
      cdna: 'c.1;2del',
      aa_change: 'p.Pro814='
    })
    expect(db.prepare('SELECT cdna, aa_change FROM cohort_variant_summary').get()).toEqual({
      cdna: 'c.1;2del',
      aa_change: 'p.Pro814='
    })
    expect(db.pragma('user_version', { simple: true })).toBe(50)
  })
})
