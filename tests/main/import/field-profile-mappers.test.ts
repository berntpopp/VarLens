/**
 * The JSON mappers apply the import field profile (spec §16), columnar rows
 * must match their header (#590), and the JSON preview reads fields the way
 * the import stores them.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { afterAll, describe, expect, it } from 'vitest'

import { createFieldMapper } from '../../../src/main/import/transforms/FieldMapper'
import { createObjectFormatMapper } from '../../../src/main/import/transforms/ObjectFormatMapper'
import { resolveColumnIndices } from '../../../src/main/import/config/fieldMapping'
import { getJsonFieldPreview } from '../../../src/main/import/json-preview'
import { detectFormat } from '../../../src/main/import/format-detection'
import { createMapperPipeline } from '../../../src/main/workers/import-mapper-pipeline'
import { FieldProfileResolver } from '../../../src/shared/utils/import-field-profile'
import { IMPORT_MESSAGES } from '../../../src/shared/config/import.config'

const FIXTURES = resolve(__dirname, '../../fixtures/import')
const dictionaries = { gene: {}, impact: {}, transcript: {}, hpoSimScore: {}, moi: {} }

async function run(
  mapper: NodeJS.ReadWriteStream,
  values: unknown[]
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = []
  await pipeline(
    Readable.from(
      values.map((value, key) => ({ key, value })),
      { objectMode: true }
    ),
    mapper,
    new Writable({
      objectMode: true,
      write(chunk, _enc, cb) {
        out.push(chunk as Record<string, unknown>)
        cb()
      }
    })
  )
  return out
}

const HEADER = [
  { id: 'Chr' },
  { id: 'Pos' },
  { id: 'Ref' },
  { id: 'Alt' },
  { id: 'RevelScore' },
  { id: 'Grade', dataDictionary: { '1': 'A', '2': 'B' } }
]

describe('columnar mapper', () => {
  it('reads a slot the header lacks as absent, never from its default position', () => {
    const cols = resolveColumnIndices(HEADER)
    expect(cols.CHR).toBe(0)
    expect(cols.QUAL).toBe(-1)
    expect(cols.SELECTED_TRANSCRIPT).toBe(-1)
  })

  it('rejects a row whose length differs from the header, naming the row and both lengths (#590)', async () => {
    const mapper = createFieldMapper(
      dictionaries,
      resolveColumnIndices(HEADER),
      undefined,
      undefined,
      HEADER.length,
      {
        header: HEADER,
        fields: new FieldProfileResolver()
      }
    )
    await expect(
      run(mapper, [
        ['1', 10, 'A', 'G', 0.5, '1'],
        ['1', 11, 'A', 'G', 0.5]
      ])
    ).rejects.toThrow(IMPORT_MESSAGES.rowWidthMismatch(2, 5, 6))
  })

  it('stores unmapped columns per the profile, resolving dictionary codes', async () => {
    const mapper = createFieldMapper(
      dictionaries,
      resolveColumnIndices(HEADER),
      undefined,
      undefined,
      HEADER.length,
      {
        header: HEADER,
        fields: new FieldProfileResolver()
      }
    )
    const [row] = await run(mapper, [['1', 10, 'A', 'G', 0.5, '2']])
    expect(JSON.parse(String(row.info_json))).toEqual({ REVEL: '0.5', Grade: 'B' })
  })
})

describe('columnar transcript values', () => {
  it('selects the transcript only for transcript-specific columns, other arrays stay lists', async () => {
    const header = [
      { id: 'Chr' },
      { id: 'Pos' },
      { id: 'Ref' },
      { id: 'Alt' },
      { id: 'Transcript' },
      { id: 'selectedTranscript' },
      { id: 'GenesOverlapping' },
      { id: 'ExonIntronRank' }
    ]
    const mapper = createFieldMapper(
      dictionaries,
      resolveColumnIndices(header),
      undefined,
      undefined,
      header.length,
      {
        header,
        fields: new FieldProfileResolver()
      }
    )
    const [row] = await run(mapper, [
      ['1', 10, 'A', 'G', ['NM_1', 'NM_2'], 1, ['GENE1', 'GENE2'], ['2/10', '3/11']]
    ])
    expect(JSON.parse(String(row.info_json))).toEqual({
      GenesOverlapping: 'GENE1,GENE2',
      ExonIntronRank: '3/11'
    })
  })
})

describe('object mapper', () => {
  it('keeps properties without a column and skips the per-variant identifiers', async () => {
    const [row] = await run(createObjectFormatMapper(), [
      { chr: '1', pos: 10, ref: 'A', alt: 'G', lims_id: 'L1', 'AltAF-Index': 0.4, tags: ['x', 'y'] }
    ])
    expect(JSON.parse(String(row.info_json))).toEqual({ AltAF_Index: '0.4', tags: 'x,y' })
  })
})

describe('repo columnar fixture (#590)', () => {
  it('imports CFTR p.Phe508del with AF 0.02 and CADD 28.5', async () => {
    const file = join(FIXTURES, 'columnar-format.json.gz')
    const rows: Array<Record<string, unknown>> = []
    for await (const row of await createMapperPipeline(file, await detectFormat(file))) {
      rows.push(row as Record<string, unknown>)
    }
    const cftr = rows.find((r) => r.aa_change === 'p.Phe508del')
    expect(cftr).toMatchObject({ gene_symbol: 'CFTR', gnomad_af: 0.02, cadd: 28.5 })
  })
})

describe('JSON field preview', () => {
  const dir = mkdtempSync(join(tmpdir(), 'varlens-json-preview-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('lists columnar fields with column, type, fill rate and samples', async () => {
    const preview = await getJsonFieldPreview(join(FIXTURES, 'columnar-format.json.gz'))
    expect(preview.format).toBe('columnar')
    expect(preview.variantsScanned).toBe(50)
    const byName = Object.fromEntries(preview.fields.map((f) => [f.name, f]))
    expect(byName.Chr).toMatchObject({ column: 'chr', fillRate: 1 })
    expect(byName.Gene).toMatchObject({ column: 'gene_symbol', type: 'text' })
    expect(byName.Gene.samples[0]).toMatch(/^[A-Z0-9]+$/) // dictionary code resolved
    expect(byName.CADDPhredScore).toMatchObject({ column: 'cadd', type: 'number' })
  })

  it('lists object properties and stops after the sample size', async () => {
    const file = join(dir, 'object.json')
    const variants = Array.from({ length: 5 }, (_, i) => ({
      chr: '1',
      pos: i + 1,
      ref: 'A',
      alt: 'G',
      RevelScore: i % 2 === 0 ? 0.1 * i : null
    }))
    writeFileSync(file, JSON.stringify({ metadata: {}, samples: { S: { variants } } }))
    const preview = await getJsonFieldPreview(file, 4)
    expect(preview.variantsScanned).toBe(4)
    const revel = preview.fields.find((f) => f.name === 'RevelScore')
    expect(revel).toMatchObject({ column: null, type: 'number', fillRate: 0.5 })
  })
})
