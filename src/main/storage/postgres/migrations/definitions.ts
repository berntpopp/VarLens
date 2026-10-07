import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

import type { PostgresMigration } from './types'
import { BUILT_IN_PRESETS } from '../../../database/built-in-presets'
import { BUILT_IN_SHORTLIST_PRESETS } from '../../../database/built-in-shortlist-presets'
import { CLINICAL_METRICS } from '../../../database/clinical-metrics'
import { quoteIdentifier } from '../identifiers'

interface MigrationFile {
  version: string
  name: string
  fileName: string
}

const MIGRATION_FILES: readonly MigrationFile[] = [
  { version: '0001', name: 'create_cases', fileName: '0001_create_cases.sql' },
  { version: '0002', name: 'create_case_metadata', fileName: '0002_create_case_metadata.sql' },
  { version: '0003', name: 'create_variants', fileName: '0003_create_variants.sql' },
  {
    version: '0004',
    name: 'generated_search_documents',
    fileName: '0004_generated_search_documents.sql'
  },
  {
    version: '0005',
    name: 'create_workflow_tables',
    fileName: '0005_create_workflow_tables.sql'
  },
  {
    version: '0006',
    name: 'create_audit_log',
    fileName: '0006_create_audit_log.sql'
  },
  {
    version: '0007',
    name: 'perf_indexes',
    fileName: '0007_perf_indexes.sql'
  },
  {
    version: '0008',
    name: 'create_users_and_settings',
    fileName: '0008_create_users_and_settings.sql'
  },
  {
    version: '0009',
    name: 'idx_variants_coords',
    fileName: '0009_idx_variants_coords.sql'
  },
  {
    version: '0010',
    name: 'cohort_summary',
    fileName: '0010_cohort_summary.sql'
  },
  {
    version: '0011',
    name: 'projects_registry',
    fileName: '0011_projects_registry.sql'
  },
  {
    version: '0012',
    name: 'extend_audit_contract',
    fileName: '0012_extend_audit_contract.sql'
  },
  {
    version: '0013',
    name: 'central_audit_schema',
    fileName: '0013_central_audit_schema.sql'
  },
  {
    version: '0014',
    name: 'variant_transcripts_func',
    fileName: '0014_variant_transcripts_func.sql'
  },
  {
    version: '0015',
    name: 'import_visibility',
    fileName: '0015_import_visibility.sql'
  },
  {
    version: '0016',
    name: 'platform_identity',
    fileName: '0016_platform_identity.sql'
  },
  {
    version: '0017',
    name: 'chr_rank_indexes',
    fileName: '0017_chr_rank_indexes.sql'
  },
  {
    version: '0018',
    name: 'case_deleting_status',
    fileName: '0018_case_deleting_status.sql'
  },
  {
    version: '0019',
    name: 'multi_admin',
    fileName: '0019_multi_admin.sql'
  },
  {
    version: '0020',
    name: 'user_roles',
    fileName: '0020_user_roles.sql'
  },
  {
    version: '0021',
    name: 'cohort_keyset_index',
    fileName: '0021_cohort_keyset_index.sql'
  },
  {
    version: '0022',
    name: 'cohort_frequency_read_time',
    fileName: '0022_cohort_frequency_read_time.sql'
  }
]

const SOURCE_SQL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'sql')

const PACKAGED_SQL_DIR = join(getResourcesPath(), 'postgres-migrations')

export const POSTGRES_MIGRATIONS: readonly PostgresMigration[] = MIGRATION_FILES.map(
  ({ version, name, fileName }) => {
    const sql = readMigrationSql(fileName)
    return {
      version,
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
      afterApply: version === '0005' ? seedWorkflowDefaults : undefined
    }
  }
)

async function seedWorkflowDefaults(
  client: Parameters<NonNullable<PostgresMigration['afterApply']>>[0],
  schema: string
): Promise<void> {
  const schemaName = quoteIdentifier(schema)
  const now = Date.now()

  for (const metric of CLINICAL_METRICS) {
    await client.query(
      `
        INSERT INTO ${schemaName}."metric_definitions"
          (name, value_type, unit, category, is_predefined, created_at)
        VALUES ($1, $2, $3, $4, 1, $5)
        ON CONFLICT (name) DO NOTHING
      `,
      [metric.name, metric.value_type, metric.unit, metric.category, now]
    )
  }

  for (const preset of BUILT_IN_PRESETS) {
    await client.query(
      `
        INSERT INTO ${schemaName}."filter_presets"
          (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
        VALUES ($1, $2, $3, 1, 1, $4, 'filter', $5, $5)
        ON CONFLICT (name) DO NOTHING
      `,
      [preset.name, preset.description, JSON.stringify(preset.filterJson), preset.sortOrder, now]
    )
  }

  for (const preset of BUILT_IN_SHORTLIST_PRESETS) {
    await client.query(
      `
        INSERT INTO ${schemaName}."filter_presets"
          (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
        VALUES ($1, $2, $3, 1, 1, $4, 'shortlist', $5, $5)
        ON CONFLICT (name) DO NOTHING
      `,
      [
        preset.name,
        preset.description,
        JSON.stringify({ shortlist: preset.config }),
        preset.sortOrder,
        now
      ]
    )
  }
}

function readMigrationSql(fileName: string): string {
  const filePath = resolveMigrationPath(fileName)
  return readFileSync(filePath, 'utf8')
}

function resolveMigrationPath(fileName: string): string {
  const candidates = [
    join(PACKAGED_SQL_DIR, fileName),
    join(SOURCE_SQL_DIR, fileName),
    resolve(process.cwd(), 'src/main/storage/postgres/migrations/sql', fileName)
  ]

  const filePath = candidates.find((candidate) => existsSync(candidate))
  if (filePath === undefined) {
    throw new Error(`Unable to locate PostgreSQL migration SQL file: ${fileName}`)
  }
  return filePath
}

function getResourcesPath(): string {
  const processWithResources = process as NodeJS.Process & { resourcesPath?: string }
  return processWithResources.resourcesPath ?? process.cwd()
}
