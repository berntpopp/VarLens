/**
 * Unit tests for useTableScroll composable
 *
 * Tests scroll synchronization setup, ResizeObserver cleanup,
 * and event listener cleanup on unmount.
 *
 * CRITICAL: Memory leak regression tests (TEST-07)
 * Verifies ResizeObserver.disconnect() and removeEventListener() are called.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { useTableScroll } from '@renderer/composables/useTableScroll'

describe('useTableScroll', () => {
  let app: { unmount: () => void }

  afterEach(() => {
    if (app) app.unmount()
    vi.restoreAllMocks()
  })

  describe('Initial state', () => {
    it('returns topScrollbarRef initialized to null', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      expect(result.topScrollbarRef.value).toBeNull()
    })

    it('returns topScrollbarInnerRef initialized to null', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      expect(result.topScrollbarInnerRef.value).toBeNull()
    })

    it('returns initScrollSync function', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      expect(typeof result.initScrollSync).toBe('function')
    })

    it('returns updateScrollbarWidth function', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      expect(typeof result.updateScrollbarWidth).toBe('function')
    })
  })

  describe('initScrollSync', () => {
    it('sets up scroll synchronization with table wrapper', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      // Create mock elements
      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')

      // Mock scrollWidth for updateScrollbarWidth
      Object.defineProperty(tableWrapper, 'scrollWidth', {
        value: 1000,
        writable: true
      })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      // Should not throw
      expect(() => result.initScrollSync(tableWrapper)).not.toThrow()
    })

    it('registers scroll event listeners', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')

      Object.defineProperty(tableWrapper, 'scrollWidth', { value: 1000 })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      const addEventListenerSpy = vi.spyOn(tableWrapper, 'addEventListener')

      result.initScrollSync(tableWrapper)

      expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
      expect(addEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function))
      expect(addEventListenerSpy).toHaveBeenCalledWith('auxclick', expect.any(Function))
    })

    it('registers document-level mouse event listeners', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')

      Object.defineProperty(tableWrapper, 'scrollWidth', { value: 1000 })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      const docAddEventListenerSpy = vi.spyOn(document, 'addEventListener')

      result.initScrollSync(tableWrapper)

      expect(docAddEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
      expect(docAddEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))
    })

    it('creates ResizeObserver for table wrapper', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')

      Object.defineProperty(tableWrapper, 'scrollWidth', { value: 1000 })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      const observeSpy = vi.spyOn(global.ResizeObserver.prototype, 'observe')

      result.initScrollSync(tableWrapper)

      expect(observeSpy).toHaveBeenCalledWith(tableWrapper)
    })

    it('calls updateScrollbarWidth initially', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')

      Object.defineProperty(tableWrapper, 'scrollWidth', { value: 1234 })

      // Browsers deliver an initial notification for every observed element;
      // the setup mock does not, so emulate it.
      vi.spyOn(global.ResizeObserver.prototype, 'observe').mockImplementation(function (this: {
        callback: ResizeObserverCallback
      }) {
        this.callback([], this as unknown as ResizeObserver)
      })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      result.initScrollSync(tableWrapper)

      // Inner width follows the table scrollWidth via the observer
      expect(topScrollbarInner.style.width).toBe('1234px')
    })

    it('does not read scrollWidth synchronously (no forced layout during mount)', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')
      const scrollWidth = vi.fn(() => 1000)
      Object.defineProperty(tableWrapper, 'scrollWidth', { get: scrollWidth })

      result.topScrollbarRef.value = document.createElement('div')
      result.topScrollbarInnerRef.value = topScrollbarInner
      result.initScrollSync(tableWrapper)

      expect(scrollWidth).not.toHaveBeenCalled()
      expect(topScrollbarInner.style.width).toBe('')
    })
  })

  describe('Memory leak regression tests (TEST-07)', () => {
    it('disconnects ResizeObserver on unmount', () => {
      const disconnectSpy = vi.spyOn(global.ResizeObserver.prototype, 'disconnect')

      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      // Create mock table wrapper element
      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')
      Object.defineProperty(tableWrapper, 'scrollWidth', { value: 1000 })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      result.initScrollSync(tableWrapper)

      // Unmount triggers onBeforeUnmount cleanup
      app.unmount()

      // CRITICAL ASSERTION: ResizeObserver must be disconnected
      expect(disconnectSpy).toHaveBeenCalled()
    })

    it('removes table wrapper event listeners on unmount', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')
      Object.defineProperty(tableWrapper, 'scrollWidth', { value: 1000 })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      result.initScrollSync(tableWrapper)

      const removeEventListenerSpy = vi.spyOn(tableWrapper, 'removeEventListener')

      app.unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('auxclick', expect.any(Function))
    })

    it('removes document event listeners on unmount', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')
      Object.defineProperty(tableWrapper, 'scrollWidth', { value: 1000 })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      result.initScrollSync(tableWrapper)

      const docRemoveEventListenerSpy = vi.spyOn(document, 'removeEventListener')

      app.unmount()

      // CRITICAL ASSERTION: Document listeners must be removed
      expect(docRemoveEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
      expect(docRemoveEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))
    })

    it('removes top scrollbar event listener on unmount', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')
      Object.defineProperty(tableWrapper, 'scrollWidth', { value: 1000 })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      result.initScrollSync(tableWrapper)

      const topScrollbarRemoveSpy = vi.spyOn(topScrollbar, 'removeEventListener')

      app.unmount()

      expect(topScrollbarRemoveSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
    })

    it('handles unmount without initScrollSync call gracefully', () => {
      const disconnectSpy = vi.spyOn(global.ResizeObserver.prototype, 'disconnect')

      const [, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      // Unmount without calling initScrollSync
      expect(() => app.unmount()).not.toThrow()

      // disconnect should not be called if ResizeObserver was never created
      expect(disconnectSpy).not.toHaveBeenCalled()
    })
  })

  describe('updateScrollbarWidth', () => {
    it('updates top scrollbar inner width to match table scrollWidth', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')

      // Use writable: true and configurable: true to allow redefinition
      Object.defineProperty(tableWrapper, 'scrollWidth', {
        value: 1500,
        writable: true,
        configurable: true
      })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      result.initScrollSync(tableWrapper)

      // Change scrollWidth
      Object.defineProperty(tableWrapper, 'scrollWidth', {
        value: 2000,
        writable: true,
        configurable: true
      })

      result.updateScrollbarWidth()

      expect(topScrollbarInner.style.width).toBe('2000px')
    })

    it('handles call without initialization gracefully', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      // Should not throw even if refs are null
      expect(() => result.updateScrollbarWidth()).not.toThrow()
    })
  })

  describe('Scroll synchronization behavior', () => {
    it('syncs top scrollbar scroll to table wrapper', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')
      Object.defineProperty(tableWrapper, 'scrollWidth', { value: 1000 })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      result.initScrollSync(tableWrapper)

      // Simulate scrolling top scrollbar
      topScrollbar.scrollLeft = 100
      topScrollbar.dispatchEvent(new Event('scroll'))

      expect(tableWrapper.scrollLeft).toBe(100)
    })

    it('syncs table wrapper scroll to top scrollbar', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')
      Object.defineProperty(tableWrapper, 'scrollWidth', { value: 1000 })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      result.initScrollSync(tableWrapper)

      // Simulate scrolling table wrapper
      tableWrapper.scrollLeft = 200
      tableWrapper.dispatchEvent(new Event('scroll'))

      expect(topScrollbar.scrollLeft).toBe(200)
    })
  })

  describe('ResizeObserver creation', () => {
    it('creates ResizeObserver that can be triggered manually via updateScrollbarWidth', () => {
      const [result, appInstance] = withSetup(() => useTableScroll())
      app = appInstance

      const topScrollbar = document.createElement('div')
      const topScrollbarInner = document.createElement('div')
      const tableWrapper = document.createElement('div')
      Object.defineProperty(tableWrapper, 'scrollWidth', {
        value: 1000,
        writable: true,
        configurable: true
      })

      result.topScrollbarRef.value = topScrollbar
      result.topScrollbarInnerRef.value = topScrollbarInner

      result.initScrollSync(tableWrapper)
      // Initial sync is the observer's first notification (see the width test)
      result.updateScrollbarWidth()

      expect(topScrollbarInner.style.width).toBe('1000px')

      // Change scrollWidth and manually trigger update (simulates ResizeObserver callback)
      Object.defineProperty(tableWrapper, 'scrollWidth', {
        value: 1500,
        writable: true,
        configurable: true
      })

      // ResizeObserver would call updateScrollbarWidth in real usage
      result.updateScrollbarWidth()

      expect(topScrollbarInner.style.width).toBe('1500px')
    })
  })
})
