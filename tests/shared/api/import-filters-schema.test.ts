import { describe, expect, it } from 'vitest'

import { normalizeImportFiltersPayload } from '../../../src/shared/api/schemas/import'
import { ImportFiltersIpcPayloadSchema } from '../../../src/shared/ipc/domains/import-schemas'

/** The web route and the desktop IPC handler must refuse the same filter values. */
describe('import filter limits are the same on web and desktop', () => {
  it.each([
    { bedPadding: -1 },
    { bedPadding: 0.5 },
    { bedPadding: 1_000_001 },
    { minQual: -1 },
    { minGq: -1 },
    { minDp: -1 },
    { minDp: 1_000_001 }
  ])('rejects %o', (filters) => {
    expect(ImportFiltersIpcPayloadSchema.safeParse(filters).success).toBe(false)
    expect(normalizeImportFiltersPayload(filters)).toBeUndefined()
  })

  it('accepts the values the dialog sends', () => {
    const filters = { bedPadding: 50, passOnly: true, minQual: 20, minGq: null, minDp: 10 }
    expect(ImportFiltersIpcPayloadSchema.safeParse(filters).success).toBe(true)
    expect(normalizeImportFiltersPayload(filters)).toEqual(filters)
  })
})
