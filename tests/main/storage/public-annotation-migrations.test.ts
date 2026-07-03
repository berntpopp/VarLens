import { describe, expect, test } from 'vitest'

import {
  POSTGRES_MIGRATIONS,
  PUBLIC_ANNOTATION_MIGRATIONS
} from '../../../src/main/storage/postgres/migrations/definitions'

/**
 * B3 — the public annotation schema is a versioned migration owned by the
 * sync-public-annotations command, kept OUT of the main workspace/control set so
 * the public_annotation_* tables are never created inside a private or control DB.
 */
describe('PUBLIC_ANNOTATION_MIGRATIONS', () => {
  test('provisions the public_annotation schema', () => {
    const sql = PUBLIC_ANNOTATION_MIGRATIONS.map((migration) => migration.sql).join('\n')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "__schema__"\."public_annotation_snapshots"/)
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS "__schema__"\."public_annotation_variant_records"/
    )
    expect(
      PUBLIC_ANNOTATION_MIGRATIONS.every((migration) => migration.checksum.length === 64)
    ).toBe(true)
  })

  test('is kept out of the main workspace/control migration set', () => {
    const mainVersions = new Set(POSTGRES_MIGRATIONS.map((migration) => migration.version))
    for (const migration of PUBLIC_ANNOTATION_MIGRATIONS) {
      expect(mainVersions.has(migration.version)).toBe(false)
    }
    const mainSql = POSTGRES_MIGRATIONS.map((migration) => migration.sql).join('\n')
    expect(mainSql).not.toContain('public_annotation_snapshots')
  })
})
