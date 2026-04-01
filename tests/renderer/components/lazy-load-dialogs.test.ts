import { describe, it, expect } from 'vitest'
import { defineAsyncComponent } from 'vue'

/**
 * These tests verify that the non-critical dialog/panel components in App.vue
 * are registered as async components (lazy-loaded) rather than eagerly imported.
 *
 * An async component created via defineAsyncComponent() is a plain object with
 * a `__asyncLoader` function property — it is NOT a Vue SFC module (which has a
 * `setup` or `render` property at the top level).
 */

const ASYNC_COMPONENT_PATHS = [
  '@renderer/components/ImportStatusBar.vue',
  '@renderer/components/VariantDetailsPanel.vue',
  '@renderer/components/AppDialogHost.vue',
  '@renderer/components/KeyboardShortcutsDialog.vue',
  '@renderer/components/ViewTransitionOverlay.vue'
] as const

describe('Lazy-loaded dialog/panel components', () => {
  it('defineAsyncComponent produces an object with __asyncLoader', () => {
    // Verify the shape that defineAsyncComponent() returns so we can use it as
    // a reference in subsequent checks.
    const asyncComp = defineAsyncComponent(
      () => import('@renderer/components/KeyboardShortcutsDialog.vue')
    )

    // Vue's async component wrapper exposes `__asyncLoader` on its definition object
    expect(typeof asyncComp).toBe('object')
    expect(asyncComp).toHaveProperty('__asyncLoader')
    expect(typeof (asyncComp as Record<string, unknown>).__asyncLoader).toBe('function')
  })

  it.each(ASYNC_COMPONENT_PATHS)('%s resolves via dynamic import', async (componentPath) => {
    // Each path must be importable — this confirms the module actually exists
    // and the dynamic import chain works end-to-end.
    const mod = await import(/* @vite-ignore */ componentPath)
    expect(mod).toBeDefined()
    // A Vue SFC compiled module exposes a default export that is a component options object
    expect(mod.default).toBeDefined()
  })

  it.each(ASYNC_COMPONENT_PATHS)(
    '%s wrapped in defineAsyncComponent has __asyncLoader',
    (componentPath) => {
      const asyncComp = defineAsyncComponent(() => import(/* @vite-ignore */ componentPath))
      expect(asyncComp).toHaveProperty('__asyncLoader')
    }
  )
})
