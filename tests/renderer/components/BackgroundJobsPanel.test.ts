/**
 * Background-jobs panel (progress + cancel for export, delete and import),
 * shared by every view on desktop and web.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import BackgroundJobsPanel from '../../../src/renderer/src/components/jobs/BackgroundJobsPanel.vue'
import {
  describeJob,
  FINISHED_JOB_TTL_MS,
  jobPercent,
  resetBackgroundJobsForTesting
} from '../../../src/renderer/src/composables/useBackgroundJobs'
import { EVENTS_RESYNC_DOM_EVENT } from '../../../src/shared/ipc/domains/jobs'
import type { Job } from '../../../src/shared/types/jobs'
import { createMockApi, type MockApi } from '../../utils/mock-api'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const vuetify = createVuetify({ components, directives })

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'J1',
    kind: 'case_delete',
    status: 'running',
    params: {},
    progress: { current: 1, total: 4, message: 'deleting' },
    error: null,
    createdAt: 1,
    startedAt: 1,
    finishedAt: null,
    ...overrides
  }
}

describe('BackgroundJobsPanel', () => {
  let mockApi: MockApi
  let pushJob: (snapshot: Job) => void
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    resetBackgroundJobsForTesting()
    mockApi = createMockApi()
    mockApi.jobs.list = vi.fn().mockResolvedValue([])
    mockApi.jobs.onChanged = vi.fn((callback: (snapshot: Job) => void) => {
      pushJob = callback
      return () => undefined
    })
    window.api = mockApi as unknown as typeof window.api
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    resetBackgroundJobsForTesting()
    vi.useRealTimers()
  })

  async function mountPanel(props: Record<string, unknown> = {}) {
    wrapper = mount(BackgroundJobsPanel, { props, global: { plugins: [vuetify] } })
    await flushPromises()
    return wrapper
  }

  it('shows a determinate, labelled progress bar and announces the start', async () => {
    const panel = await mountPanel()
    pushJob(job())
    await flushPromises()

    expect(panel.text()).toContain('Deleting cases')
    expect(panel.text()).toContain('Deleting · 1 of 4 cases')
    const bar = panel.find('.background-jobs__item [role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('25')
    expect(bar.attributes('aria-label')).toBe('Deleting cases progress')
    const live = panel.find('[aria-live="polite"]')
    expect(live.text()).toBe('Deleting cases started.')
  })

  it('cancel is a keyboard-reachable labelled button that calls jobs:cancel', async () => {
    mockApi.jobs.cancel = vi.fn().mockResolvedValue({ requested: true })
    const panel = await mountPanel()
    pushJob(job({ kind: 'export', progress: { current: 5, total: 10 } }))
    await flushPromises()

    const cancel = panel.find('button[aria-label="Cancel Export"]')
    expect(cancel.exists()).toBe(true)
    expect(cancel.attributes('tabindex')).not.toBe('-1')
    await cancel.trigger('click')
    await flushPromises()
    expect(mockApi.jobs.cancel).toHaveBeenCalledWith('J1')
  })

  it("shows the server's reason when a cancel is refused (another user's job)", async () => {
    mockApi.jobs.cancel = vi.fn().mockResolvedValue({
      code: 'FORBIDDEN',
      message: 'user 2 may not cancel job J1',
      userMessage: 'This job was started by another user and cannot be cancelled by you.'
    })
    const panel = await mountPanel()
    pushJob(job({ kind: 'import_single', progress: null }))
    await flushPromises()

    await panel.find('button[aria-label="Cancel Import"]').trigger('click')
    await flushPromises()
    expect(panel.find('[role="alert"]').text()).toBe(
      'This job was started by another user and cannot be cancelled by you.'
    )
  })

  it('announces the outcome, then auto-dismisses finished jobs', async () => {
    vi.useFakeTimers()
    const panel = await mountPanel()
    pushJob(job())
    await flushPromises()
    pushJob(job({ status: 'completed', progress: { current: 4, total: 4 } }))
    await flushPromises()

    expect(panel.find('[aria-live="polite"]').text()).toBe('Deleting cases: Completed.')
    expect(panel.find('.background-jobs__item [role="progressbar"]').exists()).toBe(false)
    vi.advanceTimersByTime(FINISHED_JOB_TTL_MS + 10)
    await flushPromises()
    expect(panel.find('[data-testid="background-job-case_delete"]').exists()).toBe(false)
  })

  it('ignores history: finished jobs from before the page loaded are not shown', async () => {
    mockApi.jobs.list = vi
      .fn()
      .mockResolvedValue([
        job({ id: 'OLD', status: 'completed' }),
        job({ id: 'LIVE', kind: 'import_batch', progress: { current: 1, total: 3 } })
      ])
    const panel = await mountPanel()
    expect(panel.findAll('li')).toHaveLength(1)
    expect(panel.text()).toContain('Batch import')
  })

  it('re-polls when the web client reports an unreplayable event gap', async () => {
    await mountPanel()
    const calls = (mockApi.jobs.list as ReturnType<typeof vi.fn>).mock.calls.length
    window.dispatchEvent(new CustomEvent(EVENTS_RESYNC_DOM_EVENT))
    await flushPromises()
    expect((mockApi.jobs.list as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls + 1)
  })

  it('can be narrowed to the job kinds of one context', async () => {
    const panel = await mountPanel({ kinds: ['export'] })
    pushJob(job())
    await flushPromises()
    expect(panel.findAll('li')).toHaveLength(0)
  })
})

describe('job formatting', () => {
  it('describes indeterminate import progress and failures without [object Object]', () => {
    expect(
      describeJob(
        job({ kind: 'import_single', progress: { current: 1200, total: 0, message: 'parsing' } })
      )
    ).toBe(`parsing · ${(1200).toLocaleString()} processed`)
    expect(jobPercent(job({ progress: { current: 3, total: 0 } }))).toBeNull()
    expect(
      describeJob(
        job({
          status: 'failed',
          error: { code: 'CONFLICT', message: 'x', userMessage: 'Case exists.' } as Job['error']
        })
      )
    ).toBe('Failed: Case exists.')
  })
})
