import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const RENDERER_HTML_PATH = resolve(__dirname, '../../src/renderer/index.html')
const WEB_HTML_PATH = resolve(__dirname, '../../src/web/index.html')

const EXPECTED_SCRIPT_SRC = "'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:"

/**
 * Extracts the `content="..."` value of the `<meta http-equiv="Content-Security-Policy">`
 * tag from raw HTML source. Robust to attribute ordering and surrounding whitespace.
 */
function extractCspContent(html: string): string {
  const metaMatch = html.match(/<meta\s+[^>]*http-equiv="Content-Security-Policy"[^>]*>/i)
  if (!metaMatch) {
    throw new Error('No <meta http-equiv="Content-Security-Policy"> tag found')
  }
  const contentMatch = metaMatch[0].match(/content="([^"]*)"/i)
  if (!contentMatch) {
    throw new Error('CSP meta tag has no content="..." attribute')
  }
  return contentMatch[1]
}

/** Extracts a single directive's value (everything after the directive name) from a CSP string. */
function extractDirective(csp: string, directive: string): string {
  const directives = csp.split(';').map((d) => d.trim())
  const match = directives.find((d) => d.startsWith(`${directive} `) || d === directive)
  if (!match) {
    throw new Error(`Directive "${directive}" not found in CSP: ${csp}`)
  }
  return match.slice(directive.length).trim()
}

describe('CSP policy parity (renderer vs web)', () => {
  it('src/renderer/index.html has the expected script-src directive', () => {
    const html = readFileSync(RENDERER_HTML_PATH, 'utf-8')
    const csp = extractCspContent(html)
    expect(extractDirective(csp, 'script-src')).toBe(EXPECTED_SCRIPT_SRC)
  })

  it('src/web/index.html has the expected script-src directive', () => {
    const html = readFileSync(WEB_HTML_PATH, 'utf-8')
    const csp = extractCspContent(html)
    expect(extractDirective(csp, 'script-src')).toBe(EXPECTED_SCRIPT_SRC)
  })

  it('renderer and web CSP content strings are byte-identical (Codex F-08)', () => {
    const rendererHtml = readFileSync(RENDERER_HTML_PATH, 'utf-8')
    const webHtml = readFileSync(WEB_HTML_PATH, 'utf-8')
    const rendererCsp = extractCspContent(rendererHtml)
    const webCsp = extractCspContent(webHtml)
    expect(rendererCsp).toBe(webCsp)
  })
})
