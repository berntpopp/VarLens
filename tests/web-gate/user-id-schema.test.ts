import { afterAll, describe, expect, test } from 'vitest'
import { listTables, openMigratedTmpDb, tableColumns } from './helpers/tmp-db'

/**
 * Web pilot gate — the current web pilot is explicitly single-user.
 * `auth:createUser` remains disabled, and row-level multi-user data
 * isolation is out of scope until a later scoped phase.
 *
 * `user_id INTEGER NOT NULL DEFAULT 1` is schema prep only. It keeps the
 * later isolation migration bounded without making this web slice
 * multi-user-ready.
 *
 * Strategy: maintain a snapshot set of "tables that should have user_id
 * but currently don't." Test passes if the actual set of tables-without-
 * user_id is exactly the snapshot — meaning no new domain table was added
 * without `user_id` (would grow the set), and no expected table was
 * forgotten (would be in the snapshot but the test would still pass when
 * removed manually). When a later scoped isolation PR adds `user_id` to a
 * table, the developer removes it from `EXPECTED_MISSING_USER_ID` in the
 * same PR.
 *
 * The `EXEMPT_TABLES` set captures tables that should NEVER need user_id:
 * junctions, reference data, KV-meta, virtual FTS5 tables.
 */

// Tables that legitimately do not need a `user_id` column.
// Junctions are owned by their parent rows; reference/cache tables are
// shared; KV tables are app-wide; FTS5 virtual tables are computed.
const EXEMPT_TABLES = new Set([
  // KV / meta
  'database_settings',
  'cohort_summary_meta',
  // Reference / cache (shared across users)
  'cohort_variant_summary',
  'gene_burden_summary',
  'variant_frequency',
  'gene_list_items',
  'panel_genes',
  'region_file_entries',
  // Junctions
  'case_active_panels',
  'case_cohort_links',
  'variant_tags',
  'analysis_group_members',
  'case_variant_annotations',
  // Owned by its case (chromosome-name migration v47: case build to confirm)
  'contig_build_review',
  // Variant detail extensions (owned by parent variant row)
  'variant_transcripts',
  'variant_sv',
  'variant_cnv',
  'variant_str',
  // FTS5 virtual tables (computed, no schema columns)
  'variants_fts',
  'variant_sv_fts',
  'variant_str_fts',
  // FTS5 shadow tables (auto-created by virtual FTS tables)
  'variants_fts_data',
  'variants_fts_idx',
  'variants_fts_docsize',
  'variants_fts_config',
  'variant_sv_fts_data',
  'variant_sv_fts_idx',
  'variant_sv_fts_docsize',
  'variant_sv_fts_config',
  'variant_str_fts_data',
  'variant_str_fts_idx',
  'variant_str_fts_docsize',
  'variant_str_fts_config',
  // Provenance / audit / users
  'audit_log', // has its own user_name → user_id migration tracked by audit-shape.test.ts
  'users', // identity itself
  'case_import_files', // provenance
  'api_cache', // ephemeral
  // Multi-tenancy scope registry (Sprint A PR-4 D5). `projects` maps a project
  // id to its schema_name, which IS the tenant boundary (PG schema / SQLite
  // path) threaded through every repository as the `schema` arg. It defines
  // scopes rather than holding per-user rows; per-project / multi-tenant auth
  // is explicitly Out of scope (Sprint F+) per .planning/specs/2026-05-28-
  // multi-project-architecture.md. Like `users`, it never carries user_id.
  'projects'
])

// Snapshot of domain tables that still lack `user_id` schema-prep columns.
// This backlog does not enable multi-user web mode; it stays visible until a
// later scoped row-level isolation phase adds columns and removes entries.
const EXPECTED_MISSING_USER_ID = new Set([
  'cases',
  'variants',
  'variant_annotations',
  'case_metadata',
  'cohort_groups',
  'tags',
  'case_hpo_terms',
  'case_comments',
  'metric_definitions',
  'case_metrics',
  'case_data_info',
  'case_external_ids',
  'gene_lists',
  'region_files',
  'filter_presets',
  'panels',
  'analysis_groups'
])

describe('user-id-schema gate', () => {
  const tmp = openMigratedTmpDb()
  afterAll(() => tmp.cleanup())

  test('every non-exempt table has user_id NOT NULL DEFAULT 1, modulo the snapshot', () => {
    const tables = listTables(tmp.db)
    const missing: string[] = []
    const malformed: string[] = []

    for (const table of tables) {
      if (EXEMPT_TABLES.has(table)) continue

      const cols = tableColumns(tmp.db, table)
      const userId = cols.find((c) => c.name === 'user_id')

      if (!userId) {
        if (!EXPECTED_MISSING_USER_ID.has(table)) {
          missing.push(table)
        }
        continue
      }

      // Has user_id — must be NOT NULL with default 1.
      const hasDefault1 = userId.dflt_value === '1' || userId.dflt_value === '(1)'
      if (userId.notnull !== 1 || !hasDefault1) {
        malformed.push(
          `${table} (notnull=${userId.notnull}, default=${JSON.stringify(userId.dflt_value)})`
        )
      }
    }

    expect(
      missing,
      missing.length
        ? `Tables added without user_id. Add 'user_id INTEGER NOT NULL DEFAULT 1' to the migration, OR if the table is shared/junction/reference data, add it to EXEMPT_TABLES in this test. Context: .planning/web/completed/testing/desktop-to-web-parity.md user-id-schema\n  ${missing.join('\n  ')}`
        : 'no surprise missing user_id'
    ).toEqual([])

    expect(
      malformed,
      malformed.length
        ? `tables with user_id but wrong shape (need NOT NULL DEFAULT 1):\n  ${malformed.join('\n  ')}`
        : 'all user_id columns well-formed'
    ).toEqual([])
  })

  test('snapshot is consistent with the live schema (no stale entries)', () => {
    // If a table is in EXPECTED_MISSING_USER_ID but the table itself has
    // been removed or renamed, fail loudly so we don't carry dead snapshot
    // entries forever.
    const liveTables = new Set(listTables(tmp.db))
    const stale = [...EXPECTED_MISSING_USER_ID].filter((t) => !liveTables.has(t))
    expect(
      stale,
      stale.length
        ? `EXPECTED_MISSING_USER_ID references tables that no longer exist: ${stale.join(', ')}`
        : 'snapshot is consistent'
    ).toEqual([])
  })

  test.fails('later row-level isolation phase: EXPECTED_MISSING_USER_ID is empty', () => {
    // Self-revoking TODO. When the later scoped row-level isolation phase
    // adds `user_id` to every domain table, the snapshot empties out and
    // this test starts passing — at which point flip `test.fails()` →
    // `test()` and delete EXPECTED_MISSING_USER_ID entirely.
    expect([...EXPECTED_MISSING_USER_ID]).toEqual([])
  })
})
