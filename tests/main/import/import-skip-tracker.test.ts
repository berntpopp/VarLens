import { describe, expect, it } from 'vitest'
import { ImportSkipTracker } from '../../../src/main/workers/import-skip-tracker'
import { MAX_IMPORT_SKIP_REASONS } from '../../../src/shared/types/import-worker'

describe('ImportSkipTracker', () => {
  it('counts every skip while retaining only the bounded reason sample', () => {
    const tracker = new ImportSkipTracker()
    for (let index = 0; index < MAX_IMPORT_SKIP_REASONS + 5; index += 1) {
      tracker.record(`reason-${index}`)
    }

    expect(tracker.count).toBe(MAX_IMPORT_SKIP_REASONS + 5)
    expect(tracker.reasons).toHaveLength(MAX_IMPORT_SKIP_REASONS)
    expect(tracker.reasons.at(-1)).toBe(`reason-${MAX_IMPORT_SKIP_REASONS - 1}`)
  })
})
