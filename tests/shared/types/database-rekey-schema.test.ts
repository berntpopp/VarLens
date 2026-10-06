import { describe, expect, it } from 'vitest'

import { DatabaseRekeySchema } from '../../../src/shared/types/ipc-schemas'

describe('DatabaseRekeySchema', () => {
  it('accepts a new password', () => {
    expect(DatabaseRekeySchema.safeParse({ newPassword: 'correct horse' }).success).toBe(true)
  })

  it('rejects an empty password — `PRAGMA rekey` with an empty key removes encryption', () => {
    expect(DatabaseRekeySchema.safeParse({ newPassword: '' }).success).toBe(false)
  })

  it('rejects a missing or over-long password', () => {
    expect(DatabaseRekeySchema.safeParse({}).success).toBe(false)
    expect(DatabaseRekeySchema.safeParse({ newPassword: 'x'.repeat(257) }).success).toBe(false)
  })
})
