// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Writable } from 'node:stream'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/pick.js'
import { streamArray } from 'stream-json/streamers/stream-array.js'
import { createDecompressedStream } from '../../../src/main/import/stream-utils'
import { createObjectFormatMapper } from '../../../src/main/import/transforms/ObjectFormatMapper'
import { detectFormat } from '../../../src/main/import/format-detection'

const FIXTURES = join(__dirname, '../../fixtures/import')

describe('mapper pipeline output shape', () => {
  it('simple format: mapper emits plain variant objects with expected fields', async () => {
    const filePath = join(FIXTURES, 'simple-format.json.gz')
    const variants: Record<string, unknown>[] = []

    const collector = new Writable({
      objectMode: true,
      write(chunk, _encoding, callback) {
        if (chunk !== null) {
          variants.push(chunk)
        }
        callback()
      }
    })

    await pipeline(
      createDecompressedStream(filePath),
      parser.asStream(),
      pick.asStream({ filter: 'variants' }),
      streamArray.asStream(),
      createObjectFormatMapper(),
      collector
    )

    expect(variants.length).toBeGreaterThan(0)

    // Verify output shape: plain object (not { key, value } wrapper)
    const first = variants[0]
    expect(first).toHaveProperty('chr')
    expect(first).toHaveProperty('pos')
    expect(first).toHaveProperty('ref')
    expect(first).toHaveProperty('alt')
    // Should NOT have streamArray wrapper
    expect(first).not.toHaveProperty('key')
    expect(first).not.toHaveProperty('value')
  })

  it('object format: mapper emits plain variant objects', async () => {
    const filePath = join(FIXTURES, 'object-format.json.gz')
    const formatInfo = await detectFormat(filePath)
    expect(formatInfo.format).toBe('object')

    const variants: Record<string, unknown>[] = []
    const samplePath = `samples.${formatInfo.caseKey}.variants`

    const collector = new Writable({
      objectMode: true,
      write(chunk, _encoding, callback) {
        if (chunk !== null) {
          variants.push(chunk)
        }
        callback()
      }
    })

    await pipeline(
      createDecompressedStream(filePath),
      parser.asStream(),
      pick.asStream({ filter: samplePath }),
      streamArray.asStream(),
      createObjectFormatMapper(),
      collector
    )

    expect(variants.length).toBeGreaterThan(0)
    expect(variants[0]).toHaveProperty('chr')
    expect(variants[0]).not.toHaveProperty('key')
  })
})
