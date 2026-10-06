import { describe, expect, it } from 'vitest'

import { toSerializableError } from '../../../src/main/ipc/errorHandler'
import { InvalidParametersError } from '../../../src/main/ipc/errors'
import { ColumnFilterValueError } from '../../../src/shared/filters/column-filter-validation'
import { PanelRegionsUnavailableError } from '../../../src/shared/filters/panel-intervals'
import { ErrorCode } from '../../../src/shared/types/errors'

describe('toSerializableError -> InvalidParametersError', () => {
  it('maps the new error class to ErrorCode.INVALID_PARAMETERS', () => {
    const err = new InvalidParametersError('foo is required')
    const result = toSerializableError(err)

    expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
    expect(result.message).toBe('foo is required')
    expect(result.userMessage).toBe('The request contained invalid parameters.')
  })

  it('honours a custom userMessage', () => {
    const err = new InvalidParametersError('chunked', 'The file path was not valid.')
    const result = toSerializableError(err)

    expect(result.userMessage).toBe('The file path was not valid.')
  })

  it('maps invalid parameter parse messages before generic parse errors', () => {
    const err = new InvalidParametersError('failed to parse import payload')
    const result = toSerializableError(err)

    expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
  })
})

describe('toSerializableError -> refused filters', () => {
  it('reports a panel without regions for the build with its own user message', () => {
    const result = toSerializableError(new PanelRegionsUnavailableError(12, 'GRCh37'))

    expect(result.code).toBe(ErrorCode.VALIDATION)
    expect(result.userMessage).toBe(
      'The active gene panel cannot be applied: none of its 12 gene(s) has coordinates for genome build GRCh37. Deactivate the panel or use one that covers this build.'
    )
  })

  it('reports a non-numeric value on a numeric column as a validation error', () => {
    const result = toSerializableError(new ColumnFilterValueError('cadd', 'abc'))

    expect(result.code).toBe(ErrorCode.VALIDATION)
    expect(result.userMessage).toBe(
      'Invalid numeric value for column filter "cadd": "abc" is not a number'
    )
  })
})
