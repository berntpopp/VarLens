import { describe, expect, it } from 'vitest'
import { isMainWindowNavigationAllowed } from '../../src/main/window-navigation-policy'

const APP_DOC_URL = 'file:///app/renderer/index.html'

describe('main window navigation policy', () => {
  it('allows navigation within the development renderer origin', () => {
    expect(
      isMainWindowNavigationAllowed(
        'http://localhost:5173/assets/index.js',
        'http://localhost:5173',
        APP_DOC_URL
      )
    ).toBe(true)
  })

  it('allows navigation to the exact packaged app document', () => {
    expect(isMainWindowNavigationAllowed(APP_DOC_URL, undefined, APP_DOC_URL)).toBe(true)
  })

  it('blocks navigation to an arbitrary local file (S2)', () => {
    expect(isMainWindowNavigationAllowed('file:///tmp/evil.html', undefined, APP_DOC_URL)).toBe(
      false
    )
    expect(isMainWindowNavigationAllowed('file:///etc/passwd', undefined, APP_DOC_URL)).toBe(false)
  })

  it('blocks a remote file authority even when its pathname matches the app document', () => {
    expect(
      isMainWindowNavigationAllowed(
        'file://attacker/app/renderer/index.html',
        undefined,
        APP_DOC_URL
      )
    ).toBe(false)
  })

  it('allows router fragments but rejects query-bearing packaged document URLs', () => {
    expect(isMainWindowNavigationAllowed(`${APP_DOC_URL}#/variants`, undefined, APP_DOC_URL)).toBe(
      true
    )
    expect(isMainWindowNavigationAllowed(`${APP_DOC_URL}?next=evil`, undefined, APP_DOC_URL)).toBe(
      false
    )
  })

  it('blocks a dev-origin spoof that merely starts with the renderer URL (S2)', () => {
    // http://localhost:5173.evil.com starts with 'http://localhost:5173' as a
    // string, but is a different WHATWG origin entirely.
    expect(
      isMainWindowNavigationAllowed(
        'http://localhost:5173.evil.com/assets/index.js',
        'http://localhost:5173',
        APP_DOC_URL
      )
    ).toBe(false)
  })

  it('blocks non-file URLs when no development renderer URL is configured', () => {
    expect(isMainWindowNavigationAllowed('https://example.com', undefined, APP_DOC_URL)).toBe(false)
    expect(isMainWindowNavigationAllowed('https://example.com', '', APP_DOC_URL)).toBe(false)
  })

  it('blocks external URLs outside the development renderer origin', () => {
    expect(
      isMainWindowNavigationAllowed('https://example.com', 'http://localhost:5173', APP_DOC_URL)
    ).toBe(false)
  })

  it('blocks malformed URLs', () => {
    expect(isMainWindowNavigationAllowed('not a url', undefined, APP_DOC_URL)).toBe(false)
  })
})
