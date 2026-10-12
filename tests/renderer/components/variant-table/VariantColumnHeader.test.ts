/**
 * Column-header help: the sortable header button carries the COLUMN_HELP
 * entry as its delegated tooltip and as its accessible description, for the
 * case and cohort column sets alike (both render VariantColumnHeader).
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import VariantColumnHeader from '@renderer/components/variant-table/VariantColumnHeader.vue'
import { COLUMN_HELP } from '@renderer/config/columnHelp'
import { baseHeaders as caseHeaders } from '@renderer/components/variant-table/columns'
import { baseHeaders as cohortHeaders } from '@renderer/components/cohort/useCohortColumns'

const vuetify = createVuetify({ components, directives })

function mountHeader(key: string, title: string) {
  return mount(VariantColumnHeader, {
    props: {
      headerColumn: { key, title },
      getSortIcon: () => '',
      toggleSort: () => {},
      isSorted: () => false,
      hasFilter: false
    },
    global: { plugins: [vuetify] }
  })
}

const titled = (headers: { key: string; title: string }[]) => headers.filter((h) => h.title !== '')

describe('VariantColumnHeader help', () => {
  it.each(Object.entries(COLUMN_HELP))('%s: tooltip and description show the help', (key, help) => {
    const wrapper = mountHeader(key, 'Title')
    const button = wrapper.get('[role="button"]')
    expect(button.attributes('data-tooltip')).toBe(`Title — ${help}`)
    const describedBy = button.attributes('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(wrapper.get(`[id="${describedBy}"]`).text()).toBe(help)
  })

  it('falls back to the title without a description when a column has no help', () => {
    const button = mountHeader('no_such_column', 'Plain').get('[role="button"]')
    expect(button.attributes('data-tooltip')).toBe('Plain')
    expect(button.attributes('aria-describedby')).toBeUndefined()
  })

  it.each([
    ['case', caseHeaders],
    ['cohort', cohortHeaders]
  ])('every titled %s column has help', (_view, headers) => {
    const missing = titled(headers).filter((h) => !COLUMN_HELP[h.key])
    expect(missing.map((h) => h.key)).toEqual([])
  })

  it('case CADD and cohort CADD PHRED share one help text', () => {
    expect(COLUMN_HELP.cadd_phred).toBe(COLUMN_HELP.cadd)
  })
})
