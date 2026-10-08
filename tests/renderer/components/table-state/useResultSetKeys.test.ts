import { cohortVariantKey } from '../../../../src/shared/utils/cohort-variant-key'

import { describe, it, expect } from 'vitest'
import { nextTick, ref } from 'vue'
import { useResultSetKeys } from '../../../../src/renderer/src/components/table-state/useResultSetKeys'
import { withSetup } from '../../../utils/test-helpers'

interface Row {
  key: string
  starred?: boolean
}

describe('useResultSetKeys', () => {
  it('gives an opaque cohort key back unchanged, also as an expanded row', () => {
    const id = cohortVariantKey({
      chr: '2',
      pos: 321681,
      ref: 'G',
      alt: ']13:123456]T#1',
      variant_type: 'sv',
      genome_build: 'GRCh38'
    })
    const { rows, keys, app } = setup([{ key: id }])
    const renderKey = keys.rowKey(rows.value[0])
    expect(keys.idOfKey(renderKey)).toBe(id)
    const expanded = ref<string[]>([])
    keys.keyedModel(expanded).value = [renderKey]
    expect(expanded.value).toEqual([id])
    app.unmount()
  })

  function setup(initial: Row[]) {
    const rows = ref<Row[]>(initial)
    const [keys, app] = withSetup(() =>
      useResultSetKeys(
        () => rows.value,
        (r) => r.key
      )
    )
    return { rows, keys, app }
  }

  it('gives a reordered page new row keys so rows are re-created, not moved', async () => {
    const { rows, keys, app } = setup([{ key: '1:100:A:T' }, { key: '1:200:C:G' }])
    const before = rows.value.map(keys.rowKey)
    rows.value = [rows.value[1], rows.value[0]]
    await nextTick()
    const after = rows.value.map(keys.rowKey)
    expect(after.some((k) => before.includes(k))).toBe(false)
    expect(after.map(keys.idOfKey)).toEqual(['1:200:C:G', '1:100:A:T'])
    app.unmount()
  })

  it('keeps keys when the same rows re-render with new annotation data', async () => {
    const { rows, keys, app } = setup([{ key: 'a' }, { key: 'b' }])
    const before = rows.value.map(keys.rowKey)
    rows.value = [
      { key: 'a', starred: true },
      { key: 'b', starred: false }
    ]
    await nextTick()
    expect(rows.value.map(keys.rowKey)).toEqual(before)
    app.unmount()
  })

  it('maps an id list (expanded rows) to render keys and back', async () => {
    const { rows, keys, app } = setup([{ key: 'x:1' }, { key: 'y:2' }])
    const expandedIds = ref<string[]>(['y:2'])
    const model = keys.keyedModel(expandedIds)
    expect(model.value).toEqual([keys.rowKey(rows.value[1])])

    model.value = [keys.rowKey(rows.value[0]), keys.rowKey(rows.value[1])]
    expect(expandedIds.value).toEqual(['x:1', 'y:2'])

    // A sort changes the generation; the same variants stay expanded.
    rows.value = [rows.value[1], rows.value[0]]
    await nextTick()
    expect(model.value.map(keys.idOfKey)).toEqual(['x:1', 'y:2'])
    expect(model.value).toContain(keys.rowKey(rows.value[0]))
    app.unmount()
  })
})
