/**
 * Unit tests for useTableRowProps composable
 *
 * Tests zebra striping, selection highlighting, combined states,
 * reactivity, and edge cases for table row styling.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { ref } from 'vue'
import { withSetup } from '../../utils/test-helpers'
import { useTableRowProps } from '@renderer/composables/useTableRowProps'

describe('useTableRowProps', () => {
  let app: { unmount: () => void }

  afterEach(() => {
    if (app) app.unmount()
  })

  describe('Initial state', () => {
    it('returns getRowProps function', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      expect(typeof result.getRowProps).toBe('function')
    })

    it('getRowProps returns object with class property', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 0 })
      expect(props).toHaveProperty('class')
      expect(typeof props.class).toBe('string')
    })
  })

  describe('Zebra striping', () => {
    it('even index (0) returns empty class string', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 0 })
      expect(props.class).toBe('')
    })

    it('even index (2) returns empty class string', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 2 })
      expect(props.class).toBe('')
    })

    it('even index (4) returns empty class string', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 4 })
      expect(props.class).toBe('')
    })

    it('odd index (1) returns variant-row--striped', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 1 })
      expect(props.class).toBe('variant-row--striped')
    })

    it('odd index (3) returns variant-row--striped', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 3 })
      expect(props.class).toBe('variant-row--striped')
    })

    it('odd index (5) returns variant-row--striped', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 5 })
      expect(props.class).toBe('variant-row--striped')
    })
  })

  describe('Selection highlighting', () => {
    it('selectedId matches item ID returns variant-row--selected', () => {
      const selectedId = ref<string | null>('test-1')
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 0 })
      expect(props.class).toBe('variant-row--selected')
    })

    it('selectedId does not match returns no selected class', () => {
      const selectedId = ref<string | null>('test-2')
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 0 })
      expect(props.class).not.toContain('variant-row--selected')
    })

    it('selectedId is null returns no selected class', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 0 })
      expect(props.class).not.toContain('variant-row--selected')
    })
  })

  describe('Combined state', () => {
    it('odd index + selected returns both classes', () => {
      const selectedId = ref<string | null>('test-1')
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 1 })
      expect(props.class).toBe('variant-row--striped variant-row--selected')
    })

    it('even index + selected returns only selected class', () => {
      const selectedId = ref<string | null>('test-1')
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 0 })
      expect(props.class).toBe('variant-row--selected')
    })

    it('odd index + not selected returns only striped class', () => {
      const selectedId = ref<string | null>('other-id')
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 1 })
      expect(props.class).toBe('variant-row--striped')
    })
  })

  describe('Reactivity', () => {
    it('changing selectedId.value updates class output', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      // Initially not selected
      let props = result.getRowProps({ item: { id: 'test-1' }, index: 0 })
      expect(props.class).not.toContain('variant-row--selected')

      // Change selectedId
      selectedId.value = 'test-1'

      // Now selected
      props = result.getRowProps({ item: { id: 'test-1' }, index: 0 })
      expect(props.class).toBe('variant-row--selected')
    })

    it('getRowProps correctly reads from reactive ref on each call', () => {
      const selectedId = ref<string | null>('item-a')
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      // First item selected
      let propsA = result.getRowProps({ item: { id: 'item-a' }, index: 0 })
      let propsB = result.getRowProps({ item: { id: 'item-b' }, index: 1 })
      expect(propsA.class).toContain('variant-row--selected')
      expect(propsB.class).not.toContain('variant-row--selected')

      // Switch selection
      selectedId.value = 'item-b'

      propsA = result.getRowProps({ item: { id: 'item-a' }, index: 0 })
      propsB = result.getRowProps({ item: { id: 'item-b' }, index: 1 })
      expect(propsA.class).not.toContain('variant-row--selected')
      expect(propsB.class).toContain('variant-row--selected')
    })
  })

  describe('Edge cases', () => {
    it('works with string IDs', () => {
      const selectedId = ref<string | number | null>('string-id-123')
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'string-id-123' }, index: 0 })
      expect(props.class).toBe('variant-row--selected')
    })

    it('works with numeric IDs', () => {
      const selectedId = ref<string | number | null>(42)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: number }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 42 }, index: 0 })
      expect(props.class).toBe('variant-row--selected')
    })

    it('works with custom getItemId function', () => {
      interface CustomItem {
        variant_key: string
        other_field: number
      }

      const selectedId = ref<string | null>('chr1-12345-A-T')
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<CustomItem>({
          selectedId,
          getItemId: (item) => item.variant_key
        })
      )
      app = appInstance

      const props = result.getRowProps({
        item: { variant_key: 'chr1-12345-A-T', other_field: 100 },
        index: 0
      })
      expect(props.class).toBe('variant-row--selected')
    })

    it('handles zero index correctly (not striped)', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      const props = result.getRowProps({ item: { id: 'test-1' }, index: 0 })
      expect(props.class).toBe('')
      expect(props.class).not.toContain('variant-row--striped')
    })

    it('handles large index values correctly', () => {
      const selectedId = ref<string | null>(null)
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      // Large even index
      let props = result.getRowProps({ item: { id: 'test-1' }, index: 1000 })
      expect(props.class).toBe('')

      // Large odd index
      props = result.getRowProps({ item: { id: 'test-1' }, index: 1001 })
      expect(props.class).toBe('variant-row--striped')
    })

    it('strictly compares ID types (string vs number)', () => {
      const selectedId = ref<string | number | null>('42')
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: number }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      // String '42' should NOT match number 42 (strict equality)
      const props = result.getRowProps({ item: { id: 42 }, index: 0 })
      expect(props.class).not.toContain('variant-row--selected')
    })
  })

  describe('Accessibility', () => {
    it('exposes the selected row with aria-current and makes it focusable', () => {
      const selectedId = ref<string | null>('row-2')
      const [result, appInstance] = withSetup(() =>
        useTableRowProps<{ id: string }>({
          selectedId,
          getItemId: (item) => item.id
        })
      )
      app = appInstance

      expect(result.getRowProps({ item: { id: 'row-2' }, index: 1 })).toEqual({
        class: 'variant-row--striped variant-row--selected',
        'aria-current': 'true',
        tabindex: 0
      })
      const other = result.getRowProps({ item: { id: 'row-1' }, index: 0 })
      expect(other['aria-current']).toBeUndefined()
      expect(other.tabindex).toBeUndefined()
    })
  })
})
