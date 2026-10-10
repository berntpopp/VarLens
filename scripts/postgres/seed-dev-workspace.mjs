#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { URL } from 'node:url'
import { fileURLToPath } from 'node:url'

const DEFAULT_ENV_FILE = '.env.postgres.local'
const DEFAULT_SCHEMA = 'public'
const FIXED_NOW = 1714060810000
const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/main/storage/postgres/migrations/sql'
)
const CLINICAL_METRICS_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/main/database/clinical-metrics.ts'
)
const CONNECTION_ATTEMPTS = 30
const CONNECTION_RETRY_DELAY_MS = 1000

const MIGRATION_FILES = [
  ['0001', 'create_cases'],
  ['0002', 'create_case_metadata'],
  ['0003', 'create_variants'],
  ['0004', 'generated_search_documents'],
  ['0005', 'create_workflow_tables'],
  ['0006', 'create_audit_log']
].map(([version, name]) => ({ version, name, fileName: `${version}_${name}.sql` }))

const FILTER_PRESETS = [
  {
    name: 'Rare Pathogenic',
    description: 'gnomAD AF <= 1% + ClinVar P/LP',
    filterJson: {
      maxGnomadAf: 0.01,
      clinvars: ['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic']
    },
    sortOrder: 0
  },
  {
    name: 'Rare HIGH',
    description: 'gnomAD AF <= 1% + HIGH impact',
    filterJson: { maxGnomadAf: 0.01, consequences: ['HIGH'] },
    sortOrder: 1
  },
  {
    name: 'Rare HIGH+MOD',
    description: 'gnomAD AF <= 1% + HIGH or MODERATE impact',
    filterJson: { maxGnomadAf: 0.01, consequences: ['HIGH', 'MODERATE'] },
    sortOrder: 2
  },
  {
    name: 'Ultra Rare HIGH',
    description: 'gnomAD AF <= 0.001% + HIGH impact',
    filterJson: { maxGnomadAf: 0.00001, consequences: ['HIGH'] },
    sortOrder: 3
  },
  {
    name: 'ClinVar P/LP',
    description: 'ClinVar pathogenic or likely pathogenic',
    filterJson: { clinvars: ['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic'] },
    sortOrder: 4
  },
  {
    name: 'HIGH Impact',
    description: 'HIGH impact variants only',
    filterJson: { consequences: ['HIGH'] },
    sortOrder: 5
  },
  {
    name: 'Rare (1%)',
    description: 'gnomAD AF <= 1% or missing',
    filterJson: { maxGnomadAf: 0.01 },
    sortOrder: 6
  },
  {
    name: 'CADD >= 20',
    description: 'CADD Phred score at least 20',
    filterJson: { minCadd: 20 },
    sortOrder: 7
  },
  {
    name: 'Rare, not recurrent',
    description: 'gnomAD AF <= 1% + seen in at most 3 cases',
    filterJson: { maxGnomadAf: 0.01, maxCarriers: 3 },
    sortOrder: 8
  }
]

const SHORTLIST_PRESETS = [
  {
    name: 'Tier 1 candidates',
    description:
      'Strict ranking: rare HIGH/MOD impact, top-50. ClinVar P/LP and starred variants pinned to top.',
    sortOrder: 0,
    config: {
      variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
      topN: 50,
      baseFilters: { consequences: ['HIGH', 'MODERATE'], maxGnomadAf: 0.001 },
      perTypeOverrides: { sv: { maxGnomadAf: 0.01 }, cnv: { maxGnomadAf: 0.01 }, str: {} },
      rankConfig: {
        weights: { impact: 0.25, pathogenicity: 0.25, rarity: 0.25, clinvar: 0.25, phenotype: 0 },
        clinvarPinTop: true,
        pinStarredTop: true
      },
      tieBreakers: [
        { key: 'cadd', order: 'desc' },
        { key: 'chr', order: 'asc' },
        { key: 'pos', order: 'asc' }
      ]
    }
  },
  {
    name: 'All rare damaging',
    description: 'Broad shortlist: any rare HIGH/MOD variant. Score-driven ordering, no pins.',
    sortOrder: 1,
    config: {
      variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
      topN: 200,
      baseFilters: { consequences: ['HIGH', 'MODERATE'], maxGnomadAf: 0.01, minCadd: 15 },
      rankConfig: {
        weights: { impact: 0.4, pathogenicity: 0.3, rarity: 0.3, clinvar: 0, phenotype: 0 },
        clinvarPinTop: false,
        pinStarredTop: false
      },
      tieBreakers: [{ key: 'cadd', order: 'desc' }]
    }
  },
  {
    name: 'Recessive candidates',
    description:
      'SNV/indel only. Rare coding impact - use the per-tab Inheritance filter for homozygous / compound-het narrowing.',
    sortOrder: 2,
    config: {
      variantTypeScope: ['snv', 'indel'],
      topN: 100,
      baseFilters: { consequences: ['HIGH', 'MODERATE'], maxGnomadAf: 0.02 },
      rankConfig: {
        weights: { impact: 0.3, pathogenicity: 0.2, rarity: 0.3, clinvar: 0.2, phenotype: 0 },
        clinvarPinTop: false,
        pinStarredTop: false
      },
      tieBreakers: [
        { key: 'gene_symbol', order: 'asc' },
        { key: 'cadd', order: 'desc' }
      ]
    }
  }
]

function parseArgs(argv) {
  const options = {
    envFile: DEFAULT_ENV_FILE,
    schema: undefined,
    printSql: false
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--print-sql') {
      options.printSql = true
      continue
    }

    if (arg === '--env-file' || arg === '--schema') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${arg} requires a value`)
      }
      if (arg === '--env-file') {
        options.envFile = next
      } else {
        options.schema = next
      }
      i += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function stripOptionalQuotes(value) {
  if (value.length < 2) return value

  const first = value[0]
  const last = value[value.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1)
  }

  return value
}

function parseEnvFile(contents) {
  const env = {}

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const separatorIndex = normalized.indexOf('=')
    if (separatorIndex === -1) continue

    const key = normalized.slice(0, separatorIndex).trim()
    const value = normalized.slice(separatorIndex + 1).trim()
    if (key !== '') env[key] = stripOptionalQuotes(value)
  }

  return env
}

function quoteIdentifier(identifier) {
  if (!identifier?.trim()) throw new Error('PostgreSQL schema must not be blank')
  return `"${identifier.replace(/"/gu, '""')}"`
}

function quoteLiteral(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  return `'${String(value).replace(/'/gu, "''")}'`
}

function table(schemaName, tableName) {
  return `${schemaName}.${quoteIdentifier(tableName)}`
}

function jsonLiteral(value) {
  return quoteLiteral(JSON.stringify(value))
}

function valuesList(rows) {
  return rows.map((row) => `  (${row.join(', ')})`).join(',\n')
}

function serialSequenceLiteral(schema, tableName) {
  return quoteLiteral(`${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`)
}

function sequenceReset(schema, tableName) {
  return `SELECT setval(pg_get_serial_sequence(${serialSequenceLiteral(schema, tableName)}, 'id'), COALESCE((SELECT MAX(id) FROM ${table(quoteIdentifier(schema), tableName)}), 1), true);`
}

function readMigration(fileName) {
  return readFileSync(resolve(MIGRATIONS_DIR, fileName), 'utf8')
}

function readClinicalMetrics() {
  const source = readFileSync(CLINICAL_METRICS_SOURCE, 'utf8')
  const metrics = []
  const metricPattern =
    /\{\s*name:\s*'([^']+)'\s*,\s*value_type:\s*'([^']+)'\s*,\s*unit:\s*'([^']*)'\s*,\s*category:\s*'([^']+)'\s*\}/gsu

  for (const match of source.matchAll(metricPattern)) {
    metrics.push({
      name: match[1],
      valueType: match[2],
      unit: match[3],
      category: match[4]
    })
  }

  if (metrics.length === 0) {
    throw new Error('Unable to parse built-in clinical metrics')
  }

  return metrics
}

function migrationChecksum(sql) {
  return createHash('sha256').update(sql).digest('hex')
}

function buildMigrationSql(schema) {
  const schemaName = quoteIdentifier(schema)
  const statements = [
    `CREATE SCHEMA IF NOT EXISTS ${schemaName};`,
    `CREATE TABLE IF NOT EXISTS ${table(schemaName, 'schema_migrations')} (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  execution_ms BIGINT NOT NULL
);`
  ]

  for (const migration of MIGRATION_FILES) {
    const rawSql = readMigration(migration.fileName)
    statements.push(rawSql.split('"__schema__"').join(schemaName).trim())
    statements.push(`INSERT INTO ${table(schemaName, 'schema_migrations')} (version, name, checksum, execution_ms)
VALUES (${quoteLiteral(migration.version)}, ${quoteLiteral(migration.name)}, ${quoteLiteral(migrationChecksum(rawSql))}, 0)
ON CONFLICT (version) DO UPDATE SET
  name = EXCLUDED.name,
  checksum = EXCLUDED.checksum;`)
  }

  return statements.join('\n\n')
}

export function buildSeedSql(options = {}) {
  const schema = options.schema ?? DEFAULT_SCHEMA
  const schemaName = quoteIdentifier(schema)

  const cases = [
    [1, 'Oldest Case', '/data/oldest.vcf.gz', 1024, 0, 1714060800000, 'GRCh38'],
    [2, 'Middle Case', '/data/middle.vcf.gz', 2048, 21, 1714060801000, 'GRCh37'],
    [3, 'Newest Case', '/data/newest.vcf.gz', 4096, 42, 1714060802000, 'GRCh38']
  ]

  const variants = [
    [
      1,
      1,
      '1',
      1000,
      'A',
      'G',
      'BRCA1',
      '113705',
      'HIGH',
      0.001,
      28.5,
      'Pathogenic',
      '0/1',
      'missense_variant',
      99.0,
      0.91,
      'NM_007294.4',
      'c.100A>G',
      'p.Lys34Arg',
      'AD',
      'snv',
      null,
      null,
      null,
      'vep',
      'vcf'
    ],
    [
      2,
      1,
      '1',
      1050,
      'AT',
      'A',
      'BRCA2',
      '600185',
      'MODERATE',
      0.02,
      18.1,
      'Likely benign',
      '0/1',
      'frameshift_variant',
      87.0,
      0.72,
      'NM_000059.4',
      'c.200delT',
      'p.Val67fs',
      'AD',
      'indel',
      null,
      null,
      null,
      'vep',
      'vcf'
    ],
    [
      3,
      1,
      '2',
      2000,
      'N',
      '<DEL>',
      'DMD',
      '310200',
      'HIGH',
      null,
      30.0,
      'Pathogenic',
      '0/1',
      'transcript_ablation',
      80.0,
      0.83,
      null,
      null,
      null,
      'XR',
      'sv',
      2600,
      'DEL',
      -600,
      'manta',
      'vcf'
    ],
    [
      4,
      1,
      '3',
      3000,
      'N',
      '<DUP>',
      'PMP22',
      '601097',
      'MODERATE',
      null,
      12.2,
      null,
      '1/1',
      'copy_number_gain',
      75.0,
      0.55,
      null,
      null,
      null,
      'AD',
      'cnv',
      9000,
      'DUP',
      6000,
      'cnvnator',
      'vcf'
    ],
    [
      5,
      1,
      '4',
      4000,
      'CAG',
      '<STR>',
      'HTT',
      '613004',
      'MODERATE',
      null,
      10.5,
      'Pathogenic',
      '0/1',
      'repeat_expansion',
      60.0,
      0.88,
      null,
      null,
      null,
      'AD',
      'str',
      4045,
      null,
      null,
      'expansionhunter',
      'vcf'
    ],
    [
      6,
      2,
      '1',
      1000,
      'A',
      'G',
      'BRCA1',
      '113705',
      'HIGH',
      0.001,
      28.5,
      'Pathogenic',
      '0/1',
      'missense_variant',
      99.0,
      0.91,
      'NM_007294.4',
      'c.100A>G',
      'p.Lys34Arg',
      'AD',
      'snv',
      null,
      null,
      null,
      'vep',
      'vcf'
    ]
  ]

  const filterPresetRows = [
    ...FILTER_PRESETS.map((preset) => [
      preset.name,
      preset.description,
      preset.filterJson,
      'filter',
      preset.sortOrder
    ]),
    ...SHORTLIST_PRESETS.map((preset) => [
      preset.name,
      preset.description,
      { shortlist: preset.config },
      'shortlist',
      preset.sortOrder
    ])
  ]
  const clinicalMetricRows = readClinicalMetrics()

  return `${[
    'BEGIN;',
    buildMigrationSql(schema),
    `SET search_path TO ${schemaName};`,
    `INSERT INTO ${table(schemaName, 'cases')} (id, name, file_path, file_size, variant_count, created_at, genome_build)\nVALUES\n${valuesList(cases.map((row) => row.map(quoteLiteral)))}\nON CONFLICT (id) DO UPDATE SET\n  name = EXCLUDED.name,\n  file_path = EXCLUDED.file_path,\n  file_size = EXCLUDED.file_size,\n  variant_count = EXCLUDED.variant_count,\n  created_at = EXCLUDED.created_at,\n  genome_build = EXCLUDED.genome_build;`,
    `INSERT INTO ${table(schemaName, 'case_metadata')} (case_id, affected_status, sex, notes)\nVALUES\n${valuesList(
      [
        [1, 'affected', 'female', 'index case'],
        [2, 'unaffected', 'male', 'control case']
      ].map((row) => row.map(quoteLiteral))
    )}\nON CONFLICT (case_id) DO UPDATE SET\n  affected_status = EXCLUDED.affected_status,\n  sex = EXCLUDED.sex,\n  notes = EXCLUDED.notes;`,
    `INSERT INTO ${table(schemaName, 'cohort_groups')} (id, name, description, created_at)\nVALUES\n${valuesList(
      [
        [1, 'rare disease', 'Rare disease cohort', 1714060803000],
        [2, 'controls', 'Control cohort', 1714060804000]
      ].map((row) => row.map(quoteLiteral))
    )}\nON CONFLICT (id) DO UPDATE SET\n  name = EXCLUDED.name,\n  description = EXCLUDED.description;`,
    `INSERT INTO ${table(schemaName, 'case_cohort_links')} (case_id, cohort_id)\nVALUES (1, 1), (2, 2), (3, 1)\nON CONFLICT (case_id, cohort_id) DO NOTHING;`,
    `INSERT INTO ${table(schemaName, 'case_hpo_terms')} (case_id, hpo_id, hpo_label, created_at)\nVALUES\n${valuesList(
      [
        [1, 'HP:0001250', 'Seizure', 1714060805000],
        [3, 'HP:0004322', 'Short stature', 1714060806000]
      ].map((row) => row.map(quoteLiteral))
    )}\nON CONFLICT (case_id, hpo_id) DO UPDATE SET hpo_label = EXCLUDED.hpo_label;`,
    `INSERT INTO ${table(schemaName, 'metric_definitions')} (name, value_type, unit, category, is_predefined, created_at)\nVALUES\n${valuesList(
      clinicalMetricRows.map((metric) => [
        quoteLiteral(metric.name),
        quoteLiteral(metric.valueType),
        quoteLiteral(metric.unit),
        quoteLiteral(metric.category),
        '1',
        quoteLiteral(FIXED_NOW)
      ])
    )}\nON CONFLICT (name) DO UPDATE SET\n  value_type = EXCLUDED.value_type,\n  unit = EXCLUDED.unit,\n  category = EXCLUDED.category,\n  is_predefined = EXCLUDED.is_predefined;`,
    `INSERT INTO ${table(schemaName, 'filter_presets')} (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)\nVALUES\n${valuesList(
      filterPresetRows.map(([name, description, filterJson, kind, sortOrder]) => [
        quoteLiteral(name),
        quoteLiteral(description),
        jsonLiteral(filterJson),
        '1',
        '1',
        quoteLiteral(sortOrder),
        quoteLiteral(kind),
        quoteLiteral(FIXED_NOW),
        quoteLiteral(FIXED_NOW)
      ])
    )}\nON CONFLICT (name) DO UPDATE SET\n  description = EXCLUDED.description,\n  filter_json = EXCLUDED.filter_json,\n  is_built_in = EXCLUDED.is_built_in,\n  is_visible = EXCLUDED.is_visible,\n  sort_order = EXCLUDED.sort_order,\n  kind = EXCLUDED.kind,\n  updated_at = EXCLUDED.updated_at;`,
    `INSERT INTO ${table(schemaName, 'variants')}\n  (id, case_id, chr, pos, ref, alt, gene_symbol, omim_mim_number, consequence, gnomad_af, cadd, clinvar, gt_num, func, qual, hpo_sim_score, transcript, cdna, aa_change, moi, variant_type, end_pos, sv_type, sv_length, caller, source_format)\nVALUES\n${valuesList(variants.map((row) => row.map(quoteLiteral)))}\nON CONFLICT (id) DO UPDATE SET\n  case_id = EXCLUDED.case_id,\n  chr = EXCLUDED.chr,\n  pos = EXCLUDED.pos,\n  ref = EXCLUDED.ref,\n  alt = EXCLUDED.alt,\n  gene_symbol = EXCLUDED.gene_symbol,\n  consequence = EXCLUDED.consequence,\n  gnomad_af = EXCLUDED.gnomad_af,\n  cadd = EXCLUDED.cadd,\n  clinvar = EXCLUDED.clinvar,\n  gt_num = EXCLUDED.gt_num,\n  func = EXCLUDED.func,\n  qual = EXCLUDED.qual,\n  hpo_sim_score = EXCLUDED.hpo_sim_score,\n  transcript = EXCLUDED.transcript,\n  cdna = EXCLUDED.cdna,\n  aa_change = EXCLUDED.aa_change,\n  moi = EXCLUDED.moi,\n  variant_type = EXCLUDED.variant_type,\n  end_pos = EXCLUDED.end_pos,\n  sv_type = EXCLUDED.sv_type,\n  sv_length = EXCLUDED.sv_length,\n  caller = EXCLUDED.caller,\n  source_format = EXCLUDED.source_format;`,
    `INSERT INTO ${table(schemaName, 'variant_frequency')} (chr, pos, ref, alt, case_count)\nVALUES ('1', 1000, 'A', 'G', 2)\nON CONFLICT (coord_hash) DO UPDATE SET case_count = EXCLUDED.case_count;`,
    `INSERT INTO ${table(schemaName, 'variant_sv')} (variant_id, support, event_id, mate_id)\nVALUES (3, 12, 'MANTA_EVENT_001', 'MATE_001')\nON CONFLICT (variant_id) DO UPDATE SET support = EXCLUDED.support, event_id = EXCLUDED.event_id, mate_id = EXCLUDED.mate_id;`,
    `INSERT INTO ${table(schemaName, 'variant_cnv')} (variant_id, copy_number, copy_number_quality)\nVALUES (4, 4, 70)\nON CONFLICT (variant_id) DO UPDATE SET copy_number = EXCLUDED.copy_number, copy_number_quality = EXCLUDED.copy_number_quality;`,
    `INSERT INTO ${table(schemaName, 'variant_str')} (variant_id, repeat_id, repeat_unit, disease, str_status)\nVALUES (5, 'HTT', 'CAG', 'Huntington disease', 'pathogenic')\nON CONFLICT (variant_id) DO UPDATE SET repeat_id = EXCLUDED.repeat_id, repeat_unit = EXCLUDED.repeat_unit, disease = EXCLUDED.disease, str_status = EXCLUDED.str_status;`,
    `UPDATE ${table(schemaName, 'cases')} AS seeded_cases\nSET variant_count = COALESCE(seed_counts.count, 0)\nFROM (\n  SELECT c.id AS case_id, COUNT(v.id)::BIGINT AS count\n  FROM ${table(schemaName, 'cases')} c\n  LEFT JOIN ${table(schemaName, 'variants')} v ON v.case_id = c.id\n  GROUP BY c.id\n) seed_counts\nWHERE seeded_cases.id = seed_counts.case_id;`,
    sequenceReset(schema, 'cases'),
    sequenceReset(schema, 'cohort_groups'),
    sequenceReset(schema, 'metric_definitions'),
    sequenceReset(schema, 'variants'),
    sequenceReset(schema, 'filter_presets'),
    'COMMIT;'
  ].join('\n\n')}\n`
}

export function buildSeedOperations(options = {}) {
  return [{ text: buildSeedSql(options) }]
}

function buildConnectionUrl(env) {
  const explicitUrl = env.VARLENS_PG_URL?.trim()
  if (explicitUrl) return explicitUrl

  const database = env.POSTGRES_DB?.trim()
  const username = env.POSTGRES_USER?.trim()
  const password = env.POSTGRES_PASSWORD?.trim()
  const port = env.VARLENS_PG_PORT?.trim() || '5432'

  if (!database || !username || !password) {
    throw new Error('Set VARLENS_PG_URL or POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD')
  }

  const url = new URL('postgres://127.0.0.1')
  url.port = port
  url.pathname = `/${database}`
  url.username = username
  url.password = password
  return url.toString()
}

async function readEnv(options) {
  try {
    return {
      ...parseEnvFile(await readFile(options.envFile, 'utf8')),
      ...process.env
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { ...process.env }
    }
    throw error
  }
}

async function runSeed(options) {
  const env = await readEnv(options)
  const schema = options.schema ?? env.VARLENS_PG_SCHEMA ?? DEFAULT_SCHEMA
  const { Client } = await import('pg')
  const clientConfig = {
    connectionString: buildConnectionUrl(env),
    application_name: 'varlens-seed-dev-workspace'
  }

  const client = await connectWithRetry(Client, clientConfig)
  try {
    for (const operation of buildSeedOperations({ schema })) {
      await client.query(operation.text)
    }
  } finally {
    await client.end()
  }

  process.stdout.write(`Seeded PostgreSQL dev workspace schema "${schema}".\n`)
}

async function connectWithRetry(Client, clientConfig) {
  let lastError

  for (let attempt = 1; attempt <= CONNECTION_ATTEMPTS; attempt += 1) {
    const client = new Client(clientConfig)
    try {
      await client.connect()
      return client
    } catch (error) {
      lastError = error
      if (attempt === CONNECTION_ATTEMPTS) break
      await delay(CONNECTION_RETRY_DELAY_MS)
    }
  }

  throw lastError
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const env = options.printSql ? process.env : await readEnv(options)
  const schema = options.schema ?? env.VARLENS_PG_SCHEMA ?? DEFAULT_SCHEMA

  if (options.printSql) {
    process.stdout.write(buildSeedSql({ schema }))
    return
  }

  await runSeed(options)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
