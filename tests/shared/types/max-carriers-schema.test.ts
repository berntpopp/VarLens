/**
 * Carrier cap (#455): an integer of at least 1; null or absent means off.
 */
import { describe, expect, it } from 'vitest'

import { VariantInvokeBodySchemas } from '../../../src/shared/api/schemas/variants'
import {
  CohortSearchParamsSchema,
  FilterStateSchema,
  VariantFilterPartialSchema
} from '../../../src/shared/types/ipc-schemas'

const cap = (value: unknown): Record<string, unknown> => ({ carrier_count_max: value })

describe.each([
  ['CohortSearchParamsSchema', CohortSearchParamsSchema],
  ['VariantFilterPartialSchema', VariantFilterPartialSchema]
] as const)('%s: carrier_count_max', (_name, schema) => {
  it.each([1, 3, 250])('accepts %s', (value) => {
    expect(schema.parse(cap(value))).toMatchObject({ carrier_count_max: value })
  })

  it('treats null and absent as off', () => {
    expect(schema.parse(cap(null)).carrier_count_max).toBeUndefined()
    expect(schema.parse({}).carrier_count_max).toBeUndefined()
  })

  it.each([0, -1, 2.5, '3', Number.NaN])('rejects %s', (value) => {
    expect(schema.safeParse(cap(value)).success).toBe(false)
  })
})

describe('carrier cap in the other schemas', () => {
  it('the web variants:query body rejects a cap below 1 and a fraction', () => {
    const body = (value: unknown): unknown => ({ args: [1, cap(value), 0, 25, [], false, false] })
    expect(VariantInvokeBodySchemas.query.safeParse(body(3)).success).toBe(true)
    expect(VariantInvokeBodySchemas.query.safeParse(body(null)).success).toBe(true)
    expect(VariantInvokeBodySchemas.query.safeParse(body(0)).success).toBe(false)
    expect(VariantInvokeBodySchemas.query.safeParse(body(2.5)).success).toBe(false)
  })

  it('FilterStateSchema: maxCarriers is a whole number of cases, at least 1, or null', () => {
    const partial = FilterStateSchema.partial()
    expect(partial.safeParse({ maxCarriers: 3 }).success).toBe(true)
    expect(partial.safeParse({ maxCarriers: null }).success).toBe(true)
    for (const bad of [0, -1, 2.5]) {
      expect(partial.safeParse({ maxCarriers: bad }).success).toBe(false)
    }
  })
})
