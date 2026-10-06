import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { defineComponent, h } from 'vue'
import { mdiCog } from '@mdi/js'
import IconButton from '../../../src/renderer/src/components/common/IconButton.vue'
import CaseStatusIcons from '../../../src/renderer/src/components/CaseStatusIcons.vue'
import AnnotationsCell from '../../../src/renderer/src/components/table-cells/AnnotationsCell.vue'
import ExpandToggleCell from '../../../src/renderer/src/components/table-cells/ExpandToggleCell.vue'
import {
  findTooltipTarget,
  useDelegatedTooltip
} from '../../../src/renderer/src/composables/useDelegatedTooltip'
import { buildViewTitle } from '../../../src/renderer/src/composables/useViewTitle'

const vuetify = createVuetify({ components, directives })
const global = { plugins: [vuetify] }

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('IconButton', () => {
  it('names the button and exposes the label as its delegated tooltip', () => {
    const wrapper = mount(IconButton, { props: { label: 'Settings', icon: mdiCog }, global })
    const btn = wrapper.get('button')
    expect(btn.attributes('aria-label')).toBe('Settings')
    expect(btn.attributes('data-tooltip')).toBe('Settings')
    expect(wrapper.find('.v-tooltip').exists()).toBe(false)
  })

  it('meets the 24px target minimum at the smallest size and 32px by default', () => {
    const small = mount(IconButton, {
      props: { label: 'x', icon: mdiCog, size: 'x-small' },
      global
    })
    expect(small.get('button').attributes('style')).toContain('width: 24px')
    const dflt = mount(IconButton, { props: { label: 'x', icon: mdiCog }, global })
    expect(dflt.get('button').attributes('style')).toContain('width: 32px')
  })

  it('supports a distinct tooltip, no tooltip, and toggle state', () => {
    const wrapper = mount(IconButton, {
      props: { label: 'Starred only', icon: mdiCog, tooltip: 'Show starred', pressed: true },
      global
    })
    const btn = wrapper.get('button')
    expect(btn.attributes('data-tooltip')).toBe('Show starred')
    expect(btn.attributes('aria-pressed')).toBe('true')
    const silent = mount(IconButton, {
      props: { label: 'Expand', icon: mdiCog, tooltip: false },
      global
    })
    expect(silent.get('button').attributes('data-tooltip')).toBeUndefined()
  })
})

describe('AnnotationsCell', () => {
  const baseProps = { isStarred: true, acmgClassification: null, hasComment: false }

  it('renders star / ACMG / comment as named native buttons without per-cell tooltips', () => {
    const wrapper = mount(AnnotationsCell, { props: baseProps, global })
    const buttons = wrapper.findAll('button.annotation-btn')
    expect(buttons).toHaveLength(3)
    for (const b of buttons) {
      expect(b.attributes('aria-label')).toBeTruthy()
      expect(b.attributes('data-tooltip')).toBe(b.attributes('aria-label'))
    }
    expect(buttons[0].attributes('aria-pressed')).toBe('true')
    expect(buttons[2].attributes('aria-label')).toBe('Add comment')
    expect(wrapper.find('.v-tooltip').exists()).toBe(false)
  })

  it('emits actions from the buttons', async () => {
    const wrapper = mount(AnnotationsCell, { props: baseProps, global })
    const buttons = wrapper.findAll('button.annotation-btn')
    await buttons[0].trigger('click')
    await buttons[2].trigger('click')
    expect(wrapper.emitted('star-toggle')).toHaveLength(1)
    expect(wrapper.emitted('comment-click')).toHaveLength(1)
  })

  it('describes the other-scope annotation in the accessible name', () => {
    const wrapper = mount(AnnotationsCell, {
      props: { ...baseProps, isStarred: false, isGlobalStarred: true },
      global
    })
    const star = wrapper.findAll('button.annotation-btn')[0]
    expect(star.attributes('aria-label')).toBe('Global star — click to add case star')
    expect(star.classes()).toContain('has-global')
  })
})

describe('CaseStatusIcons', () => {
  it('renders no "?" glyphs for unknown values but keeps accessible text', () => {
    const wrapper = mount(CaseStatusIcons, {
      props: { status: 'unknown', sex: 'unknown' },
      global
    })
    expect(wrapper.findAll('.v-icon')).toHaveLength(0)
    expect(wrapper.get('.visually-hidden').text()).toBe('Affected status unknown, Sex unknown')
  })

  it('renders glyphs with tooltips for known values', () => {
    const wrapper = mount(CaseStatusIcons, { props: { status: 'affected', sex: 'female' }, global })
    const icons = wrapper.findAll('.v-icon')
    expect(icons).toHaveLength(2)
    expect(icons[0].attributes('data-tooltip')).toBe('Affected')
    expect(icons[1].attributes('data-tooltip')).toBe('Sex: female')
  })
})

describe('ExpandToggleCell', () => {
  it('names the header and toggles with a named button', async () => {
    const header = mount(ExpandToggleCell, { props: { header: true }, global })
    expect(header.text()).toBe('Carriers')
    const toggle = vi.fn()
    const cell = mount(ExpandToggleCell, {
      props: { internalItem: { id: 1 }, isExpanded: () => true, toggleExpand: toggle },
      global
    })
    const btn = cell.get('button')
    expect(btn.attributes('aria-label')).toBe('Hide carriers')
    expect(btn.attributes('aria-expanded')).toBe('true')
    await btn.trigger('click')
    expect(toggle).toHaveBeenCalledWith({ id: 1 })
  })
})

describe('useDelegatedTooltip', () => {
  it('resolves the nearest data-tooltip ancestor and its location', () => {
    document.body.innerHTML =
      '<div data-tooltip="Hello" data-tooltip-location="top"><i id="inner"></i></div><p id="none"></p>'
    const hit = findTooltipTarget(document.getElementById('inner'))
    expect(hit?.text).toBe('Hello')
    expect(hit?.location).toBe('top')
    expect(findTooltipTarget(document.getElementById('none'))).toBeNull()
  })

  it('opens after the hover delay, follows the hovered element, and closes on Escape', async () => {
    vi.useFakeTimers()
    let state: ReturnType<typeof useDelegatedTooltip> | undefined
    const Host = defineComponent({
      setup() {
        state = useDelegatedTooltip(() => document, 100)
        return () => h('div', [h('button', { id: 'a', 'data-tooltip': 'Alpha' })])
      }
    })
    mount(Host, { attachTo: document.body })
    const a = document.getElementById('a') as HTMLElement
    a.dispatchEvent(new Event('pointerover', { bubbles: true }))
    expect(state?.open.value).toBe(false)
    vi.advanceTimersByTime(100)
    expect(state?.open.value).toBe(true)
    expect(state?.text.value).toBe('Alpha')
    expect(state?.target.value).toBe(a)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(state?.open.value).toBe(false)
  })
})

describe('buildViewTitle', () => {
  it('titles case, cohort, and home views', () => {
    expect(buildViewTitle({ tab: 'case', caseName: 'LB26-0060' })).toEqual({
      documentTitle: 'LB26-0060 · Case · VarLens',
      heading: 'Case LB26-0060'
    })
    expect(buildViewTitle({ tab: 'cohort', caseName: 'LB26-0060' }).documentTitle).toBe(
      'Cohort · VarLens'
    )
    expect(buildViewTitle({ tab: 'case', caseName: null }).documentTitle).toBe('VarLens')
  })
})
