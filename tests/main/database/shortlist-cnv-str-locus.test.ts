// @vitest-environment node
/**
 * CNV/STR locus fields end to end (CNV/STR spec §6.1–6.2, plan L5): the
 * synthetic VEP CNV and STR VCFs go through the real import, the case gets HPO
 * terms, and an evidence ruleset with CNV- and STR-scoped groups (structural
 * flags switched on for this test only) reads `hpo_resnik`, `hpo_best_locus`,
 * `cnv_gene_count` and `str_band`; the tooltip explanation carries the locus
 * note. PostgreSQL must give the identical result; it is gated by
 * VARLENS_RUN_POSTGRES_E2E=1 (VARLENS_PG_URL).
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import Database from 'better-sqlite3-multiple-ciphers'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { GeneReferenceDb } from '../../../src/main/database/GeneReferenceDb'
import { buildHpoSimilarityDb } from '../../../src/main/services/phenotype/hpo-similarity-db'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresExportRepository } from '../../../src/main/storage/postgres/PostgresExportRepository'
import { PostgresShortlistService } from '../../../src/main/storage/postgres/PostgresShortlistService'
import { prepareStatements, streamInsertVcf } from '../../../src/main/workers/import-pipeline'
import { HPO_DATA_CONFIG } from '../../../src/shared/config/hpo-data.config'
import { SHORTLIST_EVIDENCE_CONFIG } from '../../../src/shared/config/shortlist-evidence.config'
import type { EvidenceRuleset } from '../../../src/shared/types/evidence-ruleset'
import type { ShortlistConfig, ShortlistResult } from '../../../src/shared/types/shortlist'
import { HP_JSON, PHENOTYPE_HPOA, T } from '../../shared/phenotype/hpo-fixture'
import {
  clingenGenes,
  clingenRegions,
  MONDO_OBO,
  STRCHIVE_LOCI
} from '../../shared/phenotype/locus-fixture'
import type { PostgresImportWorkerOutboundMessage } from '../../../src/shared/types/postgres-import-worker'

const GENE_REF = resolve(__dirname, '../../../resources/gene_reference.db')
const VCF_DIR = resolve(__dirname, '../../test-data/vcf')

vi.mock('node:worker_threads', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  workerData: { geneRefDbPath: resolve(__dirname, '../../../resources/gene_reference.db') }
}))
const { defaultDeps, runImport } = await import('../../../src/main/workers/postgres-import-worker')

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

// Real genes of the fixtures on the toy HPO diseases (OMIM:2 {D}, OMIM:3 {E}, OMIM:4 {C, E}).
const GENES = [
  'ncbi_gene_id\tgene_symbol\thpo_id\thpo_name\tfrequency\tdisease_id',
  `1\tNIPA1\t${T.D}\tx\t-\tOMIM:2`,
  `2\tNIPA2\t${T.C}\tx\t-\tOMIM:4`,
  `2\tNIPA2\t${T.E}\tx\t-\tOMIM:4`,
  `3\tPMP22\t${T.E}\tx\t-\tOMIM:3`,
  `4\tCYFIP1\t${T.D}\tx\t-\tOMIM:2`
].join('\n')
// ClinGen gene 1 (HI 3) is NIPA1, gene 2 (HI 30) NIPA2; the rest are fillers.
const ENTREZ_TO_HGNC = new Map<string, string>([
  ['1', 'HGNC:17043'],
  ['2', 'HGNC:17044'],
  ...Array.from({ length: 1000 }, (_, i): [string, string] => [`${i + 3}`, `HGNC:FILL${i}`])
])
// The fixture catalogue (every overridden locus must exist), with ATXN3 at its real
// GRCh38 locus and CSTB (AR) added.
const STRCHIVE = JSON.stringify([
  ...(JSON.parse(STRCHIVE_LOCI) as Array<Record<string, unknown>>).map((l) =>
    l.id === 'SCA3_ATXN3'
      ? { ...l, chrom: 'chr14', start_hg38: 92071010, stop_hg38: 92071042, pathogenic_min: 60 }
      : l
  ),
  {
    id: 'EPM1_CSTB',
    gene: 'CSTB',
    chrom: 'chr21',
    start_hg38: 43776444,
    stop_hg38: 43776479,
    evidence: ['Definitive'],
    inheritance: ['AR'],
    pathogenic_motif_reference_orientation: ['GCGGGGC'],
    pathogenic_min: 30,
    omim: ['4'],
    orphanet: [],
    mondo: []
  }
])

const RULESET: EvidenceRuleset = {
  version: 1,
  id: 'locus-wiring',
  modes: [{ id: 'fallback', label: 'Any', when: null, points: 0 }],
  groups: [
    {
      id: 'pheno',
      label: 'Phenotype',
      scope: 'global',
      rules: [{ id: 'pheno', label: 'HPO', when: 'hpo_resnik:>:0', points: 1 }]
    },
    {
      id: 'locus',
      label: 'Locus',
      scope: 'global',
      rules: [{ id: 'locus', label: 'Locus', when: 'hpo_best_locus:is:notnull', points: 0.5 }]
    },
    {
      id: 'cnv_genes',
      label: 'CNV genes',
      scope: 'global',
      variantType: 'cnv',
      rules: [
        { id: 'genes3', label: '3+', when: 'cnv_gene_count:>=:3', points: 3 },
        { id: 'genes2', label: '2', when: 'cnv_gene_count:>=:2', points: 2 },
        { id: 'genes1', label: '1', when: 'cnv_gene_count:>=:1', points: 1 }
      ]
    },
    {
      id: 'str_band',
      label: 'STR band',
      scope: 'global',
      variantType: 'str',
      rules: [
        { id: 'full', label: 'Full', when: 'str_band:=:full', points: 4 },
        { id: 'normal', label: 'Normal', when: 'str_band:=:normal', points: -1 }
      ]
    }
  ]
}
const CONFIG: ShortlistConfig = {
  variantTypeScope: ['cnv', 'str'],
  baseFilters: {},
  topN: 50,
  rankConfig: {
    weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 },
    ruleset: RULESET
  }
}
const FILES = ['synthetic-cnv-vep.vcf', 'synthetic-str.vcf'] as const
const TERMS = [T.C, T.D, T.E]

/** Backend-independent view of a ranked row (ids differ between backends). */
const signature = (r: ShortlistResult): unknown[] =>
  r.rows.map((row) => ({
    locus: `${row.chr}:${row.pos}:${row.gt_num}`,
    score: row.rank_score,
    rules: row.rank_evidence?.map((c) => c.id),
    hpo: row.rank_hpo ?? null
  }))
const rowAt = (r: ShortlistResult, pos: number, gt?: string) =>
  r.rows.find((row) => row.pos === pos && (gt === undefined || row.gt_num === gt))

let dir: string
const lite = new Map<string, ShortlistResult>()
const enabled = SHORTLIST_EVIDENCE_CONFIG.structuralTypes.enabled
const saved = { ...enabled }

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cnv-str-locus-'))
  const hpoPath = join(dir, 'hpo_similarity.db')
  const warnings = buildHpoSimilarityDb(
    {
      ontology: HP_JSON,
      annotations: PHENOTYPE_HPOA,
      genes: GENES,
      locus: {
        clingen: {
          genes: clingenGenes(),
          regions: { GRCh37: clingenRegions(), GRCh38: clingenRegions() }
        },
        strchive: STRCHIVE,
        mondo: MONDO_OBO,
        versions: { clingen: '2026-10-14', strchive: 'v2.28.0', mondo: 'v2026-10-06' },
        errors: {},
        entrezToHgnc: ENTREZ_TO_HGNC,
        previousPath: null
      }
    },
    { release: 'v2026-09-01', sha256: {} },
    hpoPath
  )
  expect(warnings).toEqual([])
  process.env[HPO_DATA_CONFIG.envPath] = hpoPath
  Object.assign(enabled, { cnv: true, str: true })

  const svc = new DatabaseService(':memory:')
  const geneRef = new GeneReferenceDb(new Database(GENE_REF, { readonly: true }))
  try {
    for (const file of FILES) {
      const path = resolve(VCF_DIR, file)
      const caseId = svc.cases.createCase(file, path, 1)
      svc.database.prepare("UPDATE cases SET genome_build = 'GRCh38' WHERE id = ?").run(caseId)
      // prettier-ignore
      await streamInsertVcf(path, { format: 'vcf', caseKey: '' }, caseId, 100, prepareStatements(svc.database), () => false, undefined, () => {}, undefined, undefined, undefined, undefined, GENE_REF)
      for (const term of TERMS) svc.metadata.assignCaseHpoTerm(caseId, term, term)
      const result = svc.shortlistService.getShortlist(
        { caseId, adHocConfig: CONFIG },
        () => geneRef
      )
      lite.set(file, result)
    }
  } finally {
    svc.close()
  }
}, 60_000)

afterAll(() => {
  Object.assign(enabled, saved)
  delete process.env[HPO_DATA_CONFIG.envPath]
  rmSync(dir, { recursive: true, force: true })
})

describe('CNV/STR locus fields — SQLite end to end', () => {
  it('scores CNVs on their CSQ gene set with the locus note in the tooltip', () => {
    const cnv = lite.get('synthetic-cnv-vep.vcf')!
    // CN 1 over NIPA1 and NIPA2: NIPA2 (OMIM:4, higher score) wins over NIPA1 (OMIM:2); PDCD6IPP1 is a pseudogene.
    const del = rowAt(cnv, 22700000)!
    expect(del.rank_evidence?.map((c) => c.id)).toEqual(['fallback', 'pheno', 'locus', 'genes2'])
    expect(del.rank_hpo?.diseaseId).toBe('OMIM:4')
    expect(del.rank_hpo?.locus).toEqual({
      kind: 'gene',
      id: 'NIPA2',
      label: 'NIPA2',
      diseaseGenes: 2,
      genes: 2
    })
    // CN 0 over NIPA1, NIPA2 and CYFIP1: three coding genes.
    const cn0 = rowAt(cnv, 22800000)!
    expect(cn0.rank_evidence?.map((c) => c.id)).toEqual(['fallback', 'pheno', 'locus', 'genes3'])
    expect(cn0.rank_hpo?.locus).toMatchObject({ kind: 'gene', diseaseGenes: 3, genes: 3 })
    // No CSQ: the interval fallback finds TUBGCP5 (no HPO disease): counted, not scored.
    const plain = rowAt(cnv, 22990000)!
    expect(plain.rank_evidence?.map((c) => c.id)).toEqual(['fallback', 'genes1'])
    expect(plain.rank_hpo).toBeNull()
    // The explanation's score is the row's hpo_resnik on the gene scale.
    for (const row of cnv.rows) {
      if (row.rank_hpo != null) expect(row.rank_hpo.score).toBeGreaterThan(0)
    }
  })

  it('scores STRs against their catalogue locus and band', () => {
    const str = lite.get('synthetic-str.vcf')!
    // CSTB 50/50 hom, AR: both alleles full → OMIM:4.
    const cstb = rowAt(str, 43776444)!
    expect(cstb.rank_evidence?.map((c) => c.id)).toEqual(['fallback', 'pheno', 'locus', 'full'])
    expect(cstb.rank_hpo).toMatchObject({
      diseaseId: 'OMIM:4',
      locus: { kind: 'str', id: 'EPM1_CSTB', label: 'CSTB', band: 'full', inheritance: 'AR' }
    })
    // ATXN3 24/15: normal band, no score; NOTCH2NLC is off-catalogue: no band.
    expect(rowAt(str, 92071010)?.rank_evidence?.map((c) => c.id)).toEqual(['fallback', 'normal'])
    expect(rowAt(str, 92071010)?.rank_hpo).toBeNull()
    expect(rowAt(str, 149390803)?.rank_evidence?.map((c) => c.id)).toEqual(['fallback'])
  })
})

describe.skipIf(!RUN_PG)('CNV/STR locus fields — PostgreSQL parity', () => {
  const schema = `vt_cnv_str_locus_${randomBytes(4).toString('hex')}`
  let pool: Pool

  beforeAll(async () => {
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA "${schema}"`)
    await provisioner.end()
    pool = new Pool({ connectionString: PG_URL, max: 4 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 120_000)

  afterAll(async () => {
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  it('ranks the same CNV and STR cases with identical locus fields', async () => {
    const service = new PostgresShortlistService({
      pool,
      schema,
      filterPresets: { getPreset: async () => null },
      rows: new PostgresExportRepository(pool, schema),
      geneRefDbPath: () => GENE_REF
    })
    for (const file of FILES) {
      const messages: PostgresImportWorkerOutboundMessage[] = []
      await runImport(
        defaultDeps,
        {
          type: 'start',
          client: { connectionString: PG_URL },
          schema,
          mode: 'single-file',
          caseName: file,
          filePath: resolve(VCF_DIR, file),
          vcfOptions: { genomeBuild: 'GRCh38' },
          batchSize: 10_000
        },
        (message) => messages.push(message)
      )
      const last = messages.at(-1)
      if (last?.type !== 'complete') throw new Error(`import failed: ${JSON.stringify(last)}`)
      const caseId = last.result.caseId
      for (const term of TERMS) {
        await pool.query(
          `INSERT INTO "${schema}".case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
           VALUES ($1, $2, $2, 0)`,
          [caseId, term]
        )
      }
      const pg = await service.getShortlist({ caseId, adHocConfig: CONFIG })
      expect(signature(pg)).toEqual(signature(lite.get(file)!))
    }
  }, 180_000)
})
