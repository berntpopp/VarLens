import { describe, it, expect } from 'vitest'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createObjectFormatMapper } from '../../../src/main/import/transforms/ObjectFormatMapper'
import type { ObjectFormatVariant } from '../../../src/main/import/transforms/ObjectFormatMapper'

async function runObjectTransform(variants: ObjectFormatVariant[]): Promise<unknown[]> {
  const mapper = createObjectFormatMapper()
  const results: unknown[] = []
  const readable = Readable.from(
    variants.map((v, i) => ({ key: i, value: v })),
    { objectMode: true }
  )
  const writable = new Writable({
    objectMode: true,
    write(chunk, _enc, cb) {
      results.push(chunk)
      cb()
    }
  })
  await pipeline(readable, mapper, writable)
  return results
}

describe('ObjectFormatMapper transcript output', () => {
  it('should emit _transcripts with one selected row when transcript present', async () => {
    const results = await runObjectTransform([
      {
        chr: '17',
        pos: 43094000,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'BRCA1',
        consequence: 'MODERATE',
        func: 'missense_variant',
        transcript: 'NM_007294.4',
        cdna: 'c.123A>G',
        aa_change: 'p.His41Arg',
        moi: [{ accessionId: 1, name: 'Autosomal dominant', abbreviation: 'AD' }]
      }
    ])

    const v = results[0] as Record<string, unknown>
    const transcripts = v._transcripts as Record<string, unknown>[]
    expect(transcripts).toHaveLength(1)
    expect(transcripts[0].transcript_id).toBe('NM_007294.4')
    expect(transcripts[0].is_selected).toBe(1)
    expect(transcripts[0].gene_symbol).toBe('BRCA1')
    // Canonical model (D1): consequence = IMPACT, func = SO term, both
    // passed through from the top-level mapped variant onto the transcript row.
    expect(transcripts[0].consequence).toBe('MODERATE')
    expect(transcripts[0].func).toBe('missense_variant')
  })

  it('should NOT emit _transcripts when transcript is null', async () => {
    const results = await runObjectTransform([{ chr: '1', pos: 100, ref: 'A', alt: 'G' }])

    const v = results[0] as Record<string, unknown>
    expect(v._transcripts).toBeUndefined()
  })

  it('keeps non-IMPACT legacy consequence text out of consequence', async () => {
    const [mapped] = await runObjectTransform([
      {
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'G',
        consequence: 'missense_variant',
        transcript: 'NM_1'
      }
    ])

    const variant = mapped as Record<string, unknown>
    expect(variant.consequence).toBeNull()
    expect(variant.func).toBe('missense_variant')
    expect((variant._transcripts as Record<string, unknown>[])[0]).toMatchObject({
      consequence: null,
      func: 'missense_variant'
    })
  })

  it('repairs swapped legacy consequence and func fields without losing either value', async () => {
    const [mapped] = await runObjectTransform([
      {
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'G',
        consequence: 'missense_variant',
        func: 'MODERATE',
        transcript: 'NM_1'
      }
    ])

    const variant = mapped as Record<string, unknown>
    expect(variant.consequence).toBe('MODERATE')
    expect(variant.func).toBe('missense_variant')
    expect((variant._transcripts as Record<string, unknown>[])[0]).toMatchObject({
      consequence: 'MODERATE',
      func: 'missense_variant'
    })
  })
})

describe('ObjectFormatMapper hpo_match (#580)', () => {
  it('stores the matched HPO terms as "id label" text, out of info_json', async () => {
    const [mapped] = await runObjectTransform([
      {
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'G',
        hpo_sim_score: 0.4,
        hpo_match: [
          { accessionId: 1001, name: 'Short stature', abbreviation: 'HP:0004322' },
          { accessionId: 1004, name: 'Craniosynostosis', abbreviation: 'HP:0001363' }
        ]
      }
    ])
    const variant = mapped as Record<string, unknown>
    expect(variant.hpo_match).toBe('HP:0004322 Short stature; HP:0001363 Craniosynostosis')
    expect(variant.info_json).toBeNull()
  })

  it('keeps an empty or missing list null', async () => {
    const rows = await runObjectTransform([
      { chr: '1', pos: 1, ref: 'A', alt: 'G', hpo_match: [] },
      { chr: '1', pos: 2, ref: 'A', alt: 'G', hpo_match: null },
      { chr: '1', pos: 3, ref: 'A', alt: 'G' }
    ])
    expect(rows.map((r) => (r as Record<string, unknown>).hpo_match)).toEqual([null, null, null])
  })
})
