/**
 * A lazy chunk that fails to load must leave a visible, actionable notice in
 * the shell instead of a silently blank view (issue #452). Vite reports the
 * failure with a `vite:preloadError` event on window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import ChunkLoadErrorBanner from '../../../../src/renderer/src/components/common/ChunkLoadErrorBanner.vue'
import { useChunkLoadFailure } from '../../../../src/renderer/src/composables/useChunkLoadFailure'
import { useLogStore } from '../../../../src/renderer/src/stores/logStore'

const vuetify = createVuetify({ components, directives })
const BANNER = '[data-testid="chunk-load-error"]'

function dispatchPreloadError(payload: unknown): Event {
  const event = new Event('vite:preloadError', { cancelable: true })
  Object.defineProperty(event, 'payload', { value: payload })
  window.dispatchEvent(event)
  return event
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('ChunkLoadErrorBanner', () => {
  it('renders nothing while every chunk loads', () => {
    const wrapper = mount(ChunkLoadErrorBanner, { global: { plugins: [vuetify] } })
    expect(wrapper.find(BANNER).exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows an alert with a reload action once a lazy chunk fails to load', async () => {
    const wrapper = mount(ChunkLoadErrorBanner, { global: { plugins: [vuetify] } })
    dispatchPreloadError(
      new TypeError('Failed to fetch dynamically imported module: /assets/CaseView-abc.js')
    )
    await nextTick()

    const banner = wrapper.get(BANNER)
    expect(banner.attributes('role')).toBe('alert')
    expect(banner.text()).toContain('could not be loaded')
    expect(banner.get('button').text()).toBe('Reload')
    wrapper.unmount()
  })

  it('stops listening when unmounted', async () => {
    const wrapper = mount(ChunkLoadErrorBanner, { global: { plugins: [vuetify] } })
    wrapper.unmount()
    dispatchPreloadError(new Error('late failure'))
    expect(useLogStore().entries).toHaveLength(0)
  })
})

describe('useChunkLoadFailure', () => {
  it('records the failure in the application log and leaves the event uncancelled', () => {
    const scope = effectScope()
    const { failed } = scope.run(() => useChunkLoadFailure())!
    expect(failed.value).toBe(false)

    const event = dispatchPreloadError(
      new TypeError('Failed to fetch dynamically imported module: /assets/CohortView-abc.js')
    )

    expect(failed.value).toBe(true)
    // Not cancelled: Vite still rejects the import, so Vue and vue-router see the failure.
    expect(event.defaultPrevented).toBe(false)
    const entry = useLogStore().entries.at(-1)
    expect(entry).toMatchObject({ level: 'error', source: 'chunk-load' })
    expect(entry?.message).toContain('CohortView-abc.js')
    scope.stop()
  })

  it('tolerates a payload that is not an Error', () => {
    const scope = effectScope()
    const { failed } = scope.run(() => useChunkLoadFailure())!
    dispatchPreloadError('Unable to preload CSS for /assets/CaseView-abc.css')
    expect(failed.value).toBe(true)
    expect(useLogStore().entries.at(-1)?.message).toContain('Unable to preload CSS')
    scope.stop()
  })

  it('reloads the document on request', () => {
    const reloadSpy = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy })
    const scope = effectScope()
    const { reload } = scope.run(() => useChunkLoadFailure())!
    reload()
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    scope.stop()
    vi.unstubAllGlobals()
  })
})
