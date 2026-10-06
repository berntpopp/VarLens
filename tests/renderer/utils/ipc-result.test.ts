import { describe, expect, it } from 'vitest'

import { formatError } from '../../../src/renderer/src/utils/ipc-result'
import { ErrorCode } from '../../../src/shared/types/errors'

describe('formatError', () => {
  it('uses the SerializableError user message (the old [object Object] association bug)', () => {
    const thrown = {
      code: ErrorCode.UNSUPPORTED_RUNTIME,
      message: 'cohort.runAssociation is not available in web mode yet.',
      userMessage: 'Association analysis is not available in the web version yet.'
    }
    expect(formatError(thrown)).toBe(
      'Association analysis is not available in the web version yet.'
    )
    expect(`Analysis failed: ${formatError(thrown)}`).not.toContain('[object Object]')
  })

  it('never returns [object Object] for opaque objects, empty strings or null', () => {
    for (const value of [{}, { details: 1 }, '', null, undefined, Object.create(null)]) {
      const text = formatError(value, 'fallback')
      expect(text).toBe('fallback')
    }
  })

  it('passes Error messages and strings through', () => {
    expect(formatError(new Error('boom'))).toBe('boom')
    expect(formatError('plain')).toBe('plain')
  })
})
