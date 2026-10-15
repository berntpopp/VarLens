import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import DslSearchBar from '../../../src/renderer/src/components/DslSearchBar.vue'
import { useDslSearch } from '../../../src/renderer/src/composables/useDslSearch'
import type { SuggestionScope } from '../../../src/renderer/src/dsl/autocomplete'

const vuetify = createVuetify({ components, directives })

/** Wires DslSearchBar to useDslSearch the way FilterToolbar / CohortFilterBar do */
function harness(scope: SuggestionScope = 'case') {
  const applied = ref<string[]>([])
  const Host = defineComponent({
    setup() {
      const dsl = useDslSearch(() => ['my_preset'], scope)
      function onApply(): void {
        dsl.parseNow() // as useDslFilterIntegration.applyDslFilters does
        if (dsl.errors.value.length === 0) applied.value.push(dsl.rawInput.value.trim())
      }
      return () =>
        h(DslSearchBar, {
          rawInput: dsl.rawInput.value,
          suggestions: dsl.suggestions.value,
          isDslMode: dsl.isDslMode.value,
          errors: dsl.errors.value,
          'onUpdate:rawInput': (v: string) => (dsl.rawInput.value = v),
          onApply,
          onClear: dsl.clear,
          onSelectSuggestion: dsl.applySuggestion
        })
    }
  })
  const wrapper = mount(Host, { global: { plugins: [vuetify] }, attachTo: document.body })
  return { wrapper, applied }
}

let current: VueWrapper | null = null
afterEach(() => {
  current?.unmount()
  current = null
  vi.useRealTimers()
})

function input(wrapper: VueWrapper): HTMLInputElement {
  return wrapper.find('input').element as HTMLInputElement
}

async function press(wrapper: VueWrapper, key: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await wrapper.find('input').trigger('keydown', { key })
    await nextTick()
  }
}

function activeOptionText(wrapper: VueWrapper): string {
  const id = input(wrapper).getAttribute('aria-activedescendant')
  expect(id).toBeTruthy()
  return document.getElementById(id!)?.textContent ?? ''
}

async function focusBar(wrapper: VueWrapper): Promise<void> {
  input(wrapper).focus()
  await wrapper.find('input').trigger('focus')
  await nextTick()
}

describe('DslSearchBar', () => {
  it('describes a pending draft below the field instead of squeezing the input', () => {
    current = mount(DslSearchBar, {
      props: {
        rawInput: 'gene:=:BRCA1',
        suggestions: [],
        isDslMode: true,
        errors: [],
        notApplied: true
      },
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    const describedBy = current.find('input').attributes('aria-describedby') ?? ''
    expect(describedBy).not.toBe('')
    expect(document.getElementById(describedBy)?.textContent?.trim()).toBe(
      'Not applied — press Enter to apply'
    )
    expect(current.find('.v-field__append-inner').text()).not.toContain('Not applied')
  })

  it('has exactly one combobox and it is the input', () => {
    const { wrapper } = harness()
    current = wrapper
    const comboboxes = document.querySelectorAll('[role="combobox"]')
    expect(comboboxes).toHaveLength(1)
    expect(comboboxes[0]).toBe(input(wrapper))
    expect(input(wrapper).getAttribute('aria-expanded')).toBe('false')
  })

  it('builds a full query from the keyboard alone and applies it', async () => {
    const { wrapper, applied } = harness()
    current = wrapper
    await focusBar(wrapper)
    const el = input(wrapper)

    expect(el.getAttribute('aria-expanded')).toBe('true')
    const listbox = document.getElementById(el.getAttribute('aria-controls')!)
    expect(listbox?.getAttribute('role')).toBe('listbox')

    // field
    await press(wrapper, 'ArrowDown')
    expect(activeOptionText(wrapper)).toContain('gnomad_af')
    expect(
      document.getElementById(el.getAttribute('aria-activedescendant')!)?.getAttribute('role')
    ).toBe('option')
    await press(wrapper, 'Enter')
    expect(el.value).toBe('gnomad_af:')

    // operator: = != < → the third; its hint explains missing values
    await press(wrapper, 'ArrowDown', 3)
    expect(activeOptionText(wrapper)).toContain('also keeps variants with no gnomAD AF value')
    await press(wrapper, 'Enter')
    expect(el.value).toBe('gnomad_af:<:')

    // value
    await press(wrapper, 'ArrowDown')
    expect(activeOptionText(wrapper)).toContain('0.01')
    await press(wrapper, 'Enter')
    expect(el.value).toBe('gnomad_af:<:0.01 ')
    expect(applied.value).toEqual([])

    // combine with AND, then a second condition, then apply
    await press(wrapper, 'ArrowDown')
    expect(activeOptionText(wrapper)).toContain('AND')
    await press(wrapper, 'Enter')
    expect(el.value).toBe('gnomad_af:<:0.01 AND ')
    await press(wrapper, 'ArrowDown', 8) // gnomad_af cadd qual hpo_sim_score phenotype_score pos gene_symbol consequence
    expect(activeOptionText(wrapper)).toContain('consequence')
    await press(wrapper, 'Enter')
    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'Enter')
    await press(wrapper, 'ArrowDown')
    expect(activeOptionText(wrapper)).toContain('HIGH')
    await press(wrapper, 'Enter')
    expect(el.value).toBe('gnomad_af:<:0.01 AND consequence:=:HIGH ')

    // no active option → Enter applies
    await press(wrapper, 'Enter')
    expect(applied.value).toEqual(['gnomad_af:<:0.01 AND consequence:=:HIGH'])
    expect(document.activeElement).toBe(el)
  })

  it('offers only cohort fields in the cohort view', async () => {
    const { wrapper } = harness('cohort')
    current = wrapper
    await focusBar(wrapper)
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)
    expect(options.some((t) => t?.includes('carrier_count'))).toBe(true)
    expect(options.some((t) => t?.includes('gnomad_af'))).toBe(true)
    expect(options.some((t) => t?.includes('hpo_sim_score'))).toBe(false)
    expect(options.some((t) => t?.includes('gt_num'))).toBe(false)
  })

  it('rejects a per-case field in the cohort view with an inline error and applies nothing', async () => {
    const { wrapper, applied } = harness('cohort')
    current = wrapper
    await wrapper.find('input').setValue('gt_num:=:1/1')
    await press(wrapper, 'Escape')
    await press(wrapper, 'Enter')
    expect(applied.value).toEqual([])
    const el = input(wrapper)
    expect(el.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(el.getAttribute('aria-describedby')!)?.textContent).toContain(
      'per-case field'
    )
  })

  it('shows errors as persistent text linked to the input, and Enter applies a corrected query at once', async () => {
    vi.useFakeTimers()
    const { wrapper, applied } = harness()
    current = wrapper
    await wrapper.find('input').setValue('gnomad_af:<:abc')
    await vi.advanceTimersByTimeAsync(300) // debounced validation
    await nextTick()

    const el = input(wrapper)
    expect(el.getAttribute('aria-invalid')).toBe('true')
    const describedBy = el.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toContain("'abc' is not a number")

    // Correct it and press Enter before the debounce fires: nothing stale may block it
    await wrapper.find('input').setValue('gnomad_af:<:0.05')
    await press(wrapper, 'Escape') // close the list so Enter applies
    await press(wrapper, 'Enter')
    expect(applied.value).toEqual(['gnomad_af:<:0.05'])
    await nextTick()
    expect(el.getAttribute('aria-invalid')).toBeNull()
    expect(wrapper.text()).not.toContain('is not a number')
  })

  it('Escape closes the suggestions but keeps focus in the input', async () => {
    const { wrapper } = harness()
    current = wrapper
    await focusBar(wrapper)
    const el = input(wrapper)
    await press(wrapper, 'ArrowDown')
    expect(el.getAttribute('aria-expanded')).toBe('true')

    await press(wrapper, 'Escape')
    expect(el.getAttribute('aria-expanded')).toBe('false')
    expect(el.getAttribute('aria-activedescendant')).toBeNull()
    expect(document.activeElement).toBe(el)

    // Arrow keys reopen it
    await press(wrapper, 'ArrowDown')
    expect(el.getAttribute('aria-expanded')).toBe('true')
  })

  it('round-trips: a typed query and a picked query apply the same text', async () => {
    const { wrapper, applied } = harness()
    current = wrapper
    await wrapper.find('input').setValue('cadd:>=:20')
    await press(wrapper, 'Escape')
    await press(wrapper, 'Enter')

    await wrapper.find('input').setValue('')
    await focusBar(wrapper)
    await press(wrapper, 'ArrowDown', 2) // cadd
    await press(wrapper, 'Enter')
    await press(wrapper, 'ArrowDown', 6) // = != < > <= >=
    await press(wrapper, 'Enter')
    await press(wrapper, 'ArrowDown', 3) // 10 15 20
    await press(wrapper, 'Enter')
    await press(wrapper, 'Escape')
    await press(wrapper, 'Enter')
    expect(applied.value).toEqual(['cadd:>=:20', 'cadd:>=:20'])
  })
})
