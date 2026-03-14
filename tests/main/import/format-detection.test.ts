// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { createDataPipeline } from '../../../src/main/import/format-detection'

const FIXTURES = join(__dirname, '../../fixtures/import')

describe('createDataPipeline', () => {
  it('detects simple format and returns raw JSON item stream', async () => {
    const filePath = join(FIXTURES, 'simple-format.json.gz')
    const { formatInfo, stream } = await createDataPipeline(filePath)

    expect(formatInfo.format).toBe('simple')

    // streamArray() emits { key: number, value: T } objects
    const items: unknown[] = []
    for await (const chunk of stream) {
      items.push(chunk.value)
    }
    expect(items.length).toBeGreaterThan(0)
    const first = items[0] as Record<string, unknown>
    expect(first).toHaveProperty('chr')
    expect(first).toHaveProperty('pos')
  })

  it('detects object format and returns raw JSON item stream', async () => {
    const filePath = join(FIXTURES, 'object-format.json.gz')
    const { formatInfo, stream } = await createDataPipeline(filePath)

    expect(formatInfo.format).toBe('object')
    expect(formatInfo.caseKey).toBeTruthy()

    const items: unknown[] = []
    for await (const chunk of stream) {
      items.push(chunk.value)
    }
    expect(items.length).toBeGreaterThan(0)
  })

  it('detects columnar format and returns raw JSON item stream', async () => {
    const filePath = join(FIXTURES, 'columnar-format.json.gz')
    const { formatInfo, stream } = await createDataPipeline(filePath)

    expect(formatInfo.format).toBe('columnar')

    const items: unknown[] = []
    for await (const chunk of stream) {
      items.push(chunk.value)
    }
    expect(items.length).toBeGreaterThan(0)
  })
})
