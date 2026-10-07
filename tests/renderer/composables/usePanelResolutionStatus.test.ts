/**
 * usePanelResolutionStatus — which genes of the active gene panel have no
 * coordinates for the genome build, and the warning built from that answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { flushPromises } from '../../utils/test-helpers'
import { withQueries } from '../helpers/with-queries'
import { createMockApi } from '../../utils/mock-api'
import {
  buildPanelUnmappedGenesWarning,
  MAX_INLINE_UNMAPPED_GENES,
  providePanelResolutionStatus,
  usePanelResolutionStatus,
  usePanelUnmappedGenesWarning
} from '@renderer/composables/usePanelResolutionStatus'
import { _resetPanelManagerState, usePanelManager } from '@renderer/composables/usePanelManager'
import type { PanelResolutionStatus } from '../../../src/shared/types/panels'
import { ErrorCode } from '../../../src/shared/types/errors'

vi.mock('@renderer/services/LogService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

function statusOf(symbols: string[], totalGenes = 120, build = 'GRCh38'): PanelResolutionStatus {
  return {
    genomeBuild: build,
    totalGenes,
    unmappedCount: symbols.length,
    unmappedGenes: symbols.map((symbol, index) => ({ hgncId: `HGNC:${index + 1}`, symbol }))
  }
}

describe('buildPanelUnmappedGenesWarning', () => {
  it('names the unmapped genes with their count, the panel size and the build', () => {
    const warning = buildPanelUnmappedGenesWarning(statusOf(['GENE1', 'GENE2', 'GENE3']))

    expect(warning).toMatchObject({
      kind: 'unmapped',
      text: '3 of 120 panel genes have no coordinates for GRCh38 and are not applied: GENE1, GENE2, GENE3',
      hiddenCount: 0
    })
  })

  it('uses the singular for a single unmapped gene', () => {
    expect(buildPanelUnmappedGenesWarning(statusOf(['GENE1'], 40, 'GRCh37'))?.text).toBe(
      '1 of 40 panel genes has no coordinates for GRCh37 and is not applied: GENE1'
    )
  })

  it('cuts a long list with "+N more" but keeps every symbol for the expanded view', () => {
    const symbols = Array.from({ length: MAX_INLINE_UNMAPPED_GENES + 7 }, (_, i) => `G${i + 1}`)
    const warning = buildPanelUnmappedGenesWarning(statusOf(symbols))

    expect(warning?.inlineSymbols).toEqual(symbols.slice(0, MAX_INLINE_UNMAPPED_GENES))
    expect(warning?.hiddenCount).toBe(7)
    expect(warning?.text.endsWith(`G${MAX_INLINE_UNMAPPED_GENES} +7 more`)).toBe(true)
    expect(warning?.allSymbols).toEqual(symbols)
  })

  it('is null when every gene is mapped or there is no status', () => {
    expect(buildPanelUnmappedGenesWarning(statusOf([]))).toBeNull()
    expect(buildPanelUnmappedGenesWarning(null)).toBeNull()
  })
})

describe('usePanelResolutionStatus', () => {
  let app: { unmount: () => void } | undefined
  const withSetup = <T>(composable: () => T): [T, { unmount: () => void }] => {
    const host = withQueries(composable)
    return [host.result, host]
  }
  let resolutionStatus: ReturnType<typeof vi.fn>

  beforeEach(() => {
    _resetPanelManagerState()
    window.api = createMockApi()
    resolutionStatus = (window.api as unknown as { panels: { resolutionStatus: typeof vi.fn } })
      .panels.resolutionStatus as unknown as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
  })

  it('does not query while no panel is active', async () => {
    const [state, mounted] = withSetup(() =>
      usePanelResolutionStatus({ panelIds: ref([]), caseId: ref(4) })
    )
    app = mounted
    await flushPromises()

    expect(resolutionStatus).not.toHaveBeenCalled()
    expect(state.warning.value).toBeNull()
  })

  it('asks for the case build in the case view and warns about unmapped genes', async () => {
    resolutionStatus.mockResolvedValue(statusOf(['GENE1', 'GENE2']))
    const [state, mounted] = withSetup(() =>
      usePanelResolutionStatus({ panelIds: ref([7, 3, 7]), caseId: ref(4) })
    )
    app = mounted
    await flushPromises()

    expect(resolutionStatus).toHaveBeenCalledWith({ panelIds: [3, 7], caseId: 4 })
    expect(state.warning.value?.text).toContain('2 of 120 panel genes')
  })

  it('asks for the selected build in the cohort view', async () => {
    const [, mounted] = withSetup(() =>
      usePanelResolutionStatus({ panelIds: () => [3], genomeBuild: ref('GRCh37') })
    )
    app = mounted
    await flushPromises()

    expect(resolutionStatus).toHaveBeenCalledWith({ panelIds: [3], genomeBuild: 'GRCh37' })
  })

  it('drops the previous warning as soon as the scope changes and re-queries', async () => {
    resolutionStatus.mockResolvedValueOnce(statusOf(['GENE1']))
    const build = ref('GRCh38')
    const [state, mounted] = withSetup(() =>
      usePanelResolutionStatus({ panelIds: ref([3]), genomeBuild: build })
    )
    app = mounted
    await flushPromises()
    expect(state.warning.value).not.toBeNull()

    let release: (value: PanelResolutionStatus) => void = () => undefined
    resolutionStatus.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    build.value = 'GRCh37'
    await nextTick()

    // The GRCh38 answer must not be shown for GRCh37 while the new one loads.
    expect(state.warning.value).toBeNull()
    release(statusOf(['GENE9'], 120, 'GRCh37'))
    await flushPromises()
    expect(state.warning.value?.text).toContain('GRCh37')
  })

  it('ignores a slow answer for a scope that is no longer current', async () => {
    let releaseFirst: (value: PanelResolutionStatus) => void = () => undefined
    resolutionStatus
      .mockReturnValueOnce(new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(statusOf([]))
    const panelIds = ref([3])
    const [state, mounted] = withSetup(() => usePanelResolutionStatus({ panelIds, caseId: 1 }))
    app = mounted
    await flushPromises()
    panelIds.value = [5]
    await flushPromises()

    releaseFirst(statusOf(['STALE']))
    await flushPromises()

    expect(state.warning.value).toBeNull()
  })

  it('clears the warning when the panel is deactivated', async () => {
    resolutionStatus.mockResolvedValue(statusOf(['GENE1']))
    const panelIds = ref<number[]>([3])
    const [state, mounted] = withSetup(() => usePanelResolutionStatus({ panelIds, caseId: 1 }))
    app = mounted
    await flushPromises()

    panelIds.value = []
    await flushPromises()

    expect(state.warning.value).toBeNull()
    expect(resolutionStatus).toHaveBeenCalledTimes(1)
  })

  it('re-queries after a panel edit reloaded the panel list', async () => {
    resolutionStatus.mockResolvedValueOnce(statusOf(['GENE1'])).mockResolvedValueOnce(statusOf([]))
    const [state, mounted] = withSetup(() => {
      const panelState = usePanelResolutionStatus({ panelIds: ref([3]), caseId: 1 })
      return { ...panelState, manager: usePanelManager() }
    })
    app = mounted
    await flushPromises()
    expect(state.warning.value).not.toBeNull()

    await state.manager.loadPanels()
    await flushPromises()

    expect(resolutionStatus).toHaveBeenCalledTimes(2)
    expect(state.warning.value).toBeNull()
  })

  it.each([
    ['a rejected call', () => Promise.reject(new Error('boom'))],
    [
      'an IPC error result',
      () => Promise.resolve({ code: ErrorCode.DB_ERROR, message: 'x', userMessage: 'x' })
    ]
  ])('warns that the panel could not be verified after %s', async (_name, answer) => {
    resolutionStatus.mockImplementation(answer)
    const [state, mounted] = withSetup(() =>
      usePanelResolutionStatus({ panelIds: ref([3]), caseId: 1 })
    )
    app = mounted
    await flushPromises()

    expect(state.warning.value).toMatchObject({ kind: 'unverified', allSymbols: [] })
    expect(state.warning.value?.text).toMatch(/^Could not check/)
  })

  it('hands the warning of the providing view to descendants, and null without a provider', async () => {
    resolutionStatus.mockResolvedValue(statusOf(['GENE1']))
    const [state, mounted] = withSetup(() => {
      const withoutProvider = usePanelUnmappedGenesWarning()
      const provided = providePanelResolutionStatus({ panelIds: ref([3]), caseId: 1 })
      return { withoutProvider, provided }
    })
    app = mounted
    await flushPromises()

    expect(state.withoutProvider.value).toBeNull()
    expect(state.provided.warning.value?.kind).toBe('unmapped')
  })
})
