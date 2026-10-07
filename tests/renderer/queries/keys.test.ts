import { describe, it, expect, beforeEach } from 'vitest'

import { isEmptyScope, queryKeys } from '../../../src/renderer/src/queries/keys'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import { createQueryPinia } from '../helpers/with-queries'

describe('queryKeys', () => {
  beforeEach(() => {
    createQueryPinia()
  })

  it('roots every key at the database revision', () => {
    const root = queryKeys.root()
    for (const key of [
      queryKeys.tags(),
      queryKeys.filterPresets(),
      queryKeys.caseIds(),
      queryKeys.filterOptions(1),
      queryKeys.variantTags(1, 2),
      queryKeys.typesPresent({ caseId: 1 }),
      queryKeys.columnMeta({ caseIds: [1, 2] }, 'sv.length')
    ]) {
      expect(key.slice(0, root.length)).toEqual([...root])
    }
  })

  it('gives a different database a different key for the same case id', () => {
    const before = queryKeys.filterOptions(7)
    useDatabaseStore().revision++
    expect(queryKeys.filterOptions(7)).not.toEqual(before)
  })

  it('treats a cohort as the same scope whatever the order of its ids', () => {
    expect(queryKeys.columnMeta({ caseIds: [3, 1, 2] }, 'c')).toEqual(
      queryKeys.columnMeta({ caseIds: [1, 2, 3] }, 'c')
    )
  })

  it('never lets a case scope and a cohort scope share a key', () => {
    expect(queryKeys.typesPresent({ caseId: 1 })).not.toEqual(
      queryKeys.typesPresent({ caseIds: [1] })
    )
  })

  it('recognises an empty scope', () => {
    expect(isEmptyScope({})).toBe(true)
    expect(isEmptyScope({ caseIds: [] })).toBe(true)
    expect(isEmptyScope({ caseId: 0 })).toBe(false)
    expect(isEmptyScope({ caseIds: [4] })).toBe(false)
  })

  it('recognises per-variant tag keys', () => {
    expect(queryKeys.isVariantTags(queryKeys.variantTags(1, 2))).toBe(true)
    expect(queryKeys.isVariantTags(queryKeys.tags())).toBe(false)
  })
})
