import { describe, expect, test } from 'vitest'

import {
  CONTROL_DB_MIGRATIONS,
  POSTGRES_MIGRATIONS
} from '../../../src/main/storage/postgres/migrations/definitions'

/**
 * A5a — the hosted control DB runs a routing/auth/audit-only migration subset so it
 * never receives case-data DDL (cases, variants, workflow, search, cohort).
 */
describe('CONTROL_DB_MIGRATIONS', () => {
  test('excludes case-data migrations and keeps routing/auth/audit', () => {
    const versions = new Set(CONTROL_DB_MIGRATIONS.map((migration) => migration.version))
    for (const excluded of ['0001', '0002', '0003', '0004', '0005', '0007', '0009', '0010']) {
      expect(versions.has(excluded)).toBe(false)
    }
    // audit_log, users_and_settings, hosted_user_private_db must remain.
    for (const kept of ['0006', '0008', '0014']) {
      expect(versions.has(kept)).toBe(true)
    }
  })

  test('never creates case-data tables but does create users', () => {
    const sql = CONTROL_DB_MIGRATIONS.map((migration) => migration.sql).join('\n')
    expect(sql).not.toMatch(/CREATE TABLE[\s\S]*?"cases"/i)
    expect(sql).not.toMatch(/CREATE TABLE[\s\S]*?"variants"/i)
    expect(sql).toMatch(/"users"/)
  })

  test('is a strict subset of the full migration set', () => {
    const full = new Set(POSTGRES_MIGRATIONS.map((migration) => migration.version))
    for (const migration of CONTROL_DB_MIGRATIONS) {
      expect(full.has(migration.version)).toBe(true)
    }
    expect(CONTROL_DB_MIGRATIONS.length).toBeLessThan(POSTGRES_MIGRATIONS.length)
  })
})
