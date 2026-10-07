// @vitest-environment node
/**
 * Every CSQ entry of the repository VCF fixtures has as many fields as the
 * header's Format declares. `synthetic-unit-test.vcf` had three entries with
 * one field too many, which shifted CADD_PHRED into ClinVar_CLNSIG ("3.2",
 * "33.0" imported as ClinVar values) and dropped the canonical flag.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const DIR = resolve(__dirname, '../../../test-data/vcf')
const FILES = readdirSync(DIR).filter((name) => /\.vcf(\.gz)?$/.test(name))

function readVcf(name: string): string[] {
  const bytes = readFileSync(join(DIR, name))
  return (name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8').split('\n')
}

describe('CSQ field count of the VCF fixtures', () => {
  it.each(FILES)('%s', (name) => {
    const lines = readVcf(name)
    const format = lines
      .find((line) => line.startsWith('##INFO=<ID=CSQ,'))
      ?.match(/Format: ([^"]+)"/)?.[1]
    if (format === undefined) return
    const expected = format.split('|').length

    const wrong: string[] = []
    for (const line of lines) {
      if (line === '' || line.startsWith('#')) continue
      const columns = line.split('\t')
      const csq = columns[7].split(';').find((entry) => entry.startsWith('CSQ='))
      if (csq === undefined) continue
      for (const entry of csq.slice(4).split(',')) {
        // `CSQ=` with no value is the deliberate "no annotation" edge case
        if (entry === '') continue
        const count = entry.split('|').length
        if (count !== expected) wrong.push(`${columns[0]}:${columns[1]} has ${count}`)
      }
    }
    expect(wrong, `expected ${expected} fields per CSQ entry`).toEqual([])
  })
})
