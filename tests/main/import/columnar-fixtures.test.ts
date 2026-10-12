/**
 * Every columnar JSON fixture must have rows exactly as wide as its header:
 * the import rejects anything else (FieldMapper row/header length check).
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const DIRS = ['../../fixtures/import', '../../e2e/test-data'].map((d) => join(__dirname, d))

type Columnar = { header: unknown[]; data: unknown[][] }

function columnarBlocks(node: unknown, out: Columnar[] = []): Columnar[] {
  if (node === null || typeof node !== 'object') return out
  const o = node as Record<string, unknown>
  if (Array.isArray(o.header) && o.header.length > 0 && Array.isArray(o.data)) {
    out.push(o as unknown as Columnar)
  }
  for (const v of Object.values(o)) columnarBlocks(v, out)
  return out
}

const files = DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json') || f.endsWith('.json.gz'))
    .map((f) => join(dir, f))
)

describe('columnar JSON fixtures', () => {
  it.each(files)('%s has rows as wide as its header', (file) => {
    const raw = readFileSync(file)
    const json: unknown = JSON.parse((file.endsWith('.gz') ? gunzipSync(raw) : raw).toString())
    for (const { header, data } of columnarBlocks(json)) {
      const widths = new Set(data.map((row) => row.length))
      expect([...widths]).toEqual(data.length === 0 ? [] : [header.length])
    }
  })
})
