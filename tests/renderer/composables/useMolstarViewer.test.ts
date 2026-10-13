import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { ProteinStructureInfo } from '../../../src/shared/types/protein'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('pdbe-molstar/build/pdbe-molstar-light.css', () => ({}))

interface FakeViewer {
  plugin?: { dispose: ReturnType<typeof vi.fn> }
  finishRender: () => void
}
const viewers: FakeViewer[] = []
let deferRender = false

vi.mock('pdbe-molstar/lib/viewer', () => ({
  PDBeMolstarPlugin: class implements FakeViewer {
    plugin?: { dispose: ReturnType<typeof vi.fn> }
    events = { loadComplete: { subscribe: () => ({ unsubscribe: vi.fn() }) } }
    canvas = { setBgColor: vi.fn() }
    finishRender = (): void => {}
    constructor() {
      viewers.push(this)
    }
    // The real render() creates `plugin`, so a teardown during init sees none yet.
    render(): Promise<void> {
      return new Promise((resolve) => {
        this.finishRender = () => {
          this.plugin = { dispose: vi.fn() }
          resolve()
        }
        if (!deferRender) this.finishRender()
      })
    }
  }
}))

const { useMolstarViewer } = await import('../../../src/renderer/src/composables/useMolstarViewer')

const structure = {
  alphafold: { url: 'https://example.test/x.bcif', format: 'bcif', source: 'alphafold' }
} as unknown as ProteinStructureInfo

function mountViewer() {
  const el = ref<HTMLElement | null>(null)
  let api!: ReturnType<typeof useMolstarViewer>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useMolstarViewer(el, ref(structure), ref([]))
        return () => h('div')
      }
    })
  )
  return { el, api: () => api, wrapper }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise((r) => setTimeout(r, 0))
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    getExtension: () => ({ loseContext: vi.fn() })
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

beforeEach(() => {
  viewers.length = 0
  deferRender = false
})

describe('useMolstarViewer disposal (#550)', () => {
  it('disposes the plugin on unmount', async () => {
    const { el, wrapper } = mountViewer()
    el.value = document.createElement('div')
    await settle()
    expect(viewers).toHaveLength(1)
    wrapper.unmount()
    expect(viewers[0].plugin?.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes the previous plugin when the element changes', async () => {
    const { el } = mountViewer()
    el.value = document.createElement('div')
    await settle()
    el.value = document.createElement('div')
    await settle()
    expect(viewers).toHaveLength(2)
    expect(viewers[0].plugin?.dispose).toHaveBeenCalledTimes(1)
    expect(viewers[1].plugin?.dispose).not.toHaveBeenCalled()
  })

  it('disposes the old plugin after a representation change remounts the element', async () => {
    const { el, api } = mountViewer()
    el.value = document.createElement('div')
    await settle()
    api().setRepresentation('molecular-surface')
    expect(api().loading.value).toBe(true)
    // MolstarViewer.vue re-keys the host div, which swaps the element.
    el.value = document.createElement('div')
    await settle()
    expect(viewers[0].plugin?.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes a plugin whose render finishes after unmount', async () => {
    deferRender = true
    const { el, wrapper } = mountViewer()
    el.value = document.createElement('div')
    await settle()
    expect(viewers).toHaveLength(1)
    wrapper.unmount()
    viewers[0].finishRender()
    await settle()
    expect(viewers[0].plugin?.dispose).toHaveBeenCalledTimes(1)
  })

  it('treats a click on the active representation as a no-op', async () => {
    const { el, api } = mountViewer()
    el.value = document.createElement('div')
    await settle()
    api().loading.value = false
    api().setRepresentation('cartoon')
    expect(api().loading.value).toBe(false)
    expect(viewers[0].plugin?.dispose).not.toHaveBeenCalled()
  })
})
