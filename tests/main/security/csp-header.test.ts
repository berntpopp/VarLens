import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
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
  const match = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/>/
  )
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
})
