// @vitest-environment node
/**
 * Import field profile parity (spec §16): a varvis columnar export, an object
 * export and a VEP-annotated VCF carrying the same evidence store identical
 * canonical `info.<KEY>` values, and each backend stores the same rows and
 * field dictionary. All data is synthetic.
 *
 * Both backends run through their real import executor with the worker code
 * in-process. PostgreSQL needs a real instance and is gated by
 * VARLENS_RUN_POSTGRES_E2E=1 (with a reachable VARLENS_PG_URL).
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import Database from 'better-sqlite3-multiple-ciphers'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { detectFormat } from '../../../src/main/import/format-detection'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresImportExecutor } from '../../../src/main/storage/postgres/PostgresImportExecutor'
import { SqliteImportExecutor } from '../../../src/main/storage/sqlite/SqliteImportExecutor'
import { createMapperPipeline } from '../../../src/main/workers/import-pipeline'
import { runImportSession } from '../../../src/main/workers/import-worker'
import { runImport, streamMappedVcfRows } from '../../../src/main/workers/postgres-import-worker'
import type { ImportFieldProfile } from '../../../src/shared/config/import-fields.config'

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
const VCF_DIR = resolve(__dirname, '../../test-data/vcf')

/** The evidence of two synthetic variants, as every source states it. */
const EVIDENCE = [
  {
    chr: 'chr1',
    pos: 1000,
    ref: 'A',
    alt: 'G',
    revel: 0.912,
    metarnn: 0.85,
    popmax: 0.0001,
    hom: 0,
    loeuf: 0.21,
    revstat: 'criteria provided, multiple submitters, no conflicts'
  },
  {
    chr: 'chr2',
    pos: 2000,
    ref: 'C',
    alt: 'T',
    revel: 0.15,
    metarnn: 0.2,
    popmax: 0.012,
    hom: 3,
    loeuf: 1.1,
    revstat: 'no assertion criteria provided'
  }
]

/** What every source must store under the canonical keys. */
const CANONICAL = EVIDENCE.map((v) => ({
  REVEL: String(v.revel),
  METARNN: String(v.metarnn),
  GNOMAD_POPMAX_AF: String(v.popmax),
  GNOMAD_HOM: String(v.hom),
  LOEUF: String(v.loeuf),
  CLINVAR_REVSTAT: v.revstat
}))
const CANONICAL_KEYS = Object.keys(CANONICAL[0])

const header = (id: string, type: string, dataDictionary?: Record<string, unknown>) => ({
  id,
  type,
  label: id,
  ...(dataDictionary ? { dataDictionary } : {})
})

const COLUMNAR = {
  SyntheticCase: {
    header: [
      header('Chr', 'text'),
      header('Pos', 'number'),
      header('Ref', 'text'),
      header('Alt', 'text'),
      header('Gene', 'dictionary', { '1': 'GENE1', '2': 'GENE2' }),
      header('Transcript', 'dictionary', { '1': 'NM_1.1', '2': 'NM_1.2', '3': 'NM_2.1' }),
      header('selectedTranscript', 'number'),
      header('ExonIntronRank', 'text'),
      header('GTNum-Index', 'number'),
      header('GnomPMaxFiltAF', 'number'),
      header('RevelScore', 'number'),
      header('MetaRnnRank', 'number'),
      header('GnomHomInd', 'number'),
      header('GnomGLofOeUp', 'number'),
      header('ClinVStatus', 'text'),
      header('AltAF-Index', 'number'),
      header('LocalSig', 'dictionary', { '1': 'Benign', '2': 'Pathogenic' }),
      header('GenesOverlapping', 'text')
    ],
    data: EVIDENCE.map((v, i) => [
      v.chr,
      v.pos,
      v.ref,
      v.alt,
      i === 0 ? ['1', '1'] : '2',
      i === 0 ? ['1', '2'] : '3',
      i === 0 ? 1 : 0,
      i === 0 ? ['2/10', '3/11'] : '5/9',
      1,
      v.popmax,
      v.revel,
      v.metarnn,
      v.hom,
      v.loeuf,
      v.revstat,
      0.48,
      i === 0 ? '2' : null,
      i === 0 ? ['GENE1', 'GENE1-AS1', 'MIR1'] : []
    ])
  }
}

const OBJECT = {
  metadata: { version: '1.0' },
  samples: {
    S1: {
      variants: EVIDENCE.map((v) => ({
        lims_id: 'L-1',
        chr: v.chr,
        pos: v.pos,
        ref: v.ref,
        alt: v.alt,
        gene_symbol: 'GENE1',
        gnomad_af: v.popmax,
        RevelScore: v.revel,
        MetaRnnRank: v.metarnn,
        GnomPMaxFiltAF: v.popmax,
        GnomHomInd: v.hom,
        GnomGLofOeUp: v.loeuf,
        ClinVStatus: v.revstat,
        'AltAF-Index': 0.48
      }))
    }
  }
}

const CSQ_FIELDS = [
  'Allele',
  'Consequence',
  'IMPACT',
  'SYMBOL',
  'Feature',
  'BIOTYPE',
  'CANONICAL',
  'HGVSc',
  'REVEL_score',
  'MetaRNN_rankscore',
  'AlphaMissense_score',
  'gnomAD4.1_joint_POPMAX_AF',
  'gnomAD4.1_joint_nhomalt',
  'LOEUF',
  'ClinVarCurrent_CLNREVSTAT',
  'SpliceAI_pred_DS_AG',
  'SpliceAI_pred_DS_AL',
  'SpliceAI_pred_DS_DG',
  'SpliceAI_pred_DS_DL'
]

/** VEP's spelling: per-transcript values `&`-joined, ClinVar text with `_` and `&`. */
function csq(v: (typeof EVIDENCE)[number], i: number): string {
  const vep = (text: string): string => text.replace(/, /g, '&_').replace(/ /g, '_')
  const canonical = [
    v.alt,
    'missense_variant',
    'MODERATE',
    `GENE${i + 1}`,
    `ENST0${i}`,
    'protein_coding',
    'YES',
    'c.1A>G',
    i === 0 ? `0.5&${v.revel}` : String(v.revel),
    String(v.metarnn),
    '0.7',
    v.popmax.toExponential(3),
    String(v.hom),
    String(v.loeuf),
    vep(v.revstat),
    '0.01',
    '0.00',
    i === 0 ? '0.62' : '0.03',
    '.'
  ].join('|')
  const other = [v.alt, 'intron_variant', 'MODIFIER', `GENE${i + 1}`, `ENST9${i}`].join('|')
  return `${other},${canonical}`
}

const VCF = [
  '##fileformat=VCFv4.2',
  '##reference=GRCh38',
  '##INFO=<ID=DP,Number=1,Type=Integer,Description="Depth">',
  '##INFO=<ID=my-flag,Number=0,Type=Flag,Description="A flag with a dash">',
  `##INFO=<ID=CSQ,Number=.,Type=String,Description="Consequence annotations from Ensembl VEP. Format: ${CSQ_FIELDS.join('|')}">`,
  '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
  '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1',
  ...EVIDENCE.map(
    (v, i) =>
      `${v.chr}\t${v.pos}\t.\t${v.ref}\t${v.alt}\t50\tPASS\tDP=35;my-flag;CSQ=${csq(v, i)}\tGT\t0/1`
  ),
  ''
].join('\n')

interface Imported {
  rows: Record<string, Record<string, string>>
  dictionary: Record<string, string> | null
}

type Backend = (filePath: string, profile?: ImportFieldProfile) => Promise<Imported>

const keyOf = (r: Record<string, unknown>): string => `${r.chr}:${r.pos}:${r.ref}>${r.alt}`
const pick = (info: Record<string, string>, keys: string[]): Record<string, string> =>
  Object.fromEntries(keys.filter((k) => k in info).map((k) => [k, info[k]]))

function rowsOf(rows: Array<Record<string, unknown>>): Imported['rows'] {
  return Object.fromEntries(
    rows.map((r) => [
      keyOf(r),
      r.info_json === null ? {} : (JSON.parse(String(r.info_json)) as Record<string, string>)
    ])
  )
}

describe('import field profile: every source, both backends', () => {
  let dir: string
  const files: Record<'columnar' | 'object' | 'vcf', string> = {
    columnar: '',
    object: '',
    vcf: ''
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-field-profile-'))
    files.columnar = join(dir, 'varvis-columnar.json')
    files.object = join(dir, 'varvis-object.json')
    files.vcf = join(dir, 'pipeline-csq.vcf')
    writeFileSync(files.columnar, JSON.stringify(COLUMNAR))
    writeFileSync(files.object, JSON.stringify(OBJECT))
    writeFileSync(files.vcf, VCF)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const importSqlite: Backend = async (filePath, profile) => {
    const dbPath = join(dir, `${randomBytes(6).toString('hex')}.db`)
    const svc = new DatabaseService(dbPath)
    try {
      await new Promise<void>((done) => setImmediate(done))
      const executor = new SqliteImportExecutor({
        getDatabaseService: () => svc,
        createWorkerClient: () =>
          ({
            start: (request: Record<string, unknown>) => {
              const on = request as unknown as Record<string, (m: unknown) => void>
              void runImportSession({ type: 'start', ...request } as never, {
                postMessage: (m) => {
                  if (m.type === 'file-complete') on.onFileComplete(m)
                  else if (m.type === 'complete') on.onComplete(m)
                  else if (m.type === 'error') on.onError(m)
                }
              })
            },
            cancel: () => undefined
          }) as never
      })
      await executor.importSingleFile({
        filePath,
        caseName: 'parity',
        vcfOptions: profile && { fieldProfile: profile },
        throttleMs: 1000
      })
      const db = new Database(dbPath, { readonly: true })
      try {
        const rows = db.prepare('SELECT chr, pos, ref, alt, info_json FROM variants').all()
        const info = db.prepare('SELECT field_dictionary FROM case_data_info').get() as
          { field_dictionary: string | null } | undefined
        return {
          rows: rowsOf(rows as Array<Record<string, unknown>>),
          dictionary: info?.field_dictionary ? JSON.parse(info.field_dictionary) : null
        }
      } finally {
        db.close()
      }
    } finally {
      svc.close()
    }
  }

  function contract(importCase: Backend, label: string): void {
    it(`${label}: the three sources store the same canonical evidence values`, async () => {
      for (const source of ['columnar', 'object', 'vcf'] as const) {
        const { rows } = await importCase(files[source])
        EVIDENCE.forEach((v, i) => {
          expect(pick(rows[keyOf(v)], CANONICAL_KEYS), `${source} ${keyOf(v)}`).toEqual(
            CANONICAL[i]
          )
        })
      }
    }, 120_000)

    it(`${label}: keeps unknown varvis columns, resolved and normalised`, async () => {
      const { rows, dictionary } = await importCase(files.columnar)
      const first = rows[keyOf(EVIDENCE[0])]
      expect(first).toMatchObject({
        AltAF_Index: '0.48',
        LocalSig: 'Pathogenic', // dictionary code resolved
        GenesOverlapping: 'GENE1,GENE1-AS1,MIR1', // a list, comma-joined
        ExonIntronRank: '3/11' // the selected transcript's value
      })
      // Evidence aliases are stored once, under the canonical key.
      expect(first).not.toHaveProperty('RevelScore')
      expect(rows[keyOf(EVIDENCE[1])]).not.toHaveProperty('LocalSig')
      expect(dictionary).toMatchObject({
        AltAF_Index: 'JSON:AltAF-Index',
        REVEL: 'JSON:RevelScore',
        GNOMAD_POPMAX_AF: 'JSON:GnomPMaxFiltAF'
      })
    }, 60_000)

    it(`${label}: skips the object export's identifiers and keeps its other properties`, async () => {
      const { rows } = await importCase(files.object)
      const first = rows[keyOf(EVIDENCE[0])]
      expect(first).not.toHaveProperty('lims_id')
      expect(first).toMatchObject({ AltAF_Index: '0.48' })
    }, 60_000)

    it(`${label}: keeps the selected transcript's CSQ subfields and derives SpliceAI`, async () => {
      const { rows, dictionary } = await importCase(files.vcf)
      const first = rows[keyOf(EVIDENCE[0])]
      expect(first).toMatchObject({
        DP: '35',
        my_flag: '',
        BIOTYPE: 'protein_coding',
        CANONICAL: 'YES',
        ALPHAMISSENSE: '0.7',
        SPLICEAI_MAX: '0.62',
        SpliceAI_pred_DS_DG: '0.62'
      })
      expect(first).not.toHaveProperty('SYMBOL') // a column
      expect(rows[keyOf(EVIDENCE[1])]).toMatchObject({ SPLICEAI_MAX: '0.03' })
      expect(dictionary).toMatchObject({
        REVEL: 'CSQ:REVEL_score',
        my_flag: 'INFO:my-flag',
        CLINVAR_REVSTAT: 'CSQ:ClinVarCurrent_CLNREVSTAT'
      })
    }, 60_000)

    it(`${label}: a profile skips and renames fields`, async () => {
      const { rows } = await importCase(files.columnar, {
        keepUnknown: 'none',
        fields: {
          'JSON:AltAF-Index': { keep: true, key: 'ALT_AF' },
          'JSON:RevelScore': { keep: false }
        }
      })
      const first = rows[keyOf(EVIDENCE[0])]
      expect(first).toMatchObject({ ALT_AF: '0.48', METARNN: '0.85' })
      expect(first).not.toHaveProperty('REVEL')
      expect(first).not.toHaveProperty('LocalSig')
    }, 60_000)

    it(`${label}: the repo VEP fixture keeps INFO keys and suffixes colliding subfields`, async () => {
      const { rows } = await importCase(resolve(VCF_DIR, 'single-sample.vep.vcf.gz'))
      const all = Object.values(rows)
      expect(all.length).toBeGreaterThan(0)
      const annotated = all.find((info) => 'BIOTYPE' in info)
      expect(annotated).toBeDefined()
      // The INFO AF of the caller keeps its name; VEP's CSQ AF is the one suffixed.
      if (all.some((info) => 'AF_2' in info)) {
        expect(all.some((info) => 'AF' in info)).toBe(true)
      }
    }, 120_000)
  }

  contract(importSqlite, 'SQLite')

  describe.skipIf(!RUN_PG)('PostgreSQL (real instance)', () => {
    const schema = `varlens_test_field_profile_${Date.now()}_${randomBytes(4).toString('hex')}`
    let probe: Client

    beforeAll(async () => {
      probe = new Client({ connectionString: PG_URL })
      await probe.connect()
      await probe.query(`CREATE SCHEMA "${schema}"`)
      const pool = new Pool({ connectionString: PG_URL, max: 2 })
      await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
      await pool.end()
    }, 60_000)

    afterAll(async () => {
      if (!probe) return
      await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await probe.end()
    }, 60_000)

    const importPostgres: Backend = async (filePath, profile) => {
      const executor = new PostgresImportExecutor({
        schema,
        clientConfig: { connectionString: PG_URL },
        workerClientFactory: () =>
          ({
            start: (message: never, on: Record<string, (m: unknown) => void>) => {
              void runImport(
                {
                  createClient: (config) => new Client(config),
                  detectFormat,
                  createMapperPipeline,
                  statFile: (path) => ({ size: statSync(path).size }),
                  createVcfMappedStream: async (path, options) =>
                    streamMappedVcfRows(
                      path,
                      options.selectedSample,
                      options.filters,
                      options.onSkip,
                      options.appendedTo,
                      options.fields
                    )
                },
                message,
                (m) => {
                  if (m.type === 'complete') on.onComplete(m)
                  else if (m.type === 'error') on.onError(m)
                }
              )
            },
            cancel: () => undefined,
            terminate: async () => undefined
          }) as never
      })
      const result = await executor.importSingleFile({
        filePath,
        caseName: `parity-${randomBytes(6).toString('hex')}`,
        vcfOptions: profile && { fieldProfile: profile },
        throttleMs: 1000
      })
      const rows = await probe.query(
        `SELECT chr, pos, ref, alt, info_json FROM "${schema}"."variants" WHERE case_id = $1`,
        [result.caseId]
      )
      const info = await probe.query(
        `SELECT field_dictionary FROM "${schema}"."case_data_info" WHERE case_id = $1`,
        [result.caseId]
      )
      const text = info.rows[0]?.field_dictionary as string | null | undefined
      return { rows: rowsOf(rows.rows), dictionary: text ? JSON.parse(text) : null }
    }

    contract(importPostgres, 'PostgreSQL')

    it('stores exactly what SQLite stores', async () => {
      for (const filePath of [
        ...Object.values(files),
        resolve(VCF_DIR, 'trio-region.vep.vcf.gz')
      ]) {
        const [sqlite, postgres] = [await importSqlite(filePath), await importPostgres(filePath)]
        expect(postgres, filePath).toEqual(sqlite)
      }
    }, 240_000)
  })
})
