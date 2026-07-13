import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { buildContentSecurityPolicy } from '../../../src/main/security/csp-header'

/**
 * Extracts a single directive's value from a `; `-joined CSP policy string.
 * e.g. extractDirective("default-src 'self'; script-src 'self'", 'script-src')
 *   -> "'self'"
 */
function extractDirective(policy: string, directiveName: string): string {
  const directive = policy
    .split('; ')
    .find((entry) => entry === directiveName || entry.startsWith(`${directiveName} `))
  if (directive === undefined) {
    throw new Error(`Directive "${directiveName}" not found in policy: ${policy}`)
  }
  return directive.slice(directiveName.length).trim()
}

/**
 * Reads the meta CSP `content` attribute out of the shipped renderer HTML,
 * so tests fail loudly if the header builder ever drifts from the HTML.
 */
function readMetaCspFromHtml(): string {
  const htmlPath = join(__dirname, '../../../src/renderer/index.html')
  const html = readFileSync(htmlPath, 'utf-8')
  const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/>/)
  if (match === null) {
    throw new Error(`Could not find meta CSP tag in ${htmlPath}`)
  }
  return match[1]
}

describe('buildContentSecurityPolicy', () => {
  it('returns a script-src directive matching the shipped policy', () => {
    const policy = buildContentSecurityPolicy()
    expect(extractDirective(policy, 'script-src')).toBe(
      "'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:"
    )
  })

  it("includes frame-ancestors 'none' (header-only, meta tags cannot express it)", () => {
    const policy = buildContentSecurityPolicy()
    expect(policy).toContain("frame-ancestors 'none'")
  })

  it('includes the other security-relevant directives unmodified', () => {
    const policy = buildContentSecurityPolicy()
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'self'")
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("worker-src 'self' blob:")
  })

  it('anti-drift: script-src is byte-identical to the meta CSP in src/renderer/index.html', () => {
    const policy = buildContentSecurityPolicy()
    const metaCsp = readMetaCspFromHtml()
    const metaScriptSrc = extractDirective(metaCsp, 'script-src')
    const headerScriptSrc = extractDirective(policy, 'script-src')
    expect(headerScriptSrc).toBe(metaScriptSrc)
  })

  it('anti-drift: the full session-header policy is byte-identical to the meta CSP plus frame-ancestors', () => {
    const policy = buildContentSecurityPolicy()
    const metaCsp = readMetaCspFromHtml()
    expect(policy).toBe(`${metaCsp}; frame-ancestors 'none'`)
  })

  it('applies the authoritative header to app documents loaded as either main or subframes', async () => {
    const module = (await import('../../../src/main/security/csp-header')) as Record<
      string,
      unknown
    >
    const createHandler = module.createContentSecurityPolicyHeaderHandler

    expect(createHandler).toBeTypeOf('function')
    if (typeof createHandler !== 'function') return

    const appUrl = 'file:///app/renderer/index.html'
    const handler = createHandler((url: string) => url === appUrl) as (
      details: Partial<Electron.OnHeadersReceivedListenerDetails>,
      callback: (response: Electron.HeadersReceivedResponse) => void
    ) => void

    for (const resourceType of ['mainFrame', 'subFrame'] as const) {
      const callback = vi.fn()
      handler(
        {
          resourceType,
          url: appUrl,
          responseHeaders: { 'Existing-Header': ['kept'] }
        },
        callback
      )

      expect(callback).toHaveBeenCalledWith({
        responseHeaders: {
          'Existing-Header': ['kept'],
          'Content-Security-Policy': [buildContentSecurityPolicy()]
        }
      })
    }
  })

  it('does not rewrite subresources or unrelated frame documents', async () => {
    const module = (await import('../../../src/main/security/csp-header')) as Record<
      string,
      unknown
    >
    const createHandler = module.createContentSecurityPolicyHeaderHandler

    expect(createHandler).toBeTypeOf('function')
    if (typeof createHandler !== 'function') return

    const appUrl = 'file:///app/renderer/index.html'
    const handler = createHandler((url: string) => url === appUrl) as (
      details: Partial<Electron.OnHeadersReceivedListenerDetails>,
      callback: (response: Electron.HeadersReceivedResponse) => void
    ) => void

    for (const details of [
      { resourceType: 'script', url: appUrl },
      { resourceType: 'subFrame', url: 'https://attacker.example/frame' }
    ]) {
      const callback = vi.fn()
      handler({ ...details, responseHeaders: { 'Existing-Header': ['kept'] } }, callback)
      expect(callback).toHaveBeenCalledWith({
        responseHeaders: { 'Existing-Header': ['kept'] }
      })
    }
  })
})
