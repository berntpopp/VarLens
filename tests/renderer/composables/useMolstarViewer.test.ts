import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { LollipopVariant, ProteinStructureInfo } from '../../../src/shared/types/protein'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('pdbe-molstar/build/pdbe-molstar-light.css', () => ({}))

interface FakeViewer {
  plugin?: { dispose: ReturnType<typeof vi.fn> }
  visual: { select: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> }
  emitLoadComplete: (success: boolean) => void
  finishRender: () => void
}
const viewers: FakeViewer[] = []
let deferRender = false

vi.mock('pdbe-molstar/lib/viewer', () => ({
  PDBeMolstarPlugin: class implements FakeViewer {
    plugin?: { dispose: ReturnType<typeof vi.fn> }
    private loadListener: ((success: boolean) => void) | null = null
    events = {
      loadComplete: {
        subscribe: (cb: (success: boolean) => void) => {
          this.loadListener = cb
          return { unsubscribe: vi.fn() }
        }
      }
    }
    canvas = { setBgColor: vi.fn() }
    visual = { select: vi.fn().mockResolvedValue(undefined), reset: vi.fn() }
    emitLoadComplete = (success: boolean): void => {
      this.loadListener?.(success)
    }
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

function mountViewer(
  structureVal: ProteinStructureInfo = structure,
  initialVariants: LollipopVariant[] = []
) {
  const el = ref<HTMLElement | null>(null)
  const variantsRef = ref<LollipopVariant[]>(initialVariants)
  let api!: ReturnType<typeof useMolstarViewer>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useMolstarViewer(el, ref(structureVal), variantsRef)
        return () => h('div')
      }
    })
  )
  return { el, variantsRef, api: () => api, wrapper }
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

describe('useMolstarViewer AlphaFold pLDDT & highlighted residue focus (#578)', () => {
  it('omits nonSelectedColor on AlphaFold structures and focuses highlighted variant with sideChain', async () => {
    const { el, variantsRef } = mountViewer(structure, [
      {
        proteinPosition: 248,
        aaChange: 'p.Arg248Gln',
        consequence: 'missense_variant',
        color: '#ff5500',
        Category: 'missense',
        count: 1,
        variants: [],
        highlighted: true
      } as unknown as LollipopVariant,
      {
        proteinPosition: 175,
        aaChange: 'p.Arg175His',
        consequence: 'missense_variant',
        color: '#0055ff',
        Category: 'missense',
        count: 1,
        variants: [],
        highlighted: false
      } as unknown as LollipopVariant
    ])
    const host = document.createElement('div')
    el.value = host
    await settle()

    const btn = document.createElement('button')
    btn.setAttribute('title', 'Toggle Spin')
    host.appendChild(btn)
    vi.useFakeTimers()
    try {
      viewers[0].emitLoadComplete(true)
      expect(btn.getAttribute('aria-label')).toBe('Toggle Spin')
      await vi.advanceTimersByTimeAsync(500)
    } finally {
      vi.useRealTimers()
    }

    expect(viewers[0].visual.select).toHaveBeenCalledWith({
      data: [
        {
          struct_asym_id: 'A',
          start_residue_number: 248,
          end_residue_number: 248,
          color: { r: 255, g: 85, b: 0 },
          focus: true,
          sideChain: true,
          representationColor: { r: 255, g: 85, b: 0 }
        },
        {
          struct_asym_id: 'A',
          start_residue_number: 175,
          end_residue_number: 175,
          color: { r: 0, g: 85, b: 255 },
          focus: false,
          sideChain: false
        }
      ]
    })

    // Subsequent re-highlight (or resetView) keeps the camera whole-protein (focus: false)
    viewers[0].visual.select.mockClear()
    variantsRef.value = [...variantsRef.value]
    await settle()
    expect(viewers[0].visual.select).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ start_residue_number: 248, focus: false, sideChain: true })
        ])
      })
    )
  })

  it('passes nonSelectedColor on non-AlphaFold PDB structures', async () => {
    const pdbOnly = {
      alphafold: null,
      pdb: { url: 'https://example.test/1tup.cif', format: 'cif', source: 'pdb' }
    } as unknown as ProteinStructureInfo
    const { el, variantsRef } = mountViewer(pdbOnly, [
      {
        proteinPosition: 100,
        aaChange: 'p.Ala100Val',
        consequence: 'missense_variant',
        color: '#ff0000',
        Category: 'missense',
        count: 1,
        variants: []
      } as unknown as LollipopVariant
    ])
    el.value = document.createElement('div')
    await settle()
    viewers[0].emitLoadComplete(true)
    variantsRef.value = [...variantsRef.value]
    await settle()

    expect(viewers[0].visual.select).toHaveBeenCalledWith(
      expect.objectContaining({
        nonSelectedColor: { r: 220, g: 220, b: 220 }
      })
    )
  })
})
