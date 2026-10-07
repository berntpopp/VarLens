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
import BackgroundJobsToggle from '../../../src/renderer/src/components/jobs/BackgroundJobsToggle.vue'
import {
  describeJob,
  FINISHED_JOB_TTL_MS,
  jobPercent,
  resetBackgroundJobsForTesting,
  summarizeJobs,
  useBackgroundJobs
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

  /** The list is collapsed by default; most tests look at the expanded list. */
  async function mountPanel(props: Record<string, unknown> = {}, expanded = true) {
    wrapper = mount(BackgroundJobsPanel, {
      props,
      attachTo: document.body,
      global: { plugins: [vuetify] }
    })
    useBackgroundJobs().setPanelExpanded(expanded)
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

  it('shows "Cancelling…" and disables Cancel until the job reaches a terminal status', async () => {
    mockApi.jobs.cancel = vi.fn().mockResolvedValue({ requested: true })
    const panel = await mountPanel()
    pushJob(
      job({ kind: 'import_batch', progress: { current: 2, total: 100, message: 'a.vcf.gz' } })
    )
    await flushPromises()

    await panel.find('button[aria-label="Cancel Batch import"]').trigger('click')
    await flushPromises()

    // The HTTP call returned, but the worker is still stopping: still `running`.
    const item = panel.find('[data-testid="background-job-import_batch"]')
    expect(item.text()).toContain('Cancelling…')
    expect(item.text()).not.toContain('2 of 100 files')
    const button = panel.find('button[aria-label="Cancel Batch import"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(panel.find('[aria-live="polite"]').text()).toBe('Batch import: cancelling.')

    // A later progress snapshot of the still-running job must not undo it.
    pushJob(
      job({ kind: 'import_batch', progress: { current: 3, total: 100, message: 'b.vcf.gz' } })
    )
    await flushPromises()
    expect(item.text()).toContain('Cancelling…')

    pushJob(
      job({ kind: 'import_batch', status: 'cancelled', progress: { current: 3, total: 100 } })
    )
    await flushPromises()
    expect(item.text()).toContain('Cancelled')
    expect(item.text()).not.toContain('Cancelling…')
    expect(useBackgroundJobs().cancelRequested.value).toEqual({})
  })

  it('does not claim "Cancelling…" when the backend did not accept the cancel', async () => {
    mockApi.jobs.cancel = vi.fn().mockResolvedValue({ requested: false })
    const panel = await mountPanel()
    pushJob(job({ kind: 'export', progress: { current: 5, total: 10 } }))
    await flushPromises()

    await panel.find('button[aria-label="Cancel Export"]').trigger('click')
    await flushPromises()

    expect(panel.text()).not.toContain('Cancelling…')
    expect(panel.find('button[aria-label="Cancel Export"]').attributes('disabled')).toBeUndefined()
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

describe('collapsed by default (footer toggle)', () => {
  let mockApi: MockApi
  let pushJob: (snapshot: Job) => void
  let panel: VueWrapper
  let toggle: VueWrapper

  beforeEach(async () => {
    setActivePinia(createPinia())
    resetBackgroundJobsForTesting()
    mockApi = createMockApi()
    mockApi.jobs.list = vi.fn().mockResolvedValue([])
    mockApi.jobs.onChanged = vi.fn((callback: (snapshot: Job) => void) => {
      pushJob = callback
      return () => undefined
    })
    window.api = mockApi as unknown as typeof window.api
    toggle = mount(BackgroundJobsToggle, {
      attachTo: document.body,
      global: { plugins: [vuetify] }
    })
    panel = mount(BackgroundJobsPanel, { attachTo: document.body, global: { plugins: [vuetify] } })
    await flushPromises()
  })

  afterEach(() => {
    panel.unmount()
    toggle.unmount()
    resetBackgroundJobsForTesting()
  })

  const toggleButton = () => toggle.find('button#background-jobs-toggle')

  it('renders nothing at all while there are no jobs', () => {
    expect(toggleButton().exists()).toBe(false)
    expect(panel.find('#background-jobs-panel').exists()).toBe(false)
  })

  it('shows only a labelled toggle for a running job, not the floating card', async () => {
    pushJob(job({ kind: 'export', progress: { current: 5, total: 10 } }))
    await flushPromises()

    expect(panel.find('#background-jobs-panel').exists()).toBe(false)
    const button = toggleButton()
    expect(button.text()).toContain('Export · 50%')
    expect(button.attributes('aria-label')).toBe('Background tasks: Export · 50%')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(button.attributes('aria-controls')).toBe('background-jobs-panel')
    // Progress is still announced while collapsed.
    expect(panel.find('[aria-live="polite"]').text()).toBe('Export started.')
  })

  it('expands on click and moves focus into the list; collapse returns it', async () => {
    pushJob(job({ kind: 'export', progress: { current: 5, total: 10 } }))
    await flushPromises()

    await toggleButton().trigger('click')
    await flushPromises()
    const card = panel.find('#background-jobs-panel')
    expect(card.exists()).toBe(true)
    expect(toggleButton().attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(card.element)

    await panel.find('button[aria-label="Collapse background tasks"]').trigger('click')
    await flushPromises()
    expect(panel.find('#background-jobs-panel').exists()).toBe(false)
    expect(toggleButton().attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggleButton().element)
  })

  it('collapses on Escape', async () => {
    pushJob(job({ kind: 'export', progress: { current: 5, total: 10 } }))
    await flushPromises()
    await toggleButton().trigger('click')
    await flushPromises()

    await panel.find('#background-jobs-panel').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(panel.find('#background-jobs-panel').exists()).toBe(false)
  })

  it('expands by itself when a job fails, without stealing focus', async () => {
    pushJob(job({ kind: 'export', progress: { current: 5, total: 10 } }))
    await flushPromises()
    const before = document.activeElement
    pushJob(
      job({
        kind: 'export',
        status: 'failed',
        error: { code: 'INTERNAL', message: 'x', userMessage: 'Disk full.' } as Job['error']
      })
    )
    await flushPromises()

    expect(panel.find('#background-jobs-panel').text()).toContain('Failed: Disk full.')
    expect(toggleButton().text()).toContain('1 task failed')
    expect(document.activeElement).toBe(before)
  })

  it('starts collapsed again for the next job after the list emptied', async () => {
    pushJob(job({ kind: 'export', progress: { current: 5, total: 10 } }))
    await flushPromises()
    await toggleButton().trigger('click')
    useBackgroundJobs().dismiss('J1')
    pushJob(job({ id: 'J2', kind: 'export', progress: { current: 1, total: 10 } }))
    await flushPromises()
    expect(panel.find('#background-jobs-panel').exists()).toBe(false)
  })
})

describe('job formatting', () => {
  it('labels every import phase instead of leaking the raw phase name', () => {
    const importJob = (message: string, current: number): Job =>
      job({ kind: 'import_single', progress: { current, total: 0, message } })
    expect(describeJob(importJob('reading', 0))).toBe('Reading file')
    expect(describeJob(importJob('parsing', 1200))).toBe(
      `Parsing variants · ${(1200).toLocaleString()} processed`
    )
    expect(describeJob(importJob('inserting', 60000))).toBe(
      `Importing variants · ${(60000).toLocaleString()} processed`
    )
    // Batch imports report the current file name, which is shown as is.
    expect(
      describeJob(
        job({
          kind: 'import_batch',
          progress: { current: 2, total: 100, message: 'SIM-0003.vcf.gz' }
        })
      )
    ).toBe('SIM-0003.vcf.gz · 2 of 100 files')
  })

  it('summarises the job list for the collapsed toggle', () => {
    expect(summarizeJobs([job({ kind: 'import_single', progress: null })])).toBe('Import')
    expect(summarizeJobs([job(), job({ id: 'J2', kind: 'export' })])).toBe('2 tasks running')
    expect(summarizeJobs([job({ status: 'failed' }), job({ id: 'J2', status: 'completed' })])).toBe(
      '1 task failed'
    )
    expect(summarizeJobs([job({ status: 'cancelled' })])).toBe('Task finished')
  })

  it('describes indeterminate import progress and failures without [object Object]', () => {
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
