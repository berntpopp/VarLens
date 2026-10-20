/**
 * Pooled render rows are mutated in place for the same id, so the cis/trans chip
 * must follow a `phase` prop, not the (identity-stable) row object.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import GenotypeCell from '@renderer/components/variant-table/GenotypeCell.vue'
import {
  buildVariantRenderRows,
  type VariantRenderRow
} from '@renderer/components/variant-table/useVariantRenderRows'
import type { Variant } from '../../../../src/shared/types/api'

const vuetify = createVuetify({ components, directives })

describe('GenotypeCell', () => {
  it('drops the comphet chip when comphet_phase clears on the same pooled row id', async () => {
    const cache = new Map<number, VariantRenderRow>()
    const base = { id: 7, gt_num: '0/1' } as unknown as Variant
    const rows = shallowRef(
      buildVariantRenderRows([{ ...base, comphet_phase: 'trans' }], new Map(), cache)
    )
    const Host = defineComponent(
      () => () =>
        rows.value.map((row) => h(GenotypeCell, { value: row.gt_num, phase: row.comphet_phase }))
    )
    const wrapper = mount(Host, { global: { plugins: [vuetify] } })
    expect(wrapper.find('[data-testid="comphet-phase-chip"]').text()).toBe('trans')

    const next = buildVariantRenderRows([{ ...base }], new Map(), cache)
    expect(next[0]).toBe(rows.value[0])
    rows.value = next
    await nextTick()
    expect(wrapper.find('[data-testid="comphet-phase-chip"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
