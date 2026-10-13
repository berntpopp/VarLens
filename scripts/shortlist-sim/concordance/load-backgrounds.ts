/**
 * Load the local varvis exome backgrounds (patient data) through the production
 * ObjectFormatMapper, in-process. Nothing returned here may be written into the repository or
 * sent over the network.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gunzipSync } from 'node:zlib'
import {
  createObjectFormatMapper,
  type ObjectFormatVariant
} from '../../../src/main/import/transforms/ObjectFormatMapper'
import type { Variant } from '../../../src/shared/types/database'
import { BACKGROUND_DIR } from '../common/paths'

export type MappedVariant = Omit<Variant, 'id' | 'case_id'>

export interface Background {
  /** bg1..bgN by file-name order — never the LIMS id. */
  caseLabel: string
  rows: MappedVariant[]
  skipped: number
}

export async function mapVariants(
  variants: ObjectFormatVariant[]
): Promise<{ rows: MappedVariant[]; skipped: number }> {
  const rows: MappedVariant[] = []
  let skipped = 0
  const sink = new Writable({
    objectMode: true,
    write(chunk: MappedVariant & { _transcripts?: unknown }, _enc, cb) {
      delete chunk._transcripts
      rows.push(chunk)
      cb()
    }
  })
  const source = Readable.from(
    variants.map((value, key) => ({ key, value })),
    { objectMode: true }
  )
  await pipeline(
    source,
    createObjectFormatMapper(undefined, () => skipped++),
    sink
  )
  return { rows, skipped }
}

export function backgroundFiles(dir: string = BACKGROUND_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json.gz') || f.endsWith('.json'))
    .sort()
    .map((f) => join(dir, f))
}

export async function loadBackground(path: string, caseLabel: string): Promise<Background> {
  const raw = readFileSync(path)
  const text = path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
  const doc = JSON.parse(text) as { variants?: ObjectFormatVariant[] } | ObjectFormatVariant[]
  const variants = Array.isArray(doc) ? doc : (doc.variants ?? [])
  const { rows, skipped } = await mapVariants(variants)
  return { caseLabel, rows, skipped }
}

export async function loadBackgrounds(dir: string = BACKGROUND_DIR): Promise<Background[]> {
  const files = backgroundFiles(dir)
  if (files.length === 0) throw new Error(`No varvis JSON backgrounds in ${dir}`)
  return Promise.all(files.map((f, i) => loadBackground(f, `bg${i + 1}`)))
}
